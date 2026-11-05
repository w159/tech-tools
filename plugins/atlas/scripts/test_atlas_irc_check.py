"""atlas_irc DONE/check machinery: digests, docstring restore, the unit-check runner, staging, speculation helpers."""

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _test_isolation  # noqa: F401,E402
import atlas_irc as irc  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in list(os.environ):
        if k.startswith("ATLAS_IRC_") or k.startswith("ATLAS_CREW_"):
            monkeypatch.delenv(k)
    monkeypatch.setattr(irc.time, "sleep", lambda s: None)


@pytest.fixture
def bus(tmp_path):
    return irc.init_bus(tmp_path / "bus", "#t", ["a", "b", "c"], "boss")


@pytest.fixture
def proj(tmp_path):
    p = tmp_path / "proj"
    p.mkdir()
    return p


def sha(b):
    return hashlib.sha256(b).hexdigest()


# --- _owned_files / _owned_digest ------------------------------------------


def test_owned_files_literals_globs_dirs(proj):
    (proj / "src").mkdir()
    (proj / "src" / "a.py").write_text("a")
    (proj / "src" / "sub").mkdir()
    (proj / "src" / "sub" / "b.py").write_text("b")
    (proj / "top.py").write_text("t")
    (proj / "x1.txt").write_text("x")
    assert irc._owned_files(proj, ["top.py", "missing.py"]) == ["missing.py", "top.py"]
    assert irc._owned_files(proj, ["src/"]) == ["src/a.py", "src/sub/b.py"]
    assert irc._owned_files(proj, ["src"]) == ["src/a.py", "src/sub/b.py"]
    assert irc._owned_files(proj, ["*.py"]) == ["top.py"]
    assert irc._owned_files(proj, ["x?.txt"]) == ["x1.txt"]
    assert irc._owned_files(proj, ["x[1].txt"]) == ["x1.txt"]
    assert irc._owned_files(proj, ["src/*"]) == ["src/a.py"]  # glob matches files only, not dirs
    assert irc._owned_files(proj, None) == [] and irc._owned_files(proj, []) == []
    assert irc._owned_files(proj, ["top.py", "top.py", "*.py"]) == ["top.py"]


def test_owned_digest_formula_and_sensitivity(proj):
    (proj / "a.py").write_text("hello")
    h = hashlib.sha256()
    h.update(b"a.py\0F\0" + hashlib.sha256(b"hello").digest())
    h.update(b"gone.py\0M\0" + hashlib.sha256(b"").digest())
    assert irc._owned_digest(proj, ["a.py", "gone.py"]) == h.hexdigest()
    d0 = irc._owned_digest(proj, ["a.py"])
    (proj / "a.py").write_text("hello!")
    assert irc._owned_digest(proj, ["a.py"]) != d0
    assert irc._owned_digest(proj, []) == hashlib.sha256().hexdigest()
    (proj / "b.py").write_text("hello")
    assert irc._owned_digest(proj, ["b.py"]) != irc._owned_digest(proj, ["a.py"])  # path is part of the digest


# --- test_inputs_digest -----------------------------------------------------


def test_test_inputs_digest(proj):
    (proj / "tests").mkdir()
    (proj / "tests" / "test_a.py").write_text("t")
    (proj / "tests" / "conftest.py").write_text("c")
    (proj / "pytest.ini").write_text("[pytest]")
    (proj / "node_modules").mkdir()
    (proj / "node_modules" / "conftest.py").write_text("ignored")
    (proj / "tox.ini").mkdir()  # not a file: ignored
    h = hashlib.sha256()
    for rel, data in (
        ("pytest.ini", b"[pytest]"),
        ("tests/conftest.py", b"c"),
        ("tests/test_a.py", b"t"),
    ):
        h.update(rel.encode() + b"\0" + hashlib.sha256(data).digest())
    assert irc.test_inputs_digest(proj, "python3 -m pytest -q tests/test_a.py -x nothere.py") == h.hexdigest()
    base = irc.test_inputs_digest(proj, "")
    assert base != h.hexdigest()
    (proj / "tests" / "conftest.py").write_text("c2")
    assert irc.test_inputs_digest(proj, "") != base
    assert irc.test_inputs_digest(proj, None) == irc.test_inputs_digest(proj, "")


def test_test_inputs_digest_bad_quote_and_option_tokens(proj):
    (proj / "-weird.py").write_text("w")
    assert irc.test_inputs_digest(proj, "pytest 'unterminated") == irc.test_inputs_digest(proj, "")
    assert irc.test_inputs_digest(proj, "pytest -weird.py") == irc.test_inputs_digest(proj, "")
    (proj / "t.py").write_text("t")
    assert irc.test_inputs_digest(proj, "pytest t.py") != irc.test_inputs_digest(proj, "")
    outside = proj.parent / "out.py"
    outside.write_text("o")
    assert irc.test_inputs_digest(proj, f"pytest {outside}") == irc.test_inputs_digest(proj, "")


# --- _env_owns / done_current / _check_cmd ---------------------------------


def test_env_owns(monkeypatch):
    assert irc._env_owns() == []
    monkeypatch.setenv("ATLAS_CREW_OWNS", '["a.py","b.py"]')
    assert irc._env_owns() == ["a.py", "b.py"]
    monkeypatch.setenv("ATLAS_CREW_OWNS", '{"a": 1}')
    assert irc._env_owns() == []
    monkeypatch.setenv("ATLAS_CREW_OWNS", "not json")
    assert irc._env_owns() == []


