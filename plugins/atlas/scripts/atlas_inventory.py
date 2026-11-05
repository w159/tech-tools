#!/usr/bin/env python3
"""Map every function, class, method and top-level definition in the Atlas plugin, plus its hooks,
skills, agents, mods and widgets, into one inventory.

  atlas_inventory.py [--root plugins/atlas] [--json out.json] [--markdown out.md]

Python is parsed with `ast`. TypeScript and JavaScript are parsed with the TypeScript compiler when
node can resolve the `typescript` package (NODE_PATH or a global install), and with a conservative
pattern scan otherwise; the report says which. Each code symbol carries file, line span and kind.
Plugin components come from their own manifests: hooks/hooks.json (Claude Code), hooks/hooks.codex.json
(Codex), skills/*/SKILL.md, agents/*.md, mod/ (Claude Code mods) and omp/ (omp extension).

`--tests` adds, per symbol, the test files that name it (a cheap reference check; mutation testing in
atlas_mutate.py is the real proof that a test catches faults). Stdlib only.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

SKIP_DIRS = {"node_modules", "__pycache__", ".git", "dist", "build", ".venv", "mutants", "vendor"}
PY_EXT = {".py"}
# Upstream code copied in with its own tests and build; listed, but kept apart from Atlas's own counts.
VENDORED = ("colony/herdr-web-ui/",)
TS_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"}

TS_SCRIPT = r"""
const ts = require(process.argv[process.argv.length - 1]);  // node -e puts the first extra arg at argv[1]
const fs = require('fs');
const files = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = [];
for (const f of files) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const kind = f.endsWith('x') ? ts.ScriptKind.TSX : (f.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, kind);
  const line = (p) => sf.getLineAndCharacterOfPosition(p).line + 1;
  const visit = (n, scope) => {
    let name = null, k = null;
    if (ts.isFunctionDeclaration(n) && n.name) { name = n.name.text; k = 'function'; }
    else if (ts.isClassDeclaration(n) && n.name) { name = n.name.text; k = 'class'; }
    else if ((ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n)) && n.name) { name = n.name.getText(sf); k = 'method'; }
    else if (ts.isConstructorDeclaration(n)) { name = 'constructor'; k = 'method'; }
    else if (ts.isInterfaceDeclaration(n)) { name = n.name.text; k = 'interface'; }
    else if (ts.isTypeAliasDeclaration(n)) { name = n.name.text; k = 'type'; }
    else if (ts.isEnumDeclaration(n)) { name = n.name.text; k = 'enum'; }
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
             (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) { name = n.name.text; k = 'function'; }
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && scope === '' &&
             n.parent && n.parent.parent && ts.isVariableStatement(n.parent.parent) && n.parent.parent.parent === sf) { name = n.name.text; k = 'const'; }
    if (name) {
      const q = scope ? scope + '.' + name : name;
      out.push({file: f, name: q, kind: k, line: line(n.getStart(sf)), end: line(n.end)});
      if (k === 'class' || k === 'function' || k === 'method') { ts.forEachChild(n, (c) => visit(c, q)); return; }
    }
    ts.forEachChild(n, (c) => visit(c, scope));
  };
  visit(sf, '');
}
process.stdout.write(JSON.stringify(out));
"""

_TS_PATTERNS = [
    (re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)"), "function"),
    (re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)"), "class"),
    (re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>"), "function"),
    (re.compile(r"^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)"), "interface"),
    (re.compile(r"^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*="), "type"),
]


def walk(root: Path, exts: set[str]) -> list[Path]:
    out = []
    for dp, dns, fns in os.walk(root):
        dns[:] = sorted(d for d in dns if d not in SKIP_DIRS and not d.startswith(".") or d == ".claude-plugin")
        for fn in sorted(fns):
            p = Path(dp) / fn
            if p.suffix in exts and not fn.endswith(".min.js"):
                out.append(p)
    return out


def is_test(p: Path) -> bool:
    n = p.name
    return (n.startswith("test_") or n.endswith("_test.py") or ".test." in n or ".spec." in n
            or n in ("conftest.py",) or "/tests/" in p.as_posix() or "/__tests__/" in p.as_posix())


def py_symbols(path: Path, rel: str) -> list[dict]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), filename=rel)
    except SyntaxError as exc:
        return [{"file": rel, "name": "<syntax error>", "kind": "error", "line": exc.lineno or 0, "end": 0}]
    out: list[dict] = []

    def visit(node, scope: str):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                q = f"{scope}.{child.name}" if scope else child.name
                kind = "class" if isinstance(child, ast.ClassDef) else (
                    "method" if scope and isinstance(node, ast.ClassDef) else "function")
                out.append({"file": rel, "name": q, "kind": kind, "line": child.lineno,
                            "end": getattr(child, "end_lineno", child.lineno)})
                visit(child, q)
            elif not scope and isinstance(child, (ast.Assign, ast.AnnAssign)):
                targets = child.targets if isinstance(child, ast.Assign) else [child.target]
                for t in targets:
                    if isinstance(t, ast.Name) and t.id.isupper():
                        out.append({"file": rel, "name": t.id, "kind": "const", "line": child.lineno,
                                    "end": getattr(child, "end_lineno", child.lineno)})

    visit(tree, "")
    return out


def find_typescript() -> str | None:
    node = shutil.which("node")
    if not node:
        return None
    paths = [p for p in os.environ.get("NODE_PATH", "").split(os.pathsep) if p]
    paths += ["/opt/node-tools/node_modules", "/usr/local/lib/node_modules", "/usr/lib/node_modules"]
    try:
        root = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True, timeout=20).stdout.strip()
        if root:
            paths.append(root)
    except (OSError, subprocess.TimeoutExpired):
        pass
    for p in paths:
        cand = Path(p) / "typescript"
        if (cand / "package.json").exists():
            return str(cand)
    return None


def ts_symbols(files: list[Path], root: Path) -> tuple[list[dict], str]:
    tsmod = find_typescript()
    if tsmod and files:
        proc = subprocess.run(["node", "-e", TS_SCRIPT, tsmod], input=json.dumps([str(f) for f in files]),
                              capture_output=True, text=True, timeout=600)
        if proc.returncode == 0:
            syms = json.loads(proc.stdout)
            for s in syms:
                s["file"] = Path(s["file"]).relative_to(root).as_posix()
            return syms, "typescript"
    out = []
    for f in files:
        rel = f.relative_to(root).as_posix()
        for i, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for rx, kind in _TS_PATTERNS:
                m = rx.match(line)
                if m:
                    out.append({"file": rel, "name": m.group(1), "kind": kind, "line": i, "end": i})
                    break
    return out, "pattern"


def components(root: Path) -> dict:
    comp: dict = {"hooks": [], "codex_hooks": [], "skills": [], "agents": [], "mods": [], "omp": [],
                  "output_styles": []}
    for key, name in (("hooks", "hooks.json"), ("codex_hooks", "hooks.codex.json")):
        p = root / "hooks" / name
        if p.exists():
            doc = json.loads(p.read_text())
            for event, groups in (doc.get("hooks") or {}).items():
                for g in groups:
                    for h in g.get("hooks", []):
                        comp[key].append({"event": event, "matcher": g.get("matcher", ""),
                                          "command": h.get("command", ""), "timeout": h.get("timeout")})
    for sk in sorted((root / "skills").glob("*/SKILL.md")):
        head = sk.read_text(encoding="utf-8").split("---", 2)
        fm = head[1] if len(head) > 2 else ""
        manual = bool(re.search(r"^disable-model-invocation:\s*true", fm, re.M))
        comp["skills"].append({"name": sk.parent.name, "manual": manual,
                               "lines": len(sk.read_text(encoding="utf-8").splitlines())})
    for ag in sorted((root / "agents").glob("*.md")):
        comp["agents"].append({"name": ag.stem})
    for st in sorted((root / "output-styles").glob("*.md")) if (root / "output-styles").exists() else []:
        comp["output_styles"].append({"name": st.stem})
    mod = root / "mod"
    if mod.exists():
        for f in sorted(mod.rglob("*")):
            if f.suffix in (".ts", ".tsx") and not is_test(f) and "test-" not in f.name:
                comp["mods"].append({"file": f.relative_to(root).as_posix()})
    omp = root / "omp"
    if omp.exists():
        for f in sorted(omp.rglob("*.ts")):
            if not is_test(f) and "test-" not in f.name:
                comp["omp"].append({"file": f.relative_to(root).as_posix()})
    return comp


def attach_tests(symbols: list[dict], test_files: list[Path], root: Path) -> None:
    # Tokenize each test file once into a set of identifiers, then look each symbol's leaf name up.
    # A regex per symbol per file is O(symbols x files x bytes) and takes minutes on this tree.
    ident = re.compile(r"[A-Za-z_$][\w$]*")
    index: dict[str, list[str]] = {}
    for t in test_files:
        rel = t.relative_to(root).as_posix()
        for tok in set(ident.findall(t.read_text(encoding="utf-8", errors="replace"))):
            index.setdefault(tok, []).append(rel)
    for s in symbols:
        leaf = s["name"].split(".")[-1]
        if len(leaf) >= 3:
            s["tests"] = sorted(index.get(leaf, []))


def build(root: Path, with_tests: bool) -> dict:
    py = [p for p in walk(root, PY_EXT)]
    ts = [p for p in walk(root, TS_EXT)]
    src_py = [p for p in py if not is_test(p)]
    src_ts = [p for p in ts if not is_test(p) and not p.name.startswith("test-")]
    symbols = []
    for p in src_py:
        symbols += py_symbols(p, p.relative_to(root).as_posix())
    ts_syms, parser = ts_symbols(src_ts, root)
    symbols += ts_syms
    if with_tests:
        attach_tests(symbols, [p for p in py + ts if is_test(p) or p.name.startswith("test-")], root)
    return {"root": root.as_posix(), "ts_parser": parser,
            "files": {"python": len(src_py), "ts_js": len(src_ts),
                      "python_tests": sum(1 for p in py if is_test(p)),
                      "ts_tests": sum(1 for p in ts if is_test(p))},
            "symbols": [dict(s, vendored=True) if is_vendored(s["file"]) else s for s in symbols],
            "components": components(root)}


def is_vendored(rel: str) -> bool:
    return rel.startswith(VENDORED)


def area(rel: str) -> str:
    parts = rel.split("/")
    if parts[0] == "colony" and len(parts) > 2:
        return "/".join(parts[:3])
    if parts[0] == "scripts" and len(parts) > 2:
        return "/".join(parts[:2])
    return parts[0] if len(parts) > 1 else "."


def markdown(inv: dict) -> str:
    syms = inv["symbols"]
    lines = ["# Atlas inventory", "",
             f"Generated by `scripts/atlas_inventory.py`. TypeScript parser: {inv['ts_parser']}.", "",
             "| | count |", "|---|---|",
             f"| Python source files | {inv['files']['python']} |",
             f"| TS/JS source files | {inv['files']['ts_js']} |",
             f"| Python test files | {inv['files']['python_tests']} |",
             f"| TS/JS test files | {inv['files']['ts_tests']} |"]
    kinds: dict[str, int] = {}
    for s in syms:
        kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    for k in sorted(kinds):
        lines.append(f"| {k} | {kinds[k]} |")
    comp = inv["components"]
    lines += ["", "## Components", "",
              f"- Claude Code hook entries: {len(comp['hooks'])}; Codex hook entries: {len(comp['codex_hooks'])}",
              f"- Skills: {len(comp['skills'])} ({sum(s['manual'] for s in comp['skills'])} manual)",
              f"- Agents: {len(comp['agents'])}; output styles: {len(comp['output_styles'])}",
              f"- Mod files (Claude Code): {len(comp['mods'])}; omp extension files: {len(comp['omp'])}", ""]
    lines += ["| event | matcher | command |", "|---|---|---|"]
    for h in comp["hooks"]:
        cmd = h["command"].replace("|", "\\|")
        lines.append(f"| {h['event']} | `{h['matcher'] or '*'}` | `{cmd[-80:]}` |")
    lines += ["", "| skill | manual | lines |", "|---|---|---|"]
    lines += [f"| {s['name']} | {'yes' if s['manual'] else ''} | {s['lines']} |" for s in comp["skills"]]
    with_tests = any("tests" in s for s in syms)
    lines += ["", "## Symbols by area", "",
              "Vendored areas (upstream code with its own tests) are marked and left out of the totals below.", "",
              "| area | files | functions | methods | classes | other | not named by a test |",
              "|---|---|---|---|---|---|---|"]
    areas: dict[str, dict] = {}
    for s in syms:
        a = areas.setdefault(area(s["file"]), {"files": set(), "function": 0, "method": 0, "class": 0,
                                               "other": 0, "untested": 0})
        a["files"].add(s["file"])
        a[s["kind"] if s["kind"] in ("function", "method", "class") else "other"] += 1
        if with_tests and s["kind"] in ("function", "method") and not s.get("tests"):
            a["untested"] += 1
    for name in sorted(areas):
        a = areas[name]
        tag = " (vendored)" if is_vendored(name + "/") else ""
        unt = str(a["untested"]) if with_tests else "-"
        lines.append(f"| {name}{tag} | {len(a['files'])} | {a['function']} | {a['method']} | {a['class']} "
                     f"| {a['other']} | {unt} |")
    if with_tests:
        own = [s for s in syms if s["kind"] in ("function", "method") and not is_vendored(s["file"])]
        untested = [s for s in own if not s.get("tests")]
        lines += ["", f"Atlas-owned functions and methods that no test file names: {len(untested)} of {len(own)}. "
                      "This is a reference check only; the mutation scores measure whether tests catch faults."]
    lines += ["", "The full per-symbol list (file, line span, kind, naming tests) is in the JSON beside this page.", ""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument("--json")
    ap.add_argument("--markdown")
    ap.add_argument("--tests", action="store_true", help="list the test files that name each symbol")
    a = ap.parse_args(argv)
    root = Path(a.root).resolve()
    if not (root / "skills").is_dir():
        print(f"not a plugin root: {root}", file=sys.stderr)
        return 2
    inv = build(root, a.tests)
    if a.json:
        Path(a.json).write_text(json.dumps(inv, indent=1))
    md = markdown(inv)
    if a.markdown:
        Path(a.markdown).write_text(md)
    if not a.json and not a.markdown:
        print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
