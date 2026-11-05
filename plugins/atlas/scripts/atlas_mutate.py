#!/usr/bin/env python3
"""Sampled mutation testing for Python and TypeScript/JavaScript, stdlib only (plus node for TS).

For each target module it makes one small fault at a time (flip a comparison, swap and/or, drop a
`not`, flip a boolean, nudge a number, swap + and -, return None, swap break and continue), runs the
module's own tests against it, and counts the fault killed when the tests fail or time out and
survived when they still pass. Mutation score = killed / (killed + survived).

Why a runner of its own: mutmut and Stryker mutate a whole project from one config. Atlas is a tree
of independent scripts, hooks and Bun-tested TS files, each with its own tests. This runner:
- mutates private copies of the tree (the source is never edited) and splices only the mutated node,
  so comments, formatting and every other line stay byte-identical;
- samples mutants per module with a fixed seed, spread across functions, so before and after runs
  of the same module see the same faults;
- runs a canary first (the module raises on load): if the tests still pass, they never load this
  file and every score would be fake, so the target is reported as `not-exercised` and skipped;
- names the enclosing function of every survivor, which points at the missing test.

  atlas_mutate.py --root plugins/atlas --target scripts/atlas_prompt_judge.py \
      --tests scripts/test_atlas_prompt_judge.py --max 40 --jobs 4 --json out.json

Suites that read files above --root (the repo's docs/ or scripts/) need `--context DIR`, an ancestor of
--root: each copy then mirrors DIR with real directories down to --root, a real copy of --root, and
symlinks to the originals for every other entry on the way (read-only use). Tests still run in the copy
of --root, so relative paths are unchanged.

  atlas_mutate.py --root plugins/atlas --context . --target scripts/atlas_harness.py \
      --tests hooks/test_codex_parity.py

`--plan plan.json` runs many targets: a JSON list of {"target": ..., "tests": [...]}. Python tests
run with `python -m pytest -x -q`; TS/JS tests with `bun test`. Exit codes: 0 done, 2 usage error.
A red baseline or a surviving canary is recorded per target, not raised.
"""

from __future__ import annotations

import argparse
import ast
import concurrent.futures as cf
import json
import os
import queue
import random
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

COPY_IGNORE = shutil.ignore_patterns("node_modules", "__pycache__", ".git", "mutants", "*.pyc",
                                     ".pytest_cache", ".atlas")
TS_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"}

# ---- Python sites ----------------------------------------------------------------------------

_CMP = {ast.Eq: "!=", ast.NotEq: "==", ast.Lt: ">=", ast.GtE: "<", ast.Gt: "<=", ast.LtE: ">",
        ast.In: "not in", ast.NotIn: "in", ast.Is: "is not", ast.IsNot: "is"}
_CMP_NODE = {"!=": ast.NotEq, "==": ast.Eq, ">=": ast.GtE, "<": ast.Lt, "<=": ast.LtE, ">": ast.Gt,
             "not in": ast.NotIn, "in": ast.In, "is not": ast.IsNot, "is": ast.Is}
_BIN = {ast.Add: ast.Sub, ast.Sub: ast.Add, ast.Mult: ast.FloorDiv, ast.FloorDiv: ast.Mult,
        ast.Div: ast.Mult}


def _skip_ids(tree: ast.AST) -> set[int]:
    """Nodes never mutated: docstrings, annotations, f-string internals."""
    skip: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                skip.add(id(body[0].value))
        for ann in (getattr(node, "annotation", None), getattr(node, "returns", None)):
            if ann is not None:
                skip.update(id(x) for x in ast.walk(ann))
        if isinstance(node, ast.JoinedStr):
            skip.update(id(x) for x in ast.walk(node) if x is not node)
    return skip


