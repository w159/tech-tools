#!/usr/bin/env python3
"""Print the CHANGELOG.md section for a version (without its heading).

Usage: release_notes.py <version> [changelog-path]
Exit 2 when the section is missing or still marked "(unreleased)".
"""
import re
import sys
from pathlib import Path

DEFAULT = Path(__file__).resolve().parent.parent / "CHANGELOG.md"


def section(text: str, version: str):
    """Return (body, heading) for `## <version>`, or None."""
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        m = re.match(r"##\s+(\S+)", ln)
        if m and m.group(1) == version:
            body = []
            for nxt in lines[i + 1:]:
                if re.match(r"##\s", nxt):
                    break
                body.append(nxt)
            return "\n".join(body).strip(), ln
    return None


def main(argv):
    if len(argv) < 2:
        print("usage: release_notes.py <version> [changelog]", file=sys.stderr)
        return 2
    path = Path(argv[2]) if len(argv) > 2 else DEFAULT
    found = section(path.read_text(encoding="utf-8"), argv[1])
    if found is None:
        print(f"no '## {argv[1]}' section in {path}", file=sys.stderr)
        return 2
    body, heading = found
    if "unreleased" in heading.lower():
        print(f"'{heading}' is still marked unreleased", file=sys.stderr)
        return 2
    print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
