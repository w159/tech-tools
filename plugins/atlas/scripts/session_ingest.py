#!/usr/bin/env python3
"""Mirror Claude Code session transcripts into the atlas observability DB.

Claude Code already writes a complete jsonl transcript per session under
~/.claude/projects/<encoded-root>/<session-id>.jsonl. That file - not a hook
payload - is the lossless record of every message, tool call, tool result, and
token-usage number. This module parses those transcripts incrementally (by byte
cursor, so each call only reads new lines) and lands normalized rows in
messages / tool_calls / user_prompts / signals via atlas_db.

Two entry points:
  - ingest_transcript(path) for one session (the Stop/SessionEnd hook calls this)
  - main() CLI:  session_ingest.py <path>      ingest one transcript
                 session_ingest.py --backfill  walk ~/.claude/projects
                 session_ingest.py --backfill-agent codex [root]
                                               walk another agent's session tree
                                               (codex defaults to ~/.codex/sessions)

Beyond claude, a pluggable adapter layer (AGENT_ADAPTERS) chronicles other
coding agents' sessions into the same store; codex is the first adapter. The
claude Stop/SessionEnd hook path never triggers cross-agent ingest - that runs
only via the explicit --backfill-agent CLI.

Stdlib-only. Never stores raw secrets: tool inputs are summarized and scrubbed.
Designed to fail safe - a malformed line is skipped, not fatal.
"""

import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import atlas_db  # noqa: E402

# --- tool classification ------------------------------------------------------

# Plugins whose product name is more recognizable than their internal server
# segment (claude-mem's server is literally "mcp-search"; context-mode's is
# "context-mode"). For these, the plugin name becomes the `server` value so the
# context-tool health check can find them.
PRODUCT_PLUGINS = {"context-mode", "claude-mem", "context7"}


def classify(tool_name, tinput):
    """Return (kind, target, server). kind in builtin|skill|mcp|agent."""
    n = tool_name or ""
    tinput = tinput or {}
    if n.startswith("mcp__"):
        srvpart, _, toolpart = n[5:].partition("__")
        if srvpart.startswith("plugin_"):
            plugin, _, srv = srvpart[7:].partition("_")
            server = plugin if plugin in PRODUCT_PLUGINS else (srv or plugin)
        else:
            server = srvpart
        target = f"{server}.{toolpart}" if toolpart else server
        return "mcp", target, server
    if n == "Skill":
        return "skill", (tinput.get("skill") or tinput.get("command") or "?"), None
    if n in ("Agent", "Task"):
        return "agent", (tinput.get("subagent_type") or n), None
    return "builtin", n, None


# --- secret-safe input summary ------------------------------------------------

SECRET_KEY = re.compile(
    r"(pass|pwd|secret|token|api[_-]?key|authorization|bearer|credential"
    r"|client_secret|connection[_-]?string|private[_-]?key)",
    re.I,
)
SECRET_VAL = re.compile(
    r"(eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+"  # JWT
    r"|sk-[A-Za-z0-9]{16,}"  # OpenAI-style
    r"|AKIA[0-9A-Z]{16}"  # AWS access key
    r"|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"  # GitHub
    r"|xox[baprs]-[A-Za-z0-9-]{10,}"  # Slack
    r"|Bearer\s+[\w.\-]{10,})",  # bearer header
)


def summarize_input(tinput):
    """Compact, secret-scrubbed JSON of a tool input, capped to 500 chars.
    Returns (summary, true_byte_size)."""
    tinput = tinput or {}
    raw = json.dumps(tinput, default=str)
    parts = {}
    for k, v in tinput.items():
        if SECRET_KEY.search(str(k)):
            parts[k] = "***"
            continue
        sv = v if isinstance(v, str) else json.dumps(v, default=str)
        parts[k] = SECRET_VAL.sub("***", sv)[:200]
    return SECRET_VAL.sub("***", json.dumps(parts, default=str))[:500], len(raw)


# --- behavioral signal taggers ------------------------------------------------