def _scopes(tree: ast.AST) -> list[tuple[int, int, str]]:
    out: list[tuple[int, int, str]] = []

    def visit(node, scope):
        for ch in ast.iter_child_nodes(node):
            if isinstance(ch, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                q = f"{scope}.{ch.name}" if scope else ch.name
                out.append((ch.lineno, ch.end_lineno or ch.lineno, q))
                visit(ch, q)
            else:
                visit(ch, scope)

    visit(tree, "")
    return out


def enclosing(scopes: list[tuple[int, int, str]], line: int) -> str:
    best, span = "<module>", None
    for a, b, q in scopes:
        if a <= line <= b and (span is None or b - a <= span):
            best, span = q, b - a
    return best


def _offsets(source: str) -> list[int]:
    """Byte-free character offset of the start of each line (1-based index via [line-1])."""
    starts, pos = [], 0
    for ln in source.splitlines(keepends=True):
        starts.append(pos)
        pos += len(ln)
    starts.append(pos)
    return starts


def _span(node: ast.AST, starts: list[int], source: str) -> tuple[int, int]:
    # col_offset is in UTF-8 bytes; convert per line so non-ASCII lines splice correctly
    def at(line, col):
        line_text = source[starts[line - 1]:starts[line]] if line < len(starts) else source[starts[line - 1]:]
        return starts[line - 1] + len(line_text.encode("utf-8")[:col].decode("utf-8", errors="ignore"))

    return at(node.lineno, node.col_offset), at(node.end_lineno, node.end_col_offset)


def py_sites(source: str) -> list[dict]:
    """Every mutation site: {"line", "func", "desc", "start", "end", "text"} with the replacement text
    for source[start:end]. Order is the AST walk order, stable for a given source."""
    tree = ast.parse(source)
    skip = _skip_ids(tree)
    scopes = _scopes(tree)
    starts = _offsets(source)
    sites: list[dict] = []

    def add(node, desc, text):
        s, e = _span(node, starts, source)
        sites.append({"line": node.lineno, "func": enclosing(scopes, node.lineno), "desc": desc,
                      "start": s, "end": e, "text": text})

    for node in ast.walk(tree):
        if id(node) in skip or not hasattr(node, "end_col_offset"):
            continue
        if isinstance(node, ast.Compare):
            for i, op in enumerate(node.ops):
                if type(op) in _CMP:
                    new = ast.Compare(left=node.left, ops=list(node.ops), comparators=node.comparators)
                    new.ops[i] = _CMP_NODE[_CMP[type(op)]]()
                    add(node, f"{type(op).__name__} -> {_CMP[type(op)]}", f"({ast.unparse(new)})")
        elif isinstance(node, ast.BoolOp):
            other = ast.Or() if isinstance(node.op, ast.And) else ast.And()
            add(node, f"{type(node.op).__name__.lower()} -> {type(other).__name__.lower()}",
                f"({ast.unparse(ast.BoolOp(op=other, values=node.values))})")
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            add(node, "drop not", f"({ast.unparse(node.operand)})")
        elif isinstance(node, ast.BinOp) and type(node.op) in _BIN:
            if any(isinstance(x, ast.JoinedStr) or (isinstance(x, ast.Constant) and isinstance(x.value, str))
                   for x in (node.left, node.right)):
                continue  # string concatenation, not arithmetic
            new = ast.BinOp(left=node.left, op=_BIN[type(node.op)](), right=node.right)
            add(node, f"{type(node.op).__name__} -> {type(new.op).__name__}", f"({ast.unparse(new)})")
        elif isinstance(node, ast.Constant):
            v = node.value
            if isinstance(v, bool):
                add(node, f"{v} -> {not v}", repr(not v))
            elif isinstance(v, int):
                add(node, f"{v} -> {v + 1}", repr(v + 1))
        elif isinstance(node, ast.Return) and node.value is not None and not (
                isinstance(node.value, ast.Constant) and node.value.value is None):
            add(node, "return None", "return None")
        elif isinstance(node, ast.Break):
            add(node, "break -> continue", "continue")
        elif isinstance(node, ast.Continue):
            add(node, "continue -> break", "break")
    return sites


def apply_site(source: str, site: dict) -> str:
    return source[:site["start"]] + site["text"] + source[site["end"]:]


def py_valid(source: str) -> bool:
    try:
        compile(source, "<mutant>", "exec")
        return True
    except (SyntaxError, ValueError):
        return False


# ---- TypeScript / JavaScript sites (via the TypeScript compiler) -----------------------------

TS_SITES = r"""
const ts = require(process.argv[process.argv.length - 1]);
const src = require('fs').readFileSync(0, 'utf8');
const file = process.env.MUT_FILE;
const kind = file.endsWith('x') ? ts.ScriptKind.TSX : (file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
const K = ts.SyntaxKind;
const swap = {
  [K.EqualsEqualsEqualsToken]: '!==', [K.ExclamationEqualsEqualsToken]: '===',
  [K.EqualsEqualsToken]: '!=', [K.ExclamationEqualsToken]: '==',
  [K.LessThanToken]: '>=', [K.GreaterThanEqualsToken]: '<', [K.GreaterThanToken]: '<=', [K.LessThanEqualsToken]: '>',
  [K.AmpersandAmpersandToken]: '||', [K.BarBarToken]: '&&', [K.QuestionQuestionToken]: '&&',
  [K.PlusToken]: '-', [K.MinusToken]: '+', [K.AsteriskToken]: '/', [K.SlashToken]: '*',
};
const out = [];
const line = (p) => sf.getLineAndCharacterOfPosition(p).line + 1;
const fnName = (n) => {
  const names = [];
  for (let p = n; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isClassDeclaration(p)) && p.name) names.unshift(p.name.getText(sf));
    else if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parent && ts.isVariableDeclaration(p.parent)) names.unshift(p.parent.name.getText(sf));
  }
  return names.join('.') || '<module>';
};
const inType = (n) => { for (let p = n.parent; p; p = p.parent) { if (ts.isTypeNode(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) return true; } return false; };
const add = (n, start, end, text, desc) => out.push({ start, end, text, desc, line: line(start), func: fnName(n) });
const visit = (n) => {
  if (ts.isBinaryExpression(n) && swap[n.operatorToken.kind] !== undefined && !inType(n)) {
    const t = n.operatorToken; add(n, t.getStart(sf), t.getEnd(), swap[t.kind], t.getText(sf) + ' -> ' + swap[t.kind]);
  } else if (ts.isPrefixUnaryExpression(n) && n.operator === K.ExclamationToken) {
    add(n, n.getStart(sf), n.operand.getStart(sf), '', 'drop !');
  } else if ((n.kind === K.TrueKeyword || n.kind === K.FalseKeyword) && !inType(n)) {
    const v = n.kind === K.TrueKeyword; add(n, n.getStart(sf), n.getEnd(), String(!v), v + ' -> ' + !v);
  } else if (ts.isNumericLiteral(n) && !inType(n) && /^\d+$/.test(n.text)) {
    add(n, n.getStart(sf), n.getEnd(), String(Number(n.text) + 1), n.text + ' -> ' + (Number(n.text) + 1));
  } else if (ts.isReturnStatement(n) && n.expression && n.expression.kind !== K.UndefinedKeyword) {
    add(n, n.expression.getStart(sf), n.expression.getEnd(), 'undefined', 'return undefined');
  } else if (n.kind === K.BreakStatement && !n.label) {
    add(n, n.getStart(sf), n.getStart(sf) + 5, 'continue', 'break -> continue');
  }
  ts.forEachChild(n, visit);
};
visit(sf);
process.stdout.write(JSON.stringify(out));
"""


def find_typescript() -> str | None:
    paths = [p for p in os.environ.get("NODE_PATH", "").split(os.pathsep) if p]
    paths += ["/opt/node-tools/node_modules", "/usr/local/lib/node_modules_global", "/usr/local/lib/node_modules",
              "/usr/lib/node_modules"]
    for p in paths:
        if (Path(p) / "typescript" / "package.json").exists():
            return str(Path(p) / "typescript")
    try:
        root = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True, timeout=20).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return None
    cand = Path(root) / "typescript"
    return str(cand) if (cand / "package.json").exists() else None


