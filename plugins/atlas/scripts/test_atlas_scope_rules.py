import os
import sqlite3
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _test_isolation  # noqa: F401,E402
import atlas_scope as sc  # noqa: E402


@pytest.fixture
def home(tmp_path, monkeypatch):
    """Fake $HOME with no scratch roots so tmp dirs count as ordinary paths."""
    h = tmp_path / "home"
    h.mkdir()
    monkeypatch.setenv("HOME", str(h))
    monkeypatch.setenv("ATLAS_SCRATCH_ROOTS", "")
    monkeypatch.setattr(sc, "SCRATCH_ROOTS", ())
    monkeypatch.delenv("ATLAS_GATES", raising=False)
    monkeypatch.setenv("ATLAS_DB", str(tmp_path / "none.db"))
    return h.resolve()


def _db(path, root, dispatches):
    conn = sqlite3.connect(path)
    conn.executescript(
        "CREATE TABLE projects(id INTEGER PRIMARY KEY, root_path TEXT);"
        "CREATE TABLE runs(id INTEGER PRIMARY KEY, project_id INTEGER);"
        "CREATE TABLE dispatches(id INTEGER PRIMARY KEY, run_id INTEGER);"
    )
    conn.execute("INSERT INTO projects(id, root_path) VALUES(1, ?)", (root,))
    conn.execute("INSERT INTO runs(id, project_id) VALUES(1, 1)")
    for _ in range(dispatches):
        conn.execute("INSERT INTO dispatches(run_id) VALUES(1)")
    conn.commit()
    conn.close()


# --- _under -----------------------------------------------------------------


def test_under():
    assert sc._under("/a/b", "/a/b")
    assert sc._under("/a/b/c", "/a/b")
    assert sc._under("/a/b/c", "/a/b/")
    assert not sc._under("/a/bc", "/a/b")
    assert not sc._under("/a", "/a/b")
    assert sc._under("/anything", "/")


# --- gates_armed ------------------------------------------------------------


@pytest.mark.parametrize("val", ["always", "ALWAYS", "  Always  "])
def test_mode_always(home, monkeypatch, val):
    monkeypatch.setenv("ATLAS_GATES", val)
    assert sc.gates_armed(str(home)) is True


@pytest.mark.parametrize("val", ["off", "OFF", " off "])
def test_mode_off(home, monkeypatch, val):
    monkeypatch.setenv("ATLAS_GATES", val)
    (home / "p").mkdir()
    (home / "p" / ".git").mkdir()
    assert sc.gates_armed(str(home / "p")) is False


def test_other_mode_value_is_ignored(home, monkeypatch):
    monkeypatch.setenv("ATLAS_GATES", "maybe")
    (home / "p" / ".git").mkdir(parents=True)
    assert sc.gates_armed(str(home / "p")) is True


@pytest.mark.parametrize("marker", sc.PROJECT_MARKERS)
def test_every_marker_arms(home, marker):
    p = home / "proj"
    p.mkdir()
    (p / marker).write_text("")
    assert sc.gates_armed(str(p)) is True


def test_marker_in_ancestor_arms(home):
    (home / "proj").mkdir()
    (home / "proj" / "pyproject.toml").write_text("")
    deep = home / "proj" / "a" / "b"
    deep.mkdir(parents=True)
    assert sc.gates_armed(str(deep)) is True


def test_marker_in_home_itself_does_not_arm(home):
    (home / ".git").mkdir()
    (home / ".claude").mkdir()
    d = home / "scratchy"
    d.mkdir()
    assert sc.gates_armed(str(d)) is False
    assert sc.gates_armed(str(home)) is False


def test_markerless_dir_unarmed(home):
    d = home / "nothing"
    d.mkdir()
    assert sc.gates_armed(str(d)) is False


def test_cwd_default_is_getcwd(home, monkeypatch):
    p = home / "proj"
    (p / ".git").mkdir(parents=True)
    monkeypatch.chdir(p)
    assert sc.gates_armed() is True
    q = home / "bare"
    q.mkdir()
    monkeypatch.chdir(q)
    assert sc.gates_armed() is False
    assert sc.gates_armed(None) is False


def test_scratch_roots_never_armed_even_with_marker(home, monkeypatch, tmp_path):
    scratch = tmp_path / "scr"
    (scratch / "proj" / ".git").mkdir(parents=True)
    monkeypatch.setenv("ATLAS_SCRATCH_ROOTS", str(scratch))
    assert sc.gates_armed(str(scratch / "proj")) is False
    monkeypatch.setenv("ATLAS_SCRATCH_ROOTS", "")
    assert sc.gates_armed(str(scratch / "proj")) is True