def test_done_current_tracks_bytes(bus, proj, monkeypatch):
    (proj / "a.py").write_text("v1")
    assert irc.done_current(bus, "a", proj, ["a.py"]) is False
    irc.post(bus, "a", "#t", "DONE", kind="done")  # no digest: never current
    assert irc.done_current(bus, "a", proj, ["a.py"]) is False
    irc.post(bus, "a", "#t", "DONE", kind="done", extra={"digest": irc._owned_digest(proj, ["a.py"])})
    assert irc.done_current(bus, "a", proj, ["a.py"]) is True
    (proj / "a.py").write_text("v2")
    assert irc.done_current(bus, "a", proj, ["a.py"]) is False
    (proj / "a.py").write_text("v1")
    irc.post(bus, "a", "a", "bad", kind="unverified")
    assert irc.done_current(bus, "a", proj, ["a.py"]) is False


def test_done_current_env_defaults(bus, proj, monkeypatch):
    (proj / "a.py").write_text("v1")
    irc.post(bus, "a", "#t", "DONE", kind="done", extra={"digest": irc._owned_digest(proj, ["a.py"])})
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    monkeypatch.setenv("ATLAS_CREW_OWNS", '["a.py"]')
    assert irc.done_current(bus, "a") is True
    assert irc.done_current(bus, "a", owns=[]) is False  # explicit empty owns is honoured
    monkeypatch.delenv("ATLAS_CREW_ROOT")
    monkeypatch.chdir(proj)
    assert irc.done_current(bus, "a") is True


def test_done_current_uses_latest_done(bus, proj):
    (proj / "a.py").write_text("v1")
    irc.post(bus, "a", "#t", "DONE", kind="done", extra={"digest": "old"})
    irc.post(bus, "a", "#t", "DONE", kind="done", extra={"digest": irc._owned_digest(proj, ["a.py"])})
    assert irc.done_current(bus, "a", proj, ["a.py"]) is True


def test_check_cmd(monkeypatch):
    assert irc._check_cmd("make test") == "make test"
    assert irc._check_cmd("echo python -m pytest") == "echo python -m pytest"
    import importlib.util as iu
    import shutil
    import shlex

    monkeypatch.setattr(iu, "find_spec", lambda n: object())
    assert irc._check_cmd("python3 -m pytest -q x.py") == f"{shlex.quote(sys.executable)} -m pytest -q x.py"
    assert irc._check_cmd("  python -m pytest") == f"{shlex.quote(sys.executable)} -m pytest"
    assert irc._check_cmd("python -m pytestx") == "python -m pytestx"
    monkeypatch.setattr(iu, "find_spec", lambda n: None)
    monkeypatch.setattr(shutil, "which", lambda n: "/usr/bin/pytest")
    assert irc._check_cmd("python3 -m pytest -q") == "pytest -q"
    monkeypatch.setattr(shutil, "which", lambda n: None)
    assert irc._check_cmd("python3 -m pytest -q") == "python3 -m pytest -q"


# --- _run_unit_check --------------------------------------------------------


def test_run_unit_check_none_without_cmd(bus):
    assert irc._run_unit_check(bus, "a") is None


def test_run_unit_check_pass_prints_tail(bus, proj, monkeypatch, capsys):
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "echo out; echo err 1>&2; pwd")
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    assert irc._run_unit_check(bus, "a") == 0
    assert capsys.readouterr().out == f"out\n{proj}\nerr\n"
    assert irc.history(bus) == []


def test_run_unit_check_failure_posts_unverified(bus, monkeypatch, capsys):
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "printf nonl; exit 3")
    assert irc._run_unit_check(bus, "a") == 3
    assert capsys.readouterr().out == "nonl\n"
    (rec,) = irc.history(bus)
    assert rec["kind"] == "unverified" and rec["from"] == "a" and rec["to"] == "a"
    assert rec["text"] == "unverified a: `printf nonl; exit 3` exited 3"


def test_run_unit_check_tail_is_capped(bus, monkeypatch, capsys):
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "python3 -c \"print('x'*7000)\"")
    irc._run_unit_check(bus, "a")
    out = capsys.readouterr().out
    assert out == "x" * (irc.TAIL_CHARS - 1) + "\n"


def test_run_unit_check_quiet_and_capture(bus, monkeypatch, capsys):
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "echo hi; exit 2")
    cap = []
    assert irc._run_unit_check(bus, "a", quiet=True, capture=cap) == 2
    assert cap == ["hi\n"] and capsys.readouterr().out == "" and irc.history(bus) == []
    assert irc._run_unit_check(bus, "a", quiet=True) == 2


def test_run_unit_check_timeout(bus, monkeypatch, capsys):
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "sleep 5")
    monkeypatch.setattr(irc, "CHECK_TIMEOUT_S", 0.2)
    assert irc._run_unit_check(bus, "a") == 124
    assert capsys.readouterr().out == "check timed out after 0.2s\n"
    assert irc.history(bus)[0]["text"].endswith("exited 124")


