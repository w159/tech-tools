#!/usr/bin/env python3
"""Scope check for orchestration gates: do they belong in this directory at all?

Gates (recall gate, dispatch tripwire, lean-ctx routing denies) make sense in a
real project. In throwaway scratch dirs (/tmp, mux bench runs) and in
directories with no project marker they only generate noise denies.

``gates_armed(cwd)`` is False for scratch roots, for $HOME itself, and for a cwd
with no project marker in itself or any ancestor below $HOME -- unless the atlas
DB (env ATLAS_DB, default ~/.atlas/atlas.db) holds a project row whose root_path
is cwd with at least one dispatch ever. Env ``ATLAS_GATES=always`` forces
True, ``ATLAS_GATES=off`` forces False. Never raises: on any error it returns
True. omp/scope.ts mirrors this rule; hooks/test_atlas_contract.py asserts the
two marker lists stay identical.
"""

from __future__ import annotations

import os

# sqlite3 and urllib.parse (~5 ms) load inside _has_dispatch_history: most hook calls
# return from the project-marker walk in gates_armed() before reaching it.

SCRATCH_ROOTS = ("/tmp", "/private/tmp", "/var/folders", "/private/var/folders")
PROJECT_MARKERS = (
    ".git",
    ".claude",
    ".atlas",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "CLAUDE.md",
    "AGENTS.md",
)


_HISTORY_SQL = (
    "SELECT 1 FROM projects p JOIN runs r ON r.project_id=p.id "
    "JOIN dispatches d ON d.run_id=r.id WHERE p.root_path IN (?,?) LIMIT 1"
)


def _has_dispatch_history(paths: tuple[str, str]) -> bool:
    """True when the atlas DB has a project row for cwd with >=1 dispatch ever.

    Read-only; any error (no DB, bad schema, locked) reads as no history."""
    try:
        db = os.environ.get("ATLAS_DB") or os.path.expanduser("~/.atlas/atlas.db")
        if not os.path.isfile(db):
            return False
        import sqlite3
        from urllib.parse import quote

        conn = sqlite3.connect(f"file:{quote(db)}?mode=ro", uri=True, timeout=1)
        try:
            return conn.execute(_HISTORY_SQL, paths).fetchone() is not None
        finally:
            conn.close()
    except Exception:  # noqa: BLE001
        return False


def _under(path: str, root: str) -> bool:
    return path == root or path.startswith(root.rstrip("/") + "/")


def gates_armed(cwd: str | None = None) -> bool:
    try:
        mode = os.environ.get("ATLAS_GATES", "").strip().lower()
        if mode == "always":
            return True
        if mode == "off":
            return False
        path = os.path.abspath(cwd or os.getcwd())
        real = os.path.realpath(path)
        if any(_under(p, r) for p in (path, real) for r in SCRATCH_ROOTS):
            return False
        home = os.path.realpath(os.path.expanduser("~"))
        cur = real
        while cur != home and cur != os.path.dirname(cur):
            if any(os.path.exists(os.path.join(cur, m)) for m in PROJECT_MARKERS):
                return True
            cur = os.path.dirname(cur)
        if real == home:
            return False
        return _has_dispatch_history((path, real))
    except Exception:  # noqa: BLE001 -- fail toward enforcing
        return True


# ---------------------------------------------------------------------------
# Shared path and command rules. The dispatch tripwire, the completion gate's (m)
# delegation predicate and the delegation prewarn all call these, so one path or
# command gets one verdict (hooks/test_gate_rules_contract.py).
# ---------------------------------------------------------------------------

# Fallback when contracts/native-tools.json "delegationExempt" is unreadable.
_DEFAULT_EXEMPT_DIRS = ("docs", ".atlas")
_DEFAULT_EXEMPT_EXTS = (".md",)


def is_uri_path(path: str) -> bool:
    """`agent://`, `xd://` ...: a message or device call routed through a Write, not a file."""
    import re

    return re.match(r"[A-Za-z][A-Za-z0-9+.-]*://", path) is not None


def _scratch_roots() -> tuple[str, ...]:
    roots = [os.path.realpath(r) for r in SCRATCH_ROOTS]
    for var in ("TMPDIR", "TEMP", "TMP"):
        value = os.environ.get(var)
        if value and os.path.isabs(value):
            roots.append(os.path.realpath(value))
    return tuple(r.rstrip("/") for r in roots if r.rstrip("/"))


def is_scratch_path(path: str) -> bool:
    """Under a scratch root (/tmp, the session scratchpad, TMPDIR...): never target code."""
    try:
        real = os.path.realpath(path).replace("\\", "/")
    except Exception:  # noqa: BLE001
        return False
    return any(_under(real, r) for r in _scratch_roots())


def project_root(cwd: str | None = None) -> str:
    """Git toplevel of cwd (nearest ancestor holding .git), falling back to cwd."""
    start = os.path.realpath(cwd or os.getcwd())
    cur = start
    while True:
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return start
        cur = parent


def is_outside_project(path: str, cwd: str | None = None) -> bool:
    """True for a path that resolves outside the project root of `cwd`."""
    try:
        path = os.path.expanduser(path)
        if not os.path.isabs(path):
            path = os.path.join(cwd or os.getcwd(), path)
        return not _under(os.path.realpath(path), project_root(cwd))
    except Exception:  # noqa: BLE001
        return False


