#!/usr/bin/env python3
"""SubagentStop gate: block an atlas:* subagent whose final message is not the
fixed report container (contracts/worker-protocol.json) or whose container is
objectively empty or false.

Guarantees, each pinned by a unit test in test_worker_report_gate.py:
- a valid report produces empty stdout and exit 0 (test_compliant_is_silent);
- stop_hook_active never triggers a second block (test_stop_hook_active_silent);
- at most one block per agent_id (test_second_time_same_agent_silent);
- the block reason is a one-line format correction followed by the container
  template (test_block_reason_is_one_line_format_correction);
- beyond the labels, cheap objective checks run (STEPS is `<done>/<total>` with
  done <= total; a DONE report carries a numbered `command -> output` EVIDENCE
  line; a DONE report from a writing agent names FILES_CHANGED paths that exist
  or show up in `git status`) - test_nonsense_done_blocks and friends;
- every error fails open and leaves an atlas_faults row (test_malformed_stdin_silent)."""

import json
import os
import re
import subprocess
import sys
import tempfile

PROTOCOL = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "contracts",
    "worker-protocol.json",
)

# Agents that change files: their DONE report's FILES_CHANGED is checked against the tree.
WRITERS = ("atlas:implementer", "atlas:docs-curator", "atlas:runner")

STEPS_RE = re.compile(r"\s*(\d+)\s*/\s*(\d+)\b")
NUMBERED_RE = re.compile(r"^\s*\d+[.)]\s*(.*)$")
ARROW_RE = re.compile(r"->|\u2192|=>")
ANNOTATION_RE = re.compile(r"\s*\(([^)]*)\)\s*$")
GLOB_CHARS = set("*?{}[]")
# Annotations that say the entry is intentionally not a surviving file.
GONE_RE = re.compile(r"delet|remov|throwaway|scratch|temp|not committed", re.I)


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


def sections(lines, fields):
    """label -> text after the label, continuation lines included, up to the next label."""
    out, cur = {}, None
    for ln in lines:
        m = re.match(r"(" + "|".join(map(re.escape, fields)) + r")\s*:\s*(.*)$", ln)
        if m:
            cur = m.group(1)
            out.setdefault(cur, [])
            out[cur].append(m.group(2))
        elif cur is not None:
            out[cur].append(ln)
    return {k: "\n".join(v).strip() for k, v in out.items()}


def evidence_ok(text):
    """True when some numbered item has a command part and an output part:
    `cmd -> output` on one line, or an item that continues on a following line."""
    items, cur = [], None
    for ln in text.splitlines():
        m = NUMBERED_RE.match(ln)
        if m:
            cur = [m.group(1)]
            items.append(cur)
        elif cur is not None and ln.strip():
            cur.append(ln.strip())
    for item in items:
        if len(item) > 1 and item[0].strip():
            return True
        parts = ARROW_RE.split(item[0], maxsplit=1)
        if len(parts) == 2 and parts[0].strip() and parts[1].strip():
            return True
    return False


def git_changed(cwd):
    """Absolute paths `git status` reports (renames: both sides); empty when git is unavailable."""
    try:
        top = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
        raw = subprocess.run(
            ["git", "-C", cwd, "status", "--porcelain", "-z", "--untracked-files=all"],
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return set()
    changed, entries, i = set(), raw.split("\0"), 0
    while i < len(entries):
        e = entries[i]
        if len(e) > 3:
            changed.add(os.path.join(top, e[3:]))
            if e[0] in "RC" or e[1] in "RC":
                i += 1
                if i < len(entries):
                    changed.add(os.path.join(top, entries[i]))
        i += 1
    return changed


def missing_files(value, cwd):
    """FILES_CHANGED entries that name a plain path which neither exists nor is in git status."""
    if not cwd or not os.path.isdir(cwd) or value.strip().lower() in ("", "none"):
        return []
    missing = []
    for raw in re.split(
        r"\n|;(?![^()]*\))", value
    ):  # `;` inside an annotation does not split
        entry = raw.strip().strip("`")
        entry = re.sub(r"^[-*]\s+", "", entry)
        m = ANNOTATION_RE.search(entry)
        if m and GONE_RE.search(m.group(1)):
            continue
        entry = ANNOTATION_RE.sub("", entry).strip().strip("`")
        if not entry or entry.lower() == "none" or GLOB_CHARS & set(entry):
            continue
        if re.match(
            r"[A-Za-z][A-Za-z0-9+.-]*://", entry
        ):  # local://, agent:// are not tree paths
            continue
        path = entry if os.path.isabs(entry) else os.path.join(cwd, entry)
        if not os.path.exists(path):
            missing.append((entry, path))
    if not missing:
        return []
    changed = git_changed(cwd)
    return [e for e, p in missing if os.path.normpath(p) not in changed]


def check_report(msg, agent_type, cwd, report):
    """Problems with a final message: container shape first, then the objective checks."""
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
    if problems:
        return problems
    sec = sections(lines, fields)
    m = STEPS_RE.match(sec.get("STEPS", ""))
    if not m:
        problems.append("STEPS is not `<done>/<total>`")
    elif int(m.group(1)) > int(m.group(2)):
        problems.append("STEPS done exceeds total")
    if first.split(":", 1)[1].strip() == "DONE":
        if not evidence_ok(sec.get("EVIDENCE", "")):
            problems.append(
                "a DONE report needs at least one numbered EVIDENCE line with a command and its real output (`1. <command> -> <output>`)"
            )
        if agent_type in WRITERS:
            gone = missing_files(sec.get("FILES_CHANGED", ""), cwd)
            if gone:
                problems.append(
                    "FILES_CHANGED names paths that do not exist and are not in git status: "
                    + ", ".join(gone[:3])
                )
    return problems


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
    agent_type = str(p.get("agent_type") or "")
    if not agent_type.startswith("atlas:"):
        return
    msg = p.get("last_assistant_message")
    if not isinstance(msg, str) or not msg.strip():
        return
    with open(PROTOCOL, encoding="utf-8") as f:
        report = json.load(f)["report"]
    problems = check_report(msg, agent_type, p.get("cwd"), report)
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
    except Exception as exc:
        try:
            sys.path.insert(
                0,
                os.path.join(
                    os.path.dirname(os.path.abspath(__file__)), "..", "scripts"
                ),
            )
            import atlas_faults

            atlas_faults.record("worker_report_gate", exc)
        except Exception:
            pass
    sys.exit(0)