def test_run_unit_check_runs_in_root_and_converts_pytest(bus, proj, monkeypatch):
    seen = {}

    class R:
        returncode, stdout, stderr = 0, "", ""

    def run(cmd, **kw):
        seen["cmd"], seen["kw"] = cmd, kw
        return R()

    monkeypatch.setattr(irc.subprocess, "run", run)
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "echo hi")
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    irc._run_unit_check(bus, "a")
    assert seen["cmd"] == "echo hi"
    assert seen["kw"] == {"shell": True, "cwd": str(proj), "capture_output": True, "text": True, "timeout": 600}
    monkeypatch.delenv("ATLAS_CREW_ROOT")
    monkeypatch.chdir(proj)
    irc._run_unit_check(bus, "a")
    assert seen["kw"]["cwd"] == str(proj)


# --- docstring restore ------------------------------------------------------

STUB = '''"""Module doc."""

class C:
    """Class doc
    more lines here
        indented
    """

    def m(self):
        """Method doc with "quotes" and \\\\ backslash."""
        raise NotImplementedError

def f(x):
    """F doc."""
    raise NotImplementedError

def g(): 
    """G doc"""

@dec
def h():
    """H doc."""
'''
WORK = '''import os

class C:
    def m(self):
        return 1

def f(x):
    return x

def g(): return 2

@dec
def h():
    return 3
'''


def test_restore_docstrings_inserts_stub_docs():
    out, n = irc.restore_docstrings(STUB, WORK)
    assert n == 5
    import ast

    tree = ast.parse(out)
    assert ast.get_docstring(tree) == "Module doc."
    cls = next(x for x in tree.body if isinstance(x, ast.ClassDef))
    assert ast.get_docstring(cls, clean=False) == ast.get_docstring(ast.parse(STUB).body[1], clean=False)
    m = cls.body[1] if isinstance(cls.body[0], ast.Expr) else cls.body[0]
    assert ast.get_docstring(m) == 'Method doc with "quotes" and \\ backslash.'
    funcs = {x.name: x for x in tree.body if isinstance(x, ast.FunctionDef)}
    assert ast.get_docstring(funcs["f"]) == "F doc."
    assert ast.get_docstring(funcs["h"]) == "H doc."
    assert ast.get_docstring(funcs["g"]) is None  # one-liner `def g(): return 2` is skipped
    assert "return x" in out and "return 3" in out
    assert out.index('"""F doc."""') < out.index("return x")
    assert out.index("@dec") < out.index('"""H doc."""') < out.index("return 3")


def test_restore_docstrings_keeps_worker_docs_and_noop():
    work = 'def f():\n    """mine."""\n    return 1\n'
    stub = 'def f():\n    """theirs."""\n    raise NotImplementedError\n'
    assert irc.restore_docstrings(stub, work) == (work, 0)
    assert irc.restore_docstrings("def f(): pass\n", "def f():\n    return 1\n") == ("def f():\n    return 1\n", 0)
    assert irc.restore_docstrings(stub, "def other():\n    return 1\n") == ("def other():\n    return 1\n", 0)


def test_restore_docstrings_syntax_errors():
    assert irc.restore_docstrings(STUB, "def (:") == ("def (:", 0)
    assert irc.restore_docstrings("def (:", WORK) == (WORK, 0)


def test_restore_docstrings_ambiguous_names_untouched():
    stub = 'def f():\n    """doc."""\n    pass\n'
    work = "def f():\n    return 1\n\ndef f():\n    return 2\n"
    assert irc.restore_docstrings(stub, work) == (work, 0)


def test_restore_docstrings_empty_body_class_with_nested():
    stub = 'class A:\n    """A."""\n    class B:\n        """B."""\n        pass\n'
    work = "class A:\n    class B:\n        x = 1\n"
    out, n = irc.restore_docstrings(stub, work)
    assert n == 2
    import ast

    t = ast.parse(out)
    assert ast.get_docstring(t.body[0]) == "A."
    assert ast.get_docstring(t.body[0].body[1]) == "B."


def test_doc_nodes_and_has_doc():
    import ast

    t = ast.parse('"""m"""\nclass A:\n    def f(self): ...\n    def f(self): ...\ndef g():\n    def inner(): ...\n')
    nodes = irc._doc_nodes(t)
    assert set(nodes) == {"", "A", "A.f", "g", "g.inner"}
    assert nodes["A.f"] is None and nodes[""] is t
    assert irc._has_doc(t) and not irc._has_doc(nodes["g"])


def test_doc_literal_shapes():
    assert irc._doc_literal("One line.", "    ", 4) == ['    """One line."""']
    assert irc._doc_literal("A\n    b\n\n    c", "  ", 4) == ['  """A', "  b", "", "  c\"\"\""]
    assert irc._doc_literal('say "hi"', "", 0) == ['"""say "hi\\""""']
    assert irc._doc_literal('x\\y', "", 0) == ['"""x\\\\y"""']
    assert irc._doc_literal('a """ b', "", 0) == ['"""a \\"\\"\\" b"""']
    assert irc._doc_literal("a\r\nb", "", 0) == ['"""a\\r', 'b"""']
    # the closing quote's own whitespace-only line keeps its indentation
    assert irc._doc_literal("A\n    ", "  ", 4) == ['  """A', '      """'] or irc._doc_literal("A\n    ", "  ", 4)[1].endswith('"""')


def _crew_env(monkeypatch, proj, stubs, owns):
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    monkeypatch.setenv("ATLAS_CREW_STUBS", json.dumps(stubs))
    monkeypatch.setenv("ATLAS_CREW_OWNS", json.dumps(owns))