ADMISSION = re.compile(
    r"\b(never (actually |even )?(tried|tested|implemented|attempted|ran|"
    r"verified|wired|checked)|just assumed|i assumed|assumed it (would|was)|"
    r"did ?n'?t (actually )?(try|test|implement|verify|run|check|wire)|"
    r"had ?n'?t (actually )?(tried|tested|run|verified|checked|implemented)|"
    r"without (actually )?(testing|trying|verifying|running|checking)|"
    r"i never (actually )?(tested|tried|ran|verified|wired|implemented))\b",
    re.I,
)
UNVERIFIED = re.compile(
    r"\b(should (work|fix|resolve|be fine|do it)|"
    r"this should (work|fix|resolve)|that should (work|fix|do it))\b",
    re.I,
)
CORRECTION = re.compile(
    r"\b(that'?s (wrong|not right|incorrect|not what)|"
    r"you (lied|never|did ?n'?t actually|claimed|said)|"
    r"stop (doing|assuming|making)|why did you (assume|say|claim|not)|"
    r"you said .{0,40}? but|no,? (it|that|you|don'?t|stop)|"
    r"actually,? (no|it|that|you))\b",
    re.I,
)
SIGNAL_WEIGHT = {
    "assumption_admission": 2.0,
    "user_correction": 1.5,
    "unverified_claim": 0.5,
}


def _snippet(text, m):
    """Extract the full sentence(s) containing the match, not a ±80 char fragment.

    Mid-sentence fragments like "rule the previous version of this skill failed
    to enforce" are useless — the reader can't tell what rule or what skill. We
    expand to sentence boundaries so the snippet is self-contained.
    """
    # Find sentence boundaries: split on . / ! / ? followed by whitespace, or
    # newlines.  Fall back to the old ±80 window if no sentence boundary is
    # found (e.g. very long run-on text).
    sentence_end = re.compile(r"[.!?]\s+|\n+")
    start = m.start()
    end = m.end()

    # Walk backwards to find the start of the containing sentence
    prefix = text[:start]
    parts = sentence_end.split(prefix)
    if parts and len(parts[-1].strip()) > 0:
        sent_start = start - len(parts[-1])
    else:
        sent_start = max(0, start - 80)

    # Walk forwards to find the end of the containing sentence
    remainder = text[end:]
    next_end = re.search(r"[.!?]\s+|\n", remainder)
    if next_end:
        sent_end = end + next_end.end()
    else:
        sent_end = min(len(text), end + 80)

    snippet = re.sub(r"\s+", " ", text[sent_start:sent_end]).strip()
    return snippet[:300]


def detect_signals(role, text):
    """Yield (signal_type, weight, snippet) for one message's text."""
    if not text:
        return
    if role == "assistant":
        m = ADMISSION.search(text)
        if m:
            yield (
                "assumption_admission",
                SIGNAL_WEIGHT["assumption_admission"],
                _snippet(text, m),
            )
        m = UNVERIFIED.search(text)
        if m:
            yield (
                "unverified_claim",
                SIGNAL_WEIGHT["unverified_claim"],
                _snippet(text, m),
            )
    elif role == "user":
        m = CORRECTION.search(text)
        if m:
            yield "user_correction", SIGNAL_WEIGHT["user_correction"], _snippet(text, m)


# --- transcript parsing -------------------------------------------------------

CAP = 20000  # per-field text cap keeps the DB bounded under full-fidelity mode
# Machine-generated openings that are NOT human prompts: slash-command wrappers,
# interrupt markers, continuation nudges, and claude-mem's observer-agent
# instructions. Counting these as user prompts would drown the real
# repeated-request signal (the observer prompt alone recurs thousands of times).
NOISE_PREFIXES = (
    "<command-name>",
    "<command-message>",
    "<local-command",
    "Caveat:",
    "<bash-",
    "[Request interrupted",
    "[Your previous response",
    "You are a Claude-Mem",
    "Hello memory agent",
    "<observed_from_primary_session>",
    "--- MODE SWITCH",
    "This session is being continued",
    "Base directory for this skill:",
    "<ide_opened_file>",
    "<ide_selection>",
    "<system-reminder>",
)


def _blocks(msg):
    c = msg.get("content")
    if isinstance(c, str):
        return [{"type": "text", "text": c}]
    return c if isinstance(c, list) else []


def _is_real_prompt(text, blocks):
    if not text or len(text.strip()) < 2:
        return False
    if any(b.get("type") == "tool_result" for b in blocks):
        return False
    return not text.lstrip().startswith(NOISE_PREFIXES)


