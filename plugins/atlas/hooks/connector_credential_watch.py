#!/usr/bin/env python3
"""PostToolUse hook -- stop a stale-credential MCP connector from eating a session.

Measured failure (insight report 2026-08-18): the ConnectWise connector returned
HTTP 400 "Invalid Token" on every endpoint and the session kept trying other
endpoints for an hour, producing no data. Ramp and CIPP burned sessions the same
way. The tell is always in the FIRST response, and it is always the same shape:
401/403, or a 400 whose body says the token is invalid or expired.

This hook reads the tool_response of any `mcp__*` call, and when it sees that
shape it injects one instruction: the running MCP server holds the stale
credential, so restart it -- do not sweep the rest of the endpoints. Once per
server per session, so a connector that is genuinely down does not nag on every
call.

Advisory only: additionalContext, never a deny. A misfire costs one paragraph.
Fail-open on every error path. Disable with ATLAS_CONNECTOR_WATCH=off.

Stdlib only.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


def _state_path() -> Path:
    base = os.environ.get("ATLAS_HOME") or str(Path.home() / ".atlas")
    return Path(base) / "connector_auth_warned.json"


# A 401/403 only counts as a status (not as a number inside data): it must follow a
# status-ish word or precede the standard reason phrase. A bare 400 is also a plain
# bad-argument error, so it only counts when the body names the token or credential.
_HARD_AUTH = re.compile(
    r"\b(?:status(?:_?code)?|http|code|error)\W{0,3}(?:401|403)\b|"
    r"\b(?:401|403)\s+(?:unauthorized|forbidden)|\bunauthorized\b|\bforbidden\b|"
    r"invalid[ _-]?token|expired[ _-]?token|token[ _-]?expired|"
    r"invalid[ _-]?(?:client|credential|api[ _-]?key)|"
    r"authentication[ _-]?failed|invalid_grant",
    re.I,
)
_STATUS_400 = re.compile(r"\b(?:status(?:_?code)?|http|code)\W{0,3}400\b", re.I)
_NAMES_CREDENTIAL = re.compile(
    r"invalid[ _-]?token|expired|invalid[ _-]?(?:client|credential|api[ _-]?key)|"
    r"invalid_grant|unauthorized",
    re.I,
)
# A plain-text (non-isError) response counts as an error only when it OPENS with an
# error banner; a data payload that merely mentions 401/forbidden further in never does.
_BANNER = re.compile(
    r"\s*(?:error\b|http\W{0,3}\d{3}|status\W{0,3}\d{3}|\d{3}\b)", re.I
)
_STATUS_KEYS = ("status", "status_code", "statusCode", "http_status")


# Servers whose tool_response is file content or command output, not an API
# result. Their payloads routinely CONTAIN the words this hook hunts for -- a
# ctx_read of connector source, or a grep for auth patterns, would otherwise
# inject a false "restart the server" order mid-task. Same context-hijack class
# as nudge.py landing in subagent context. The hooks.json matcher already
# narrows to connector prefixes; this is the guard that survives a matcher edit.
CONTENT_SERVERS = (
    "lean-ctx",
    "context-mode",
    "mcp-search",
    "claude-mem",
    "serena",
    "context7",
    "microsoft-docs",
)


def _is_content_server(tool_name: str) -> bool:
    # omp device names use underscores (mcp__lean_ctx_...), Claude Code hyphens.
    norm = tool_name.replace("_", "-")
    return any(name in norm for name in CONTENT_SERVERS)


_ATLAS_SERVER = re.compile(r"^mcp__(?:plugin_)?atlas_([a-z0-9]+)", re.I)


def _server_of(tool_name: str) -> str:
    """`mcp__plugin_atlas_connectwise__cw_x` and omp `mcp__atlas_connectwise_cw_x` -> `connectwise`."""
    m = _ATLAS_SERVER.match(tool_name)
    if m:
        return m.group(1).lower()
    parts = tool_name.split("__")
    return parts[1] if len(parts) >= 3 else tool_name


def _block_text(content) -> str:
    """Join the text blocks of an MCP `content` list."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(
        b["text"]
        for b in content
        if isinstance(b, dict) and isinstance(b.get("text"), str)
    )