def test_restore_owned_docstrings_and_revert(proj, monkeypatch, tmp_path):
    stub = tmp_path / "stub_m.py"
    stub.write_text('def f():\n    """Doc."""\n    raise NotImplementedError\n')
    (proj / "m.py").write_text("def f():\n    return 1\n")
    (proj / "n.txt").write_text("not python")
    (proj / "nostub.py").write_text("x = 1\n")
    _crew_env(monkeypatch, proj, {"m.py": str(stub), "n.txt": str(stub)}, ["m.py", "n.txt", "nostub.py", "gone.py"])
    changed = irc._restore_owned_docstrings()
    assert [(c[0], c[1], c[2]) for c in changed] == [("m.py", b"def f():\n    return 1\n", 1)]
    assert '"""Doc."""' in (proj / "m.py").read_text()
    assert (proj / "n.txt").read_text() == "not python"
    irc._revert_restored(changed)
    assert (proj / "m.py").read_bytes() == b"def f():\n    return 1\n"
    monkeypatch.delenv("ATLAS_CREW_ROOT")
    assert len(irc._restore_owned_docstrings(proj)) == 1  # explicit root argument
    assert irc._restore_owned_docstrings(proj) == []  # docstring now present: nothing more to restore


def test_restore_owned_docstrings_bad_env_and_unreadable(proj, monkeypatch, tmp_path):
    monkeypatch.setenv("ATLAS_CREW_STUBS", "nope")
    assert irc._restore_owned_docstrings(proj) == []
    monkeypatch.setenv("ATLAS_CREW_STUBS", json.dumps({"m.py": str(tmp_path / "missing_stub.py")}))
    monkeypatch.setenv("ATLAS_CREW_OWNS", '["m.py"]')
    (proj / "m.py").write_text("def f():\n    return 1\n")
    assert irc._restore_owned_docstrings(proj) == []
    monkeypatch.delenv("ATLAS_CREW_STUBS")
    assert irc._restore_owned_docstrings(proj) == []


def test_restore_skips_files_without_new_docs(proj, monkeypatch, tmp_path):
    stub = tmp_path / "s.py"
    stub.write_text("def f():\n    raise NotImplementedError\n")
    (proj / "m.py").write_text("def f():\n    return 1\n")
    _crew_env(monkeypatch, proj, {"m.py": str(stub)}, ["m.py"])
    assert irc._restore_owned_docstrings(proj) == []


def test_revert_restored_ignores_oserror(proj):
    irc._revert_restored([("sub/does/not/exist.py", b"x", 1)], proj)


def test_check_with_docstrings(bus, proj, tmp_path, monkeypatch, capsys):
    stub = tmp_path / "s.py"
    stub.write_text('def f():\n    """Doc."""\n    raise NotImplementedError\n')
    (proj / "m.py").write_text("def f():\n    return 1\n")
    _crew_env(monkeypatch, proj, {"m.py": str(stub)}, ["m.py"])
    assert irc._check_with_docstrings(bus, "a") is None  # no unit check configured
    assert capsys.readouterr().out == "restored 1 docstrings in m.py\n"
    assert '"""Doc."""' in (proj / "m.py").read_text()
    (proj / "m.py").write_text("def f():\n    return 1\n")
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "exit 1")
    assert irc._check_with_docstrings(bus, "a") == 1
    out = capsys.readouterr().out
    assert out.endswith("(docstrings were restored for this run and have been removed again)\n")
    assert (proj / "m.py").read_text() == "def f():\n    return 1\n"
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "true")
    assert irc._check_with_docstrings(bus, "a") == 0
    assert "restored 1 docstrings in m.py" in capsys.readouterr().out


def test_check_with_docstrings_quiet_captures(bus, proj, tmp_path, monkeypatch, capsys):
    stub = tmp_path / "s.py"
    stub.write_text('def f():\n    """Doc."""\n    raise NotImplementedError\n')
    (proj / "m.py").write_text("def f():\n    return 1\n")
    _crew_env(monkeypatch, proj, {"m.py": str(stub)}, ["m.py"])
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "echo ran")
    cap = []
    assert irc._check_with_docstrings(bus, "a", quiet=True, capture=cap) == 0
    assert cap == ["ran\n", "restored 1 docstrings in m.py\n"]
    assert capsys.readouterr().out == ""
    (proj / "m.py").write_text("def f():\n    return 1\n")
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "exit 4")
    cap2 = []
    irc._check_with_docstrings(bus, "a", quiet=True, capture=cap2)
    assert cap2[-1] == "(docstrings were restored for this run and have been removed again)\n"
    irc._check_with_docstrings(bus, "a", quiet=True)  # capture=None must not crash


# --- install_staged / _install_from_env ------------------------------------


def test_install_staged(tmp_path):
    stage, root = tmp_path / "stage", tmp_path / "root"
    (stage / "pkg").mkdir(parents=True)
    root.mkdir()
    (stage / "pkg" / "new.py").write_bytes(b"new")
    (stage / "pkg" / "same.py").write_bytes(b"same")
    (stage / "pkg" / "old.py").write_bytes(b"stale")
    (stage / "dir").mkdir()
    (root / "pkg").mkdir()
    (root / "pkg" / "same.py").write_bytes(b"same")
    (root / "pkg" / "old.py").write_bytes(b"newer real")
    os.utime(stage / "pkg" / "old.py", (1000, 1000))
    os.utime(root / "pkg" / "old.py", (2000, 2000))
    os.utime(stage / "pkg" / "same.py", (3000, 3000))
    os.utime(root / "pkg" / "same.py", (1000, 1000))
    owns = ["pkg/new.py", "pkg/same.py", "pkg/old.py", "pkg/nostage.py", "dir"]
    assert irc.install_staged(stage, root, owns) == ["pkg/new.py"]
    assert (root / "pkg" / "new.py").read_bytes() == b"new"
    assert (root / "pkg" / "old.py").read_bytes() == b"newer real"
    assert irc.install_staged(stage, root, None) == []