# --- synthetic-session exclusion ----------------------------------------------

# Path fragments that mark a transcript as a synthetic mirror of another agent's
# work rather than a real coding run. claude-mem writes an observer transcript
# per session under ~/.claude-mem/observer-sessions; mirroring those into
# session_logs duplicates every observed session and drowns every sextant
# rollup (they were 96.8% of session_logs rows). Extend this tuple - one place -
# when new synthetic-session sources appear.
SYNTHETIC_SESSION_MARKERS = (".claude-mem/observer-sessions",)


def is_synthetic_session(path=None, cwd=None):
    """True when a transcript path or its recorded cwd lives under a known
    synthetic-session directory. Such transcripts must not land a session_logs
    row (nor any child rows); see SYNTHETIC_SESSION_MARKERS."""
    for candidate in (path, cwd):
        if not candidate:
            continue
        norm = str(candidate).replace("\\", "/")
        if any(marker in norm for marker in SYNTHETIC_SESSION_MARKERS):
            return True
    return False


def _read_session_cwd(path):
    """Peek the first recorded cwd in a transcript, for the cwd-based synthetic
    check. cwd is present on essentially every Claude Code transcript line."""
    try:
        with open(path, "rb") as f:
            for raw in f:
                if not raw.strip():
                    continue
                cwd = json.loads(raw).get("cwd")
                if cwd:
                    return cwd
    except Exception:
        pass
    return None


def ingest_transcript(path, conn=None, session_id=None, force=False):
    """Ingest new lines of one transcript. Returns a small stats dict.
    Incremental via byte cursor; resets cleanly if the file was truncated."""
    # `skipped` counts per-line failures that were swallowed rather than fatal
    # (corrupt JSON, unparseable records); `skip_reasons` keeps a few samples so a
    # silent partial ingest is observable. See M15.
    stats = {
        "messages": 0,
        "tools": 0,
        "prompts": 0,
        "signals": 0,
        "results": 0,
        "skipped": 0,
        "skip_reasons": [],
    }
    # Never mirror a synthetic session (e.g. claude-mem observer transcripts):
    # no session_logs row, no child rows. Bail before opening the DB.
    if is_synthetic_session(path=path, cwd=_read_session_cwd(path)):
        return stats
    own = conn is None
    if own:
        conn = atlas_db.connect()
        atlas_db.init(conn)
    try:
        if not session_id:
            session_id = (
                _read_session_id(path) or os.path.splitext(os.path.basename(path))[0]
            )
        size = os.path.getsize(path)
        cursor, _prev = atlas_db.session_cursor(conn, session_id)
        if force or cursor > size:  # truncated/rewritten/forced -> full re-ingest
            atlas_db.reset_session_rows(conn, session_id)
            cursor = 0
        if cursor == size:
            return stats  # nothing new
        with open(path, "rb") as f:
            f.seek(cursor)
            data = f.read()
        nl = data.rfind(b"\n")
        if nl == -1:
            return stats  # no complete line yet
        new_cursor = cursor + nl + 1
        meta = {
            "cwd": None,
            "git_branch": None,
            "model": None,
            "started_at": None,
            "ended_at": None,
            "project_id": None,
        }
        for raw in data[: nl + 1].split(b"\n"):
            if not raw.strip():
                continue
            try:
                obj = json.loads(raw)
            except Exception as e:
                # Skip, do not abort: a single corrupt line must not sink the
                # whole ingest. Record it so the silent partial result is
                # observable (M15).
                stats["skipped"] += 1
                if len(stats["skip_reasons"]) < 5:
                    stats["skip_reasons"].append(
                        f"json parse failed: {type(e).__name__}: {e}"
                    )
                continue
            _ingest_line(conn, session_id, obj, meta, stats)
        # link project from the cwd seen in the transcript
        if meta["cwd"]:
            try:
                meta["project_id"] = atlas_db.register_project(
                    conn, meta["cwd"], os.path.basename(meta["cwd"].rstrip("/"))
                )
            except Exception:
                pass
        atlas_db.upsert_session_log(
            conn,
            session_id,
            project_id=meta["project_id"],
            transcript_path=path,
            cwd=meta["cwd"],
            git_branch=meta["git_branch"],
            model=meta["model"],
            started_at=meta["started_at"],
            ended_at=meta["ended_at"],
            cursor_bytes=new_cursor,
            file_size=size,
            file_mtime=os.path.getmtime(path),
            last_ingest_at=time.time(),
        )
        atlas_db.refresh_session_aggregates(conn, session_id)
        # The mirror is now current for this session, so the run-health columns
        # that no live hook can fill (est_context_tokens, verifier_coverage,
        # parallel_waves, in_flight_peak) can be derived. Attach to the latest
        # run for the session whether or not the Stop hook already closed it.
        try:
            rid = atlas_db.latest_run_id(conn, session_id)
            if rid is not None:
                atlas_db.derive_run_metrics(conn, rid, session_id)
        except Exception:
            pass  # derivation is best-effort; never break ingest
        conn.commit()
    finally:
        if own:
            conn.close()
    return stats


