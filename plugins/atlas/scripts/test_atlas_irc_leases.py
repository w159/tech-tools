"""Live file leases on a crew: `irc give` hands a file to a peer, `irc claim` takes an unowned one, and the
lease hook, `irc check`'s install step and the supervisor's fix routing all follow the moved lease."""

import io
import json
import os
import sys
from contextlib import redirect_stdout

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "hooks"))
import _test_isolation  # noqa: F401,E402
import atlas_crew  # noqa: E402
import atlas_irc as irc  # noqa: E402
import crew_worker  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in list(os.environ):
        if k.startswith("ATLAS_IRC_") or k.startswith("ATLAS_CREW_"):
            monkeypatch.delenv(k)


@pytest.fixture
def crew(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    (root / "pkg").mkdir(parents=True)
    for f in ("a.py", "b.py"):
        (root / "pkg" / f).write_text("x = 1\n")
    bus = irc.init_bus(tmp_path / "bus", "#run", ["alpha", "beta"], "lead")
    owners = {"pkg/a.py": "alpha", "pkg/b.py": "beta"}

    def be(nick):
        monkeypatch.setenv("ATLAS_IRC_DIR", str(bus))
        monkeypatch.setenv("ATLAS_IRC_NICK", nick)
        monkeypatch.setenv("ATLAS_CREW_ROOT", str(root))
        monkeypatch.setenv("ATLAS_CREW_OWNS", json.dumps([p for p, n in owners.items() if n == nick]))
        monkeypatch.setenv("ATLAS_CREW_OWNERS", json.dumps(owners))

    return root, bus, be


def _run(argv):
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = irc.main(argv)
    return rc, buf.getvalue()


def _edit_denied(root, path, capsys):
    crew_worker.pre_tool_use({"tool_name": "Edit", "tool_input": {"file_path": str(root / path)}})
    out = capsys.readouterr().out
    return '"deny"' in out, out


def test_give_moves_the_lease_and_announces_it(crew, capsys):
    root, bus, be = crew
    be("alpha")
    rc, out = _run(["give", "pkg/a.py", "beta", "you", "own", "the", "parser", "now"])
    assert rc == 0 and "now leased to beta" in out
    assert irc.leases(bus) == {"pkg/a.py": "beta"}
    last = irc.history(bus)[-1]
    assert last["kind"] == "lease" and last["to"] == "beta" and "LEASE pkg/a.py -> beta" in last["text"]
    assert irc.effective_owns(bus, "alpha") == []
    denied, out = _edit_denied(root, "pkg/a.py", capsys)
    assert denied and "leased to beta" in out
    be("beta")
    assert sorted(irc.effective_owns(bus, "beta")) == ["pkg/a.py", "pkg/b.py"]
    assert not _edit_denied(root, "pkg/a.py", capsys)[0]


def test_give_refused_when_not_owner_or_not_a_peer(crew):
    root, bus, be = crew
    be("alpha")
    assert _run(["give", "pkg/b.py", "beta"])[0] == 2  # beta's file, not alpha's
    assert _run(["give", "pkg/a.py", "mallory"])[0] == 2
    assert _run(["give", "pkg/a.py", "alpha"])[0] == 2
    assert irc.leases(bus) == {}


def test_claim_takes_only_unowned_files(crew, capsys):
    root, bus, be = crew
    be("beta")
    assert _run(["claim", "pkg/a.py"])[0] == 2  # alpha's
    rc, out = _run(["claim", "pkg/util.py"])
    assert rc == 0 and irc.leases(bus) == {"pkg/util.py": "beta"}
    assert not _edit_denied(root, "pkg/util.py", capsys)[0]
    be("alpha")
    assert _run(["claim", "pkg/util.py"])[0] == 2  # first claim wins
    assert _edit_denied(root, "pkg/util.py", capsys)[0]


def test_fix_routing_follows_moved_lease():
    plan = {
        "workers": [
            {"name": "alpha", "owns": ["pkg/a.py"], "tests": ["tests/test_a.py"]},
            {"name": "beta", "owns": ["pkg/b.py"], "tests": ["tests/test_b.py"]},
        ]
    }
    out = "FAILED pkg/a.py::thing - boom\n"
    assert set(atlas_crew.route_failures(plan, out)) == {"alpha"}
    assert set(atlas_crew.route_failures(plan, out, {"pkg/a.py": "beta"})) == {"beta"}


def test_given_file_is_not_installed_from_givers_stage(crew, monkeypatch, tmp_path):
    root, bus, be = crew
    be("alpha")
    stage = tmp_path / "stage"
    (stage / "pkg").mkdir(parents=True)
    (stage / "pkg" / "a.py").write_text("y = 2\n")
    monkeypatch.setenv("ATLAS_CREW_STAGE", str(stage))
    _run(["give", "pkg/a.py", "beta"])  # installs the newest staged copy first, then hands it over
    assert (root / "pkg" / "a.py").read_text() == "y = 2\n"
    (stage / "pkg" / "a.py").write_text("z = 3\n")
    os.utime(stage / "pkg" / "a.py", (2e9, 2e9))
    assert irc._install_from_env() == []
    assert (root / "pkg" / "a.py").read_text() == "y = 2\n"
