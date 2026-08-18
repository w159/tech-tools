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

STATE_RELPATH = Path.home() / ".atlas" / "connector_auth_warned.json"

# 401/403 are unambiguous. A bare 400 is not (it is also a bad-argument error),
# so it only counts when the body names the token or the credential.
_STATUS = re.compile(r"\b(?:status(?:_code)?|http)\W{0,3}(401|403|400)\b", re.I)
_HARD_AUTH = re.compile(
    r"\b(401|403)\b|\bunauthorized\b|\bforbidden\b|"
    r"invalid[ _-]?token|expired[ _-]?token|token[ _-]?expired|"
    r"invalid[ _-]?(?:client|credential|api[ _-]?key)|"
    r"authentication[ _-]?failed|invalid_grant",
    re.I,
)


def _server_of(tool_name: str) -> str:
    """`mcp__plugin_atlas_connectwise__cw_search_tickets` -> the server segment."""
    parts = tool_name.split("__")
    return parts[1] if len(parts) >= 3 else tool_name


def _response_text(payload: dict) -> str:
    """Flatten tool_response to searchable text without assuming its shape."""
    resp = payload.get("tool_response")
    if resp is None:
        return ""
    if isinstance(resp, str):
        return resp
    try:
        return json.dumps(resp)
    except (TypeError, ValueError):
        return str(resp)


def looks_like_auth_failure(text: str) -> bool:
    """True only for a credential failure, not for a generic bad request."""
    if not text:
        return False
    head = text[:4000]  # a long payload's tail is data, not the error banner
    if not _HARD_AUTH.search(head):
        return False
    m = _STATUS.search(head)
    if m and m.group(1) == "400":
        # A 400 counts only when the body actually names the credential.
        return bool(
            re.search(
                r"invalid[ _-]?token|expired|invalid[ _-]?(?:client|credential|"
                r"api[ _-]?key)|invalid_grant|unauthorized",
                head,
                re.I,
            )
        )
    return True


def _already_warned(session: str, server: str) -> bool:
    """One warning per server per session. Fail-open to 'not warned'."""
    key = "%s|%s" % (session, server)
    try:
        state = json.loads(STATE_RELPATH.read_text(encoding="utf-8"))
        if not isinstance(state, dict):
            state = {}
    except (OSError, json.JSONDecodeError, ValueError):
        state = {}
    if key in state:
        return True
    state[key] = True
    # Bound the file: keep the most recent 200 keys, drop the rest.
    if len(state) > 200:
        state = dict(list(state.items())[-200:])
    try:
        STATE_RELPATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATE_RELPATH.parent / (".%s.tmp%d" % (STATE_RELPATH.name, os.getpid()))
        tmp.write_text(json.dumps(state), encoding="utf-8")
        os.replace(tmp, STATE_RELPATH)
    except OSError:
        pass  # a lost write costs one duplicate warning
    return False


def main() -> int:
    if os.environ.get("ATLAS_CONNECTOR_WATCH", "on").lower() == "off":
        return 0
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        return 0
    if not isinstance(payload, dict):
        return 0
    try:
        tool = str(payload.get("tool_name", ""))
        if not tool.startswith("mcp__"):
            return 0
        if not looks_like_auth_failure(_response_text(payload)):
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
    except Exception:  # noqa: BLE001 -- advisory hook, never break a tool call
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