def test_install_staged_newer_stage_overwrites_and_equal_mtime_skips(tmp_path):
    stage, root = tmp_path / "s", tmp_path / "r"
    stage.mkdir()
    root.mkdir()
    (stage / "f.py").write_bytes(b"A")
    (root / "f.py").write_bytes(b"B")
    os.utime(stage / "f.py", ns=(5_000_000_000, 5_000_000_000))
    os.utime(root / "f.py", ns=(5_000_000_000, 5_000_000_000))
    assert irc.install_staged(stage, root, ["f.py"]) == []
    os.utime(stage / "f.py", ns=(5_000_000_001, 5_000_000_001))
    assert irc.install_staged(stage, root, ["f.py"]) == ["f.py"]
    assert (root / "f.py").read_bytes() == b"A"


def test_install_staged_oserror_continues(tmp_path):
    stage, root = tmp_path / "s", tmp_path / "r"
    stage.mkdir()
    (stage / "a.py").write_text("a")
    (stage / "b.py").write_text("b")
    root.mkdir()
    (root / "a.py").mkdir()  # cannot be written as a file
    os.utime(root / "a.py", (1, 1))
    assert irc.install_staged(stage, root, ["a.py", "b.py"]) == ["b.py"]


def test_install_from_env(tmp_path, monkeypatch, capsys):
    assert irc._install_from_env() == []
    stage, root = tmp_path / "s", tmp_path / "r"
    stage.mkdir()
    root.mkdir()
    (stage / "a.py").write_text("a")
    monkeypatch.setenv("ATLAS_CREW_STAGE", str(stage))
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(root))
    monkeypatch.setenv("ATLAS_CREW_OWNS", '["a.py"]')
    assert irc._install_from_env() == ["a.py"]
    assert capsys.readouterr().out == "installed a.py from staged copy\n"
    assert (root / "a.py").read_text() == "a"
    monkeypatch.setenv("ATLAS_CREW_OWNS", "bad")
    assert irc._install_from_env() == []
    monkeypatch.delenv("ATLAS_CREW_ROOT")
    monkeypatch.setenv("ATLAS_CREW_OWNS", '["a.py"]')
    monkeypatch.chdir(tmp_path / "r")
    (tmp_path / "r" / "a.py").unlink()
    assert irc._install_from_env() == ["a.py"]


# --- _announce_done / cmd_done ---------------------------------------------


def test_announce_done_records_digests(bus, proj, monkeypatch, capsys):
    (proj / "a.py").write_text("v")
    (proj / "t.py").write_text("t")
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    monkeypatch.setenv("ATLAS_CREW_OWNS", '["a.py"]')
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "pytest t.py")
    irc._announce_done(bus, "a", "all good", {"b": "dig"})
    assert capsys.readouterr().out == "posted DONE for a\n"
    (rec,) = irc.history(bus)
    assert rec["kind"] == "done" and rec["from"] == "a" and rec["to"] == "#t"
    assert rec["text"] == "DONE a: all good"
    assert rec["digest"] == irc._owned_digest(proj, ["a.py"])
    assert rec["test_digest"] == irc.test_inputs_digest(proj, "pytest t.py")
    assert rec["peer_digests"] == {"b": "dig"}
    irc._announce_done(bus, "a", "again")
    assert capsys.readouterr().out == "already announced DONE for a\n"
    assert len(irc.history(bus)) == 1


def test_announce_done_without_peer_digests_and_default_channel(tmp_path, proj, monkeypatch):
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    irc._announce_done(tmp_path / "bare", "n", "x")
    (rec,) = irc.history(tmp_path / "bare")
    assert "peer_digests" not in rec and rec["to"] == "#team"
    irc._announce_done(tmp_path / "bare", "m", "x", {})
    assert irc.history(tmp_path / "bare")[1]["peer_digests"] == {}


def ns(**kw):
    base = dict(dir=None, as_=None, text=[], timeout=1.0, peers=[], done=False)
    base.update(kw)
    return argparse.Namespace(**base)


def test_cmd_done_passes_and_is_idempotent(bus, proj, monkeypatch, capsys):
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    assert irc.cmd_done(ns(dir=str(bus), as_="a", text=["finished", "it"])) == 0
    assert irc.history(bus)[0]["text"] == "DONE a: finished it"
    assert irc.cmd_done(ns(dir=str(bus), as_="a")) == 0
    assert "already announced DONE for a" in capsys.readouterr().out
    irc.cmd_done(ns(dir=str(bus), as_="b"))
    assert irc.history(bus)[-1]["text"] == "DONE b: check passes"


def test_cmd_done_refused_on_failing_check(bus, proj, monkeypatch, capsys):
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "echo boom; exit 7")
    assert irc.cmd_done(ns(dir=str(bus), as_="a")) == 1
    out = capsys.readouterr().out
    assert out.endswith("refused: DONE a needs the unit check to pass (exit 7)\n") and "boom" in out
    assert [r["kind"] for r in irc.history(bus)] == ["unverified"]


