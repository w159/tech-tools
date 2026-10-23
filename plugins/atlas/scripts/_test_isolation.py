"""Test isolation: importing this module redirects every atlas state path to a
fresh tempdir so no test can write to the real ``~/.atlas``.

Import it FIRST in every test module (before any atlas module is imported):

    import _test_isolation  # noqa: F401  (hooks tests: add scripts/ to sys.path first)

It first removes every ATLAS_* / CLAUDE_* / CLAUDECODE variable inherited from the calling session
(first import only), then points ATLAS_HOME, ATLAS_DB, ATLAS_DASHBOARD_DB and ATLAS_HOOKSTATE_DIR at the tempdir (HOME is
left alone: tests rely on the real one). The tempdir is removed at interpreter exit. Idempotent:
a second import (or a second test module in the same process) reuses it.
"""

from __future__ import annotations

import atexit
import contextlib
import os
import shutil
import subprocess
import tempfile

# Hermetic env: a suite run from inside a live atlas/Claude session inherits that session's identity
# (lead/worker/channel/team/session id) and the user's settings.json env block. Tests must never depend on
# them, so drop them for the whole process (and every child it spawns) and restore nothing. Every hook and
# script test module imports this file, so this is the one choke point for both suites.
SCRUBBED_ENV_NAMES = (
    "ATLAS_LEAD_NAME",
    "ATLAS_CHANNEL",
    "ATLAS_WORKER_NAME",
    "CLAUDE_CODE_SESSION_ID",
    # user settings.json env block (mirrors hooks/testenv.USER_INJECTED)
    "ATLAS_DASHBOARD_PORT",
    "ATLAS_OPTIMIZER_MODEL",
    "ATLAS_OPTIMIZE_LOG",
    "ATLAS_OPTIMIZE_VERBOSE",
    "ATLAS_TYPESAFE_SCORING",
    "ATLAS_MEMORY_CAPTURE",
    "ATLAS_DOCS_REPAIR",
)
for _name in [k for k in os.environ if k in SCRUBBED_ENV_NAMES or k.startswith("ATLAS_TEAM")]:
    os.environ.pop(_name, None)

REAL_HOME = os.environ.get("_ATLAS_TEST_REAL_HOME") or os.path.expanduser("~")
os.environ["_ATLAS_TEST_REAL_HOME"] = REAL_HOME

_marker = os.environ.get("_ATLAS_TEST_ISOLATED_ROOT")
if _marker and os.path.isdir(_marker):
    ROOT = _marker  # inherited by a child process; owner cleans up
else:
    # First (non-inherited) import: the caller's session must not leak into the tests. A live Claude Code
    # session exports ATLAS_LEAD_NAME, CLAUDE_CODE_*, CLAUDE_SESSION_ID ... which change gate and colony behaviour.
    # A test that wants one sets it itself; child processes inherit the marker below and are not scrubbed again.
    # ATLAS_CHECK_* are explicit opt-ins for host-dependent checks and survive the scrub.
    for _k in [k for k in os.environ if k.startswith(("ATLAS_", "CLAUDE_", "CLAUDECODE")) and not k.startswith("ATLAS_CHECK_")]:
        del os.environ[_k]
    ROOT = tempfile.mkdtemp(prefix="atlas-test-home-")
    os.environ["_ATLAS_TEST_ISOLATED_ROOT"] = ROOT
    atexit.register(shutil.rmtree, ROOT, ignore_errors=True)

ATLAS_HOME = os.path.join(ROOT, ".atlas")
os.makedirs(ATLAS_HOME, exist_ok=True)
os.environ["ATLAS_HOME"] = ATLAS_HOME
os.environ["ATLAS_DB"] = os.path.join(ATLAS_HOME, "atlas.db")
os.environ["ATLAS_DASHBOARD_DB"] = os.environ["ATLAS_DB"]
os.environ["ATLAS_HOOKSTATE_DIR"] = os.path.join(ATLAS_HOME, "hookstate")
# Every tmux a test (or a process it spawns) runs lands on a PRIVATE server: with TMUX_TMPDIR set, the
# default socket is <dir>/tmux-<uid>/default, never the user's /private/tmp/tmux-<uid>/default. Short path:
# unix socket paths cap near 100 chars. A test that needs its own server still overrides TMUX_TMPDIR.
if not os.environ.get("_ATLAS_TEST_TMUX_TMPDIR") or not os.path.isdir(os.environ["_ATLAS_TEST_TMUX_TMPDIR"]):
    _tmux_tmp = tempfile.mkdtemp(prefix="atmx", dir="/tmp")
    os.environ["_ATLAS_TEST_TMUX_TMPDIR"] = _tmux_tmp

    def _reap_private_tmux(d=_tmux_tmp):
        with contextlib.suppress(Exception):  # kill-server only ever sees the private socket here, so it cannot reach the user's server
            subprocess.run(["tmux", "kill-server"], env={**os.environ, "TMUX_TMPDIR": d}, capture_output=True, timeout=5)
        shutil.rmtree(d, ignore_errors=True)

    atexit.register(_reap_private_tmux)
TMUX_TMPDIR = os.environ["_ATLAS_TEST_TMUX_TMPDIR"]
os.environ["TMUX_TMPDIR"] = TMUX_TMPDIR
os.environ.pop("TMUX", None)
os.environ.pop("TMUX_PANE", None)
# No test (or process an importer spawns) may start/adopt the user's dashboard or colony; if one
# does anyway, it gets a spare port instead of the live 7421.
os.environ["ATLAS_DASHBOARD"] = "off"
os.environ["ATLAS_COLONY"] = "off"
os.environ["ATLAS_DASHBOARD_PORT"] = "17969"

# The values this helper set, so tests can assert against them even if another test
# mutates the live environment.
ISOLATED_ENV = {
    k: os.environ[k]
    for k in ("ATLAS_HOME", "ATLAS_DB", "ATLAS_DASHBOARD_DB", "ATLAS_HOOKSTATE_DIR", "TMUX_TMPDIR")
}

# Tests that build a "real project" under $HOME need HOME outside the scratch roots: atlas treats every
# path under /tmp or /var/folders as scratch by design (atlas_scope.SCRATCH_ROOTS), so with HOME there
# (a CI runner or `HOME=$(mktemp -d)`) those fixtures can never arm and the tests fail for the host,
# not the code. They skip with this reason instead.
_SCRATCH_ROOTS = ("/tmp", "/private/tmp", "/var/folders", "/private/var/folders")
_real_home = os.path.realpath(REAL_HOME)
HOME_UNDER_SCRATCH = any(
    h == r or h.startswith(r + os.sep) for h in (REAL_HOME, _real_home) for r in _SCRATCH_ROOTS
)
HOME_UNDER_SCRATCH_REASON = (
    f"HOME ({REAL_HOME}) is under a scratch root; atlas treats paths there as scratch, "
    "so a project fixture under HOME cannot arm. Run with HOME outside /tmp and /var/folders."
)


def make_real_project_dir(testcase) -> str:
    """A directory the project-picker heuristics accept as a real project (outside every temp dir, so not
    under /tmp or /var/folders; has a .git marker), independent of where the checkout lives. Created under the
    real home with a unique name and removed on cleanup; skips the test when home is not writable."""
    try:
        d = tempfile.mkdtemp(prefix="atlas-test-realproj-", dir=REAL_HOME)
    except OSError as e:
        testcase.skipTest(f"cannot create a non-temp project dir under {REAL_HOME}: {e}")
    testcase.addCleanup(shutil.rmtree, d, True)
    os.makedirs(os.path.join(d, ".git"))
    return os.path.realpath(d)