def ts_sites(source: str, file: str) -> list[dict]:
    tsmod = find_typescript()
    if not tsmod or not shutil.which("node"):
        raise RuntimeError("TypeScript mutation needs node and the typescript package")
    proc = subprocess.run(["node", "-e", TS_SITES, tsmod], input=source, capture_output=True, text=True,
                          timeout=120, env=dict(os.environ, MUT_FILE=file))
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr[-500:])
    return json.loads(proc.stdout)


# ---- sampling --------------------------------------------------------------------------------

def sample(sites: list[dict], k: int, seed: int) -> list[dict]:
    """Up to k sites, spread round-robin across functions so one big function cannot take all."""
    if k <= 0 or len(sites) <= k:
        return list(sites)
    rng = random.Random(seed)
    by_func: dict[str, list[dict]] = {}
    for s in sites:
        by_func.setdefault(s["func"], []).append(s)
    pools = [rng.sample(v, len(v)) for _, v in sorted(by_func.items())]
    rng.shuffle(pools)
    out: list[dict] = []
    while len(out) < k:
        progressed = False
        for p in pools:
            if p and len(out) < k:
                out.append(p.pop())
                progressed = True
        if not progressed:
            break
    return sorted(out, key=lambda s: (s["start"], s["desc"]))


# ---- running ---------------------------------------------------------------------------------