def test_cmd_done_installs_staged_files(bus, proj, tmp_path, monkeypatch, capsys):
    stage = tmp_path / "stage"
    stage.mkdir()
    (stage / "a.py").write_text("staged")
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    monkeypatch.setenv("ATLAS_CREW_STAGE", str(stage))
    monkeypatch.setenv("ATLAS_CREW_OWNS", '["a.py"]')
    irc.cmd_done(ns(dir=str(bus), as_="a"))
    assert (proj / "a.py").read_text() == "staged"
    assert "installed a.py from staged copy" in capsys.readouterr().out


# --- peer helpers -----------------------------------------------------------


def test_peer_owns_env(monkeypatch):
    assert irc._peer_owns_env() is None
    monkeypatch.setenv("ATLAS_CREW_PEER_OWNS", '{"b": ["x.py"], "c": []}')
    assert irc._peer_owns_env() == {"b": ["x.py"], "c": []}
    monkeypatch.setenv("ATLAS_CREW_PEER_OWNS", '{"b": "x.py"}')
    assert irc._peer_owns_env() is None
    monkeypatch.setenv("ATLAS_CREW_PEER_OWNS", '["x"]')
    assert irc._peer_owns_env() is None
    monkeypatch.setenv("ATLAS_CREW_PEER_OWNS", "{bad")
    assert irc._peer_owns_env() is None
    monkeypatch.setenv("ATLAS_CREW_PEER_OWNS", "{}")
    assert irc._peer_owns_env() == {}


def test_peer_ready(bus, proj, tmp_path):
    stubs = tmp_path / "stubs"
    stubs.mkdir()
    (stubs / "m.py").write_text("stub")
    (proj / "m.py").write_text("stub")
    assert irc._peer_ready(bus, proj, "b", ["m.py"], stubs) is False  # unchanged from stub
    (proj / "m.py").write_text("real")
    assert irc._peer_ready(bus, proj, "b", ["m.py"], stubs) is True
    assert irc._peer_ready(bus, proj, "b", ["m.py"], None) is False
    assert irc._peer_ready(bus, proj, "b", [], stubs) is False
    assert irc._peer_ready(bus, proj, "b", None, stubs) is False
    assert irc._peer_ready(bus, proj, "b", ["*.py"], stubs) is False
    assert irc._peer_ready(bus, proj, "b", ["m.py", "d/*.py"], stubs) is False
    assert irc._peer_ready(bus, proj, "b", ["gone.py"], stubs) is False
    (proj / "n.py").write_text("real")
    assert irc._peer_ready(bus, proj, "b", ["m.py", "n.py"], stubs) is False  # n.py has no stub
    irc.post(bus, "b", "#t", "DONE", kind="done")
    assert irc._peer_ready(bus, proj, "b", None, None) is True


def test_peer_gave_up(bus):
    assert irc._peer_gave_up(bus, "b") is False
    irc.post(bus, "b", "#t", "x", kind="failed")
    assert irc._peer_gave_up(bus, "b") is True
    irc.post(bus, "b", "#t", "DONE", kind="done")
    assert irc._peer_gave_up(bus, "b") is False
    irc.post(bus, "c", "#t", "x", kind="failed")
    assert irc._peer_gave_up(bus, "b") is False and irc._peer_gave_up(bus, "c") is True
    irc.post(bus, "b", "#t", "chatter")
    assert irc._peer_gave_up(bus, "b") is False


def test_latest_done_digest(bus):
    assert irc._latest_done_digest(bus, "b") is None
    irc.post(bus, "b", "#t", "DONE", kind="done", extra={"digest": "d1"})
    irc.post(bus, "b", "#t", "DONE", kind="done", extra={"digest": "d2"})
    irc.post(bus, "b", "#t", "other", extra={"digest": "nope"})
    assert irc._latest_done_digest(bus, "b") == "d2"
    irc.post(bus, "b", "#t", "DONE", kind="done")
    assert irc._latest_done_digest(bus, "b") is None


def test_peer_digests_and_closure_snapshot(proj, monkeypatch):
    (proj / "x.py").write_text("x")
    owns = {"b": ["x.py"], "c": []}
    d = irc._peer_digests(proj, ["b", "c", "zz"], {**owns})
    assert d == {"b": irc._owned_digest(proj, ["x.py"]), "c": irc._owned_digest(proj, []), "zz": irc._owned_digest(proj, [])}
    assert irc._closure_snapshot(proj, "a") is None
    monkeypatch.setenv("ATLAS_CREW_PEER_OWNS", json.dumps(owns))
    assert irc._closure_snapshot(proj, "a") == {}
    monkeypatch.setenv("ATLAS_CREW_NEEDS_ALL", "b,c a  b")
    assert irc._closure_snapshot(proj, "a") == {"b": d["b"], "c": d["c"]}
    monkeypatch.setenv("ATLAS_CREW_NEEDS_ALL", "b d")
    assert irc._closure_snapshot(proj, "a") is None


