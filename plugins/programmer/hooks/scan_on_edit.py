"""PostToolUse hook: after Edit/Write/MultiEdit on a .py file, report new error-level principle findings.

"New" means not present before the edit. For Edit and MultiEdit the pre-edit text is rebuilt from the
payload (the file now holds new_string where old_string was), scanned the same way, and its findings are
subtracted by fingerprint. Write carries no old text, and an edit that cannot be located unambiguously
has none either; both report every error-level finding in the file.

Off unless PROGRAMMER_SCAN_ON_EDIT=1. Never blocks: always exits 0, prints nothing when clean.
"""

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

MAX_LINES = 5


def project_root(target: Path) -> Path:
    """Nearest ancestor with .principles.toml, else the git toplevel, else the file's directory."""
    for d in target.resolve().parents:
        if (d / ".principles.toml").is_file():
            return d
    for d in target.resolve().parents:
        if (d / ".git").exists():
            return d
    return target.parent


def previous_text(current: str, tool_input: dict, tool_name: str):
    """File text before the edit, or None when the payload cannot say."""
    if tool_name == "Edit":
        edits = [tool_input]
    elif tool_name == "MultiEdit":
        edits = tool_input.get("edits") or []
    else:
        return None
    text = current
    for edit in reversed(edits):
        old, new = edit.get("old_string"), edit.get("new_string")
        if not isinstance(old, str) or not isinstance(new, str) or not new:
            return None
        if edit.get("replace_all"):
            text = text.replace(new, old)
        elif text.count(new) == 1:
            text = text.replace(new, old, 1)
        else:
            return None  # new_string occurs elsewhere too: cannot tell which copy the edit wrote
    return text


def baseline_fingerprints(target: Path, config: dict, before: str, scan, find_project_root) -> set:
    """Fingerprints of the findings the file had before the edit, scanned at the same relative path."""
    class_root = find_project_root(target.parent).resolve()
    try:
        rel = target.resolve().relative_to(class_root)
    except ValueError:
        rel = Path(target.name)
    with tempfile.TemporaryDirectory(prefix="principles-before-") as tmp:
        old = Path(tmp) / rel
        old.parent.mkdir(parents=True, exist_ok=True)
        old.write_text(before, encoding="utf-8")
        result = scan(old, config, project_root=Path(tmp))
    return {f.fingerprint() for f in result.findings}


def main() -> int:
    if os.environ.get("PROGRAMMER_SCAN_ON_EDIT") != "1":
        return 0
    try:
        event = json.load(sys.stdin)
        path = event["tool_input"]["file_path"]
        target = Path(path)
        if target.suffix != ".py" or not target.is_file():
            return 0
        from principles.core import find_project_root, load_config
        from principles.engine import scan

        config = load_config(project_root(target))
        result = scan(target, config, project_root=find_project_root(target.parent))
        known: set = set()
        before = previous_text(target.read_text(encoding="utf-8-sig"), event["tool_input"], event.get("tool_name", ""))
        if before is not None:
            known = baseline_fingerprints(target, config, before, scan, find_project_root)
    except Exception as exc:  # a broken hook or malformed payload must never break the edit loop
        detail = (str(exc).splitlines() or [""])[0]
        print(f"principles hook skipped: {type(exc).__name__}: {detail}".rstrip(": "), file=sys.stderr)
        return 0
    errors = [f for f in result.findings if f.severity == "error" and f.fingerprint() not in known]
    if not errors:
        return 0
    lines = [f"{target.name}:{f.line} {f.rule} {f.message}" for f in errors[:MAX_LINES]]
    more = len(errors) - MAX_LINES
    if more > 0:
        lines.append(f"... and {more} more")
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": "principles scanner, error-level findings in the file just edited:\n" + "\n".join(lines),
    }}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
