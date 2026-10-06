#!/usr/bin/env python3
"""SubagentStop gate: block an atlas:* subagent whose final message is not the
fixed report container (contracts/worker-protocol.json).

Guarantees, each pinned by a unit test in test_worker_report_gate.py:
- a valid report produces empty stdout and exit 0 (test_compliant_is_silent);
- stop_hook_active never triggers a second block (test_stop_hook_active_silent);
- at most one block per agent_id (test_second_time_same_agent_silent);
- the block reason is a one-line format correction followed by the container
  template (test_block_reason_is_one_line_format_correction);
- every error fails open (test_malformed_stdin_silent)."""

import json
import os
import re
import sys
import tempfile

PROTOCOL = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "contracts",
    "worker-protocol.json",
)


def marker_claimed(agent_id):
    """True when this call created the marker (first block for agent_id)."""
    d = os.environ.get("ATLAS_REPORT_GATE_DIR") or os.path.join(
        tempfile.gettempdir(), "atlas-report-gate"
    )
    os.makedirs(d, exist_ok=True)
    name = re.sub(r"[^A-Za-z0-9_.-]", "_", str(agent_id))
    try:
        fd = os.open(os.path.join(d, name), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    os.close(fd)
    return True


def main():
    if (
        os.environ.get("ATLAS_GATE") == "off"
        or os.environ.get("ATLAS_GATE_REPORT") == "off"
    ):
        return
    p = json.load(sys.stdin)
    if not isinstance(p, dict) or p.get("hook_event_name") != "SubagentStop":
        return
    if p.get("stop_hook_active"):
        return
    if not str(p.get("agent_type") or "").startswith("atlas:"):
        return
    msg = p.get("last_assistant_message")
    if not isinstance(msg, str) or not msg.strip():
        return
    with open(PROTOCOL, encoding="utf-8") as f:
        report = json.load(f)["report"]
    fields = report["textFields"]
    lines = msg.splitlines()
    first = next((ln for ln in lines if ln.strip()), "")
    problems = []
    if not re.match(report["firstLinePattern"], first):
        problems.append("the first non-empty line is not `STATUS: DONE|FAILED|BLOCKED`")
    missing = [
        x
        for x in fields
        if not any(re.match(re.escape(x) + r"\s*:", ln) for ln in lines)
    ]
    if missing:
        problems.append("missing labels: " + ", ".join(missing))
    if not problems:
        return
    if not marker_claimed(p.get("agent_id") or "unknown"):
        return
    reason = (
        "Your final message is not the atlas report container ("
        + "; ".join(problems)
        + "). Resend it as exactly this container, nothing before the first line:\n\n"
        "STATUS: DONE | FAILED | BLOCKED\n"
        "STEPS: <done>/<total>\n"
        "FILES_CHANGED: <path>; <path>   (or: none)\n"
        "EVIDENCE:\n1. <command or read-back> -> <first 3 and last 3 lines of the real output>\n"
        "DELIVERABLE: <the findings or artifact your dispatch asked for; none if only files changed>\n"
        "NEXT: <the exact question for the lead if BLOCKED or FAILED; otherwise: none>"
    )
    print(json.dumps({"decision": "block", "reason": reason}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