def test_wait_peers_ready(bus, proj, tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_CREW_STUB_DIR", str(tmp_path / "nostubs"))
    owns = {"b": ["m.py"]}
    irc.post(bus, "b", "#t", "DONE", kind="done")
    assert irc._wait_peers_ready(bus, proj, ["b"], owns, 0) is True
    irc.post(bus, "b", "#t", "x", kind="failed")
    assert irc._wait_peers_ready(bus, proj, ["b"], owns, 10**12) is False


def test_wait_peers_ready_times_out_and_polls(bus, proj, monkeypatch):
    clock = [100.0]
    sleeps = []
    monkeypatch.setattr(irc.time, "time", lambda: clock[0])
    monkeypatch.setattr(irc.time, "sleep", lambda s: (sleeps.append(s), clock.__setitem__(0, clock[0] + 1)))
    assert irc._wait_peers_ready(bus, proj, ["b"], {"b": ["m.py"]}, 103.0) is False
    assert sleeps == [irc.SPECULATE_POLL_S] * 3
    assert irc._wait_peers_ready(bus, proj, [], {}, 0) is True


# --- _own_failures ----------------------------------------------------------

XML = """<?xml version="1.0"?>
<testsuites><testsuite>
<testcase classname="pkg.test_a" name="test_own"><failure message="assert 1 == 2&#10;detail">trace body</failure></testcase>
<testcase classname="pkg.test_a" name="test_stub"><failure message="NotImplementedError">x</failure></testcase>
<testcase classname="pkg.test_a" name="test_imp"><failure message="boom">ModuleNotFoundError: no module</failure></testcase>
<testcase classname="pkg.test_a" name="test_imp2"><failure message="cannot import name foo"></failure></testcase>
<testcase classname="pkg.test_a" name="test_imp3"><failure message="ImportError"></failure></testcase>
<testcase classname="pkg.test_a" name="test_err"><error message="collection error">x</error></testcase>
<testcase classname="" name="loose"><failure message="nomsg"></failure></testcase>
<testcase classname="pkg.test_b" name="test_nomsg"><failure>text only</failure></testcase>
<testcase classname="pkg.test_b" name="test_ok"/>
</testsuite></testsuites>
"""


def test_own_failures(tmp_path):
    p = tmp_path / "r.xml"
    p.write_text(XML)
    got = irc._own_failures(p)
    assert got == [
        ("pkg/test_a.py::test_own", "assert 1 == 2"),
        ("loose", "nomsg"),
        ("pkg/test_b.py::test_nomsg", ""),
    ]


def test_own_failures_message_truncated_and_bad_files(tmp_path):
    p = tmp_path / "r.xml"
    p.write_text(f'<testsuite><testcase classname="a" name="t"><failure message="{"m" * 400}"/></testcase></testsuite>')
    assert irc._own_failures(p) == [("a.py::t", "m" * 300)]
    assert irc._own_failures(tmp_path / "missing.xml") == []
    p.write_text("<not xml")
    assert irc._own_failures(p) == []


# --- _early_check -----------------------------------------------------------


def _fake_pytest(monkeypatch, xml_text, record):
    def run(cmd, **kw):
        record.append((cmd, kw))
        path = kw["env"]["PYTEST_ADDOPTS"].split("--junitxml=")[1].split()[0]
        if xml_text is not None:
            Path(path).write_text(xml_text)

        class R:
            returncode, stdout, stderr = 1, "", ""

        return R()

    monkeypatch.setattr(irc.subprocess, "run", run)


def test_early_check_disabled_cases(bus, proj, monkeypatch):
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    assert irc._early_check(bus, "a", ["b"]) is None  # no unit check
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "make test")
    assert irc._early_check(bus, "a", ["b"]) is None  # not pytest
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "pytest x")
    monkeypatch.setenv("ATLAS_CREW_EARLY_CHECK", "OFF")
    assert irc._early_check(bus, "a", ["b"]) is None
    monkeypatch.delenv("ATLAS_CREW_EARLY_CHECK")
    irc.post(bus, "b", "#t", "DONE", kind="done")
    assert irc._early_check(bus, "a", ["b"]) is None  # every need already DONE
    assert irc._early_check(bus, "a", ["a", "b"]) is None  # own nick is not a need


def test_early_check_reports_own_failures_once_per_digest(bus, proj, monkeypatch, capsys):
    (proj / "a.py").write_text("v1")
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    monkeypatch.setenv("ATLAS_CREW_OWNS", '["a.py"]')
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "python3 -m pytest -q x")
    monkeypatch.setenv("PYTEST_ADDOPTS", "-v")
    rec = []
    _fake_pytest(monkeypatch, XML, rec)
    assert irc._early_check(bus, "a", ["b"]) == 1
    out = capsys.readouterr().out
    assert out == (
        "FAILED pkg/test_a.py::test_own: assert 1 == 2\nFAILED loose: nomsg\nFAILED pkg/test_b.py::test_nomsg: \n"
        "These failures do not depend on unfinished peers (no NotImplementedError or import error); fix them now. "
        "`irc check` again waits for the peers.\n"
    )
    cmd, kw = rec[0]
    assert "-m pytest -q x" in cmd and kw["shell"] is True and kw["cwd"] == str(proj)
    assert kw["timeout"] == 20 and kw["capture_output"] is True and kw["text"] is True
    assert kw["env"]["PYTEST_ADDOPTS"].startswith("-v --junitxml=") and kw["env"]["PYTEST_ADDOPTS"].endswith("-p no:cacheprovider")
    marker = bus / "earlycheck-a.digest"
    assert marker.read_text() == irc._owned_digest(proj, ["a.py"])
    assert irc._early_check(bus, "a", ["b"]) is None and len(rec) == 1  # same digest: not re-run
    (proj / "a.py").write_text("v2")
    assert irc._early_check(bus, "a", ["b"]) == 1 and len(rec) == 2


