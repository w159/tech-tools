#!/usr/bin/env python3
"""Model-scored quality judgments of assistant replies (TypeSafe / Jev).

Builds one exchange per real user prompt from the atlas.db `messages` mirror,
scores each with a single batched TypeSafe call, and writes the answers plus a
few deterministic metrics to `turn_scores`. Each judgment names the atlas
surface (output-style section or hook) to fix when it fires, so recurring
failures become findings the doctor can baseline and remeasure. Also fills the
facet enrichment columns (outcome, satisfaction, type, helpfulness).

Never runs in a hook's latency budget: ingest_session spawns it detached at
SessionEnd. Stdlib only; the API key is read by typesafe_client from the
environment and never touched here.

Usage:
  turn_scoring.py --session ID [--max-calls N] [--dry-run]
  turn_scoring.py --recent-days N [--limit N] [--max-calls N] [--dry-run]
  turn_scoring.py --status

Env: ATLAS_TYPESAFE_MAX_CALLS (default 200), plus typesafe_client's.
"""

import argparse
import os
import re
import sys
import time
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_db  # noqa: E402
import session_ingest  # noqa: E402
import typesafe_client  # noqa: E402

REQUEST_CAP = 4000
EARLIER_CAP = 800
EARLIER_N = 5
REPLY_CAP = 8000
DIGEST_CAP = 1500
HEADER_RE = re.compile(r"^ATLAS \|", re.M)
PUNCT_RE = re.compile("[\u2014\u2013\u2018\u2019\u201c\u201d\u2026]")

METRICS = ("header_present", "banned_punct", "reply_chars")

# Stored judgment ids. The doctor mines these. Compound failures are not asked
# as one noul: _ATOMIC holds one yes/no each, and _fold_answers combines them
# into the id below. State fields are already named, so questions do not repeat
# a field glossary.
JUDGMENTS = {
    "literal_ask_delivered": {
        "type": "noul",
        "hit": "low",
        "surface": "style: Deliver the literal ask",
        "instructions": "Stored value is the lower of the two atomic nouls.",
        "criteria": {
            "true": "Both atomic nouls are high.",
            "false": "A named deliverable is missing, or the format does not match.",
        },
    },
    "done_claim_unverified": {
        "type": "noul",
        "hit": "high",
        "surface": "style: Evidence on the user's surface; hook: hooks/completion_gate.py",
        "instructions": "Stored value is asserts_success times (1 - names_observed_result).",
        "criteria": {
            "true": "The reply claims success and does not quote an observed result.",
            "false": "No success claim, or the claim quotes a command, count, file:line, or rows.",
        },
    },
    "scope_drift": {
        "type": "noul",
        "hit": "high",
        "surface": "style: Scope is what was named",
        "instructions": "The reply reports edits the request did not name.",
        "criteria": {
            "true": "The reply names a change the request did not ask for.",
            "false": "The reported work stays inside the request. A closing offer of more work is false.",
        },
    },
    "ignored_standing_correction": {
        "type": "noul",
        "hit": "high",
        "surface": "style: Corrections stick",
        "instructions": "The reply repeats a mistake the user already corrected.",
        "criteria": {
            "true": "An earlier user message corrected this, and the reply does it again.",
            "false": "No earlier correction, or the reply follows it.",
        },
    },
    "buried_decision": {
        "type": "noul",
        "hit": "high",
        "surface": "style: Decisions stop the line",
        "instructions": "Stored value is the decided_without_asking noul.",
        "criteria": {
            "true": "The reply picked a blocking option and kept working.",
            "false": "No blocking choice, or the reply asked before doing the work.",
        },
    },
    "next_turn_correction": {
        "type": "noul",
        "hit": "high",
        "surface": "outcome",
        "instructions": "next_user_message corrects this reply or repeats the request.",
        "criteria": {
            "true": "The next user message says this reply was wrong, incomplete, or ignored.",
            "false": "The next message accepts it, continues it, or starts a new request.",
        },
    },
    "verbosity": {
        "type": "score",
        "hit": "high",
        "surface": "style: Length budget",
        "top_value": 3,
        "instructions": "How long is the reply relative to the request? Quoted command output is not padding.",
        "criteria": [
            "Shorter than the request needed",
            "Proportionate to the request",
            "Longer than the request needed",
            "Mostly recap and narration",
        ],
    },
}