def _read_session_id(path):
    try:
        with open(path, "rb") as f:
            for raw in f:
                if not raw.strip():
                    continue
                sid = json.loads(raw).get("sessionId")
                if sid:
                    return sid
                break
    except Exception:
        pass
    return None


def _ingest_line(conn, session_id, obj, meta, stats):
    ts = _epoch(obj.get("timestamp"))
    if obj.get("cwd"):
        meta["cwd"] = obj["cwd"]
    if obj.get("gitBranch"):
        meta["git_branch"] = obj["gitBranch"]
    if ts:
        meta["started_at"] = meta["started_at"] or ts
        meta["ended_at"] = ts
    mtype = obj.get("type")
    if mtype not in ("user", "assistant", "system"):
        return
    msg = obj.get("message") or {}
    role = msg.get("role") or mtype
    blocks = _blocks(msg)
    thinking, texts = [], []
    for b in blocks:
        if not isinstance(b, dict):
            continue
        bt = b.get("type")
        if bt == "text":
            texts.append(b.get("text", ""))
        elif bt == "thinking":
            thinking.append(b.get("thinking", "") or b.get("text", ""))
        elif bt == "tool_use":
            _ingest_tool_use(conn, session_id, obj, b, ts, stats)
        elif bt == "tool_result":
            _ingest_tool_result(conn, b, stats)
    text = "\n".join(t for t in texts if t).strip()
    think = "\n".join(t for t in thinking if t).strip()
    usage = msg.get("usage") or {}
    if msg.get("model"):
        meta["model"] = msg["model"]
    uuid = obj.get("uuid")
    if uuid:
        atlas_db.insert_message(
            conn,
            session_id,
            {
                "uuid": uuid,
                "parent_uuid": obj.get("parentUuid"),
                "ts": ts,
                "role": role,
                "is_sidechain": 1 if obj.get("isSidechain") else 0,
                "model": msg.get("model"),
                "thinking": think[:CAP] or None,
                "text": text[:CAP] or None,
                "input_tokens": usage.get("input_tokens"),
                "output_tokens": usage.get("output_tokens"),
                "cache_read_tokens": usage.get("cache_read_input_tokens"),
                "cache_creation_tokens": usage.get("cache_creation_input_tokens"),
                "service_tier": usage.get("service_tier"),
            },
        )
        stats["messages"] += 1
    if role == "user" and _is_real_prompt(text, blocks):
        atlas_db.insert_user_prompt(
            conn,
            session_id,
            {
                "uuid": uuid,
                "ts": ts,
                "text": text[:CAP],
                "char_len": len(text),
                "norm": _normalize(text),
            },
        )
        stats["prompts"] += 1
    for stype, weight, snip in detect_signals(role, text):
        atlas_db.insert_signal(
            conn,
            session_id,
            {
                "message_uuid": uuid,
                "ts": ts,
                "signal_type": stype,
                "weight": weight,
                "snippet": snip,
            },
        )
        stats["signals"] += 1