def _status_of(resp: dict):
    for key in _STATUS_KEYS:
        v = resp.get(key)
        if isinstance(v, int) and not isinstance(v, bool):
            return v
        if isinstance(v, str) and v.strip().isdigit():
            return int(v)
    return None


def error_text(resp) -> str:
    """The text to inspect for an auth failure, or "" when `resp` carries no error signal.

    An error signal is: MCP isError, a top-level 4xx status / non-empty `error` field, or
    (plain text only) an opening error banner. Payload words such as "Unauthorized login"
    or a count of 403 inside a successful result are data, never an error."""
    if isinstance(resp, list):
        return error_text({"content": resp})
    if isinstance(resp, str):
        s = resp.strip()
        if s.startswith("{"):
            try:
                obj = json.loads(s)
            except ValueError:
                obj = None
            if isinstance(obj, dict):
                return error_text(obj)
        return s[:2000] if _BANNER.match(s) else ""
    if not isinstance(resp, dict):
        return ""
    text = _block_text(resp.get("content"))
    if resp.get("isError") is True or resp.get("is_error") is True:
        return (text or json.dumps(resp, default=str))[:2000]
    status = _status_of(resp)
    if status in (400, 401, 403) or resp.get("error"):
        return json.dumps(resp, default=str)[:2000]
    if text:
        return error_text(text)  # content blocks without isError: plain-text rules
    return ""


def looks_like_auth_failure(text: str) -> bool:
    """True only for a credential failure, not for a generic bad request."""
    if not text:
        return False
    head = text[:2000]
    if not _HARD_AUTH.search(head):
        return False
    if _STATUS_400.search(head) and not re.search(r"\b(?:401|403)\b", head):
        return bool(_NAMES_CREDENTIAL.search(head))
    return True


def _record(exc: BaseException) -> None:
    try:
        sys.path.insert(
            0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
        )
        import atlas_faults

        atlas_faults.record("connector_credential_watch", exc)
    except Exception:  # noqa: BLE001 -- the recorder must never become the fault
        pass


def _already_warned(session: str, server: str) -> bool:
    """One warning per server per session. Fail-open to 'not warned'."""
    key = "%s|%s" % (session, server)
    path = _state_path()
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(state, dict):
            state = {}
    except (OSError, ValueError):
        state = {}
    if key in state:
        return True
    state[key] = True
    # Bound the file: keep the most recent 200 keys, drop the rest.
    if len(state) > 200:
        state = dict(list(state.items())[-200:])
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.parent / (".%s.tmp%d" % (path.name, os.getpid()))
        tmp.write_text(json.dumps(state), encoding="utf-8")
        os.replace(tmp, path)
    except OSError as exc:
        _record(exc)  # a lost write costs one duplicate warning
    return False


def main() -> int:
    if os.environ.get("ATLAS_CONNECTOR_WATCH", "on").lower() == "off":
        return 0
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except ValueError as exc:
        _record(exc)
        return 0
    if not isinstance(payload, dict):
        return 0
    try:
        tool = str(payload.get("tool_name", ""))
        if not tool.startswith("mcp__") or _is_content_server(tool):
            return 0
        if not looks_like_auth_failure(error_text(payload.get("tool_response"))):
            return 0
        server = _server_of(tool)
        if _already_warned(str(payload.get("session_id", "")), server):
            return 0
        msg = (
            "[atlas] STALE CREDENTIAL: %s returned an auth failure on %s. A running "
            "MCP server caches its credentials at startup, so a rotated secret does "
            "not reach it and EVERY other endpoint on this server will fail the same "
            "way. Do NOT retry other endpoints. Tell the user which credential is "
            "stale and that the MCP server needs a restart (/mcp, or restart Claude "
            "Code), or fall back to a direct API call with a key they supply. Retrying "
            "this connector is what turns a 30-second fix into a lost session."
            % (server, tool)
        )
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PostToolUse",
                        "additionalContext": msg,
                    }
                }
            )
        )
    except Exception as exc:  # noqa: BLE001 -- advisory hook, never break a tool call
        _record(exc)
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