# One observable per noul. Code combines these into the JUDGMENTS ids.
_ATOMIC = {
    "literal_ask_delivered": {
        "covers_named_deliverable": {
            "type": "noul",
            "instructions": "The reply includes each deliverable the request named.",
            "criteria": {
                "true": "Each named deliverable is present, or the reply only asks a clarifying question.",
                "false": "A named deliverable is missing or replaced with something else.",
            },
        },
        "matches_requested_format": {
            "type": "noul",
            "instructions": "The reply uses the format the request named.",
            "criteria": {
                "true": "The format matches, or the request named no format.",
                "false": "The request named a format and the reply uses a different one.",
            },
        },
    },
    "done_claim_unverified": {
        "asserts_success": {
            "type": "noul",
            "instructions": "The reply states that the work is done, fixed, or passing.",
            "criteria": {
                "true": "Says done, fixed, passing, or verified.",
                "false": "No success claim, or it says the check was not run.",
            },
        },
        "names_observed_result": {
            "type": "noul",
            "instructions": "The reply quotes a command result, a test count, a file and line, or query rows.",
        },
    },
    "buried_decision": {
        "decided_without_asking": {
            "type": "noul",
            "instructions": "The reply picked a blocking option itself and kept working.",
        },
    },
}

FACET_OUTCOMES = {
    "success": "The user's main goal was achieved by the end of the session.",
    "partial": "Some of the goal was achieved but material work remained.",
    "failed": "The goal was not achieved.",
    "blocked": "Work stopped on an external blocker (access, missing input, "
    "environment) rather than on the assistant's effort.",
}
FACET_SATISFACTION = {
    "positive": "The user expressed or implied approval or thanks.",
    "neutral": "No clear signal either way.",
    "negative": "The user expressed frustration, corrected the assistant "
    "repeatedly, or abandoned the work.",
}
FACET_TYPES = {
    "coding": "Writing or modifying application code",
    "debugging": "Diagnosing and fixing a defect",
    "devops": "Infrastructure, deployment, CI, cloud or admin operations",
    "docs": "Writing or updating documentation",
    "meta": "Work on the assistant tooling, prompts, or session process itself",
    "orchestration": "Coordinating subagents or multi-step delegated runs",
    "planning": "Designing or planning without implementing",
    "plugin-dev": "Developing plugins, hooks, skills or agents",
    "research": "Investigation, exploration, or answering questions",
    "summary-handoff": "Producing summaries or handoff documents",
    "ui-coding": "Building or changing user interface code",
}
HELPFULNESS_LEVELS = [
    "1: unhelpful or harmful, the assistant wasted the user's time",
    "2: slightly helpful, most of the value came from the user correcting it",
    "3: moderately helpful, useful with notable gaps or rework",
    "4: very helpful, minor issues only",
    "5: essential, the assistant delivered exactly what was needed",
]


def _facet_questions():
    ctx = (
        "The state is a compact digest of one AI coding assistant session: the "
        "user's first prompt, their last three prompts, the assistant's last "
        "reply, and how many times the user corrected the assistant. "
    )
    return {
        "outcome": {
            "type": "choice",
            "instructions": ctx + "What was the outcome of the session?",
            "criteria": FACET_OUTCOMES,
        },
        "user_satisfaction": {
            "type": "choice",
            "instructions": ctx + "How satisfied was the user at the end?",
            "criteria": FACET_SATISFACTION,
        },
        "session_type": {
            "type": "choice",
            "instructions": ctx + "Which kind of work best describes the session?",
            "criteria": FACET_TYPES,
        },
        "claude_helpfulness": {
            "type": "score",
            "instructions": ctx + "How helpful was the assistant overall?",
            "criteria": HELPFULNESS_LEVELS,
        },
    }