def test_cmd(tests: list[str]) -> list[str]:
    if all(Path(t).suffix in TS_EXT for t in tests):
        return ["bun", "test", *tests]
    return [sys.executable, "-m", "pytest", "-x", "-q", "-p", "no:cacheprovider", "-p", "no:randomly",
            "-o", "addopts=", *tests]


def run_tests(root: Path, tests: list[str], timeout: float,
              tail: list[str] | None = None) -> tuple[str, float]:
    """('pass' | 'fail' | 'timeout', seconds) for the tests in the copy at `root`.

    Output is discarded unless `tail` is given; then its last ~20 lines are appended to it."""
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", ATLAS_MUTATE="1")
    env.pop("PYTEST_ADDOPTS", None)
    t0 = time.monotonic()
    sink = tempfile.TemporaryFile() if tail is not None else None
    try:
        proc = subprocess.Popen(test_cmd(tests), cwd=root, env=env, stdout=sink or subprocess.DEVNULL,
                                stderr=subprocess.STDOUT if sink else subprocess.DEVNULL,
                                start_new_session=True)
        try:
            rc = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                pass
            proc.wait()
            return "timeout", time.monotonic() - t0
        if sink is not None and rc != 0:
            sink.seek(0)
            tail.extend(sink.read().decode("utf-8", "replace").splitlines()[-20:])
        return ("pass" if rc == 0 else "fail"), time.monotonic() - t0
    finally:
        if sink is not None:
            sink.close()


def mirror_context(context: Path, root: Path, dst: Path) -> Path:
    """Mirror `context` at `dst`: real dirs down to `root`, a real copy of `root`, symlinks elsewhere.

    Returns the copy of `root` inside the mirror."""
    parts = root.relative_to(context).parts
    here, out = context, dst
    for part in parts:
        out.mkdir(parents=True, exist_ok=True)
        for entry in sorted(here.iterdir()):
            if entry.name != part:
                (out / entry.name).symlink_to(entry)
        here, out = here / part, out / part
    shutil.copytree(root, out, ignore=COPY_IGNORE, symlinks=True)
    return out


class Pool:
    """N private copies of the tree; each mutant borrows one, edits one file, runs, restores."""

    def __init__(self, root: Path, n: int, base: Path, context: Path | None = None):
        self.copies: queue.Queue[Path] = queue.Queue()
        for i in range(n):
            dst = base / f"w{i}"
            if context is None:
                shutil.copytree(root, dst, ignore=COPY_IGNORE, symlinks=True)
                self.copies.put(dst)
            else:
                self.copies.put(mirror_context(context, root, dst))

    def run(self, rel: str, text: str | None, tests: list[str], timeout: float,
            tail: list[str] | None = None) -> tuple[str, float]:
        copy = self.copies.get()
        path = copy / rel
        original = path.read_text(encoding="utf-8")
        try:
            if text is not None:
                path.write_text(text, encoding="utf-8")
            return run_tests(copy, tests, timeout, tail)
        finally:
            path.write_text(original, encoding="utf-8")
            self.copies.put(copy)


def canary(rel: str, source: str) -> str:
    if Path(rel).suffix in TS_EXT:
        return 'throw new Error("atlas-mutate canary");\n' + source
    lines = source.splitlines(keepends=True)
    # keep `from __future__` imports first or the canary itself is a SyntaxError
    i = 0
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module == "__future__":
            i = node.end_lineno
        elif isinstance(node, ast.Expr) and isinstance(getattr(node, "value", None), ast.Constant) and i == 0 \
                and node is tree.body[0]:
            i = node.end_lineno
    return "".join(lines[:i]) + 'raise RuntimeError("atlas-mutate canary")\n' + "".join(lines[i:])