def _ingest_tool_use(conn, session_id, obj, block, ts, stats):
    tinput = block.get("input") or {}
    kind, target, server = classify(block.get("name"), tinput)
    summary, ibytes = summarize_input(tinput)
    atlas_db.insert_tool_call(
        conn,
        session_id,
        {
            "message_uuid": obj.get("uuid"),
            "ts": ts,
            "is_sidechain": 1 if obj.get("isSidechain") else 0,
            "tool_use_id": block.get("id"),
            "tool_name": block.get("name"),
            "kind": kind,
            "target": target,
            "server": server,
            "input_summary": summary,
            "input_bytes": ibytes,
            "is_error": None,
            "result_bytes": None,
        },
    )
    stats["tools"] += 1


def _ingest_tool_result(conn, block, stats):
    tuid = block.get("tool_use_id")
    if not tuid:
        return
    content = block.get("content")
    rbytes = (
        len(content)
        if isinstance(content, str)
        else len(json.dumps(content, default=str))
    )
    is_err = 1 if block.get("is_error") in (True, "true", "True") else 0
    atlas_db.update_tool_result(conn, tuid, is_err, rbytes)
    stats["results"] += 1


def _epoch(ts):
    if not ts:
        return None
    try:
        from datetime import datetime

        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def _normalize(text):
    """Collapse a prompt to a clustering key: lowercase, drop punctuation and
    digits, squash whitespace, first 120 chars. Recurring asks collide here."""
    t = re.sub(r"[^a-z0-9\s]", " ", text.lower())
    t = re.sub(r"\s+", " ", t).strip()
    return t[:120] or None


# --- multi-agent ingest interface ---------------------------------------------

# The claude path above is transcript-shape-specific (Claude Code jsonl). Other
# coding agents (codex today; cursor/cline/aider tomorrow) write different files.
# To chronicle every agent without duplicating the persistence layer, an adapter
# is a callable(path) -> iterator of normalized record dicts, and one generic
# driver (ingest_agent_session) lands them through the SAME atlas_db helpers.
#
# A record is one of:
#   {"kind":"meta",   "session_id","agent","cwd","model","started_at","ended_at"}
#   {"kind":"message","uuid","parent_uuid","ts","role","model","text","thinking",
#                     "input_tokens","output_tokens","cache_read_tokens",
#                     "cache_creation_tokens","service_tier"}
#   {"kind":"tool_call","message_uuid","ts","tool_use_id","tool_name","input"}
#   {"kind":"tool_result","tool_use_id","is_error","result_bytes"}
# Adding a new agent is one adapter function plus one AGENT_ADAPTERS entry.
# Missing fields stay absent (persisted as NULL) - never invented.


def _persist_agent_message(conn, meta, rec, stats):
    """Persist one normalized message record: the messages row plus, where the
    text warrants it, a user_prompt and any behavioral signals - the same
    downstream pipeline the claude path feeds, reused verbatim."""
    sid = meta["session_id"]
    ts = rec.get("ts")
    if ts is not None:
        if meta["started_at"] is None or ts < meta["started_at"]:
            meta["started_at"] = ts
        if meta["ended_at"] is None or ts > meta["ended_at"]:
            meta["ended_at"] = ts
    uuid = rec.get("uuid")
    role = rec.get("role")
    text = (rec.get("text") or "").strip()
    think = (rec.get("thinking") or "").strip()
    if uuid:
        atlas_db.insert_message(
            conn,
            sid,
            {
                "uuid": uuid,
                "parent_uuid": rec.get("parent_uuid"),
                "ts": ts,
                "role": role,
                "is_sidechain": 0,
                "model": rec.get("model") or meta.get("model"),
                "thinking": think[:CAP] or None,
                "text": text[:CAP] or None,
                "input_tokens": rec.get("input_tokens"),
                "output_tokens": rec.get("output_tokens"),
                "cache_read_tokens": rec.get("cache_read_tokens"),
                "cache_creation_tokens": rec.get("cache_creation_tokens"),
                "service_tier": rec.get("service_tier"),
            },
        )
        stats["messages"] += 1
    if role == "user" and _is_real_prompt(text, []):
        atlas_db.insert_user_prompt(
            conn,
            sid,
            {
                "uuid": uuid,
                "ts": ts,
                "text": text[:CAP],
                "char_len": len(text),
                "norm": _normalize(text),
            },
        )
        stats["prompts"] += 1
    for stype, weight, snip in detect_signals(role, text):
        atlas_db.insert_signal(
            conn,
            sid,
            {
                "message_uuid": uuid,
                "ts": ts,
                "signal_type": stype,
                "weight": weight,
                "snippet": snip,
            },
        )
        stats["signals"] += 1


