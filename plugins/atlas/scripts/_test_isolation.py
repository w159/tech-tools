"""Test isolation: importing this module redirects every atlas state path to a
fresh tempdir so no test can write to the real ``~/.atlas``.

Import it FIRST in every test module (before any atlas module is imported):

    import _test_isolation  # noqa: F401  (hooks tests: add scripts/ to sys.path first)

It points ATLAS_HOME, ATLAS_DB, ATLAS_DASHBOARD_DB and ATLAS_HOOKSTATE_DIR at the tempdir (HOME is
left alone: tests rely on the real one). The tempdir is removed at interpreter exit. Idempotent:
a second import (or a second test module in the same process) reuses it.
"""

from __future__ import annotations

import atexit
import os
import shutil
import tempfile

REAL_HOME = os.environ.get("_ATLAS_TEST_REAL_HOME") or os.path.expanduser("~")
os.environ["_ATLAS_TEST_REAL_HOME"] = REAL_HOME

_marker = os.environ.get("_ATLAS_TEST_ISOLATED_ROOT")
if _marker and os.path.isdir(_marker):
    ROOT = _marker  # inherited by a child process; owner cleans up
else:
    ROOT = tempfile.mkdtemp(prefix="atlas-test-home-")
    os.environ["_ATLAS_TEST_ISOLATED_ROOT"] = ROOT
    atexit.register(shutil.rmtree, ROOT, ignore_errors=True)

ATLAS_HOME = os.path.join(ROOT, ".atlas")
os.makedirs(ATLAS_HOME, exist_ok=True)
os.environ["ATLAS_HOME"] = ATLAS_HOME
os.environ["ATLAS_DB"] = os.path.join(ATLAS_HOME, "atlas.db")
os.environ["ATLAS_DASHBOARD_DB"] = os.environ["ATLAS_DB"]
os.environ["ATLAS_HOOKSTATE_DIR"] = os.path.join(ATLAS_HOME, "hookstate")
# No test (or process an importer spawns) may start/adopt the user's dashboard or colony; if one
# does anyway, it gets a spare port instead of the live 7421.
os.environ["ATLAS_DASHBOARD"] = "off"
os.environ["ATLAS_COLONY"] = "off"
os.environ["ATLAS_DASHBOARD_PORT"] = "17969"

# The values this helper set, so tests can assert against them even if another test
# mutates the live environment.
ISOLATED_ENV = {
    k: os.environ[k]
    for k in ("ATLAS_HOME", "ATLAS_DB", "ATLAS_DASHBOARD_DB", "ATLAS_HOOKSTATE_DIR")
}