def test_builtin_scratch_root_unarmed(home, monkeypatch):
    monkeypatch.setattr(sc, "SCRATCH_ROOTS", ("/tmp",))
    assert sc.gates_armed("/tmp/definitely/x") is False


def test_scratch_by_realpath_symlink(home, monkeypatch, tmp_path):
    scratch = tmp_path / "scr"
    scratch.mkdir()
    (home / "link").symlink_to(scratch)
    (scratch / ".git").mkdir()
    monkeypatch.setenv("ATLAS_SCRATCH_ROOTS", str(scratch))
    assert sc.gates_armed(str(home / "link")) is False


def test_history_arms_markerless_dir(home, monkeypatch, tmp_path):
    d = home / "work"
    d.mkdir()
    db = tmp_path / "a.db"
    _db(str(db), str(d), 1)
    monkeypatch.setenv("ATLAS_DB", str(db))
    assert sc.gates_armed(str(d)) is True


def test_history_without_dispatch_does_not_arm(home, monkeypatch, tmp_path):
    d = home / "work"
    d.mkdir()
    db = tmp_path / "a.db"
    _db(str(db), str(d), 0)
    monkeypatch.setenv("ATLAS_DB", str(db))
    assert sc.gates_armed(str(d)) is False


def test_history_never_arms_home(home, monkeypatch, tmp_path):
    db = tmp_path / "a.db"
    _db(str(db), str(home), 3)
    monkeypatch.setenv("ATLAS_DB", str(db))
    assert sc.gates_armed(str(home)) is False


def test_exception_fails_toward_enforcing(home, monkeypatch):
    def boom(_):
        raise OSError("x")

    monkeypatch.setattr(sc.os.path, "abspath", boom)
    assert sc.gates_armed(str(home)) is True


# --- _has_dispatch_history --------------------------------------------------


def test_history_paths_either_matches(home, monkeypatch, tmp_path):
    db = tmp_path / "a.db"
    _db(str(db), "/real/root", 1)
    monkeypatch.setenv("ATLAS_DB", str(db))
    assert sc._has_dispatch_history(("/nope", "/real/root")) is True
    assert sc._has_dispatch_history(("/real/root", "/nope")) is True
    assert sc._has_dispatch_history(("/nope", "/nope2")) is False


def test_history_missing_db_false(home, monkeypatch, tmp_path):
    monkeypatch.setenv("ATLAS_DB", str(tmp_path / "missing.db"))
    assert sc._has_dispatch_history(("/a", "/a")) is False


def test_history_default_db_under_home(home, monkeypatch):
    monkeypatch.delenv("ATLAS_DB")
    (home / ".atlas").mkdir()
    _db(str(home / ".atlas" / "atlas.db"), "/r", 1)
    assert sc._has_dispatch_history(("/r", "/r")) is True
    monkeypatch.setenv("ATLAS_DB", "")
    assert sc._has_dispatch_history(("/r", "/r")) is True


def test_history_path_with_spaces_and_read_only(home, monkeypatch, tmp_path):
    d = tmp_path / "dir with space"
    d.mkdir()
    db = d / "a b.db"
    _db(str(db), "/r", 1)
    monkeypatch.setenv("ATLAS_DB", str(db))
    assert sc._has_dispatch_history(("/r", "/r")) is True
    before = db.read_bytes()
    sc._has_dispatch_history(("/r", "/r"))
    assert db.read_bytes() == before


def test_history_bad_schema_false(home, monkeypatch, tmp_path):
    db = tmp_path / "bad.db"
    sqlite3.connect(db).close()
    monkeypatch.setenv("ATLAS_DB", str(db))
    assert sc._has_dispatch_history(("/r", "/r")) is False


def test_history_connection_closed(home, monkeypatch, tmp_path):
    db = tmp_path / "a.db"
    _db(str(db), "/r", 1)
    monkeypatch.setenv("ATLAS_DB", str(db))
    closed = []
    real = sqlite3.connect

    class Wrap:
        def __init__(self, c):
            self.c = c

        def execute(self, *a):
            return self.c.execute(*a)

        def close(self):
            closed.append(1)
            self.c.close()

    seen = {}

    def fake(target, **kw):
        seen["uri"], seen["kw"] = target, kw
        return Wrap(real(target, **kw))

    monkeypatch.setattr(sqlite3, "connect", fake)
    assert sc._has_dispatch_history(("/r", "/r")) is True
    assert closed == [1]
    assert seen["uri"].endswith("?mode=ro") and seen["kw"] == {"uri": True, "timeout": 1}


