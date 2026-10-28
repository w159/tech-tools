#!/usr/bin/env python3
"""Hooks for an atlas crew worker (scripts/atlas_crew.py). Wired through the worker's own
--settings, so they run only inside crew workers, never in the lead or a normal session.

  PostToolUse  push unread team-channel messages into the worker's context (additionalContext),
               so a peer's question or announcement lands at the worker's next tool boundary; and end
               the session (continue:false) right after a Bash call whose check just posted DONE and
               whose check, re-run here, passes (no final model turn)
  PreToolUse   file leases: Edit/Write/MultiEdit/NotebookEdit outside the worker's owned paths is
               denied with the owner's name, and so is a Bash command that plainly writes a peer's
               file (redirect, tee, sed -i, cp/mv, open(..,'w'), Path.write_*); a Bash command with
               `sleep N` (N >= 3 s) is denied: workers wait with `irc wait` / `irc check`
  Stop         the adversarial gate: the worker may not stop until its own check command passes
               (re-run here, never taken from the worker's word) and it has seen every message
               addressed to it; after ATLAS_CREW_MAX_BLOCKS refusals it is let go and the failure
               is posted to the channel. On the way out it posts DONE / GAVE UP to the channel.

Env (pinned by atlas_crew per worker): ATLAS_IRC_DIR, ATLAS_IRC_NICK, ATLAS_CREW_OWNS (JSON list
of paths or globs relative to ATLAS_CREW_ROOT), ATLAS_CREW_OWNERS (JSON {glob: nick}),
ATLAS_CREW_CHECK (`irc check` when a unit check exists), ATLAS_CREW_NEEDS and ATLAS_CREW_UNIT_CHECK (read by
`irc check`), ATLAS_CREW_ROOT, ATLAS_CREW_MAX_BLOCKS (default 3).
Stdlib only. Every failure path is fail-open: a broken hook must never wedge a worker.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import atlas_irc  # noqa: E402

EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
CHECK_TIMEOUT_S = 600
TAIL_CHARS = 3500


def _env_json(name, default):
    try:
        return json.loads(os.environ.get(name) or "")
    except ValueError:
        return default


def _rel(path: str, root: str) -> str:
    try:
        return os.path.relpath(os.path.realpath(path), os.path.realpath(root))
    except ValueError:
        return path


def owns(rel: str, patterns) -> bool:
    for p in patterns:
        p = p.rstrip("/")
        if rel == p or fnmatch.fnmatch(rel, p) or rel.startswith(p + "/"):
            return True
    return False


def owner_of(rel: str, owners: dict):
    for pat, nick in owners.items():
        if owns(rel, [pat]):
            return nick
    return None


def _out(obj) -> None:
    sys.stdout.write(json.dumps(obj))


def _early_exit(payload, d: str, nick: str) -> bool:
    """True when this Bash call posted the worker's DONE (its check ends in `irc done`) and the check,
    re-run here, still passes: the session can end now instead of spending a model turn on a reply.
    Never taken from the post alone: a worker could run `irc done` by hand."""
    cmd = os.environ.get("ATLAS_CREW_CHECK") or ""
    if payload.get("tool_name") != "Bash" or not cmd or not atlas_irc.has_done(d, nick):
        return False
    code, _ = run_check(cmd, os.environ.get("ATLAS_CREW_ROOT") or os.getcwd())
    if code == 0:
        _set_blocks(_blocks(), passed=True)  # Stop does not run after continue:false; the summary reads this
    return code == 0


def post_tool_use(payload) -> None:
    d, nick = os.environ.get("ATLAS_IRC_DIR"), os.environ.get("ATLAS_IRC_NICK")
    if not d or not nick:
        return
    out = {}
    recs = atlas_irc.drain(d, nick)
    if recs:
        lines = "\n".join("[irc] " + atlas_irc.fmt(r) for r in recs)
        out["hookSpecificOutput"] = {
            "hookEventName": "PostToolUse",
            "additionalContext": "Team channel (peer messages; reply with `irc say`, or "
            f"`irc say --to <nick>` for one peer):\n{lines}",
        }
    direct = [r for r in recs if r.get("to") == nick]  # broadcasts (the kickoff names every worker) do not hold it
    if not direct and _early_exit(payload, d, nick):  # a question for this worker keeps it alive
        out.update({"continue": False, "stopReason": f"{nick}: check passed (re-verified by the crew gate); done."})
    if out:
        _out(out)


def _write_pattern(lit: str) -> "re.Pattern":
    """Shell or Python forms that write file `lit` in one Bash command: a redirect, tee, sed -i, cp/mv
    onto it, open(..., 'w'/'a'), or Path(...).write_*. Best effort: it catches the direct forms workers
    use, not a path built at run time."""
    q = "['\"]?"  # optional quote
    Q = "['\"]"  # required quote
    p = r"(\./)?" + re.escape(lit) + r"\b"
    forms = (
        r">>?\s*" + q + p,
        r"\btee\s+(-a\s+)?" + q + p,
        r"\bsed\s+-i\S*\s+[^|;&\n]*" + p,
        r"\b(cp|mv)\s+[^|;&\n]*\s" + q + p + q + r"\s*($|[;&|])",
        r"open\(\s*" + Q + p + Q + r"\s*,\s*" + Q + "[wa]",
        r"Path\(\s*" + Q + p + Q + r"\s*\)\.write_",
    )
    return re.compile("|".join(f"(?:{f})" for f in forms), re.M)


def bash_writes_peer_file(cmd: str, mine, owners: dict):
    """(path, owner) of the first peer-leased literal path that `cmd` writes, else None."""
    for pat, nick in owners.items():
        if any(ch in pat for ch in "*?[") or owns(pat, mine):
            continue
        if pat in cmd and _write_pattern(pat).search(cmd):
            return pat, nick
    return None


SLEEP_RX = re.compile(r"(?<![\w./-])sleep\s+(\d+(?:\.\d+)?)([smhd]?)(?![\w.])")
SLEEP_MAX_S = 3  # a pause this long or longer is a poll that `irc wait` does without the idle time
_UNIT_S = {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}


def long_sleep(cmd: str):
    """The first `sleep N` in a Bash command with N >= 3 seconds (suffixes s/m/h/d), as written, else None."""
    for m in SLEEP_RX.finditer(cmd):
        if float(m.group(1)) * _UNIT_S[m.group(2)] >= SLEEP_MAX_S:
            return m.group(0)
    return None


def _deny(reason: str) -> None:
    _out({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}})


def pre_tool_use(payload) -> None:
    tool = payload.get("tool_name")
    if tool not in EDIT_TOOLS and tool != "Bash":
        return
    root = os.environ.get("ATLAS_CREW_ROOT") or os.getcwd()
    ti = payload.get("tool_input") or {}
    nap = long_sleep(ti.get("command") or "") if tool == "Bash" else None
    if nap:  # live: a worker slept 45 s while four dependents blocked on it
        _deny(
            f"`{nap}` is not allowed: workers never sleep. Wait for a peer with `irc wait --from <peer> --timeout <s>` "
            "(returns the moment it posts), or run `irc check` (waits for your peers, then runs your unit check)."
        )
        return
    mine = _env_json("ATLAS_CREW_OWNS", None)
    if not mine:
        return  # no lease list: unrestricted worker
    if tool == "Bash":
        hit = bash_writes_peer_file(ti.get("command") or "", mine, _env_json("ATLAS_CREW_OWNERS", {}))
        if hit:
            _deny(
                f"{hit[0]} is leased to {hit[1]}; you own {', '.join(mine)}. Ask {hit[1]} for the change "
                f"with `irc say --to {hit[1]} \"...\"` instead of writing it."
            )
        return
    path = ti.get("file_path") or ti.get("notebook_path") or ""
    if not path:
        return
    rel = _rel(path if os.path.isabs(path) else os.path.join(root, path), root)
    if owns(rel, mine):
        return
    who = owner_of(rel, _env_json("ATLAS_CREW_OWNERS", {})) or "the lead"
    _out(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": f"{rel} is leased to {who}; you own {', '.join(mine)}. "
                f"Ask {who} for the change with `irc say --to {who} \"...\"` instead of editing it.",
            }
        }
    )


def _state_path():
    d, nick = os.environ.get("ATLAS_IRC_DIR"), os.environ.get("ATLAS_IRC_NICK")
    return Path(d) / "stop" / f"{nick}.json" if d and nick else None


def _blocks() -> int:
    p = _state_path()
    try:
        return int(json.loads(p.read_text()).get("blocks") or 0)
    except (OSError, ValueError, AttributeError):
        return 0


def _set_blocks(n: int, passed=None) -> None:
    p = _state_path()
    if not p:
        return
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"blocks": n, "passed": passed}))


def run_check(cmd: str, root: str):
    try:
        res = subprocess.run(
            cmd, shell=True, cwd=root, capture_output=True, text=True, timeout=CHECK_TIMEOUT_S
        )
        out = (res.stdout or "") + (res.stderr or "")
        return res.returncode, out
    except subprocess.TimeoutExpired:
        return 124, f"check timed out after {CHECK_TIMEOUT_S}s"


def stop(payload) -> None:
    d, nick = os.environ.get("ATLAS_IRC_DIR"), os.environ.get("ATLAS_IRC_NICK")
    if not d or not nick:
        return
    cap = int(os.environ.get("ATLAS_CREW_MAX_BLOCKS") or 3)
    n = _blocks()
    # 1. unread messages addressed to this worker (or naming it) must be seen before it leaves
    recs = atlas_irc.drain(d, nick)
    direct = [r for r in recs if r.get("to") == nick or nick in (r.get("text") or "")]
    if direct and n < cap:
        _set_blocks(n + 1)
        lines = "\n".join("[irc] " + atlas_irc.fmt(r) for r in recs)
        _out({"decision": "block", "reason": f"Unread team messages for you; answer them (irc say) before finishing:\n{lines}"})
        return
    # 2. the worker's own check, re-run here: a claim of done is not evidence
    cmd = os.environ.get("ATLAS_CREW_CHECK") or ""
    root = os.environ.get("ATLAS_CREW_ROOT") or os.getcwd()
    if cmd:
        code, out = run_check(cmd, root)
        if code != 0 and n < cap:
            _set_blocks(n + 1, passed=False)
            tail = out[-TAIL_CHARS:]
            _out(
                {
                    "decision": "block",
                    "reason": f"Your check `{cmd}` still fails (exit {code}); you cannot finish yet "
                    f"(refusal {n + 1}/{cap}). If the failure is in a peer's file, ask that peer "
                    f"(irc say --to <peer>); `irc check` already waits for its peers "
                    f"(exit 3 timed out: rerun; exit 4: a peer gave up). Output tail:\n{tail}",
                }
            )
            return
        _set_blocks(n, passed=code == 0)
        if code == 0:
            if not atlas_irc.has_done(d, nick):  # the check's own `irc done` usually posted it already
                atlas_irc.post(d, nick, atlas_irc.members(d).get("channel", "#team"), f"DONE {nick}: `{cmd}` passes", kind="done")
        else:
            atlas_irc.post(
                d, nick, atlas_irc.members(d).get("channel", "#team"),
                f"GAVE UP {nick}: `{cmd}` still fails after {cap} refusals. Tail: {out[-600:]}", kind="failed",
            )
    else:
        atlas_irc.post(d, nick, atlas_irc.members(d).get("channel", "#team"), f"DONE {nick}", kind="done")


def main() -> int:
    event = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        payload = {}
    try:
        {"PostToolUse": post_tool_use, "PreToolUse": pre_tool_use, "Stop": stop}.get(event, lambda p: None)(payload)
    except Exception as exc:  # fail open, but leave a trace in the worker log
        sys.stderr.write(f"crew_worker {event}: {exc!r}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
