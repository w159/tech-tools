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
    a = max(0, m.start() - 80)
    return re.sub(r"\s+", " ", text[a : m.end() + 80]).strip()[:220]


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


def ingest_transcript(path, conn=None, session_id=None, force=False):
    """Ingest new lines of one transcript. Returns a small stats dict.
    Incremental via byte cursor; resets cleanly if the file was truncated."""
    own = conn is None
    if own:
        conn = atlas_db.connect()
        atlas_db.init(conn)
    stats = {"messages": 0, "tools": 0, "prompts": 0, "signals": 0, "results": 0}
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
            except Exception:
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
    stats = ingest_transcript(argv[0], force="--force" in argv)
    print(json.dumps(stats))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as e:  # never crash a caller
        print(f"session_ingest error: {e}", file=sys.stderr)
        sys.exit(0)
