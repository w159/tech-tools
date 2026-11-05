"""Tests for atlas_mutate: site discovery, splicing, sampling, canary and an end-to-end run on a tiny tree."""

from __future__ import annotations

import _test_isolation  # noqa: F401  (must be first: redirects ATLAS_HOME)

import ast
import json
import shutil
import sys
import textwrap
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas_mutate as m  # noqa: E402

SRC = textwrap.dedent('''\
    """Module doc: 1 < 2 and True are not mutated here."""
    from __future__ import annotations

    LIMIT: int = 3


    def clamp(x: int) -> int:
        """Doc."""
        if x > LIMIT and not x == 99:
            return LIMIT
        for i in range(2):
            if i:
                break
        return x - 0


    def label(n):
        return f"{n + 1} items" + "!"
    ''')


def test_sites_cover_each_operator_and_skip_docstrings_annotations_fstrings():
    sites = m.py_sites(SRC)
    descs = [s["desc"] for s in sites]
    assert "Gt -> <=" in descs and "and -> or" in descs and "drop not" in descs
    assert "Eq -> !=" in descs and "return None" in descs and "break -> continue" in descs
    assert "Sub -> Add" in descs and "3 -> 4" in descs
    assert all(s["line"] != 1 for s in sites)  # module docstring
    # f-string internals and string concatenation are not arithmetic; only the return is a site
    assert [s["desc"] for s in sites if s["line"] == 18] == ["return None"]
    assert {s["func"] for s in sites} >= {"clamp", "<module>"}


def test_every_site_splices_to_valid_python_that_differs_in_one_place():
    for site in m.py_sites(SRC):
        out = m.apply_site(SRC, site)
        assert m.py_valid(out), site
        assert out != SRC
        assert out[:site["start"]] == SRC[:site["start"]]


def test_splice_keeps_comments_and_non_ascii():
    src = "x = 1  # note\ns = 'café'; ok = s == 'café'\n"
    sites = [s for s in m.py_sites(src) if s["desc"].startswith("Eq")]
    out = m.apply_site(src, sites[0])
    assert "# note" in out and "(s != 'café')" in out and m.py_valid(out)


def test_sample_is_deterministic_and_spread_across_functions():
    sites = [{"func": f, "start": i, "desc": str(i)} for i, f in enumerate(["a"] * 50 + ["b"] * 2 + ["c"])]
    one, two = m.sample(sites, 6, seed=7), m.sample(sites, 6, seed=7)
    assert one == two and len(one) == 6
    assert {s["func"] for s in one} == {"a", "b", "c"}
    assert m.sample(sites, 0, 1) == sites and m.sample(sites[:3], 10, 1) == sites[:3]


def test_enclosing_picks_innermost():
    scopes = [(1, 10, "A"), (2, 5, "A.f"), (12, 14, "g")]
    assert m.enclosing(scopes, 3) == "A.f" and m.enclosing(scopes, 7) == "A" and m.enclosing(scopes, 11) == "<module>"


def test_canary_goes_after_docstring_and_future_import():
    out = m.canary("x.py", SRC)
    assert m.py_valid(out)
    lines = out.splitlines()
    assert lines.index('raise RuntimeError("atlas-mutate canary")') > lines.index("from __future__ import annotations")
    assert m.canary("x.ts", "export const a = 1;\n").startswith("throw new Error")


def test_test_cmd_by_language():
    assert m.test_cmd(["a.test.ts"])[:2] == ["bun", "test"]
    assert m.test_cmd(["test_a.py"])[1:3] == ["-m", "pytest"]


def _tree(tmp_path: Path, test_body: str) -> Path:
    root = tmp_path / "tree"
    (root / "pkg").mkdir(parents=True)
    (root / "pkg" / "calc.py").write_text("def add(a, b):\n    return a + b\n\n\ndef pos(x):\n    return x > 0\n")
    (root / "pkg" / "test_calc.py").write_text(
        "import sys, pathlib\nsys.path.insert(0, str(pathlib.Path(__file__).parent))\nimport calc\n\n" + test_body)
    return root


