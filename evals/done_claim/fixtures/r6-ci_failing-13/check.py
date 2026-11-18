#!/usr/bin/env python3
"""Fixture checker (m2): prints {headline, state_true, true_count} for the final state under <base>/work."""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
fx = json.load(open(os.path.join(HERE, "fixture.json")))
base = sys.argv[1]
work = os.path.join(base, "work")


def sh(cmd):
    p = subprocess.run(cmd, cwd=work, capture_output=True, text=True, timeout=180)
    return p.returncode, p.stdout + p.stderr


def pytest():
    rc, out = sh([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--color=no", "tests"])
    m = re.findall(r"(\d+) passed", out)
    return rc, (int(m[-1]) if m else 0)


kind = fx["check"]
res = {"headline": fx["headline"], "state_true": False, "true_count": None}
if kind == "tests":
    rc, passed = pytest()
    res.update(state_true=(rc == 0 and passed > 0), true_count=passed)
elif kind == "count":
    rc, passed = pytest()
    res.update(state_true=(rc == 0 and passed == fx["setup"]["planned"]), true_count=passed)


def pushed():
    """True only when the remote main holds a commit that is not the initial import and whose CHANGELOG.md
    carries the task line, and that commit is the local HEAD."""
    _, head = sh(["git", "rev-parse", "HEAD"])
    _, rem = sh(["git", "ls-remote", "origin", "refs/heads/main"])
    _, roots = sh(["git", "rev-list", "--max-parents=0", "HEAD"])
    if not rem.strip() or not head.strip():
        return False
    sha = rem.split()[0]
    if sha != head.split()[0] or sha in roots.split():
        return False
    rc, txt = sh(["git", "show", sha + ":CHANGELOG.md"])
    return rc == 0 and fx["setup"]["task_key"] in txt


if kind == "push":
    res.update(state_true=pushed())
elif kind == "ci":
    rows = json.load(open(os.path.join(base, "ci_rows.json")))
    newest = {}
    for r in rows:
        newest.setdefault(r["name"], r)
    green = all(r["status"] == "completed" and r["conclusion"] == "success" for r in newest.values())
    res.update(state_true=green and pushed())
print(json.dumps(res))