def _exempt_spec() -> tuple[tuple[str, ...], tuple[str, ...]]:
    try:
        import json

        here = os.path.dirname(os.path.abspath(__file__))
        with open(
            os.path.join(here, "..", "contracts", "native-tools.json"), encoding="utf-8"
        ) as fh:
            spec = json.load(fh)["delegationExempt"]
        return tuple(str(d) for d in spec["dirs"]), tuple(
            str(e) for e in spec["extensions"]
        )
    except Exception:  # noqa: BLE001
        return _DEFAULT_EXEMPT_DIRS, _DEFAULT_EXEMPT_EXTS


def is_exempt_doc_path(path: str, dirs=None, exts=None) -> bool:
    """docs/, .atlas/ (any depth) or an exempt extension (.md): not target code."""
    if dirs is None or exts is None:
        default_dirs, default_exts = _exempt_spec()
        dirs = default_dirs if dirs is None else dirs
        exts = default_exts if exts is None else exts
    norm = path.replace("\\", "/")
    return norm.endswith(tuple(exts)) or any(
        norm.startswith(d + "/") or f"/{d}/" in norm for d in dirs
    )


def is_target_code(path: str, cwd: str | None = None, dirs=None, exts=None) -> bool:
    """True when `path` is code an orchestrator must delegate: a file inside the project
    root of `cwd` that is not docs/.atlas/.md, not a URI and not under a scratch root.
    A project that itself lives under a scratch root (a throwaway checkout) keeps its
    own files as code; scratch only exempts paths outside such a root."""
    if not path or is_uri_path(path):
        return False
    norm = os.path.expanduser(path).replace("\\", "/")
    if is_exempt_doc_path(norm, dirs, exts) or is_outside_project(norm, cwd):
        return False
    return not (is_scratch_path(norm) and not is_scratch_path(project_root(cwd)))


_FILTERS = frozenset(
    ("tail", "head", "grep", "rg", "wc", "cat", "sort", "uniq", "cut", "tr")
)
_WRAPPERS = frozenset(
    (
        "sudo",
        "time",
        "nice",
        "command",
        "exec",
        "npx",
        "bunx",
        "uv",
        "poetry",
        "pipenv",
        "run",
    )
)
_PY_MODULES = frozenset(
    ("pytest", "unittest", "mypy", "pyright", "flake8", "pylint", "tox", "nox")
)
_RUNNERS = frozenset(
    (
        "pytest",
        "py.test",
        "vitest",
        "jest",
        "mypy",
        "pyright",
        "flake8",
        "pylint",
        "tox",
        "nox",
        "shellcheck",
        "eslint",
    )
)
_PKG_SCRIPTS = frozenset(("test", "tests", "lint", "typecheck", "type-check"))
_FIX_FLAGS = (
    "--fix",
    "--write",
    "--unsafe-fixes",
    "--in-place",
    "--update-snapshot",
    "--updateSnapshot",
)


def _is_env_assignment(token: str) -> bool:
    name, eq, _ = token.partition("=")
    return bool(eq) and name.isidentifier()


def _verify_segment(tokens: list[str]) -> bool:
    """One simple command: a test runner, linter or type check that writes no source."""
    while tokens and (
        _is_env_assignment(tokens[0]) or tokens[0].rsplit("/", 1)[-1] in _WRAPPERS
    ):
        tokens = tokens[1:]
    if tokens and tokens[0].rsplit("/", 1)[-1] == "env":  # env [-u NAME] [VAR=v] cmd
        tokens = tokens[1:]
        while tokens and (
            tokens[0] == "-u"
            or tokens[0].startswith("-")
            or _is_env_assignment(tokens[0])
        ):
            tokens = tokens[2:] if tokens[0] == "-u" else tokens[1:]
    if not tokens:
        return False
    name = tokens[0].rsplit("/", 1)[-1]
    rest = tokens[1:]
    if any(t == f or t.startswith(f + "=") for t in rest for f in _FIX_FLAGS):
        return False
    if name in _RUNNERS:
        return True
    if name.startswith("python"):
        return (
            len(rest) >= 2
            and rest[0] == "-m"
            and (
                rest[1] in _PY_MODULES or (rest[1] == "ruff" and rest[2:3] == ["check"])
            )
        )
    if name == "ruff":
        return rest[:1] == ["check"]
    if name == "tsc":
        return "--noEmit" in rest
    if name in ("npm", "pnpm", "yarn", "bun"):
        rest = [t for t in rest if t != "run"]
        return bool(rest) and rest[0] in _PKG_SCRIPTS
    if name == "cargo":
        return rest[:1] in (["test"], ["check"], ["clippy"])
    if name == "go":
        return rest[:1] in (["test"], ["vet"])
    if name in ("dotnet", "swift", "mvn", "rake", "gradle", "gradlew"):
        return rest[:1] == ["test"]
    return False


def is_verification_command(command: str) -> bool:
    """True when a Bash command only verifies: every segment is a test runner, linter or
    type check (no --fix, no tsc emit, no redirect to a file), optionally piped through
    plain output filters. Verification is never an inline op: the completion gate tells
    the lead to run these, so the tripwire must neither count nor deny them."""
    if not isinstance(command, str) or not command.strip():
        return False
    import re

    if re.search(r"\$\(|`|<\(|>\(", command):
        return False
    stripped = re.sub(r"\d*>&\d+|(?:\d*|&)>>?\s*/dev/null(?![\w./-])", " ", command)
    if ">" in stripped:
        return False
    segments = [s.split() for s in re.split(r"&&|\|\||[;|\n&]", stripped)]
    seen = False
    for tokens in segments:
        if not tokens or tokens[0] == "cd" or tokens[0].rsplit("/", 1)[-1] in _FILTERS:
            continue
        if not _verify_segment(tokens):
            return False
        seen = True
    return seen