# --- uri / scratch ----------------------------------------------------------


@pytest.mark.parametrize(
    "p,exp",
    [
        ("agent://x/y", True),
        ("xd://dev", True),
        ("a+b.c-d://x", True),
        ("1abc://x", False),
        ("/abs/path", False),
        ("rel/a://b", False),
        ("C:\\x", False),
        ("a:/b", False),
    ],
)
def test_is_uri_path(p, exp):
    assert sc.is_uri_path(p) is exp


def test_scratch_roots_defaults_and_env(monkeypatch, tmp_path):
    monkeypatch.delenv("ATLAS_SCRATCH_ROOTS", raising=False)
    for v in ("TMPDIR", "TEMP", "TMP"):
        monkeypatch.delenv(v, raising=False)
    base = sc._scratch_roots()
    assert os.path.realpath("/tmp") in base
    extra = tmp_path / "x"
    extra.mkdir()
    for v in ("TMPDIR", "TEMP", "TMP"):
        monkeypatch.setenv(v, str(extra) + "/")
        assert os.path.realpath(str(extra)) in sc._scratch_roots()
        monkeypatch.delenv(v)
    monkeypatch.setenv("TMPDIR", "relative/dir")
    assert sc._scratch_roots() == base
    monkeypatch.setenv("TMPDIR", "")
    assert sc._scratch_roots() == base
    assert all(not r.endswith("/") for r in base)


def test_scratch_roots_override_strips_slash_and_skips_root(monkeypatch):
    monkeypatch.setenv("ATLAS_SCRATCH_ROOTS", os.pathsep.join(["/opt/a/", "/", "rel"]))
    assert sc._scratch_roots() == ("/opt/a",)


def test_is_scratch_path(monkeypatch):
    monkeypatch.setenv("ATLAS_SCRATCH_ROOTS", "/opt/scr")
    assert sc.is_scratch_path("/opt/scr/x.py")
    assert sc.is_scratch_path("/opt/scr")
    assert not sc.is_scratch_path("/opt/scrx/x.py")
    assert not sc.is_scratch_path("/other/x.py")
    assert sc.is_scratch_path("\\opt\\scr\\x.py") is False  # relative backslash path
    monkeypatch.setattr(sc.os.path, "realpath", lambda p: (_ for _ in ()).throw(ValueError()))
    assert sc.is_scratch_path("/opt/scr/x") is False


# --- project_root / is_outside_project -------------------------------------


def test_project_root_nearest_git(tmp_path):
    root = (tmp_path / "r").resolve()
    (root / ".git").mkdir(parents=True)
    deep = root / "a" / "b"
    deep.mkdir(parents=True)
    assert sc.project_root(str(deep)) == str(root)
    assert sc.project_root(str(root)) == str(root)
    inner = root / "a" / "sub"
    (inner / ".git").mkdir(parents=True)
    assert sc.project_root(str(inner)) == str(inner)


def test_project_root_falls_back_to_start(monkeypatch):
    monkeypatch.setattr(sc.os.path, "exists", lambda p: False)
    assert sc.project_root("/some/dir") == os.path.realpath("/some/dir")
    monkeypatch.chdir("/")
    assert sc.project_root() == os.path.realpath("/")


def test_project_root_default_cwd(tmp_path, monkeypatch):
    root = tmp_path.resolve()
    (root / ".git").mkdir()
    sub = root / "s"
    sub.mkdir()
    monkeypatch.chdir(sub)
    assert sc.project_root() == str(root)


def test_is_outside_project(tmp_path, monkeypatch):
    root = tmp_path.resolve() / "p"
    (root / ".git").mkdir(parents=True)
    other = tmp_path.resolve() / "o"
    other.mkdir()
    assert sc.is_outside_project(str(other / "f"), str(root)) is True
    assert sc.is_outside_project(str(root / "f"), str(root)) is False
    assert sc.is_outside_project("rel/f", str(root)) is False
    assert sc.is_outside_project("../o/f", str(root)) is True
    monkeypatch.setenv("HOME", str(other))
    assert sc.is_outside_project("~/f", str(root)) is True
    monkeypatch.chdir(root)
    assert sc.is_outside_project("x") is False
    assert sc.is_outside_project(str(other / "f")) is True