# --- exchange building --------------------------------------------------------


def _scrub(text):
    return session_ingest.SECRET_VAL.sub("***", text or "")


def _metrics(text):
    return {
        "header_present": 1.0 if HEADER_RE.search(text) else 0.0,
        "banned_punct": float(len(PUNCT_RE.findall(text))),
        "reply_chars": float(len(text)),
    }


def _tail_within(texts, cap):
    """Concatenate the last few text blocks that fit within cap (a single
    oversized block is truncated from its start so the ending survives)."""
    picked, used = [], 0
    for t in reversed(texts):
        if used + len(t) > cap and picked:
            break
        picked.append(t[-cap:] if len(t) > cap else t)
        used += len(t)
    return "\n\n".join(reversed(picked))


def build_exchanges(conn, session_id):
    """Exchanges for one session, oldest first. A real user prompt is a
    `messages` user row whose uuid is in `user_prompts` (ingest already drops
    tool_result rows and hook-injected text from that table). Sidechain rows
    are ignored. Exchanges without assistant text are dropped."""
    prompts = {
        r[0]
        for r in conn.execute(
            "SELECT uuid FROM user_prompts WHERE session_id=?", (session_id,)
        )
    }
    errors = [
        r[0]
        for r in conn.execute(
            "SELECT ts FROM tool_calls WHERE session_id=? AND is_error=1 "
            "AND COALESCE(is_sidechain,0)=0",
            (session_id,),
        )
        if r[0] is not None
    ]
    rows = conn.execute(
        "SELECT uuid, ts, role, text FROM messages WHERE session_id=? "
        "AND COALESCE(is_sidechain,0)=0 ORDER BY ts, id",
        (session_id,),
    ).fetchall()
    turns = []  # dicts: prompt, ts, texts, last_uuid, last_ts
    for uuid, ts, role, text in rows:
        if role == "user":
            if uuid in prompts and text:
                turns.append({"prompt": text, "ts": ts, "texts": [], "uuid": None})
        elif role == "assistant" and text and turns:
            turns[-1]["texts"].append(text)
            turns[-1]["uuid"] = uuid
            turns[-1]["last_ts"] = ts
    out = []
    for i, t in enumerate(turns):
        if not t["texts"]:
            continue
        nxt = turns[i + 1] if i + 1 < len(turns) else None
        lo = t["ts"] or 0
        hi = nxt["ts"] if nxt and nxt["ts"] else float("inf")
        earlier = [
            _scrub(p["prompt"])[:EARLIER_CAP] for p in turns[max(0, i - EARLIER_N) : i]
        ]
        state = {
            "request": _scrub(t["prompt"])[:REQUEST_CAP],
            "earlier_user_messages": earlier,
            "reply": _scrub(_tail_within(t["texts"], REPLY_CAP)),
            "tool_error_count_in_turn": sum(1 for e in errors if lo <= e < hi),
        }
        if nxt:
            state["next_user_message"] = _scrub(nxt["prompt"])[:REQUEST_CAP]
        out.append(
            {
                "message_uuid": t["uuid"],
                "ts": t["last_ts"],
                "state": state,
                "metrics": _metrics("\n".join(t["texts"])),
            }
        )
    return out


def _stored_ids(state, only=None):
    """Judgment ids written to turn_scores. Not the atomic wire ids."""
    ids = []
    for jid in JUDGMENTS:
        if jid == "next_turn_correction" and "next_user_message" not in state:
            continue
        if only is not None and jid not in only:
            continue
        ids.append(jid)
    return ids


def _questions_for(state, only=None):
    """Wire questions. Compound judgments expand to one noul per observable."""
    qs = {}
    for jid in _stored_ids(state, only):
        parts = _ATOMIC.get(jid)
        if parts:
            for aid, spec in parts.items():
                qs[f"{jid}__{aid}"] = spec
            continue
        spec = JUDGMENTS[jid]
        qs[jid] = {
            "type": spec["type"],
            "instructions": spec["instructions"],
            "criteria": spec["criteria"],
        }
    return qs


