"""The contract test must never write the developer's live board.

`QuietTerminalContract.test_session_boot_emission_stays_small` used to boot
hooks/session_boot.py with session id `contract` against the real repository
root. The boot carry-over then re-stamped every open plan row on
`<repo>/.atlas/.run/todos.json` to session `contract`, which emptied the Atlas
TODO block of the live session in this repository.
"""

from __future__ import annotations

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import ast  # noqa: E402
import importlib.util  # noqa: E402
import io  # noqa: E402
import unittest  # noqa: E402
from pathlib import Path  # noqa: E402

HOOKS_DIR = Path(__file__).resolve().parent
REPO_ROOT = HOOKS_DIR.parent.parent.parent
CONTRACT = HOOKS_DIR / "test_atlas_contract.py"
REAL_BOARD = REPO_ROOT / ".atlas" / ".run" / "todos.json"

# Hooks that write project state (board, run state, snapshots) under the
# project root they are pointed at.
WRITER_HOOKS = (
    "session_boot.py",
    "completion_gate.py",
    "dispatch_tripwire.py",
    "memory_capture.py",
    "nudge.py",
    "docs_drift_watch.py",
)


def _load_contract():
    spec = importlib.util.spec_from_file_location("_contract_under_test", CONTRACT)
    mod = importlib.util.module_from_spec(spec)
    _iso_sys.path.insert(0, str(HOOKS_DIR))
    spec.loader.exec_module(mod)
    return mod


class BootDoesNotTouchLiveBoard(unittest.TestCase):
    def test_session_boot_contract_leaves_real_board_unchanged(self):
        if not REAL_BOARD.is_file():
            self.skipTest("no live board at %s (CI)" % REAL_BOARD)
        before_bytes = REAL_BOARD.read_bytes()
        before_mtime = REAL_BOARD.stat().st_mtime_ns
        mod = _load_contract()
        suite = unittest.TestSuite(
            [mod.QuietTerminalContract("test_session_boot_emission_stays_small")]
        )
        result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
        self.assertTrue(
            result.wasSuccessful(), [str(e[1]) for e in result.failures + result.errors]
        )
        self.assertEqual(REAL_BOARD.stat().st_mtime_ns, before_mtime, "live board touched")
        self.assertEqual(REAL_BOARD.read_bytes(), before_bytes, "live board rewritten")


def _mentions_repo_root(node) -> bool:
    return node is not None and any(
        isinstance(n, ast.Name) and n.id == "REPO_ROOT" for n in ast.walk(node)
    )


def _kw(call, name):
    for k in call.keywords:
        if k.arg == name:
            return k.value
    return None


def _root_override(call) -> bool:
    """True when the call's env sets ATLAS_PROJECT_ROOT to something that is
    not REPO_ROOT."""
    env = _kw(call, "env")
    if env is None:
        return False
    for n in ast.walk(env):
        if isinstance(n, ast.keyword) and n.arg == "ATLAS_PROJECT_ROOT":
            return not _mentions_repo_root(n.value)
        if isinstance(n, ast.Dict):
            for k, v in zip(n.keys, n.values):
                if isinstance(k, ast.Constant) and k.value == "ATLAS_PROJECT_ROOT":
                    return not _mentions_repo_root(v)
    return False


def _hook_of(call):
    for n in ast.walk(call):
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            if n.value in WRITER_HOOKS:
                return n.value
    return None


class NoHookRunsAgainstRepoRoot(unittest.TestCase):
    def setUp(self):
        self.tree = ast.parse(CONTRACT.read_text(encoding="utf-8"))
        self.calls = [n for n in ast.walk(self.tree) if isinstance(n, ast.Call)]

    def test_no_cwd_points_at_repo_root(self):
        bad = []
        for call in self.calls:
            if _root_override(call):
                continue
            if _mentions_repo_root(_kw(call, "cwd")):
                bad.append("line %d: cwd=REPO_ROOT" % call.lineno)
            for n in ast.walk(call):
                if isinstance(n, ast.Dict):
                    for k, v in zip(n.keys, n.values):
                        if (
                            isinstance(k, ast.Constant)
                            and k.value == "cwd"
                            and _mentions_repo_root(v)
                        ):
                            bad.append("line %d: payload cwd=REPO_ROOT" % call.lineno)
        self.assertEqual(bad, [])

    def test_writer_hooks_get_an_explicit_scratch_root(self):
        """A writer hook with no cwd inherits the test runner's cwd, which is
        the repository root under pytest: it must get an explicit cwd."""
        bad = []
        for call in self.calls:
            func = call.func
            name = getattr(func, "attr", None) or getattr(func, "id", None)
            if name not in ("run", "_run_hook", "Popen", "check_output"):
                continue
            hook = _hook_of(call)
            if hook is None:
                continue
            cwd = _kw(call, "cwd")
            if cwd is None or (_mentions_repo_root(cwd) and not _root_override(call)):
                bad.append("line %d: %s without a scratch cwd" % (call.lineno, hook))
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