def test_is_outside_project_error_is_false(monkeypatch):
    monkeypatch.setattr(sc, "project_root", lambda cwd=None: (_ for _ in ()).throw(OSError()))
    assert sc.is_outside_project("/x", "/y") is False


# --- exempt docs ------------------------------------------------------------


def test_exempt_spec_reads_contract():
    assert sc._exempt_spec() == (("docs", ".atlas"), (".md",))


def test_exempt_spec_fallback(monkeypatch):
    real = open

    def fake(path, *a, **k):
        if str(path).endswith("native-tools.json"):
            raise OSError("gone")
        return real(path, *a, **k)

    monkeypatch.setattr("builtins.open", fake)
    assert sc._exempt_spec() == (("docs", ".atlas"), (".md",))


def test_exempt_spec_reads_given_file(monkeypatch, tmp_path):
    import io
    import json

    data = {"delegationExempt": {"dirs": ["a"], "extensions": [".x"]}}
    real = open

    def fake(path, *a, **k):
        if str(path).endswith("native-tools.json"):
            return io.StringIO(json.dumps(data))
        return real(path, *a, **k)

    monkeypatch.setattr("builtins.open", fake)
    assert sc._exempt_spec() == (("a",), (".x",))


@pytest.mark.parametrize(
    "p,exp",
    [
        ("README.md", True),
        ("src/a.md", True),
        ("docs/a.py", True),
        ("src/docs/a.py", True),
        ("a/.atlas/x.json", True),
        (".atlas/x.json", True),
        ("src\\docs\\a.py", True),
        ("mydocs/a.py", False),
        ("docsx/a.py", False),
        ("src/a.py", False),
        ("a.mdx", False),
    ],
)
def test_is_exempt_doc_path(p, exp):
    assert sc.is_exempt_doc_path(p) is exp


def test_exempt_custom_dirs_exts():
    assert sc.is_exempt_doc_path("gen/a.py", dirs=("gen",), exts=(".md",))
    assert not sc.is_exempt_doc_path("docs/a.py", dirs=("gen",), exts=(".md",))
    assert sc.is_exempt_doc_path("a.rst", dirs=None, exts=(".rst",))
    assert sc.is_exempt_doc_path("docs/a.py", dirs=None, exts=(".rst",))
    assert not sc.is_exempt_doc_path("a.md", dirs=("gen",), exts=(".rst",))
    assert sc.is_exempt_doc_path("a.md", dirs=("gen",), exts=None)
    assert not sc.is_exempt_doc_path("docs/a.py", dirs=("gen",), exts=None)


# --- is_target_code ---------------------------------------------------------


