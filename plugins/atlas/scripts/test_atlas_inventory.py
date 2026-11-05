"""Tests for atlas_inventory: symbol extraction, component discovery, test naming and the markdown summary."""

from __future__ import annotations

import _test_isolation  # noqa: F401  (must be first: redirects ATLAS_HOME)

import json
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas_inventory as inv  # noqa: E402


def _plugin(tmp_path: Path) -> Path:
    root = tmp_path / "plug"
    for d in ("skills/a", "skills/b", "agents", "hooks", "scripts", "mod", "omp", "output-styles",
              "colony/herdr-web-ui/src", "scripts/__pycache__"):
        (root / d).mkdir(parents=True)
    (root / "skills/a/SKILL.md").write_text("---\nname: a\ndisable-model-invocation: true\n---\nbody\n")
    (root / "skills/b/SKILL.md").write_text("---\nname: b\ndescription: x\n---\nbody\nmore\n")
    (root / "agents/runner.md").write_text("---\nname: runner\n---\n")
    (root / "output-styles/s.md").write_text("style\n")
    (root / "hooks/hooks.json").write_text(json.dumps({"hooks": {"Stop": [
        {"matcher": "*", "hooks": [{"type": "command", "command": "python3 x.py", "timeout": 5}]}]}}))
    (root / "scripts/tool.py").write_text(
        "LIMIT = 3\nlower = 1\n\nclass Box:\n    def open(self):\n        def inner():\n            pass\n\n"
        "def helper():\n    return 1\n\nasync def fetch():\n    pass\n")
    (root / "scripts/test_tool.py").write_text("from tool import helper, Box\n")
    (root / "scripts/__pycache__/junk.py").write_text("def nope(): pass\n")
    (root / "mod/panel.ts").write_text("export function draw() {}\nexport const k = () => 1;\n")
    (root / "mod/panel.test.ts").write_text("import { draw } from './panel';\n")
    (root / "omp/ext.ts").write_text("export class Ext { run() {} }\ninterface I { a: number }\ntype T = string;\n")
    (root / "colony/herdr-web-ui/src/v.ts").write_text("export function vend() {}\n")
    return root


def test_python_symbols_scopes_kinds_and_consts(tmp_path):
    root = _plugin(tmp_path)
    syms = {s["name"]: s for s in inv.py_symbols(root / "scripts/tool.py", "scripts/tool.py")}
    assert syms["Box"]["kind"] == "class" and syms["Box.open"]["kind"] == "method"
    assert syms["Box.open.inner"]["kind"] == "function"
    assert syms["helper"]["kind"] == "function" and syms["fetch"]["kind"] == "function"
    assert syms["LIMIT"]["kind"] == "const" and "lower" not in syms
    assert syms["helper"]["line"] == 9 and syms["helper"]["end"] == 10


def test_python_syntax_error_is_reported_not_raised(tmp_path):
    p = tmp_path / "bad.py"
    p.write_text("def (:\n")
    assert inv.py_symbols(p, "bad.py")[0]["kind"] == "error"


def test_build_skips_tests_and_caches_flags_vendored_and_names_tests(tmp_path):
    root = _plugin(tmp_path)
    doc = inv.build(root, with_tests=True)
    files = {s["file"] for s in doc["symbols"]}
    assert "scripts/test_tool.py" not in files and not any("__pycache__" in f for f in files)
    assert "mod/panel.test.ts" not in files
    by = {(s["file"], s["name"]): s for s in doc["symbols"]}
    assert by[("scripts/tool.py", "helper")]["tests"] == ["scripts/test_tool.py"]
    assert by[("scripts/tool.py", "fetch")]["tests"] == []
    assert by[("colony/herdr-web-ui/src/v.ts", "vend")]["vendored"] is True
    assert "vendored" not in by[("scripts/tool.py", "helper")]
    assert doc["files"] == {"python": 1, "ts_js": 3, "python_tests": 1, "ts_tests": 1}


def test_ts_symbols_found_by_either_parser(tmp_path):
    root = _plugin(tmp_path)
    names = {(s["name"], s["kind"]) for s in inv.build(root, False)["symbols"] if s["file"].startswith(("mod", "omp"))}
    assert {("draw", "function"), ("k", "function"), ("Ext", "class"), ("I", "interface"), ("T", "type")} <= names


@pytest.mark.skipif(not (shutil.which("node") and inv.find_typescript()), reason="needs node and typescript")
def test_typescript_parser_is_used_and_finds_methods(tmp_path):
    root = _plugin(tmp_path)
    doc = inv.build(root, False)
    assert doc["ts_parser"] == "typescript"
    assert any(s["name"] == "Ext.run" and s["kind"] == "method" for s in doc["symbols"])


def test_components(tmp_path):
    c = inv.components(_plugin(tmp_path))
    assert c["hooks"] == [{"event": "Stop", "matcher": "*", "command": "python3 x.py", "timeout": 5}]
    assert c["codex_hooks"] == []
    assert [(s["name"], s["manual"], s["lines"]) for s in c["skills"]] == [("a", True, 5), ("b", False, 6)]
    assert c["agents"] == [{"name": "runner"}] and c["output_styles"] == [{"name": "s"}]
    assert c["mods"] == [{"file": "mod/panel.ts"}] and c["omp"] == [{"file": "omp/ext.ts"}]


_HAS_TS = bool(shutil.which("node") and inv.find_typescript())


@pytest.mark.parametrize("parser, untested", [
    # owned functions and methods: open, inner, helper, fetch, draw, k, run (a class method, typescript only);
    # helper and draw are named by tests. The pattern scan cannot see `Ext.run`, so it has 6 symbols, not 7.
    pytest.param("typescript", "5 of 7", marks=pytest.mark.skipif(not _HAS_TS, reason="needs node and typescript")),
    pytest.param("pattern", "4 of 6"),
])
def test_markdown_summary_and_untested_count(tmp_path, monkeypatch, parser, untested):
    if parser == "pattern":
        monkeypatch.setattr(inv, "find_typescript", lambda: None)
    root = _plugin(tmp_path)
    md = inv.markdown(inv.build(root, True))
    assert f"TypeScript parser: {parser}." in md
    assert "| Python source files | 1 |" in md and "Skills: 2 (1 manual)" in md
    assert "colony/herdr-web-ui/src (vendored)" in md
    assert "| Stop | `*` | `python3 x.py` |" in md
    assert f"Atlas-owned functions and methods that no test file names: {untested}." in md


def test_area_buckets():
    assert inv.area("colony/herdr-web-ui/src/a.ts") == "colony/herdr-web-ui/src"
    assert inv.area("scripts/dashboard_ui/js/a.js") == "scripts/dashboard_ui"
    assert inv.area("hooks/x.py") == "hooks" and inv.area("top.py") == "."


def test_cli(tmp_path, capsys):
    root = _plugin(tmp_path)
    assert inv.main(["--root", str(tmp_path)]) == 2
    out_json, out_md = tmp_path / "i.json", tmp_path / "i.md"
    assert inv.main(["--root", str(root), "--tests", "--json", str(out_json), "--markdown", str(out_md)]) == 0
    assert json.loads(out_json.read_text())["components"]["agents"] == [{"name": "runner"}]
    assert out_md.read_text().startswith("# Atlas inventory")
    assert inv.main(["--root", str(root)]) == 0 and "# Atlas inventory" in capsys.readouterr().out