def _persist_agent_tool_call(conn, meta, rec, stats):
    """Persist one normalized tool-call record. Runs the input through the same
    secret-scrubbing summarizer the claude path uses."""
    tinput = rec.get("input") or {}
    kind, target, server = classify(rec.get("tool_name"), tinput)
    summary, ibytes = summarize_input(tinput)
    atlas_db.insert_tool_call(
        conn,
        meta["session_id"],
        {
            "message_uuid": rec.get("message_uuid"),
            "ts": rec.get("ts"),
            "is_sidechain": 0,
            "tool_use_id": rec.get("tool_use_id"),
            "tool_name": rec.get("tool_name"),
            "kind": kind,
            "target": target,
            "server": server,
            "input_summary": summary,
            "input_bytes": ibytes,
            "is_error": None,
            "result_bytes": None,
        },
    )
    stats["tools"] += 1


def ingest_agent_session(path, adapter, conn=None, session_id=None):
    """Drive one non-claude session file through the normalized records its
    `adapter` yields, persisting via atlas_db. Full-file reparse each call;
    idempotent because every insert helper is INSERT OR IGNORE keyed on a stable
    id the adapter assigns. Honors the same synthetic-session exclusion the
    claude path does (by path and by the cwd the adapter reports)."""
    stats = {"messages": 0, "tools": 0, "prompts": 0, "signals": 0, "results": 0}
    if is_synthetic_session(path=path):
        return stats
    own = conn is None
    if own:
        conn = atlas_db.connect()
        atlas_db.init(conn)
    try:
        meta = {
            "session_id": session_id,
            "agent": None,
            "cwd": None,
            "model": None,
            "started_at": None,
            "ended_at": None,
            "project_id": None,
        }
        for rec in adapter(path):
            kind = rec.get("kind")
            if kind == "meta":
                for k in ("session_id", "agent", "cwd", "model"):
                    if rec.get(k) is not None:
                        meta[k] = rec[k]
                if rec.get("started_at") is not None and (
                    meta["started_at"] is None or rec["started_at"] < meta["started_at"]
                ):
                    meta["started_at"] = rec["started_at"]
                if rec.get("ended_at") is not None:
                    meta["ended_at"] = rec["ended_at"]
                # A synthetic mirror can also be identified by the cwd the agent
                # records; bail before persisting anything if it matches.
                if meta["cwd"] and is_synthetic_session(cwd=meta["cwd"]):
                    return {k: 0 for k in stats}
            elif kind == "message":
                _persist_agent_message(conn, meta, rec, stats)
            elif kind == "tool_call":
                _persist_agent_tool_call(conn, meta, rec, stats)
            elif kind == "tool_result":
                tuid = rec.get("tool_use_id")
                if tuid:
                    atlas_db.update_tool_result(
                        conn, tuid, rec.get("is_error"), rec.get("result_bytes")
                    )
                    stats["results"] += 1
        sid = meta["session_id"] or os.path.splitext(os.path.basename(path))[0]
        meta["session_id"] = sid
        if meta["cwd"]:
            try:
                meta["project_id"] = atlas_db.register_project(
                    conn, meta["cwd"], os.path.basename(meta["cwd"].rstrip("/"))
                )
            except Exception:
                pass
        size = os.path.getsize(path)
        atlas_db.upsert_session_log(
            conn,
            sid,
            agent=meta["agent"],
            project_id=meta["project_id"],
            transcript_path=path,
            cwd=meta["cwd"],
            model=meta["model"],
            started_at=meta["started_at"],
            ended_at=meta["ended_at"],
            cursor_bytes=size,
            file_size=size,
            file_mtime=os.path.getmtime(path),
            last_ingest_at=time.time(),
        )
        atlas_db.refresh_session_aggregates(conn, sid)
        conn.commit()
    finally:
        if own:
            conn.close()
    return stats