def _noul(answers, key):
    ans = answers.get(key)
    if isinstance(ans, dict) and isinstance(ans.get("noul"), (int, float)):
        return float(ans["noul"])
    return None


def _fold_answers(answers):
    """Combine atomic nouls into the judgment ids the doctor mines.

    literal_ask_delivered is the lower of its two bits (a miss on either is a
    miss). done_claim_unverified is high only when the reply claims success
    and does not quote a result. buried_decision is decided_without_asking
    alone: a trailing 'let me know' must not cancel a choice already made.
    """
    folded = {}
    covers = _noul(answers, "literal_ask_delivered__covers_named_deliverable")
    fmt = _noul(answers, "literal_ask_delivered__matches_requested_format")
    if covers is not None and fmt is not None:
        folded["literal_ask_delivered"] = {"type": "noul", "noul": min(covers, fmt)}
    asserts = _noul(answers, "done_claim_unverified__asserts_success")
    named = _noul(answers, "done_claim_unverified__names_observed_result")
    if asserts is not None and named is not None:
        folded["done_claim_unverified"] = {
            "type": "noul",
            "noul": asserts * (1.0 - named),
        }
    decided = _noul(answers, "buried_decision__decided_without_asking")
    if decided is not None:
        folded["buried_decision"] = {"type": "noul", "noul": decided}
    for jid, ans in answers.items():
        if "__" in jid or jid in folded:
            continue
        folded[jid] = ans
    return folded


# --- answer -> row ------------------------------------------------------------


def _answer_fields(ans):
    """Map one API answer to turn_scores fields (kind/value/label/confidence)."""
    kind = ans.get("type")
    if kind == "noul":
        return {"kind": "noul", "value": ans.get("noul")}
    if kind == "score":
        score = ans.get("score")
        legend = ans.get("legend") or {}
        label = legend.get(str(int(round(score)))) if score is not None else None
        return {
            "kind": "score",
            "value": score,
            "label": label,
            "confidence": ans.get("confidence"),
        }
    if kind == "choice":
        choice = ans.get("choice")
        return {
            "kind": "choice",
            "value": (ans.get("probabilities") or {}).get(choice),
            "label": choice,
            "confidence": ans.get("confidence"),
        }
    return None


def _write_answers(conn, session_id, ex, resp, only):
    model = resp.get("model")
    tokens = (resp.get("usage") or {}).get("input_tokens")
    n = 0
    for jid, ans in _fold_answers(resp.get("answers") or {}).items():
        if jid not in only:
            continue
        f = _answer_fields(ans or {})
        if not f:
            continue
        atlas_db.upsert_turn_score(
            conn,
            session_id,
            ex["message_uuid"],
            jid,
            ts=ex["ts"],
            model=model,
            input_tokens=tokens if n == 0 else None,
            **f,
        )
        n += 1
    return n


def _write_metrics(conn, session_id, ex):
    for mid, val in ex["metrics"].items():
        atlas_db.upsert_turn_score(
            conn,
            session_id,
            ex["message_uuid"],
            mid,
            ts=ex["ts"],
            kind="metric",
            value=val,
        )


def _existing(conn, session_id):
    have = {}
    for uuid, jid in conn.execute(
        "SELECT message_uuid, judgment FROM turn_scores WHERE session_id=?",
        (session_id,),
    ):
        have.setdefault(uuid, set()).add(jid)
    return have


# --- facets -------------------------------------------------------------------


def build_facet_state(conn, session_id):
    prompts = [
        _scrub(r[0])
        for r in conn.execute(
            "SELECT text FROM user_prompts WHERE session_id=? ORDER BY ts, id",
            (session_id,),
        )
        if r[0]
    ]
    if not prompts:
        return None
    last = conn.execute(
        "SELECT text FROM messages WHERE session_id=? AND role='assistant' "
        "AND COALESCE(is_sidechain,0)=0 AND text IS NOT NULL AND text != '' "
        "ORDER BY ts DESC, id DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    corr = conn.execute(
        "SELECT correction_count FROM facets WHERE session_id=?", (session_id,)
    ).fetchone()
    return {
        "first_prompt": prompts[0][:DIGEST_CAP],
        "last_prompts": [p[:DIGEST_CAP] for p in prompts[-3:]],
        "last_reply": _scrub(last[0] if last else "")[-DIGEST_CAP * 2 :],
        "correction_count": (corr[0] or 0) if corr else 0,
    }


