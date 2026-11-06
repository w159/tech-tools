"""Test hermeticity: no pytest run may reach the live herdr server (a real pane named `w` with a tmp cwd is a leak).
Tests that need a herdr socket set HERDR_SOCKET_PATH to their own fake.

Temp hygiene: the whole session runs with TMPDIR (and ``tempfile.tempdir``) pointed at one private directory that is
removed when the session ends, so no test fixture (mkdtemp without cleanup, a project tree holding an atlas.db) and no
product path derived from ``tempfile.gettempdir()`` (``atlas-contract-gate`` markers, ``atlas-autonames``) can pile up
in the real /tmp. Child processes inherit TMPDIR, so their temp files land in the same directory."""
import atexit
import os
import shutil
import tempfile

_REAL_TMP = tempfile.gettempdir()
SESSION_TMP = tempfile.mkdtemp(prefix="atlas-run-", dir=_REAL_TMP)
os.environ["TMPDIR"] = SESSION_TMP
tempfile.tempdir = SESSION_TMP
atexit.register(shutil.rmtree, SESSION_TMP, True)

os.environ["HERDR_SOCKET_PATH"] = os.path.join(SESSION_TMP, "atlas-pytest-no-herdr.sock")


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(SESSION_TMP, ignore_errors=True)