def _codex_text(content):
    """Flatten a codex message `content` array to plain text. Codex uses
    input_text (user/developer) and output_text (assistant) block types."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    out = []
    for b in content:
        if isinstance(b, dict) and b.get("type") in (
            "input_text",
            "output_text",
            "text",
        ):
            out.append(b.get("text", ""))
    return "\n".join(t for t in out if t)


def _codex_args(arguments):
    """Codex tool arguments arrive as a JSON string (function_call.arguments) or
    a raw string (custom_tool_call.input). Return a dict for summarize_input;
    fall back to wrapping an unparseable value rather than dropping it."""
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str):
        try:
            parsed = json.loads(arguments)
            return parsed if isinstance(parsed, dict) else {"arguments": arguments}
        except Exception:
            return {"arguments": arguments[:2000]}
    return {}


def codex_adapter(path):
    """Parse a codex rollout JSONL (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
    into normalized records. Codex lines are {"timestamp","type","payload"}:
      session_meta   -> session id, cwd, start time
      turn_context   -> model
      event_msg/user_message  -> the human prompt
      event_msg/token_count   -> per-turn token usage (attached to the next
                                 assistant message; never fabricated)
      response_item/message (role=assistant) -> agent output text
      response_item/function_call | custom_tool_call        -> tool call
      response_item/function_call_output | custom_tool_call_output -> its result
    Message uuids and tool_use_ids are stable (session id + sequence, codex
    call_id) so a re-run of backfill dedupes rather than duplicates."""
    sid = None
    seq = 0
    pending_usage = None
    last_msg_uuid = None
    with open(path, "rb") as f:
        for raw in f:
            if not raw.strip():
                continue
            try:
                obj = json.loads(raw)
            except Exception:
                continue
            typ = obj.get("type")
            payload = obj.get("payload")
            if not isinstance(payload, dict):
                continue
            ts = _epoch(obj.get("timestamp"))
            if typ == "session_meta":
                sid = payload.get("id") or os.path.splitext(os.path.basename(path))[0]
                yield {
                    "kind": "meta",
                    "session_id": sid,
                    "agent": "codex",
                    "cwd": payload.get("cwd"),
                    "model": payload.get("model"),
                    "started_at": _epoch(payload.get("timestamp")) or ts,
                }
            elif typ == "turn_context":
                if payload.get("model"):
                    yield {"kind": "meta", "model": payload["model"]}
            elif typ == "event_msg":
                st = payload.get("type")
                if st == "user_message":
                    text = payload.get("message")
                    if text:
                        seq += 1
                        yield {
                            "kind": "message",
                            "uuid": f"{sid}:{seq}",
                            "ts": ts,
                            "role": "user",
                            "text": text,
                        }
                elif st == "token_count":
                    info = payload.get("info") or {}
                    ltu = info.get("last_token_usage") or {}
                    if ltu:
                        pending_usage = {
                            "input_tokens": ltu.get("input_tokens"),
                            "output_tokens": ltu.get("output_tokens"),
                            "cache_read_tokens": ltu.get("cached_input_tokens"),
                            "cache_creation_tokens": None,
                        }
            elif typ == "response_item":
                st = payload.get("type")
                if st == "message" and payload.get("role") == "assistant":
                    seq += 1
                    last_msg_uuid = f"{sid}:{seq}"
                    rec = {
                        "kind": "message",
                        "uuid": last_msg_uuid,
                        "ts": ts,
                        "role": "assistant",
                        "text": _codex_text(payload.get("content")),
                    }
                    if pending_usage:
                        rec.update(pending_usage)
                        pending_usage = None
                    yield rec
                elif st in ("function_call", "custom_tool_call"):
                    args = (
                        payload.get("arguments")
                        if st == "function_call"
                        else payload.get("input")
                    )
                    yield {
                        "kind": "tool_call",
                        "message_uuid": last_msg_uuid,
                        "ts": ts,
                        "tool_use_id": payload.get("call_id"),
                        "tool_name": payload.get("name"),
                        "input": _codex_args(args),
                    }
                elif st in ("function_call_output", "custom_tool_call_output"):
                    out = payload.get("output")
                    if out is None:
                        rbytes = None
                    elif isinstance(out, str):
                        rbytes = len(out)
                    else:
                        rbytes = len(json.dumps(out, default=str))
                    yield {
                        "kind": "tool_result",
                        "tool_use_id": payload.get("call_id"),
                        "is_error": None,  # codex output carries no reliable error flag
                        "result_bytes": rbytes,
                    }


# agent name -> (adapter callable, default session root). Extend both here when
# adding an agent; the driver and CLI are already generic over this table.
AGENT_ADAPTERS = {"codex": codex_adapter}
AGENT_DEFAULT_ROOTS = {"codex": "~/.codex/sessions"}


def backfill_agent(agent, root=None, conn=None):
    """Walk an agent's on-disk session tree and ingest every session file via
    that agent's registered adapter. Path-overridable (tests pass a temp tree).
    Codex files are rollout-*.jsonl under a YYYY/MM/DD date tree."""
    adapter = AGENT_ADAPTERS.get(agent)
    if adapter is None:
        raise ValueError(f"no adapter registered for agent {agent!r}")
    root = root or os.path.expanduser(AGENT_DEFAULT_ROOTS.get(agent, "."))
    own = conn is None
    if own:
        conn = atlas_db.connect()
        atlas_db.init(conn)
    totals = {"files": 0, "messages": 0, "tools": 0, "prompts": 0, "signals": 0}
    try:
        for dirpath, _dirs, files in os.walk(root):
            for fn in files:
                if not (fn.startswith("rollout-") and fn.endswith(".jsonl")):
                    continue
                p = os.path.join(dirpath, fn)
                if is_synthetic_session(path=p):
                    continue
                try:
                    s = ingest_agent_session(p, adapter, conn=conn)
                except Exception:
                    continue
                totals["files"] += 1
                for k in ("messages", "tools", "prompts", "signals"):
                    totals[k] += s.get(k, 0)
                if totals["files"] % 200 == 0:
                    print(f"  ...{totals['files']} {agent} sessions", file=sys.stderr)
    finally:
        if own:
            conn.close()
    return totals


# --- backfill -----------------------------------------------------------------


def backfill(root=None, conn=None):
    root = root or os.path.expanduser("~/.claude/projects")
    own = conn is None
    if own:
        conn = atlas_db.connect()
        atlas_db.init(conn)
    totals = {"files": 0, "messages": 0, "tools": 0, "prompts": 0, "signals": 0}
    try:
        for dirpath, _dirs, files in os.walk(root):
            for fn in files:
                if not fn.endswith(".jsonl"):
                    continue
                p = os.path.join(dirpath, fn)
                if is_synthetic_session(path=p):
                    continue  # skip observer-session mirrors and other synthetics
                try:
                    s = ingest_transcript(p, conn=conn)
                except Exception:
                    continue
                totals["files"] += 1
                for k in ("messages", "tools", "prompts", "signals"):
                    totals[k] += s.get(k, 0)
                if totals["files"] % 200 == 0:
                    print(f"  ...{totals['files']} transcripts", file=sys.stderr)
    finally:
        if own:
            conn.close()
    return totals


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if argv[0] == "--backfill":
        root = argv[1] if len(argv) > 1 else None
        t0 = time.time()
        print(f"Backfilling transcripts from {root or '~/.claude/projects'} ...")
        totals = backfill(root)
        out = {**totals, "seconds": round(time.time() - t0, 1)}
        print(json.dumps(out, indent=2))
        return 0
    if argv[0] == "--backfill-agent":
        if len(argv) < 2 or argv[1] not in AGENT_ADAPTERS:
            print(
                "usage: session_ingest.py --backfill-agent <%s> [root]"
                % "|".join(sorted(AGENT_ADAPTERS)),
                file=sys.stderr,
            )
            return 2
        agent = argv[1]
        root = argv[2] if len(argv) > 2 else None
        default_root = AGENT_DEFAULT_ROOTS.get(agent, ".")
        t0 = time.time()
        print(f"Backfilling {agent} sessions from {root or default_root} ...")
        totals = backfill_agent(agent, root)
        out = {**totals, "agent": agent, "seconds": round(time.time() - t0, 1)}
        print(json.dumps(out, indent=2))
        return 0
    stats = ingest_transcript(argv[0], force="--force" in argv)
    print(json.dumps(stats))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as e:  # never crash a caller
        print(f"session_ingest error: {e}", file=sys.stderr)
        sys.exit(0)