def _facet_pending(conn, session_id):
    row = conn.execute(
        "SELECT enriched_at FROM facets WHERE session_id=?", (session_id,)
    ).fetchone()
    return bool(row) and row[0] is None


def _apply_facet(conn, session_id, resp):
    ans = resp.get("answers") or {}
    fields: dict[str, Any] = {"enriched_at": time.time()}
    for col in ("outcome", "user_satisfaction", "session_type"):
        choice = (ans.get(col) or {}).get("choice")
        if choice:
            fields[col] = choice
    score = (ans.get("claude_helpfulness") or {}).get("score")
    if score is not None:
        fields["claude_helpfulness"] = str(max(1, min(5, int(round(score)) + 1)))
    atlas_db.upsert_facet(conn, session_id, **fields)
    return fields


# --- session driver -----------------------------------------------------------


def default_max_calls():
    try:
        return int(os.environ.get("ATLAS_TYPESAFE_MAX_CALLS", "200"))
    except ValueError:
        return 200


def score_session(
    conn, session_id, client: Any = typesafe_client, max_calls=None, dry_run=False
):
    """Score every unscored exchange of one session (one batched call each),
    then enrich the session's pending facet row. Idempotent: exchanges whose
    applicable judgments are all stored cost zero calls. Returns a summary."""
    if max_calls is None:
        max_calls = default_max_calls()
    summary = {
        "session_id": session_id,
        "exchanges": 0,
        "scored": 0,
        "calls": 0,
        "rows": 0,
        "input_tokens": 0,
        "state_chars": 0,
        "facet_enriched": False,
        "stopped": None,
        "error": None,
    }
    have = _existing(conn, session_id)
    exchanges = build_exchanges(conn, session_id)
    summary["exchanges"] = len(exchanges)
    # Long sessions hit the cap; keep one call for the facet so the sessions
    # the miners care most about still get outcome/satisfaction filled in.
    reserve = 1 if max_calls > 1 and _facet_pending(conn, session_id) else 0

    def fail(e):
        summary["error"] = str(e)
        if not dry_run:
            atlas_db.upsert_turn_score(
                conn,
                session_id,
                "_session",
                "scoring_error",
                kind="error",
                label=str(e)[:500],
                value=float(e.status),
                scored_at=time.time(),
            )

    def call(state, questions):
        summary["calls"] += 1
        if dry_run:
            summary["state_chars"] += len(str(state))
            return None
        resp = client.evaluate(state, questions)
        summary["input_tokens"] += (resp.get("usage") or {}).get("input_tokens") or 0
        return resp

    for ex in exchanges:
        if not dry_run:
            _write_metrics(conn, session_id, ex)
        want = set(_stored_ids(ex["state"]))
        missing = want - have.get(ex["message_uuid"], set())
        if not missing:
            continue
        if summary["calls"] >= max_calls - reserve:
            summary["stopped"] = "max_calls"
            break
        try:
            resp = call(ex["state"], _questions_for(ex["state"], only=missing))
        except typesafe_client.TypeSafeError as e:
            fail(e)
            if e.status == 422:
                continue
            summary["stopped"] = "error"
            return summary
        summary["scored"] += 1
        if resp:
            summary["rows"] += _write_answers(conn, session_id, ex, resp, missing)

    if summary["stopped"] in (None, "max_calls") and _facet_pending(conn, session_id):
        fstate = build_facet_state(conn, session_id)
        if fstate:
            if summary["calls"] >= max_calls:
                summary["stopped"] = "max_calls"
            else:
                try:
                    resp = call(fstate, _facet_questions())
                except typesafe_client.TypeSafeError as e:
                    fail(e)
                    summary["stopped"] = "error"
                    return summary
                if resp:
                    _apply_facet(conn, session_id, resp)
                    summary["facet_enriched"] = True
    return summary