def mutate_target(pool: Pool, root: Path, rel: str, tests: list[str], k: int, seed: int,
                  jobs: int, log=print) -> dict:
    source = (root / rel).read_text(encoding="utf-8")
    ts = Path(rel).suffix in TS_EXT
    rep = {"target": rel, "tests": tests, "status": "ok", "sites": 0, "sampled": 0, "killed": 0,
           "survived": 0, "timeout": 0, "invalid": 0, "survivors": [], "score": None}
    try:
        sites = ts_sites(source, rel) if ts else py_sites(source)
    except (SyntaxError, RuntimeError) as exc:
        rep.update(status="parse-error", error=str(exc)[:300])
        return rep
    rep["sites"] = len(sites)
    tail: list[str] = []
    base, secs = pool.run(rel, None, tests, timeout=600, tail=tail)
    if base == "fail":  # a suite that flakes under load gets one more go; a timeout is not retried
        tail.clear()
        base, secs = pool.run(rel, None, tests, timeout=600, tail=tail)
        if base == "pass":
            rep["flaky_baseline"] = True
    rep["baseline_seconds"] = round(secs, 1)
    if base != "pass":
        if base == "fail":
            rep["baseline_tail"] = "\n".join(tail)
        rep["status"] = f"baseline-{base}"
        return rep
    can, _ = pool.run(rel, canary(rel, source), tests, timeout=max(30, secs * 3 + 10))
    if can == "pass":
        rep["status"] = "not-exercised"
        return rep
    chosen = sample(sites, k, seed)
    rep["sampled"] = len(chosen)
    timeout = max(20.0, secs * 4 + 10)

    def one(site):
        text = apply_site(source, site)
        if not ts and not py_valid(text):
            return site, "invalid"
        res, _ = pool.run(rel, text, tests, timeout)
        return site, res

    with cf.ThreadPoolExecutor(max_workers=jobs) as ex:
        for site, res in ex.map(one, chosen):
            if res == "invalid":
                rep["invalid"] += 1
            elif res == "pass":
                rep["survived"] += 1
                rep["survivors"].append({"line": site["line"], "func": site["func"], "desc": site["desc"]})
            else:
                rep["killed"] += 1
                if res == "timeout":
                    rep["timeout"] += 1
    graded = rep["killed"] + rep["survived"]
    rep["score"] = round(rep["killed"] / graded, 3) if graded else None
    log(f"{rel}: {rep['killed']}/{graded} killed ({rep['score']}), {rep['sites']} sites, "
        f"{len(rep['survivors'])} survivors")
    return rep


SKIP_DIRS = {"node_modules", "__pycache__", ".git", "mutants", "dist", "build", ".venv", "vendor"}
VENDORED = ("colony/herdr-web-ui/",)


def _is_test(rel: str) -> bool:
    n = Path(rel).name
    return (n.startswith(("test_", "test-")) or n.endswith("_test.py") or ".test." in n or ".spec." in n
            or n == "conftest.py" or n.startswith("_test_") or "/tests/" in rel or "/__tests__/" in rel)


FIXTURE_SUFFIXES = ("_fixture", "-fixture", ".golden-cases", ".golden-fixture", "-golden")
FIXTURE_STEMS = {"test_helpers", "test-shim", "bun-preload"}


def _is_fixture(rel: str) -> bool:
    """Test support code (fixtures, golden data, helpers) is not product code and is not graded."""
    stem = Path(rel).stem
    return stem.endswith(FIXTURE_SUFFIXES) or stem in FIXTURE_STEMS


