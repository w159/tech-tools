"""irc claim of a file whose owner has exited: refused while the owner runs, allowed once its exit is recorded."""

import io
import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
SCRIPTS = PLUGIN / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(PLUGIN / "hooks"))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_irc as irc  # noqa: E402


@pytest.fixture
def bus(tmp_path, monkeypatch):
    for k in list(os.environ):
        if k.startswith("ATLAS_IRC_") or k.startswith("ATLAS_CREW_"):
            monkeypatch.delenv(k)
    run = tmp_path / "run"
    d = irc.init_bus(run / "irc", "#run", ["gitcmd", "dispatch"], "lead")
    (tmp_path / "repo" / "hooks").mkdir(parents=True)
    owners = {"hooks/test_x.py": "gitcmd"}
    monkeypatch.setenv("ATLAS_IRC_DIR", str(d))
    monkeypatch.setenv("ATLAS_IRC_NICK", "dispatch")
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(tmp_path / "repo"))
    monkeypatch.setenv("ATLAS_CREW_OWNERS", json.dumps(owners))
    return run, d


def _claim():
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = irc.main(["claim", "hooks/test_x.py"])
    return rc, buf.getvalue()


def test_claim_refused_while_the_owner_runs(bus):
    run, d = bus
    (run / "wpid").mkdir()
    (run / "wpid" / "gitcmd.r0").write_text("1")
    rc, out = _claim()
    assert rc == 2 and "still running" in out
    assert irc.leases(d) == {}


def test_claim_allowed_once_the_owner_has_exited(bus):
    run, d = bus
    (run / "exit").mkdir()
    (run / "exit" / "gitcmd.r0.json").write_text("{}")
    rc, out = _claim()
    assert rc == 0, out
    assert irc.leases(d) == {"hooks/test_x.py": "dispatch"}


def test_owner_exited_follows_the_newest_round(bus):
    run, d = bus
    (run / "exit").mkdir()
    (run / "exit" / "gitcmd.r0.json").write_text("{}")
    assert irc.owner_exited(d, "gitcmd")
    (run / "launched").mkdir()
    (run / "launched" / "gitcmd.r1").write_text("1")
    assert not irc.owner_exited(d, "gitcmd")
    assert not irc.owner_exited(d, "lead")