def test_end_to_end_scores_kills_survivors_and_baseline(tmp_path):
    root = _tree(tmp_path, "def test_add():\n    assert calc.add(2, 3) == 5\n")
    pool = m.Pool(root, 2, tmp_path / "w")
    rep = m.mutate_target(pool, root, "pkg/calc.py", ["pkg/test_calc.py"], k=0, seed=1, jobs=2, log=lambda s: None)
    assert rep["status"] == "ok" and rep["sites"] == rep["sampled"] == 5
    assert rep["killed"] == 2 and rep["survived"] == 3  # `pos` has no test
    assert {s["func"] for s in rep["survivors"]} == {"pos"}
    assert rep["score"] == 0.4
    assert (root / "pkg" / "calc.py").read_text().startswith("def add(a, b):\n    return a + b")


def test_not_exercised_and_red_baseline_are_reported(tmp_path):
    root = _tree(tmp_path, "def test_nothing():\n    assert True\n")
    (root / "pkg" / "test_calc.py").write_text("def test_nothing():\n    assert True\n")
    pool = m.Pool(root, 1, tmp_path / "w")
    assert m.mutate_target(pool, root, "pkg/calc.py", ["pkg/test_calc.py"], 0, 1, 1, log=lambda s: None)[
        "status"] == "not-exercised"
    (root / "pkg" / "test_calc.py").write_text("def test_red():\n    assert False\n")
    pool = m.Pool(root, 1, tmp_path / "w2")
    assert m.mutate_target(pool, root, "pkg/calc.py", ["pkg/test_calc.py"], 0, 1, 1, log=lambda s: None)[
        "status"] == "baseline-fail"


def test_auto_plan_pairs_modules_with_their_own_tests(tmp_path):
    root = _tree(tmp_path, "def test_add():\n    assert calc.add(1, 1) == 2\n")
    (root / "pkg" / "other.py").write_text("X = 1\n")
    (root / "pkg" / "test_misc.py").write_text("import calc\n")
    (root / "colony" / "herdr-web-ui").mkdir(parents=True)
    (root / "colony" / "herdr-web-ui" / "v.py").write_text("Y = 1\n")
    plan = {p["target"]: p["tests"] for p in m.auto_plan(root)}
    assert plan["pkg/calc.py"] == ["pkg/test_calc.py"]  # its own test, not the misc one
    assert plan["pkg/other.py"] == []
    assert "colony/herdr-web-ui/v.py" not in plan and "pkg/test_calc.py" not in plan


@pytest.mark.skipif(not (shutil.which("node") and m.find_typescript()), reason="needs node and typescript")
def test_ts_sites_skip_types_and_cover_operators():
    src = "type T = true;\nexport function f(a: number): boolean {\n  if (!a) return false;\n  return a === 1 && a > 0;\n}\n"
    sites = m.ts_sites(src, "f.ts")
    descs = [s["desc"] for s in sites]
    assert "drop !" in descs and "=== -> !==" in descs and "&& -> ||" in descs and "> -> <=" in descs
    assert "false -> true" in descs and "1 -> 2" in descs
    assert all(s["line"] != 1 for s in sites)  # the `true` in the type alias
    assert {s["func"] for s in sites} == {"f"}


def test_cli_list_and_usage(tmp_path, capsys):
    root = _tree(tmp_path, "")
    assert m.main(["--root", str(root), "--target", "pkg/calc.py", "--list"]) == 0
    assert "add\tAdd -> Sub" in capsys.readouterr().out
    assert m.main(["--root", str(root)]) == 2
    out = tmp_path / "plan.json"
    assert m.main(["--root", str(root), "--auto-plan", str(out)]) == 0
    assert json.loads(out.read_text())


def _flaky_body(marker: Path) -> str:
    return ("import pathlib\n\ndef test_add():\n    mk = pathlib.Path(%r)\n    first = not mk.exists()\n"
            "    mk.write_text('x')\n    assert not first\n    assert calc.add(2, 3) == 5\n" % str(marker))


def test_flaky_baseline_is_retried_graded_and_flagged(tmp_path):
    root = _tree(tmp_path, _flaky_body(tmp_path / "marker"))
    pool = m.Pool(root, 1, tmp_path / "w")
    rep = m.mutate_target(pool, root, "pkg/calc.py", ["pkg/test_calc.py"], 0, 1, 1, log=lambda s: None)
    assert rep["flaky_baseline"] is True
    assert rep["status"] == "ok" and rep["score"] is not None


def test_twice_failing_baseline_stays_baseline_fail_with_tail(tmp_path):
    root = _tree(tmp_path, "def test_red():\n    assert 1 == 2, 'boom-marker'\n")
    pool = m.Pool(root, 1, tmp_path / "w")
    rep = m.mutate_target(pool, root, "pkg/calc.py", ["pkg/test_calc.py"], 0, 1, 1, log=lambda s: None)
    assert rep["status"] == "baseline-fail" and "flaky_baseline" not in rep
    assert rep["baseline_tail"].strip() and "boom-marker" in rep["baseline_tail"]
    assert len(rep["baseline_tail"].splitlines()) <= 20


