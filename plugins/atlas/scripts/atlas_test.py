#!/usr/bin/env python3
"""Run the atlas hooks and scripts Python suites in parallel, optionally scoped to changed files.

  atlas_test.py select <path>... | --changed [BASE]   print the suites/test files the paths can affect
  atlas_test.py run [<path>...] [--changed [BASE]] [--suite hooks|scripts] [--jobs N]

`run` with no paths and no --changed runs both full suites. Each test file is its own
`python -m pytest` process (cwd = its suite dir), so files cannot share interpreter state. The
interpreter is the first of ATLAS_TEST_PYTHON, <repo>/.venv/bin/python, sys.executable, python3, python3.14..12
that imports pytest (CI runs pytest too); with none, `run` exits 2 instead of falling back to unittest.

Selection mapping: CI (.github/workflows/tests.yml) has no path filter; its only scoped atlas check is
hooks/test_atlas_contract.py, which every hooks change selects here too. Everything else below is local.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ATLAS = "plugins/atlas"
SUITES = {"hooks": f"{ATLAS}/hooks", "scripts": f"{ATLAS}/scripts"}
CONTRACT_TEST = "test_atlas_contract.py"
JS_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs"}
# Per-file timeout: the slowest known file is well under this; a hang counts as a failure.
FILE_TIMEOUT_S = 900
# Many tests spawn subprocesses, tmux or sqlite; past ~8 workers contention causes timing flakes, not speed.
DEFAULT_JOBS = min(8, os.cpu_count() or 4)
TAIL_LINES = 30


@dataclass
class Selection:
    files: dict = field(default_factory=lambda: {"hooks": [], "scripts": []})
    js: list = field(default_factory=list)


def suite_files(suite, root=REPO):
    return sorted(p.name for p in (Path(root) / SUITES[suite]).glob("test_*.py"))


def _add(sel, suite, names, root):
    have = set(sel.files[suite])
    sel.files[suite] = sorted(have | (set(suite_files(suite, root)) & set(names)))


def _full(sel, suite, root):
    sel.files[suite] = suite_files(suite, root)


def _js_command(rel, root):
    """Nearest package.json decides: its test script, else bun (bunfig.toml) filtered to this file."""
    p = (Path(root) / rel).parent
    root = Path(root)
    # CI runs omp and mod from plugins/atlas so its bunfig preloads load; omp/ has its own package.json that would not.
    if rel.startswith((f"{ATLAS}/omp/", f"{ATLAS}/mod/")):
        p = root / ATLAS
        return f"cd {ATLAS} && bun test {Path(rel).relative_to(ATLAS).with_suffix('').as_posix().removesuffix('.test')}"
    while True:
        if (p / "package.json").exists():
            d = p.relative_to(root).as_posix() or "."
            if "test" in json.loads((p / "package.json").read_text()).get("scripts", {}):
                return f"cd {d} && npm test"
            if (p / "bunfig.toml").exists():
                stem = Path(rel).relative_to(d).with_suffix("").as_posix()
                stem = stem.removesuffix(".test")
                return f"cd {d} && bun test {stem}"
            return f"no JS test command found in {d}/package.json for {rel}"
        if p == root or p == p.parent:
            return f"no package.json found above {rel}"
        p = p.parent


def select(paths, root=REPO):
    sel = Selection()
    for raw in paths:
        rel = Path(raw).as_posix().removeprefix("./")
        ext = Path(rel).suffix
        name = Path(rel).name
        parent = str(Path(rel).parent.as_posix())
        # Agent frontmatter is read by contract tests, so it beats the generic .md rule.
        agent = rel.startswith(f"{ATLAS}/agents/")
        if not agent and (ext == ".md" or rel.startswith("docs/")):
            continue
        if ext in JS_EXT:
            cmd = _js_command(rel, root)
            if cmd not in sel.js:
                sel.js.append(cmd)
            continue
        if not rel.startswith(f"{ATLAS}/"):
            continue  # outside atlas: the root pytest job owns it, not these suites
        shared = (agent or name.startswith("_") or name in ("testenv.py", "hooks.json", "hooks.codex.json")
                  or rel.startswith(f"{ATLAS}/contracts/"))
        suite = next((s for s, d in SUITES.items() if parent == d), None)
        if shared or suite is None:
            # ponytail: anything unmapped under plugins/atlas selects everything; narrow it when it is too broad
            _full(sel, "hooks", root)
            _full(sel, "scripts", root)
            continue
        # test_<stem>*.py, with a trailing _core dropped (completion_gate_core.py is tested by test_completion_gate.py)
        stem = Path(name).stem
        base = stem if name.startswith("test_") else f"test_{stem.removesuffix('_core')}"
        tests = [t for t in suite_files(suite, root)
                 if t == f"{base}.py" or (not name.startswith("test_") and t.startswith(f"{base}_"))]
        if tests:
            _add(sel, suite, tests + ([CONTRACT_TEST] if suite == "hooks" else []), root)
        else:
            _full(sel, suite, root)
    return sel


def _pytest_version(python):
    """pytest version string if `python` can import pytest, else None."""
    try:
        r = subprocess.run([python, "-c", "import pytest;print(pytest.__version__)"],
                           capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() or None if r.returncode == 0 else None


def pick_python(probe=_pytest_version, env=os.environ, root=REPO, exe=sys.executable, which=shutil.which):
    """First interpreter (in documented order) where probe(path) is truthy. Returns (path, pytest_version) or None."""
    cands = [env.get("ATLAS_TEST_PYTHON"), str(Path(root) / ".venv/bin/python"), exe,
             *(which(n) for n in ("python3", "python3.14", "python3.13", "python3.12"))]
    seen = set()
    for c in cands:
        if not c or c in seen or (c.startswith(str(root)) and not os.path.exists(c)):
            continue
        seen.add(c)
        version = probe(c)
        if version:
            return c, version
    return None


def _run_one(item, python=None):
    suite, cwd, name = item
    t0 = time.monotonic()
    try:
        # exit 5 (nothing collected) is nonzero, so it counts as a failure of the file
        r = subprocess.run([python, "-m", "pytest", "-q", "-p", "no:cacheprovider", name], cwd=cwd,
                           capture_output=True, text=True, timeout=FILE_TIMEOUT_S)
        out, ok = (r.stdout + r.stderr), r.returncode == 0
    except subprocess.TimeoutExpired:
        out, ok = f"TIMEOUT after {FILE_TIMEOUT_S}s", False
    return suite, name, ok, out, time.monotonic() - t0


def run_items(items, jobs=DEFAULT_JOBS, out=print, picked=None):
    """items: (suite, dir, test file name). Returns 0 when every file passes, 1 on failures, 2 with no pytest."""
    t0 = time.monotonic()
    picked = picked or pick_python()
    if not picked:
        out("no interpreter with pytest found (tried ATLAS_TEST_PYTHON, .venv, sys.executable, python3*); "
            "set ATLAS_TEST_PYTHON to a python that has pytest")
        return 2
    python, version = picked
    with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
        results = list(pool.map(lambda i: _run_one(i, python), items))
    failed = [r for r in results if not r[2]]
    for suite in sorted({r[0] for r in results}):
        mine = [r for r in results if r[0] == suite]
        bad = [r[1] for r in mine if not r[2]]
        n = len(mine)
        word = "file" if n == 1 else "files"
        out(f"{suite}: FAIL {len(bad)}/{n} {word}: {', '.join(bad)}" if bad else f"{suite}: PASS {n} {word}")
    for _suite, name, _ok, text, _dt in failed:
        out(f"--- {name} (last {TAIL_LINES} lines) ---")
        out("\n".join(text.splitlines()[-TAIL_LINES:]))
    out(f"wall {time.monotonic() - t0:.1f}s, jobs {jobs}, python {python}, pytest {version}")
    return 1 if failed else 0


def _changed(base):
    r = subprocess.run(["git", "diff", "--name-only", base], cwd=REPO, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"git diff --name-only {base} failed: {r.stderr.strip()}")
    return r.stdout.split()


def _paths(args):
    paths = list(args.paths)
    if args.changed is not None:
        paths += _changed(args.changed)
    return paths


def _print_selection(sel):
    for suite, files in sel.files.items():
        if files:
            full = files == suite_files(suite)
            print(f"{suite}: {'ALL ' if full else ''}{len(files)} file(s)" + ("" if full else ": " + ", ".join(files)))
    for cmd in sel.js:
        print(f"js: {cmd}")
    if not any(sel.files.values()) and not sel.js:
        print("nothing selected")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("select", "run"):
        p = sub.add_parser(name)
        p.add_argument("paths", nargs="*")
        p.add_argument("--changed", nargs="?", const="origin/main", default=None, metavar="BASE")
    sub.choices["run"].add_argument("--suite", choices=list(SUITES))
    sub.choices["run"].add_argument("--jobs", type=int, default=DEFAULT_JOBS)
    args = ap.parse_args(argv)

    scoped = bool(args.paths) or args.changed is not None
    if args.cmd == "select":
        _print_selection(select(_paths(args)))
        return 0
    if scoped:
        sel = select(_paths(args))
        _print_selection(sel)
        files = sel.files
    else:
        files = {s: suite_files(s) for s in SUITES}
    items = [(s, REPO / SUITES[s], n) for s in SUITES if args.suite in (None, s) for n in files[s]]
    if not items:
        print("no Python test files to run")
        return 0
    return run_items(items, args.jobs)


if __name__ == "__main__":
    sys.exit(main())