def test_early_check_no_own_failures_or_timeout(bus, proj, monkeypatch):
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "pytest x")
    rec = []
    _fake_pytest(monkeypatch, '<testsuite><testcase classname="a" name="t"><failure message="NotImplementedError"/></testcase></testsuite>', rec)
    assert irc._early_check(bus, "a", ["b"]) is None
    (bus / "earlycheck-a.digest").unlink()

    def timeout(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 20)

    monkeypatch.setattr(irc.subprocess, "run", timeout)
    assert irc._early_check(bus, "a", ["b"]) is None


def test_early_check_output_capped(bus, proj, monkeypatch, capsys):
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "pytest x")
    cases = "".join(f'<testcase classname="c" name="t{i}"><failure message="{"m" * 200}"/></testcase>' for i in range(30))
    _fake_pytest(monkeypatch, f"<testsuite>{cases}</testsuite>", [])
    assert irc._early_check(bus, "a", ["b"]) == 1
    out = capsys.readouterr().out
    body = out.split("These failures")[0]
    assert len(body) == irc.EARLY_CHECK_TIMEOUT_S * 0 + irc.EARLY_TAIL_CHARS


# --- cmd_check --------------------------------------------------------------


def test_cmd_check_no_needs_posts_done(bus, proj, monkeypatch, capsys):
    (proj / "a.py").write_text("x")
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    monkeypatch.setenv("ATLAS_CREW_OWNS", '["a.py"]')
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "echo ok")
    assert irc.cmd_check(ns(dir=str(bus), as_="a")) == 0
    (rec,) = irc.history(bus)
    assert rec["kind"] == "done" and rec["text"] == "DONE a: check passes" and "peer_digests" not in rec
    assert capsys.readouterr().out.startswith("ok\n")


def test_cmd_check_failure_returns_code_without_done(bus, proj, monkeypatch):
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "exit 5")
    assert irc.cmd_check(ns(dir=str(bus), as_="a")) == 5
    assert [r["kind"] for r in irc.history(bus)] == ["unverified"]


def test_cmd_check_waits_for_needs_then_records_peer_digests(bus, proj, monkeypatch, capsys):
    (proj / "b.py").write_text("peer")
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    monkeypatch.setenv("ATLAS_CREW_NEEDS", "b")
    monkeypatch.setenv("ATLAS_CREW_NEEDS_ALL", "b")
    monkeypatch.setenv("ATLAS_CREW_PEER_OWNS", '{"b": ["b.py"]}')
    monkeypatch.setenv("ATLAS_CREW_SPECULATE", "off")
    monkeypatch.setenv("ATLAS_CREW_EARLY_CHECK", "off")
    monkeypatch.setenv("ATLAS_CREW_UNIT_CHECK", "true")
    irc.post(bus, "b", "#t", "DONE b", kind="done")
    assert irc.cmd_check(ns(dir=str(bus), as_="a", timeout=5)) == 0
    done = [r for r in irc.history(bus) if r["from"] == "a"][-1]
    assert done["peer_digests"] == {"b": irc._owned_digest(proj, ["b.py"])}
    assert "<b> DONE b" in capsys.readouterr().out


def test_cmd_check_need_failure_propagates(bus, monkeypatch, capsys):
    monkeypatch.setenv("ATLAS_CREW_NEEDS", "zzz")
    monkeypatch.setenv("ATLAS_CREW_SPECULATE", "off")
    monkeypatch.setenv("ATLAS_CREW_EARLY_CHECK", "off")
    assert irc.cmd_check(ns(dir=str(bus), as_="a")) == 2
    assert "not on the team: zzz" in capsys.readouterr().out
    assert irc.history(bus) == []


def test_cmd_check_early_check_result_returned(bus, monkeypatch):
    monkeypatch.setenv("ATLAS_CREW_NEEDS", "b")
    monkeypatch.setattr(irc, "_early_check", lambda d, n, needs: 1)
    assert irc.cmd_check(ns(dir=str(bus), as_="a")) == 1


def test_cmd_check_speculate_result_returned_and_off_skips(bus, proj, monkeypatch):
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    monkeypatch.setenv("ATLAS_CREW_NEEDS", "b")
    monkeypatch.setenv("ATLAS_CREW_EARLY_CHECK", "off")
    calls = []
    monkeypatch.setattr(irc, "_speculate", lambda d, n, a, dl: calls.append(1) or 0)
    assert irc.cmd_check(ns(dir=str(bus), as_="a")) == 0 and calls == [1]
    monkeypatch.setenv("ATLAS_CREW_SPECULATE", "OFF")
    irc.post(bus, "b", "#t", "DONE b", kind="done")
    assert irc.cmd_check(ns(dir=str(bus), as_="a")) == 0 and calls == [1]


def test_cmd_check_snapshot_changed_during_run_drops_peer_digests(bus, proj, monkeypatch):
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(proj))
    snaps = iter([{"b": "1"}, {"b": "2"}])
    monkeypatch.setattr(irc, "_closure_snapshot", lambda r, n: next(snaps))
    assert irc.cmd_check(ns(dir=str(bus), as_="a")) == 0
    assert "peer_digests" not in irc.history(bus)[-1]
    snaps2 = iter([{"b": "1"}, {"b": "1"}])
    irc.init_bus(bus, "#t", ["a", "b", "c"], "boss")
    monkeypatch.setattr(irc, "_closure_snapshot", lambda r, n: next(snaps2))
    assert irc.cmd_check(ns(dir=str(bus), as_="c")) == 0
    assert irc.history(bus)[-1]["peer_digests"] == {"b": "1"}