def test_is_target_code(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_SCRATCH_ROOTS", "")
    root = tmp_path.resolve() / "p"
    (root / ".git").mkdir(parents=True)
    cwd = str(root)
    assert sc.is_target_code(str(root / "src" / "a.py"), cwd) is True
    assert sc.is_target_code("", cwd) is False
    assert sc.is_target_code("agent://x", cwd) is False
    assert sc.is_target_code(str(root / "README.md"), cwd) is False
    assert sc.is_target_code(str(root / "docs" / "a.py"), cwd) is False
    assert sc.is_target_code(str(tmp_path / "o" / "a.py"), cwd) is False
    assert sc.is_target_code("src/a.py", cwd) is True
    assert sc.is_target_code(str(root / "g" / "a.py"), cwd, dirs=("g",), exts=(".md",)) is False


def test_is_target_code_scratch_rules(tmp_path, monkeypatch):
    scr = tmp_path.resolve() / "scr"
    monkeypatch.setenv("ATLAS_SCRATCH_ROOTS", str(scr))
    # project lives inside scratch: own files remain code
    proj = scr / "proj"
    (proj / ".git").mkdir(parents=True)
    assert sc.is_target_code(str(proj / "a.py"), str(proj)) is True
    # project outside scratch, file inside scratch -> outside project anyway
    out = tmp_path.resolve() / "out"
    (out / ".git").mkdir(parents=True)
    assert sc.is_target_code(str(scr / "x.py"), str(out)) is False
    # scratch nested inside a non-scratch project is not code
    monkeypatch.setenv("ATLAS_SCRATCH_ROOTS", str(out / "tmpdir"))
    assert sc.is_target_code(str(out / "tmpdir" / "x.py"), str(out)) is False
    assert sc.is_target_code(str(out / "x.py"), str(out)) is True


# --- is_verification_command -----------------------------------------------


@pytest.mark.parametrize(
    "cmd",
    [
        "pytest",
        "pytest -q tests/",
        "/usr/bin/pytest",
        "py.test",
        "vitest run",
        "jest",
        "mypy .",
        "eslint src",
        "shellcheck x.sh",
        "tox",
        "python -m pytest -q",
        "python3 -m unittest",
        "python3.12 -m mypy pkg",
        "python -m ruff check .",
        "ruff check .",
        "tsc --noEmit",
        "tsc -p . --noEmit",
        "npm test",
        "npm run lint",
        "pnpm run typecheck",
        "yarn test",
        "bun run type-check",
        "cargo test",
        "cargo check",
        "cargo clippy",
        "go test ./...",
        "go vet ./...",
        "dotnet test",
        "swift test",
        "mvn test",
        "gradlew test",
        "cd sub && pytest",
        "pytest 2>&1 | tail -20",
        "pytest | grep FAIL | wc -l",
        "FOO=1 pytest",
        "sudo pytest",
        "uv run pytest",
        "npx vitest",
        "env FOO=1 pytest",
        "env -u X pytest",
        "env -i FOO=1 pytest",
        "pytest > /dev/null 2>&1",
        "pytest 2>/dev/null",
        "pytest &> /dev/null",
        "pytest >/dev/null",
        "pytest -q; mypy .",
        "pytest\nmypy .",
        "pytest && cat out",
    ],
)
def test_verification_true(cmd):
    assert sc.is_verification_command(cmd) is True, cmd


@pytest.mark.parametrize(
    "cmd",
    [
        "",
        "   ",
        None,
        5,
        "ls",
        "cat file",
        "tail -f x",
        "cd /tmp",
        "pytest --fix",
        "ruff check --fix .",
        "ruff format .",
        "ruff check",  # check alone is fine -> placeholder replaced below
        "tsc",
        "tsc -p .",
        "npm install",
        "npm run build",
        "npm",
        "cargo build",
        "go build",
        "dotnet build",
        "python script.py",
        "python -m http.server",
        "python -m ruff format .",
        "python -m pytest > out.txt",
        "pytest > out.txt",
        "pytest $(echo x)",
        "pytest `echo x`",
        "pytest <(echo x)",
        "pytest >(cat)",
        "pytest && rm -rf x",
        "pytest; rm x",
        "pytest | tee out",
        "eslint --write src",
        "jest --updateSnapshot",
        "jest --update-snapshot",
        "jest --in-place",
        "eslint --unsafe-fixes",
        "eslint --fix=true",
        "sudo",
        "FOO=1",
        "env",
        "env FOO=1",
        "env -u X",
        "pytest > /dev/nullx",
        "pytest > /dev/null.log",
        "pytest >> out.log",
        "cd sub",
        "grep x file",
    ],
)
def test_verification_false(cmd):
    if cmd == "ruff check":
        assert sc.is_verification_command(cmd) is True
        return
    assert sc.is_verification_command(cmd) is False, cmd


def test_verify_segment_edges():
    assert sc._verify_segment([]) is False
    assert sc._verify_segment(["python"]) is False
    assert sc._verify_segment(["python", "-m"]) is False
    assert sc._verify_segment(["python", "-m", "ruff"]) is False
    assert sc._verify_segment(["python", "pytest"]) is False
    assert sc._verify_segment(["cargo"]) is False
    assert sc._verify_segment(["go"]) is False
    assert sc._verify_segment(["dotnet", "build"]) is False
    assert sc._verify_segment(["npm", "run"]) is False
    assert sc._verify_segment(["npm", "run", "test"]) is True
    assert sc._verify_segment(["ruff"]) is False
    assert sc._verify_segment(["tsc", "--noEmit"]) is True
    assert sc._verify_segment(["gradle", "test"]) is True
    assert sc._verify_segment(["rake", "test"]) is True
    assert sc._verify_segment(["pytest", "--write=x"]) is False
    assert sc._verify_segment(["--fix"]) is False


def test_env_assignment():
    assert sc._is_env_assignment("A=1")
    assert sc._is_env_assignment("A=")
    assert not sc._is_env_assignment("A")
    assert not sc._is_env_assignment("1A=2")
    assert not sc._is_env_assignment("a-b=2")
    assert not sc._is_env_assignment("=1")
