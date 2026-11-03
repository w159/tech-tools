#!/usr/bin/env python3
"""Fail when a commit in a range credits Claude or Anthropic.

The repository owner does not want Claude in commit history or in the GitHub
contributor list. A commit is flagged when any of these hold:

- author or committer email is noreply@anthropic.com (or any @anthropic.com address)
- author or committer name is exactly "Claude"
- a message line is a Co-Authored-By trailer naming Claude or anthropic.com
- a message line is a Claude-Session trailer or a claude.ai/code/session link
- a message line is the "Generated with [Claude Code]" footer

Usage:
    check_attribution.py RANGE      e.g. origin/main..HEAD, or a single commit
    check_attribution.py --all      every commit reachable from every ref

Exit 0 when clean, 1 when any commit is flagged, 2 on a git error.
"""
import re
import subprocess
import sys

SEP = "\x1e"  # record separator between commits
FIELD = "\x1f"  # unit separator between fields

BAD_EMAIL = re.compile(r"@anthropic\.com$", re.I)
BAD_LINES = (
    re.compile(r"^\s*co-authored-by:.*(claude|anthropic)", re.I),
    re.compile(r"^\s*claude-session:", re.I),
    re.compile(r"claude\.ai/code/session_", re.I),
    re.compile(r"generated with \[?claude code", re.I),
)


def commits(rev_args, cwd=None):
    """Yield (sha, author_name, author_email, committer_name, committer_email, body)."""
    fmt = FIELD.join(("%H", "%an", "%ae", "%cn", "%ce", "%B")) + SEP
    out = subprocess.run(
        ["git", "log", f"--format={fmt}", *rev_args],
        cwd=cwd, check=True, capture_output=True, text=True,
    ).stdout
    for rec in out.split(SEP):
        rec = rec.lstrip("\n")
        if rec:
            yield tuple(rec.split(FIELD, 5))


def problems(sha, an, ae, cn, ce, body):
    found = []
    for role, name, email in (("author", an, ae), ("committer", cn, ce)):
        if BAD_EMAIL.search(email.strip()) or name.strip() == "Claude":
            found.append(f"{role} is {name} <{email}>")
    for line in body.splitlines():
        if any(p.search(line) for p in BAD_LINES):
            found.append(f"message line: {line.strip()}")
    return found


def scan(rev_args, cwd=None):
    """Return {sha: [problem, ...]} for every flagged commit."""
    return {c[0]: p for c in commits(rev_args, cwd) if (p := problems(*c))}


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0 if argv else 2
    rev_args = ["--all"] if argv[0] == "--all" else argv
    try:
        bad = scan(rev_args)
    except subprocess.CalledProcessError as exc:
        print(f"git log failed: {exc.stderr.strip()}", file=sys.stderr)
        return 2
    for sha, found in bad.items():
        print(f"{sha[:12]}: " + "; ".join(found))
    if bad:
        print(f"{len(bad)} commit(s) credit Claude. Rewrite them before pushing.", file=sys.stderr)
        return 1
    print("no Claude attribution found")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