def recent_sessions(conn, days, limit=None):
    since = time.time() - days * 86400
    sql = (
        "SELECT session_id FROM messages WHERE ts >= ? GROUP BY session_id "
        "ORDER BY MAX(ts) DESC"
    )
    args = [since]
    if limit:
        sql += " LIMIT ?"
        args.append(limit)
    return [r[0] for r in conn.execute(sql, args)]


def status(conn):
    now = time.time()
    total, last, tokens = conn.execute(
        "SELECT COUNT(*), MAX(scored_at), COALESCE(SUM(input_tokens),0) FROM turn_scores"
    ).fetchone()
    week = conn.execute(
        "SELECT COUNT(*) FROM turn_scores WHERE scored_at >= ? AND judgment != 'scoring_error'",
        (now - 7 * 86400,),
    ).fetchone()[0]
    errors_7d, last_error = recent_errors(conn, now)
    return {
        "key_present": bool(os.environ.get("TYPESAFE_API_KEY", "").strip()),
        "scoring_enabled": typesafe_client.available(),
        "rows_total": total,
        "rows_last_7d": week,
        "last_scored_at": last,
        "total_input_tokens": tokens,
        "errors_last_7d": errors_7d,
        "last_error": last_error,
    }


def recent_errors(conn, now=None):
    """(count in last 7 days, latest error label) of recorded scoring failures,
    so a bad key or a 429 storm is visible instead of silently scoring nothing."""
    since = (now or time.time()) - 7 * 86400
    count = conn.execute(
        "SELECT COUNT(*) FROM turn_scores WHERE judgment='scoring_error' AND scored_at >= ?",
        (since,),
    ).fetchone()[0]
    row = conn.execute(
        "SELECT label FROM turn_scores WHERE judgment='scoring_error' "
        "ORDER BY scored_at DESC LIMIT 1"
    ).fetchone()
    return count, (row[0] if row else None)


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    ap.add_argument("--session")
    ap.add_argument("--recent-days", type=float)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--max-calls", type=int)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args(argv)
    conn = atlas_db.connect()
    atlas_db.init(conn)
    if args.status:
        s = status(conn)
        print(
            f"key present: {'yes' if s['key_present'] else 'no'}"
            f" (scoring {'enabled' if s['scoring_enabled'] else 'disabled'})\n"
            f"rows total: {s['rows_total']}\nrows last 7d: {s['rows_last_7d']}\n"
            f"last scored_at: {s['last_scored_at']}\n"
            f"total input_tokens: {s['total_input_tokens']}\n"
            f"errors last 7d: {s['errors_last_7d']}"
            + (f" (latest: {s['last_error'][:200]})" if s["last_error"] else "")
        )
        return 0
    if args.session:
        sessions = [args.session]
    elif args.recent_days:
        sessions = recent_sessions(conn, args.recent_days, args.limit)
    else:
        ap.error("one of --session, --recent-days, --status is required")
    if not args.dry_run and not typesafe_client.available():
        print(
            "scoring unavailable: set TYPESAFE_API_KEY (and not ATLAS_TYPESAFE_SCORING=off)"
        )
        return 0
    budget = args.max_calls if args.max_calls is not None else default_max_calls()
    totals = {
        "sessions": 0,
        "exchanges": 0,
        "calls": 0,
        "rows": 0,
        "input_tokens": 0,
        "state_chars": 0,
    }
    for sid in sessions:
        if budget <= 0:
            break
        s = score_session(conn, sid, max_calls=budget, dry_run=args.dry_run)
        budget -= s["calls"]
        totals["sessions"] += 1
        for k in ("exchanges", "calls", "rows", "input_tokens", "state_chars"):
            totals[k] += s[k]
        if s["error"]:
            print(f"{sid}: {s['error']}")
            if s["stopped"] == "error":
                break
    print(
        ("dry-run " if args.dry_run else "")
        + " ".join(f"{k}={v}" for k, v in totals.items())
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
