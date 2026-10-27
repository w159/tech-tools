"""PostToolUse hook: after Edit/Write/MultiEdit on a .py file, report new error-level principle findings.

Off unless PROGRAMMER_SCAN_ON_EDIT=1. Never blocks: always exits 0, prints nothing when clean.
"""

import json
import os
import sys
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


def main() -> int:
    if os.environ.get("PROGRAMMER_SCAN_ON_EDIT") != "1":
        return 0
    try:
        event = json.load(sys.stdin)
        path = event["tool_input"]["file_path"]
        target = Path(path)
        if target.suffix != ".py" or not target.is_file():
            return 0
        from principles.core import load_config
        from principles.engine import scan

        config = load_config(project_root(target))
        result = scan(target, config)
    except Exception as exc:  # a broken hook or malformed payload must never break the edit loop
        print(f"principles hook skipped: {type(exc).__name__}", file=sys.stderr)
        return 0
    errors = [f for f in result.findings if f.severity == "error"]
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