def auto_plan(root: Path, max_tests: int = 2) -> list[dict]:
    """Pair every non-vendored source file with the test files that load it.

    Python: a test that imports the module by name, or names `<stem>.py` (subprocess and path tests).
    TS/JS: a test whose import specifier resolves to the file. Tests whose file name carries the
    module's stem are used when there are any, else the smallest others, at most `max_tests`, so a fault runs the tests
    written for that module rather than the whole suite."""
    files = []
    for dp, dns, fns in os.walk(root):
        dns[:] = sorted(d for d in dns if d not in SKIP_DIRS and not d.startswith("."))
        for fn in sorted(fns):
            rel = (Path(dp) / fn).relative_to(root).as_posix()
            if rel.startswith(VENDORED) or fn.endswith((".min.js", ".d.ts")):
                continue
            if Path(fn).suffix == ".py" or Path(fn).suffix in TS_EXT:
                files.append(rel)
    tests = [f for f in files if _is_test(f) and not Path(f).name.startswith("_test_") and
             Path(f).name != "conftest.py" and "-preload" not in f and "test-shim" not in f and
             "test-isolation" not in f and "test-omp-stubs" not in f and "test-dom-baseline" not in f]
    texts = {t: (root / t).read_text(encoding="utf-8", errors="replace") for t in tests}
    spec = re.compile(r"""(?:from\s+|import\s*\(?\s*|require\s*\(\s*)['"](\.{1,2}/[^'"]+)['"]""")
    ts_imports: dict[str, set[str]] = {}
    for t, text in texts.items():
        if Path(t).suffix not in TS_EXT:
            continue
        base = (root / t).parent
        for m in spec.finditer(text):
            target = (base / m.group(1)).resolve()
            for cand in [target, *[target.with_name(target.name + e) for e in (".ts", ".tsx", ".js", ".mjs")],
                         *[target.with_suffix(e) for e in (".ts", ".tsx")], target / "index.ts"]:
                if cand.is_file():
                    try:
                        ts_imports.setdefault(cand.relative_to(root).as_posix(), set()).add(t)
                    except ValueError:
                        pass
                    break
    plan = []
    for f in files:
        if _is_test(f) or _is_fixture(f) or f.endswith("__init__.py"):
            continue
        stem = Path(f).stem
        if Path(f).suffix == ".py":
            names = [stem] + ([stem[:-5]] if stem.endswith("_core") else [])  # a hook's tests load its core
            alt = "|".join(re.escape(n) for n in names)
            rx = re.compile(rf"(?:\bimport\s+(?:{alt})\b|\bfrom\s+(?:{alt})\s+import\b|"
                            rf"[\"'/](?:{alt})\.py\b|import_module\(\s*[\"'](?:{alt})[\"'])")
            hits = [t for t, text in texts.items() if t.endswith(".py") and rx.search(text)]
        else:
            hits = sorted(ts_imports.get(f, ()))
        if not hits:
            plan.append({"target": f, "tests": []})
            continue
        key = stem.replace("_", "").replace("-", "").lower()
        # `x_core.py` holds the logic of hook `x.py`; its tests are usually `test_x.py`
        keys = {key, key[:-4]} if key.endswith("core") and len(key) > 6 else {key}
        own = [t for t in hits if any(k in Path(t).name.replace("_", "").replace("-", "").lower() for k in keys)]
        rest = sorted((t for t in hits if t not in own), key=lambda t: len(texts[t]))
        # a module's own test files say what it should do; others are a fallback, smallest first
        exact = {f"test_{stem}", f"test_{stem[:-5]}", f"{stem}.test", f"{stem}.spec"}
        own.sort(key=lambda t: (Path(t).stem not in exact, len(texts[t])))
        plan.append({"target": f, "tests": (own or rest)[:max_tests]})
    return plan


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--root", required=True, help="tree the targets and tests are relative to")
    ap.add_argument("--context", help="ancestor of --root to mirror (siblings symlinked) so tests can read files above --root")
    ap.add_argument("--target", help="file to mutate, relative to --root")
    ap.add_argument("--tests", nargs="*", default=[], help="test files for --target, relative to --root")
    ap.add_argument("--plan", help="JSON list of {target, tests}")
    ap.add_argument("--max", type=int, default=30, help="mutants per target (0 = all)")
    ap.add_argument("--seed", type=int, default=1105)
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--json", help="write the full report here")
    ap.add_argument("--list", action="store_true", help="print the mutation sites of --target and exit")
    ap.add_argument("--auto-plan", metavar="OUT", help="write a {target, tests} plan for every source file and exit")
    a = ap.parse_args(argv)
    root = Path(a.root).resolve()
    context = Path(a.context).resolve() if a.context else None
    if context is not None and not (root == context or context in root.parents):
        print(f"--root {root} is not inside --context {context}", file=sys.stderr)
        return 2
    if a.auto_plan:
        plan = auto_plan(root)
        Path(a.auto_plan).write_text(json.dumps(plan, indent=1))
        print(f"{len(plan)} targets, {sum(1 for p in plan if p['tests'])} with tests")
        return 0
    if a.list and a.target:
        src = (root / a.target).read_text(encoding="utf-8")
        sites = ts_sites(src, a.target) if Path(a.target).suffix in TS_EXT else py_sites(src)
        for s in sites:
            print(f"{s['line']}\t{s['func']}\t{s['desc']}")
        return 0
    if a.plan:
        plan = [p for p in json.loads(Path(a.plan).read_text()) if p.get("tests")]
    elif a.target and a.tests:
        plan = [{"target": a.target, "tests": a.tests}]
    else:
        ap.print_usage(sys.stderr)
        return 2
    reports = []
    with tempfile.TemporaryDirectory(prefix="atlas-mutate-") as tmp:
        pool = Pool(root, a.jobs, Path(tmp), context)
        for item in plan:
            rep = mutate_target(pool, root, item["target"], item["tests"], a.max, a.seed, a.jobs,
                                log=lambda m: print(m, flush=True))
            if rep["status"] != "ok":
                print(f"{item['target']}: {rep['status']}", flush=True)
            reports.append(rep)
            if a.json:
                Path(a.json).write_text(json.dumps(reports, indent=1))
    killed = sum(r["killed"] for r in reports)
    graded = killed + sum(r["survived"] for r in reports)
    print(f"total: {killed}/{graded} killed" + (f" ({killed / graded:.1%})" if graded else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