def test_baseline_timeout_is_not_retried(tmp_path, monkeypatch):
    root = _tree(tmp_path, "def test_nothing():\n    assert True\n")
    calls = []

    def fake(root_, tests, timeout, tail=None):
        calls.append(timeout)
        return "timeout", 1.0

    monkeypatch.setattr(m, "run_tests", fake)
    pool = m.Pool(root, 1, tmp_path / "w")
    rep = m.mutate_target(pool, root, "pkg/calc.py", ["pkg/test_calc.py"], 0, 1, 1, log=lambda s: None)
    assert rep["status"] == "baseline-timeout" and len(calls) == 1


def test_auto_plan_skips_test_fixtures_and_helpers(tmp_path):
    root = _tree(tmp_path, "def test_add():\n    assert calc.add(1, 1) == 2\n")
    (root / "mod").mkdir()
    names = ["live_fixture.ts", "x.golden-cases.ts", "x.golden-fixture.ts", "core-fixture.ts", "core-golden.ts",
             "test_helpers.ts", "test-shim.ts", "bun-preload.ts", "real.ts"]
    for n in names:
        (root / "mod" / n).write_text("export const a = 1 + 2;\n")
    plan = {p["target"] for p in m.auto_plan(root)}
    assert "mod/real.ts" in plan and "pkg/calc.py" in plan
    assert not {f"mod/{n}" for n in names if n != "real.ts"} & plan


def _ctx_tree(tmp_path: Path) -> tuple[Path, Path]:
    ancestor = tmp_path / "ancestor"
    (ancestor / "shared").mkdir(parents=True)
    (ancestor / "shared" / "x.txt").write_text("7")
    plug = ancestor / "plug"
    plug.mkdir()
    (plug / "src.py").write_text("def seven():\n    return 7\n")
    (plug / "test_src.py").write_text(
        "import pathlib, sys\nsys.path.insert(0, str(pathlib.Path(__file__).parent))\nimport src\n\n\n"
        "def test_seven():\n    shared = pathlib.Path(__file__).resolve().parent.parent / 'shared' / 'x.txt'\n"
        "    assert src.seven() == int(shared.read_text())\n")
    return ancestor, plug


def _run_ctx(plug: Path, tmp_path: Path, *extra: str) -> dict:
    out = tmp_path / "out.json"
    rc = m.main(["--root", str(plug), "--target", "src.py", "--tests", "test_src.py", "--max", "0",
                 "--jobs", "1", "--json", str(out), *extra])
    assert rc == 0
    return json.loads(out.read_text())[0]


def test_context_baseline_fails_without_and_passes_with(tmp_path):
    ancestor, plug = _ctx_tree(tmp_path)
    assert _run_ctx(plug, tmp_path)["status"] == "baseline-fail"
    rep = _run_ctx(plug, tmp_path, "--context", str(ancestor))
    assert rep["status"] == "ok" and rep["score"] is not None


def test_context_mirror_symlinks_siblings_and_leaves_original_unchanged(tmp_path):
    ancestor, plug = _ctx_tree(tmp_path)
    before = sorted((p.relative_to(ancestor).as_posix(), p.read_bytes() if p.is_file() else b"")
                    for p in ancestor.rglob("*"))
    _run_ctx(plug, tmp_path, "--context", str(ancestor))
    after = sorted((p.relative_to(ancestor).as_posix(), p.read_bytes() if p.is_file() else b"")
                   for p in ancestor.rglob("*"))
    assert before == after
    copy = m.mirror_context(ancestor, plug, tmp_path / "mirror")
    assert copy == tmp_path / "mirror" / "plug" and not copy.is_symlink()
    assert (tmp_path / "mirror" / "shared").is_symlink()
    assert (copy / "src.py").is_file() and not (copy / "src.py").is_symlink()


def test_context_must_contain_root(tmp_path, capsys):
    ancestor, plug = _ctx_tree(tmp_path)
    other = tmp_path / "elsewhere"
    other.mkdir()
    rc = m.main(["--root", str(plug), "--context", str(other), "--target", "src.py", "--tests", "test_src.py"])
    assert rc == 2 and "not inside --context" in capsys.readouterr().err
