"""Tests for atlas_analytics: default-on, local-first, provably anonymous counters.

Every test runs against a throwaway ATLAS_HOME and HOME; the real ~/.atlas is never touched and no test
opens a socket (urllib is stubbed). pytest itself sets PYTEST_CURRENT_TEST, which the module treats as
automation (default off), so the autouse fixture neutralises AUTOMATION_VARS; tests of the guard put it back.
"""

from __future__ import annotations

import _test_isolation  # noqa: F401  (must be first: redirects ATLAS_HOME)

import datetime
import io
import json
import os
import random
import re
import shutil
import socket
import ssl
import string
import subprocess
import sys
import time
import types
import urllib.error
import urllib.request
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_analytics as A  # noqa: E402

PLUGIN = A.PLUGIN_ROOT
_REAL_NOW = A._now
REAL_AUTOMATION_VARS = A.AUTOMATION_VARS
VALID = [
    "skill.atlas-setup",
    "hook.git_guard.deny.protected",
    "hook.completion_gate_core.fault",
    "agent.implementer",
    "team.implement.high",
    "team.size.3-4",
    "gate.c.block",
    "git.clean.worktrees",
    "git.branch.reused",
    "security.alerts.dependabot.critical",
    "session.claude",
    "dispatch.PreToolUse.ms.lt50",
    "team.outcome.done",
    "team.wall.5to15m",
    "gate.pass",
]
ENDPOINT = "https://example.invalid/ingest"
SHIPPED_ENDPOINT = "https://atlas-telemetry.vercel.app/api/ingest"
NOW = datetime.date(2026, 11, 3)  # ISO 2026-W45


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_HOME", str(tmp_path / "ah"))
    monkeypatch.setenv("HOME", str(tmp_path / "userhome"))
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "userhome"))
    for v in (
        "ATLAS_ANALYTICS",
        "ATLAS_ANALYTICS_ENDPOINT",
        "DO_NOT_TRACK",
        "ATLAS_HARNESS",
        *REAL_AUTOMATION_VARS,
    ):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setattr(A, "AUTOMATION_VARS", ())  # tests of the guard restore it
    monkeypatch.setattr(A, "_now", lambda: NOW)
    A._reset()
    yield tmp_path / "ah"
    A._reset()


def fresh():
    A._reset()


def no_schema_endpoint(monkeypatch):
    """Simulate a build that ships no endpoint (the repo schema now ships the live one)."""
    real = A.load_schema
    monkeypatch.setattr(A, "load_schema", lambda: {**real(), "endpoint": ""})


def enable():
    assert A.main(["enable"]) == 0
    fresh()


def disable(*extra):
    assert A.main(["disable", *extra]) == 0
    fresh()


def events_text(h):
    p = h / "analytics" / "events.jsonl"
    return p.read_text() if p.exists() else ""


def events_lines(h):
    """[(week, key), ...] in file order, so tests can assert what stayed queued."""
    return [(e["w"], e["k"]) for e in map(json.loads, events_text(h).splitlines())]


def write_events(h, rows):
    d = h / "analytics"
    d.mkdir(parents=True, exist_ok=True)
    with open(d / "events.jsonl", "a") as f:
        for w, k, n in rows:
            f.write(json.dumps({"w": w, "k": k, "n": n}) + "\n")


def guard_on(monkeypatch):
    monkeypatch.setattr(A, "AUTOMATION_VARS", REAL_AUTOMATION_VARS)


# --- default on and precedence -----------------------------------------------------------------------
def test_default_on_when_undecided_and_not_automation(home):
    assert A.state() == (True, "on by default")
    assert not A.is_decided()
    for k in VALID:
        A.record(k)
    assert {json.loads(ln)["k"] for ln in events_text(home).splitlines()} == set(VALID)
    assert A.build_payload()["counts"] == {k: 1 for k in sorted(VALID)}


def test_pytest_run_is_automation_so_default_is_off(home, monkeypatch):
    """The real guard: under pytest PYTEST_CURRENT_TEST is set, so other test modules never write telemetry."""
    guard_on(monkeypatch)
    assert os.environ.get("PYTEST_CURRENT_TEST")
    fresh()
    on, why = A.state()
    assert not on and "CI or test run" in why
    A.record("skill.atlas-setup")
    assert not (home / "analytics").exists()
    assert A.boot_notice() is None
    assert A.maybe_send_in_background() is False


@pytest.mark.parametrize(
    "var",
    [
        "CI",
        "GITHUB_ACTIONS",
        "GITLAB_CI",
        "BUILDKITE",
        "CIRCLECI",
        "TRAVIS",
        "JENKINS_URL",
        "TF_BUILD",
    ],
)
def test_each_ci_var_turns_default_off(home, monkeypatch, var):
    guard_on(monkeypatch)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setenv(var, "true")
    fresh()
    assert A.state() == (False, "CI or test run (set ATLAS_ANALYTICS=on to count it)")
    A.record("skill.atlas-setup")
    assert events_text(home) == ""


def test_explicit_enable_and_env_on_win_over_automation_guard(home, monkeypatch):
    guard_on(monkeypatch)
    monkeypatch.setenv("CI", "true")
    fresh()
    assert not A.is_enabled()
    enable()
    assert A.state() == (True, "turned on with `enable`")
    A.record("skill.atlas-setup")
    assert events_text(home) != ""
    A.main(["delete"])
    monkeypatch.setenv("ATLAS_ANALYTICS", "on")
    fresh()
    assert A.state() == (True, "ATLAS_ANALYTICS=on")


def test_disable_beats_default_and_survives_reset(home):
    disable()
    assert A.state() == (False, "turned off with `disable`")
    assert A.is_decided()
    A.record("skill.atlas-setup")
    assert events_text(home) == ""


def test_precedence_dnt_over_env_on_over_consent(home, monkeypatch):
    enable()
    monkeypatch.setenv("ATLAS_ANALYTICS", "on")
    monkeypatch.setenv("DO_NOT_TRACK", "1")
    fresh()
    assert A.state() == (False, "DO_NOT_TRACK is set")
    monkeypatch.delenv("DO_NOT_TRACK")
    fresh()
    assert A.state() == (True, "ATLAS_ANALYTICS=on")
    disable()
    assert A.state() == (True, "ATLAS_ANALYTICS=on")  # env on beats a stored disable
    monkeypatch.delenv("ATLAS_ANALYTICS")
    fresh()
    assert A.state() == (False, "turned off with `disable`")


@pytest.mark.parametrize("val", ["off", "0", "false", "no", "disabled", "OFF"])
def test_env_off_beats_enabled_consent_and_silences_notice(home, monkeypatch, val):
    enable()
    monkeypatch.setenv("ATLAS_ANALYTICS", val)
    fresh()
    assert A.state() == (False, "ATLAS_ANALYTICS=off")
    A.record("skill.atlas-setup")
    assert events_text(home) == ""
    assert A.boot_notice() is None
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", ENDPOINT)
    assert A.main(["send"]) == 2


def test_settings_store_off_key_forces_off(home, monkeypatch):
    home.mkdir(parents=True, exist_ok=True)
    (home / "settings.json").write_text(json.dumps({"env": {"ATLAS_ANALYTICS": "off"}}))
    fresh()
    assert A.state() == (False, "ATLAS_ANALYTICS=off")
    enable()
    assert A.state() == (False, "ATLAS_ANALYTICS=off")  # the store key beats consent
    monkeypatch.setenv("ATLAS_ANALYTICS", "on")  # a real env var beats the store
    fresh()
    assert A.state() == (True, "ATLAS_ANALYTICS=on")


def test_settings_store_garbage_is_ignored(home):
    home.mkdir(parents=True, exist_ok=True)
    (home / "settings.json").write_text("{not json")
    fresh()
    assert A.state() == (True, "on by default")
    (home / "settings.json").write_text(json.dumps({"env": {"ATLAS_ANALYTICS": 0}}))
    fresh()
    assert A.state() == (True, "on by default")


@pytest.mark.parametrize("val", ["1", "true", "yes", "anything"])
def test_do_not_track_forces_off_over_everything(home, monkeypatch, val):
    enable()
    monkeypatch.setenv("ATLAS_ANALYTICS", "on")
    monkeypatch.setenv("DO_NOT_TRACK", val)
    fresh()
    assert A.state() == (False, "DO_NOT_TRACK is set")
    A.record("skill.atlas-setup")
    assert events_text(home) == ""
    assert A.boot_notice() is None
    assert A.main(["send"]) == 2


@pytest.mark.parametrize("val", ["0", "false", "no", "", " "])
def test_do_not_track_zero_does_not_disable(home, monkeypatch, val):
    monkeypatch.setenv("DO_NOT_TRACK", val)
    fresh()
    assert A.state() == (True, "on by default")


# --- recording and aggregation -----------------------------------------------------------------------------
def test_record_aggregates_per_week(home, monkeypatch):
    A.record("skill.atlas-setup")
    A.record("skill.atlas-setup", 4)
    A.record("gate.a.block")
    monkeypatch.setattr(A, "_now", lambda: datetime.date(2026, 11, 10))  # W46
    A.record("skill.atlas-setup")
    assert A.build_payload("2026-W45")["counts"] == {
        "gate.a.block": 1,
        "skill.atlas-setup": 5,
    }
    assert A.build_payload("2026-W46")["counts"] == {"skill.atlas-setup": 1}
    assert A.pending_week() == "2026-W45"  # oldest finished week first


def test_counts_clamped_and_bad_n_dropped(home):
    A.record("skill.atlas-setup", 10**9)
    A.record("skill.atlas-setup", -3)
    A.record("skill.atlas-setup", 0)
    A.record("skill.atlas-setup", True)  # bool is not a count
    A.record("skill.atlas-setup", "5")  # type: ignore[arg-type]
    A.record("skill.atlas-setup", 2.5)  # type: ignore[arg-type]
    assert A.build_payload()["counts"] == {"skill.atlas-setup": 10000}


def test_record_never_raises(home, monkeypatch):
    for bad in (None, 5, b"x", ["a"], object()):
        A.record(bad)  # type: ignore[arg-type]
    monkeypatch.setenv("ATLAS_HOME", "/proc/nonexistent/x")
    fresh()
    A.record("skill.atlas-setup")


def test_off_record_costs_no_disk_access(home, monkeypatch):
    disable()
    A.record("skill.atlas-setup")  # resolves the cached flag
    monkeypatch.setattr(A, "adir", lambda: pytest.fail("off path touched the disk"))
    for _ in range(100):
        A.record("skill.atlas-setup")


# --- anonymity: validation at record AND build ------------------------------------------------------------------
def _leaky_keys():
    import getpass
    import socket

    user = getpass.getuser() or "someuser"
    host = socket.gethostname() or "somehost"
    return [
        f"skill.{user}",
        "skill.my-private-skill",
        f"hook.{host}.deny",
        "hook.git_guard.deny.not_a_reason",
        "hook.git_guard.deny.protected.extra",
        "skill.atlas-setup/../../etc/passwd",
        "skill.atlas-setup\n",
        "skill.atlas-setup ",
        "SKILL.atlas-setup",
        "/home/jerry/secret-repo",
        "C:\\Users\\jerry\\repo",
        "repo.w159/tech-tools",
        "branch.feat/atlas-git-hygiene",
        "please fix the login bug in acme-billing",
        "agent.not-a-role",
        "team.implement.extreme",
        "team.size.10",
        "gate.ab.block",
        "gate.1.block",
        "security.alerts.dependabot.urgent",
        "git.clean.everything",
        "session.alice",
        "dispatch.NotAnEvent.ms.lt50",
        "dispatch.PreToolUse.ms.12",
        "team.outcome.exploded",
        "",
    ]


def test_unknown_and_leaky_keys_dropped_at_record(home):
    for k in _leaky_keys():
        A.record(k)
    assert events_text(home) == ""
    A.record("skill.atlas-setup")
    assert A.build_payload()["counts"] == {"skill.atlas-setup": 1}


def test_unknown_keys_dropped_at_build_even_if_written_to_disk(home):
    A.record("skill.atlas-setup")
    with open(
        home / "analytics" / "events.jsonl", "a"
    ) as f:  # bypass record(): hand-edited / foreign lines
        for k in _leaky_keys():
            f.write(json.dumps({"w": "2026-W45", "k": k, "n": 3}) + "\n")
        f.write(
            json.dumps({"w": "2026-W45", "k": "skill.atlas-setup", "n": "many"}) + "\n"
        )
        f.write(json.dumps({"w": "/home/x", "k": "skill.atlas-setup", "n": 1}) + "\n")
        f.write("not json\n")
    p = A.build_payload("2026-W45")
    assert p["counts"] == {"skill.atlas-setup": 1}
    assert all(r[1] for r in A.check_payload(p, identities=[]))


def test_user_skill_repo_and_cwd_names_never_match(home, monkeypatch, tmp_path):
    user_skill = tmp_path / "proj" / ".claude" / "skills" / "acme-secret-skill"
    user_skill.mkdir(parents=True)
    (user_skill / "SKILL.md").write_text("---\nname: acme-secret-skill\n---\n")
    monkeypatch.chdir(tmp_path / "proj")
    fresh()
    A.record("skill.acme-secret-skill")
    A.record("skill.proj")
    assert events_text(home) == ""


def test_fuzz_payload_only_schema_keys(home):
    rnd = random.Random(1234)
    alphabet = string.ascii_letters + string.digits + "./-_:@ \\\n"
    for i in range(500):
        junk = "".join(rnd.choice(alphabet) for _ in range(rnd.randint(1, 60)))
        A.record(junk)
        A.record(
            rnd.choice(
                [
                    "skill.",
                    "hook.",
                    "git.",
                    "agent.",
                    "team.",
                    "gate.",
                    "session.",
                    "dispatch.",
                ]
            )
            + junk
        )
        if i % 10 == 0:
            A.record(rnd.choice(VALID))
    payload = A.build_payload()
    assert payload["counts"], "valid keys must survive the fuzz"
    for k in payload["counts"]:
        assert k in VALID
        assert A.family_of(k)
    assert set(payload) == A._ENVELOPE
    assert all(r[1] for r in A.check_payload(payload, identities=[]))


# --- payload and nonce ----------------------------------------------------------------------------------------------
def test_payload_envelope_has_no_harness_or_identifier_fields(home):
    A.record("skill.atlas-setup")
    p = A.build_payload()
    assert set(p) == {
        "schema",
        "atlas_version",
        "os",
        "python",
        "week",
        "nonce",
        "counts",
        "partial",
    }
    assert p["schema"] == 3 == A.SCHEMA_VERSION
    assert p["partial"] is True  # the current week is a week-to-date snapshot
    assert A.build_payload("2026-W44")["partial"] is False
    assert "test" not in p and A.build_payload(test=True)["test"] is True


def test_nonce_is_uuid4_stable_per_week_and_unique_across_weeks(home):
    A.record("skill.atlas-setup")
    n1 = A.build_payload("2026-W45", persist_nonce=True)["nonce"]
    assert uuid.UUID(n1).version == 4 and str(uuid.UUID(n1)) == n1
    assert A.build_payload("2026-W45")["nonce"] == n1  # persisted: a retry reuses it
    assert A.build_payload("2026-W45", persist_nonce=True)["nonce"] == n1
    n2 = A.build_payload("2026-W44", persist_nonce=True)["nonce"]
    assert n2 != n1 and uuid.UUID(n2).version == 4
    assert json.loads((home / "analytics" / "outbox.json").read_text()) == {
        "2026-W44": n2,
        "2026-W45": n1,
    }


def test_unpersisted_nonce_is_fresh_each_time_and_writes_nothing(home):
    a = A.build_payload("2026-W45")["nonce"]
    b = A.build_payload("2026-W45")["nonce"]
    assert a != b
    assert not (home / "analytics" / "outbox.json").exists()


def test_corrupt_outbox_nonce_is_replaced(home):
    (home / "analytics").mkdir(parents=True)
    (home / "analytics" / "outbox.json").write_text(
        json.dumps({"2026-W45": "alice@example.com"})
    )
    n = A.build_payload("2026-W45", persist_nonce=True)["nonce"]
    assert A._is_uuid4(n)


def test_prove_fails_when_nonce_from_another_week_is_reused(home):
    A.record("skill.atlas-setup")
    p = A.build_payload("2026-W45")
    (home / "analytics").mkdir(parents=True, exist_ok=True)
    (home / "analytics" / "sent.jsonl").write_text(
        json.dumps({"week": "2026-W44", "nonce": p["nonce"]}) + "\n"
    )
    res = A.check_payload(p, identities=[])
    assert "nonce is a random UUIDv4 never used for another week" in {
        r[0] for r in res if not r[1]
    }
    same_week = {**p}
    (home / "analytics" / "sent.jsonl").write_text(
        json.dumps({"week": "2026-W45", "nonce": p["nonce"]}) + "\n"
    )
    assert all(
        r[1] for r in A.check_payload(same_week, identities=[])
    )  # a retry of the same week is fine


def test_prove_fails_on_non_uuid_nonce(home):
    A.record("skill.atlas-setup")
    p = A.build_payload()
    for bad in ("not-a-uuid", str(uuid.uuid1()), "alice@example.com"):
        p["nonce"] = bad
        assert "nonce is a random UUIDv4 never used for another week" in {
            r[0] for r in A.check_payload(p, identities=[]) if not r[1]
        }


# --- prove ---------------------------------------------------------------------------------------------------------
def test_prove_passes_on_real_payload_with_real_identities(home, capsys):
    for k in VALID:
        A.record(k, 2)
    res = A.check_payload(A.build_payload())  # real username, hostname, cwd, git remote
    assert all(r[1] for r in res), [r for r in res if not r[1]]
    capsys.readouterr()
    assert A.main(["prove"]) == 0
    assert "RESULT: PASS" in capsys.readouterr().out


def _good_payload(home):
    A.record("skill.atlas-setup")
    return A.build_payload()


def _failed(res):
    return {r[0] for r in res if not r[1]}


@pytest.mark.parametrize(
    "mutate, expect",
    [
        (
            lambda p: p["counts"].update({"skill.alice-private": 1}),
            "no counter key outside the schema",
        ),
        (
            lambda p: p["counts"].update({"/home/alice/repo": 1}),
            "no counter key outside the schema",
        ),
        (
            lambda p: p["counts"].update({"skill.atlas-setup": "3"}),
            "every count is an integer within 1..10000",
        ),
        (
            lambda p: p["counts"].update({"skill.atlas-setup": 10**6}),
            "every count is an integer within 1..10000",
        ),
        (lambda p: p.update({"host": "x"}), "envelope has exactly the schema fields"),
        (
            lambda p: p.update({"harness": "claude"}),
            "envelope has exactly the schema fields",
        ),
        (lambda p: p.pop("nonce"), "envelope has exactly the schema fields"),
        (lambda p: p.update({"schema": 1}), "envelope values come from closed sets"),
        (
            lambda p: p.update({"python": "/home/alice/venv"}),
            "envelope values come from closed sets",
        ),
    ],
)
def test_prove_fails_on_schema_violations(home, mutate, expect):
    p = _good_payload(home)
    mutate(p)
    assert expect in _failed(A.check_payload(p, identities=[]))


@pytest.mark.parametrize(
    "planted, check",
    [
        ({"os": "alice"}, "no username, hostname, home dir, cwd, repo identifiers"),
        (
            {"os": "buildbox-07"},
            "no username, hostname, home dir, cwd, repo identifiers",
        ),
        ({"python": "/home/alice/work/acme-billing"}, "no absolute paths"),
        ({"week": "alice@example.com"}, "no email-like strings"),
        ({"os": "10.1.2.3"}, "no IPv4 addresses"),
        ({"os": "fe80::1ff:fe23:4567:890a"}, "no IPv6 addresses"),
        ({"os": "deadbeefdeadbeefdeadbeef"}, "no hex tokens of 16+ chars"),
        ({"os": "QWxhZGRpbjpvcGVuU2VzYW1l"}, "no base64-like tokens of 16+ chars"),
    ],
)
def test_prove_fails_on_planted_personal_data(home, planted, check):
    p = _good_payload(home)
    p.update(planted)
    ids = [
        ("username", "alice"),
        ("hostname", "buildbox-07"),
        ("cwd basename", "acme-billing"),
        ("home dir", "/home/alice"),
    ]
    assert check in _failed(A.check_payload(p, identities=ids))


@pytest.mark.parametrize(
    "planted",
    [{"os": "/home/alice/work"}, {"os": "buildbox-07"}, {"os": "alice"}],
    ids=["path", "hostname", "username"],
)
def test_prove_command_exits_nonzero_on_path_hostname_or_username(
    home, monkeypatch, capsys, planted
):
    p = _good_payload(home)
    p.update(planted)
    monkeypatch.setattr(A, "build_payload", lambda week=None, persist_nonce=False, test=False: p)
    monkeypatch.setattr(
        A,
        "gather_identities",
        lambda: [("username", "alice"), ("hostname", "buildbox-07")],
    )
    capsys.readouterr()
    assert A.main(["prove"]) == 1
    assert "RESULT: FAIL" in capsys.readouterr().out


def test_prove_exit_code_is_nonzero_when_a_check_fails(home, monkeypatch):
    A.record("skill.atlas-setup")
    monkeypatch.setattr(
        A, "check_payload", lambda p, identities=None: [("x", False, "planted")]
    )
    assert A.main(["prove"]) == 1


def test_gathered_identities_include_user_host_home_cwd(home):
    labels = {lab for lab, _ in A.gather_identities()}
    assert {"home dir", "cwd"} <= labels


# --- schema -------------------------------------------------------------------------------------------------------
def test_every_family_has_purpose_and_patterns():
    sch = A.load_schema()
    assert sch["schema"] == A.SCHEMA_VERSION
    assert sch["families"]
    for name, fam in sch["families"].items():
        assert len(fam["purpose"].strip()) > 40, name
        assert fam["patterns"], name
        for pat in fam["patterns"]:
            for ph in re.findall(r"\{(\w+)\}", pat):
                assert ph in sch["enums"], (name, ph)
    assert sch["never_collected"]


def test_schema_covers_every_shipped_skill_hook_agent():
    for d in sorted((PLUGIN / "skills").iterdir()):
        if d.is_dir():
            assert A.valid_key(f"skill.{d.name}"), (
                f"skill {d.name} would be silently dropped"
            )
    for f in sorted((PLUGIN / "agents").glob("*.md")):
        assert A.valid_key(f"agent.{f.stem}"), f.name
    for f in sorted((PLUGIN / "hooks").glob("*.py")):
        if f.name.startswith(("test_", "_")) or f.stem in ("testenv", "conftest"):
            continue
        for dec in ("deny", "ask", "context", "fault", "slow"):
            assert A.valid_key(f"hook.{f.stem}.{dec}"), f.name
        assert A.valid_key(f"hook.{f.stem}.deny.protected")


def test_schema_covers_hook_events_scope_matrix_and_gate_letters():
    for ev in json.loads((PLUGIN / "hooks" / "hooks.json").read_text())["hooks"]:
        assert A.valid_key(f"dispatch.{ev}.ms.lt50"), ev
        assert A.valid_key(f"dispatch.{ev}.ms.ge1000"), ev
    sm = json.loads((PLUGIN / "contracts" / "scope-matrix.json").read_text())["classes"]
    for cls, efforts in sm.items():
        for eff in efforts:
            assert A.valid_key(f"team.{cls}.{eff}"), (cls, eff)
    for size in ("1", "2", "3-4", "5-8", "9+"):
        assert A.valid_key(f"team.size.{size}")
    for letter in string.ascii_lowercase:
        assert A.valid_key(f"gate.{letter}.block")
    for h in ("claude", "omp", "codex", "unknown"):
        assert A.valid_key(f"session.{h}")


def test_allowed_keys_expands_every_family():
    keys = A.allowed_keys()
    assert keys and keys == sorted(set(keys))
    assert all(A.valid_key(k) for k in keys)
    for k in (
        "session.codex",
        "gate.pass",
        "team.outcome.done",
        "dispatch.PreToolUse.ms.lt50",
        "hook.git_guard.slow",
    ):
        assert k in keys, k
    sch = A.load_schema()
    expected = set()
    for spec in sch["families"].values():
        for pat in spec["patterns"]:
            combos = [""]
            for tok in A._split(pat):
                vals = A.enum_values(tok[1:-1]) if tok.startswith("{") else [tok]
                combos = [c + v for c in combos for v in vals]
            expected.update(combos)
    assert len(keys) == len({k for k in expected if A.valid_key(k)})
    assert {A.family_of(k) for k in keys} == set(
        sch["families"]
    )  # no family expands to nothing


def test_allowed_keys_command_prints_the_same_list(home, capsys):
    assert A.main(["allowed-keys"]) == 0
    doc = json.loads(capsys.readouterr().out)
    assert doc["keys"] == A.allowed_keys()
    assert (
        doc["schema"] == 3
        and doc["schemas"] == [2, 3]
        and doc["max_count"] == 10000
        and doc["min_installs_published"] == 3
    )


# --- buckets and harness ----------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    "ms, want",
    [
        (0, "lt50"),
        (49.9, "lt50"),
        (50, "50to200"),
        (199, "50to200"),
        (200, "200to1000"),
        (999, "200to1000"),
        (1000, "ge1000"),
        (9e5, "ge1000"),
    ],
)
def test_ms_bucket(ms, want):
    assert A.ms_bucket(ms) == want
    assert A.valid_key(f"dispatch.PreToolUse.ms.{want}")


@pytest.mark.parametrize(
    "sec, want",
    [
        (0, "lt1m"),
        (59, "lt1m"),
        (60, "1to5m"),
        (299, "1to5m"),
        (300, "5to15m"),
        (899, "5to15m"),
        (900, "15to60m"),
        (3599, "15to60m"),
        (3600, "ge60m"),
    ],
)
def test_wall_bucket(sec, want):
    assert A.wall_bucket(sec) == want
    assert A.valid_key(f"team.wall.{want}")


def test_detect_harness_order():
    assert A.detect_harness(env={"ATLAS_HARNESS": "omp", "CLAUDECODE": "1"}) == "omp"
    assert (
        A.detect_harness(env={"ATLAS_HARNESS": "bogus", "CLAUDECODE": "1"}) == "claude"
    )
    assert A.detect_harness(env={"OMP_SESSION": "x", "CLAUDECODE": "1"}) == "omp"
    assert A.detect_harness(env={"PLUGIN_ROOT": "/x", "CLAUDECODE": "1"}) == "codex"
    assert A.detect_harness({"turn_id": "t1"}, env={}) == "codex"
    assert A.detect_harness({"turn_id": "t1"}, env={"CLAUDECODE": "1"}) == "codex"
    assert A.detect_harness({}, env={"CLAUDECODE": "1"}) == "claude"
    assert A.detect_harness(None, env={}) == "unknown"
    assert A.detect_harness(env={"HOME": "/x"}) == "unknown"


def test_detect_harness_reads_process_env_by_default(monkeypatch):
    for k in list(os.environ):
        if k.startswith(("OMP_", "PI_", "CODEX_", "CLAUDE_CODE_")) or k in (
            "OMPCODE",
            "PLUGIN_ROOT",
            "CLAUDECODE",
        ):
            monkeypatch.delenv(k)
    assert A.detect_harness() == "unknown"
    monkeypatch.setenv("CLAUDECODE", "1")
    assert A.detect_harness() == "claude"


def test_on_session_start_records_session_harness(home, monkeypatch):
    monkeypatch.setattr(A, "maybe_send_in_background", lambda: False)
    monkeypatch.setenv("ATLAS_HARNESS", "omp")
    A.on_session_start()
    A.on_session_start({"turn_id": "x"})  # ATLAS_HARNESS still wins
    assert A.build_payload()["counts"] == {"session.omp": 2, "active.day.tue": 2}


def test_on_session_start_compacts_and_tries_background_send_only_when_on(
    home, monkeypatch
):
    calls = []
    monkeypatch.setattr(A, "maybe_send_in_background", lambda: calls.append("send"))
    monkeypatch.setattr(A, "compact", lambda force=False: calls.append("compact"))
    A.on_session_start({"turn_id": "x"})
    assert calls == ["compact", "send"]
    assert A.build_payload()["counts"] == {"session.codex": 1, "active.day.tue": 1}
    disable()
    calls.clear()
    A.on_session_start()
    assert calls == []


def test_on_session_start_never_raises(home, monkeypatch):
    monkeypatch.setattr(A, "record", lambda *a, **k: 1 / 0)
    A.on_session_start({"turn_id": "x"})


# --- compact and retention -------------------------------------------------------------------------------------
def test_compact_collapses_clamps_and_drops_old_weeks(home):
    write_events(
        home,
        [("2026-W45", "skill.atlas-setup", 2)] * 3
        + [("2026-W45", "gate.a.block", 9000)] * 3
        + [("2026-W44", "gate.a.block", 1)]
        + [("2026-W30", "gate.a.block", 5)]  # older than 8 weeks
        + [("2026-W37", "gate.b.block", 1)],  # exactly 8 weeks back: kept
    )
    assert A.compact(force=True) is True
    rows = [json.loads(ln) for ln in events_text(home).splitlines()]
    assert rows == [
        {"w": "2026-W37", "k": "gate.b.block", "n": 1},
        {"w": "2026-W44", "k": "gate.a.block", "n": 1},
        {"w": "2026-W45", "k": "gate.a.block", "n": 10000},  # clamped to max_count
        {"w": "2026-W45", "k": "skill.atlas-setup", "n": 6},
    ]


def test_compact_caps_the_file_size_and_skips_small_or_missing(home, monkeypatch):
    assert A.compact() is False  # no file
    write_events(home, [("2026-W45", "skill.atlas-setup", 1)])
    assert A.compact() is False  # below the threshold: untouched
    monkeypatch.setattr(A, "COMPACT_BYTES", 2000)
    write_events(home, [("2026-W45", "skill.atlas-setup", 1)] * 200)
    before = (home / "analytics" / "events.jsonl").stat().st_size
    assert before > 2000
    assert A.compact() is True
    after = (home / "analytics" / "events.jsonl").stat().st_size
    assert after < 100
    assert A.build_payload("2026-W45")["counts"] == {"skill.atlas-setup": 201}


# --- lifecycle commands ----------------------------------------------------------------------------------------
def test_enable_and_disable_persist_to_consent_json(home):
    enable()
    c = json.loads((home / "analytics" / "consent.json").read_text())
    assert c == {"enabled": True, "decided": "2026-11-03", "schema": 3}
    assert A.is_decided() and A.state() == (True, "turned on with `enable`")
    disable()
    c = json.loads((home / "analytics" / "consent.json").read_text())
    assert c["enabled"] is False and c["decided"] == "2026-11-03" and c["schema"] == 3
    assert A.state() == (False, "turned off with `disable`")
    enable()
    assert A.state() == (True, "turned on with `enable`")


def test_enable_takes_no_endpoint_argument(home):
    with pytest.raises(SystemExit) as e:
        A.main(["enable", "--endpoint", "https://example.invalid/x"])
    assert e.value.code == 2
    assert not (home / "analytics" / "consent.json").exists()


def test_disable_deletes_events_and_outbox_unless_keep(home):
    A.record("skill.atlas-setup")
    A.build_payload("2026-W45", persist_nonce=True)
    disable("--keep")
    assert events_text(home) and (home / "analytics" / "outbox.json").exists()
    disable()
    assert events_text(home) == "" and not (home / "analytics" / "outbox.json").exists()
    assert (
        json.loads((home / "analytics" / "consent.json").read_text())["enabled"]
        is False
    )


def test_delete_removes_directory_and_resets_to_default(home):
    A.record("skill.atlas-setup")
    assert (home / "analytics").exists()
    assert A.main(["delete"]) == 0
    assert not (home / "analytics").exists()
    assert A.is_enabled()  # delete forgets a stored `disable` too: back to the default
    assert A.main(["delete"]) == 0  # idempotent


def test_status_explain_and_preview_run(home, capsys, monkeypatch):
    no_schema_endpoint(monkeypatch)
    A.record("skill.atlas-setup")
    capsys.readouterr()
    assert A.main(["status"]) == 0
    out = capsys.readouterr().out
    assert "ON (on by default)" in out and "none configured" in out
    assert A.main(["explain"]) == 0
    out = capsys.readouterr().out
    for spec in A.load_schema()["families"].values():
        assert spec["purpose"] in out
    assert "NEVER COLLECTED" in out and "on by default" in out


def test_preview_prints_the_exact_payload_with_envelope_and_counts(home, capsys):
    A.record("skill.atlas-setup", 3)
    A.record("session.claude")
    capsys.readouterr()
    A.main(["preview", "--week", "2026-W45"])
    out = capsys.readouterr().out
    p = json.loads(out)
    assert set(p) == A._ENVELOPE and p["week"] == "2026-W45"
    assert p["counts"] == {"session.claude": 1, "skill.atlas-setup": 3}
    assert (
        out == A.payload_json(p) + "\n"
    )  # sorted keys, compact separators: exactly what send would post


def test_status_reports_dnt_off(home, monkeypatch, capsys):
    monkeypatch.setenv("DO_NOT_TRACK", "1")
    fresh()
    capsys.readouterr()
    A.main(["status"])
    assert "OFF (DO_NOT_TRACK is set)" in capsys.readouterr().out


def test_export_writes_exact_preview(home, tmp_path, capsys):
    A.record("skill.atlas-setup")
    capsys.readouterr()
    A.main(["preview", "--week", "2026-W45"])
    prev = capsys.readouterr().out
    out = tmp_path / "p.json"
    A.main(["export", "--week", "2026-W45", "--out", str(out)])
    assert json.loads(out.read_text())["counts"] == json.loads(prev)["counts"]


# --- disclosure ---------------------------------------------------------------------------------------------------
def test_boot_notice_once_per_schema_version_while_undecided(home, monkeypatch):
    n = A.boot_notice()
    assert n and "preview" in n and "ATLAS_ANALYTICS=off" in n and "DO_NOT_TRACK" in n
    assert "disable" in n and "explain" in n and "atlas_analytics.py" in n
    assert A.boot_notice() is None
    assert json.loads((home / "analytics" / "notice.json").read_text())["schema"] == 3
    monkeypatch.setattr(A, "SCHEMA_VERSION", 4)
    assert A.boot_notice() is not None  # a new schema version shows it again
    assert A.boot_notice() is None


@pytest.mark.parametrize("decision", ["enable", "disable"])
def test_boot_notice_never_after_a_decision(home, decision):
    (enable if decision == "enable" else disable)()
    assert A.boot_notice() is None
    assert not (home / "analytics" / "notice.json").exists()


def test_boot_notice_silent_under_opt_outs_and_ci(home, monkeypatch):
    monkeypatch.setenv("DO_NOT_TRACK", "1")
    fresh()
    assert A.boot_notice() is None
    monkeypatch.delenv("DO_NOT_TRACK")
    monkeypatch.setenv("ATLAS_ANALYTICS", "off")
    fresh()
    assert A.boot_notice() is None
    monkeypatch.delenv("ATLAS_ANALYTICS")
    guard_on(monkeypatch)
    monkeypatch.setenv("CI", "true")
    fresh()
    assert A.boot_notice() is None
    assert not (home / "analytics" / "notice.json").exists()


def test_boot_notice_silent_under_env_on_without_decision(home, monkeypatch):
    monkeypatch.setenv("ATLAS_ANALYTICS", "on")  # explicit: the user already knows
    fresh()
    assert A.boot_notice() is None


# --- endpoint and send --------------------------------------------------------------------------------------------
class FakeNet:
    """Stands in for urllib: records POSTs, answers with a scripted status, never opens a socket."""

    def __init__(self, monkeypatch, sent_path=None, statuses=None):
        self.posts, self.had_it, self.statuses = [], [], list(statuses or [])
        self.sent_path = sent_path

        def answer(req, timeout=None):
            body = req.data.decode()
            self.posts.append(
                (req.full_url, body, req.get_method(), req.get_header("Content-type"))
            )
            try:
                self.had_it.append(body in self.sent_path.read_text())
            except Exception:
                self.had_it.append(False)
            status = self.statuses.pop(0) if self.statuses else 200
            if isinstance(status, Exception):
                raise status
            if status >= 400:
                raise urllib.error.HTTPError(
                    req.full_url, status, "x", {}, io.BytesIO(b"")
                )
            return _Resp(status)

        class _Opener:
            def open(self_inner, req, timeout=None):
                return answer(req, timeout)

        monkeypatch.setattr(urllib.request, "urlopen", answer)
        monkeypatch.setattr(urllib.request, "build_opener", lambda *a, **k: _Opener())


class _Resp:
    def __init__(self, status):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def net(home, monkeypatch):
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", ENDPOINT)
    return FakeNet(monkeypatch, home / "analytics" / "sent.jsonl")


def test_endpoint_env_overrides_schema_and_blank_means_none(home, monkeypatch):
    assert A.endpoint() == SHIPPED_ENDPOINT  # the shipped schema endpoint is the live receiver
    assert A.valid_endpoint(SHIPPED_ENDPOINT) is None
    assert A.load_schema()["endpoint"] == SHIPPED_ENDPOINT
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", "  ")
    assert A.endpoint() == SHIPPED_ENDPOINT  # a blank override falls through to the schema
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", ENDPOINT)
    assert A.endpoint() == ENDPOINT
    monkeypatch.delenv("ATLAS_ANALYTICS_ENDPOINT")
    monkeypatch.setattr(
        A, "load_schema", lambda: {"endpoint": "https://schema.invalid/i"}
    )
    assert A.endpoint() == "https://schema.invalid/i"


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/x",
        "http://127.0.0.1.evil.com/x",
        "ftp://x/y",
        "file:///etc/passwd",
        "example.com",
    ],
)
def test_valid_endpoint_rejects_non_https_remote(url):
    assert A.valid_endpoint(url)


@pytest.mark.parametrize(
    "url", [ENDPOINT, "http://127.0.0.1:8080/x", "http://localhost/x"]
)
def test_valid_endpoint_accepts_https_and_localhost(url):
    assert A.valid_endpoint(url) is None


def test_send_auto_is_suppressed_under_pytest_with_shipped_endpoint(
    home, monkeypatch, capsys
):
    # Real guard: PYTEST_CURRENT_TEST is set by pytest and is not neutralised here.
    guard_on(monkeypatch)
    assert os.environ.get("PYTEST_CURRENT_TEST")
    assert A.endpoint() == SHIPPED_ENDPOINT
    on, why = A.state()
    assert on is False and "CI or test run" in why
    monkeypatch.setattr(A, "_post", lambda *a: pytest.fail("posted under pytest"))
    monkeypatch.setattr(
        urllib.request, "urlopen", lambda *a, **k: pytest.fail("opened a socket")
    )
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    capsys.readouterr()
    assert A.main(["send", "--auto"]) == 2
    assert A.main(["send"]) == 2
    assert not (home / "analytics" / "sent.jsonl").exists()


def test_send_with_no_endpoint_does_nothing_and_returns_cleanly(
    home, capsys, monkeypatch
):
    no_schema_endpoint(monkeypatch)
    monkeypatch.setattr(
        A, "_post", lambda *a: pytest.fail("posted without an endpoint")
    )
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    capsys.readouterr()
    assert A.main(["send"]) == 2
    assert "no endpoint" in capsys.readouterr().out
    assert A.main(["send", "--auto"]) == 2
    assert capsys.readouterr().out == ""
    assert not (home / "analytics" / "sent.jsonl").exists()
    assert events_text(home) != ""


def test_send_refuses_when_off(home, net, capsys):
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    disable("--keep")
    capsys.readouterr()
    assert A.main(["send"]) == 2
    assert "analytics is off" in capsys.readouterr().out
    assert net.posts == []


@pytest.mark.parametrize("url", ["http://example.com/x", "ftp://x/y", "example.com"])
def test_send_refuses_non_https_remote(home, monkeypatch, url):
    FakeNet(monkeypatch)
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", url)
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    assert A.main(["send", "--week", "2026-W44"]) == 2
    assert not (home / "analytics" / "sent.jsonl").exists()


def test_send_posts_exact_previewed_bytes_logs_first_then_truncates(home, net, capsys):
    write_events(
        home, [("2026-W44", "skill.atlas-setup", 3), ("2026-W44", "gate.d.block", 1)]
    )
    capsys.readouterr()
    A.main(["preview", "--week", "2026-W44"])
    previewed = json.loads(capsys.readouterr().out)
    assert A.main(["send", "--week", "2026-W44"]) == 0
    assert len(net.posts) == 1
    url, body, method, ctype = net.posts[0]
    assert (url, method, ctype) == (ENDPOINT, "POST", "application/json")
    sent = json.loads(body)
    assert (
        sent["counts"] == previewed["counts"]
        and sent["week"] == "2026-W44"
        and A._is_uuid4(sent["nonce"])
    )
    assert body == A.payload_json(sent)
    assert net.had_it == [True], "payload must be in sent.jsonl before the POST"
    assert (home / "analytics" / "sent.jsonl").read_text().splitlines() == [body]
    assert events_lines(home) == [("2026-W45", "delivery.ok.urllib")]  # delivery health, sent next time
    assert not json.loads(
        (home / "analytics" / "outbox.json").read_text()
    )  # the nonce entry is dropped too


def test_send_posts_every_finished_week_oldest_first_and_waits_for_current(
    home, net, capsys
):
    write_events(
        home,
        [
            ("2026-W45", "gate.a.block", 1),
            ("2026-W44", "gate.b.block", 1),
            ("2026-W43", "gate.c.block", 1),
        ],
    )
    assert A.main(["send"]) == 0
    posts = [json.loads(b) for _, b, _, _ in net.posts]
    assert [(p["week"], p["partial"]) for p in posts] == [
        ("2026-W43", False),
        ("2026-W44", False),
        ("2026-W45", True),  # the current week goes as a week-to-date snapshot, the same day
    ]
    assert posts[2]["counts"] == {"delivery.ok.urllib": 2, "gate.a.block": 1}
    assert {w for w, _ in events_lines(home)} == {"2026-W45"}  # a snapshot keeps its counts
    assert A.main(["send"]) == 0
    again = json.loads(net.posts[3][1])
    assert again["week"] == "2026-W45" and again["nonce"] == posts[2]["nonce"]  # same nonce: the server replaces it


def test_send_drops_weeks_older_than_retention_unsent(home, net):
    write_events(
        home,
        [
            ("2026-W30", "gate.a.block", 1),
            ("2026-W36", "gate.a.block", 1),
            ("2026-W44", "gate.b.block", 1),
        ],
    )
    assert A.main(["send", "--auto"]) == 0
    assert [json.loads(b)["week"] for _, b, _, _ in net.posts] == ["2026-W44", "2026-W45"]
    # W30 and W36 (more than 8 weeks old) were dropped, never sent late
    assert {w for w, _ in events_lines(home)} == {"2026-W45"}


def test_retention_keeps_exactly_eight_weeks(home, net):
    write_events(home, [("2026-W37", "gate.a.block", 1)])  # cutoff week: still sent
    assert A.main(["send", "--auto"]) == 0
    assert [json.loads(b)["week"] for _, b, _, _ in net.posts] == ["2026-W37", "2026-W45"]


def test_send_treats_409_as_already_delivered(home, monkeypatch, capsys):
    FakeNet(monkeypatch, statuses=[409])
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", ENDPOINT)
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    assert A.main(["send", "--week", "2026-W44"]) == 0
    assert {w for w, _ in events_lines(home)} == {"2026-W45"}  # only the delivery.ok counter is left
    assert "sent week 2026-W44" in capsys.readouterr().out


def test_send_failure_keeps_the_week_and_moves_on_to_later_weeks(home, monkeypatch):
    # One poison week must not block every later finished week or the current snapshot.
    fake = FakeNet(monkeypatch, statuses=[500])
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", ENDPOINT)
    write_events(
        home,
        [("2026-W43", "skill.atlas-setup", 1), ("2026-W44", "skill.atlas-setup", 1)],
    )
    assert A.main(["send"]) == 1
    sent = [(json.loads(b)["week"], json.loads(b)["partial"]) for _, b, _, _ in fake.posts]
    assert sent == [("2026-W43", False), ("2026-W44", False), ("2026-W45", True)]
    assert events_lines(home) == [
        ("2026-W43", "skill.atlas-setup"),  # the failed week is kept
        ("2026-W45", "delivery.fail.http5xx"),  # why it failed is counted and sent later
        ("2026-W45", "delivery.ok.urllib"),
    ]
    assert (
        home / "analytics" / "sent.jsonl"
    ).exists()  # the attempted payload stays logged
    assert A.main(["send"]) == 0  # the retry reuses the persisted nonce
    nonces = [json.loads(b)["nonce"] for _, b, _, _ in fake.posts]
    assert nonces[0] == nonces[3]
    assert {w for w, _ in events_lines(home)} == {"2026-W45"}


def test_send_network_error_keeps_events(home, monkeypatch):
    FakeNet(monkeypatch, statuses=[urllib.error.URLError("unreachable")])
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", ENDPOINT)
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    assert A.main(["send", "--week", "2026-W44"]) == 1
    assert events_text(home) != ""


def test_send_auto_prints_nothing_on_every_path(home, monkeypatch, capsys):
    fake = FakeNet(monkeypatch, statuses=[200, 500])
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", ENDPOINT)
    capsys.readouterr()
    assert A.main(["send", "--auto"]) == 0  # nothing pending
    write_events(
        home,
        [("2026-W43", "skill.atlas-setup", 1), ("2026-W44", "skill.atlas-setup", 1)],
    )
    assert A.main(["send", "--auto"]) == 1  # first week sent, second failed, snapshot still tried
    assert len(fake.posts) == 3
    assert capsys.readouterr().out == ""


def test_send_refuses_a_payload_that_fails_an_anonymity_check(
    home, net, monkeypatch, capsys
):
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    monkeypatch.setattr(
        A,
        "check_payload",
        lambda p, identities=None: [("no absolute paths", False, "match found")],
    )
    assert A.main(["send", "--week", "2026-W44"]) == 1
    assert "refused" in capsys.readouterr().out
    assert net.posts == [] and events_text(home) != ""


def test_send_week_without_counts_posts_nothing(home, net, capsys):
    assert A.main(["send", "--week", "2026-W44"]) == 0
    assert "nothing to send" in capsys.readouterr().out and net.posts == []


def test_post_uses_a_proxy_free_opener_for_localhost_only(home, monkeypatch):
    seen = []

    class _O:
        def open(self, req, timeout=None):
            seen.append("open")
            return _Resp(204)

    def build(*handlers):
        seen.append(any(isinstance(h, urllib.request.ProxyHandler) for h in handlers))
        return _O()

    monkeypatch.setattr(urllib.request, "build_opener", build)
    assert A._post(ENDPOINT, "{}") == (204, "urllib")
    assert A._post("http://127.0.0.1:9/x", "{}") == (204, "urllib")
    assert seen == [False, "open", True, "open"]



# --- background send ---------------------------------------------------------------------------------------------
@pytest.fixture
def bg(home, monkeypatch):
    """Everything needed for maybe_send_in_background() to fire; tests break one condition at a time."""
    popen = []

    class FakePopen:
        def __init__(self, argv, **kw):
            popen.append((argv, kw))

    import subprocess

    monkeypatch.setattr(subprocess, "Popen", FakePopen)
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", ENDPOINT)
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    enable()  # a decision counts as the notice having been shown
    return popen


def test_background_send_starts_a_detached_child(home, bg):
    assert A.maybe_send_in_background() is True
    argv, kw = bg[0]
    assert argv[0] == sys.executable and argv[-2:] == ["send", "--auto"]
    assert argv[1].endswith("atlas_analytics.py")
    assert kw["start_new_session"] is True and kw["close_fds"] is True
    import subprocess

    assert kw["stdin"] == kw["stdout"] == kw["stderr"] == subprocess.DEVNULL
    assert isinstance(
        json.loads((home / "analytics" / "last_send.json").read_text())["at"], float
    )


def test_background_send_waits_for_retry_interval(home, bg):
    assert A.maybe_send_in_background() is True
    assert A.maybe_send_in_background() is False  # just attempted
    import time

    (home / "analytics" / "last_send.json").write_text(
        json.dumps({"at": time.time() - A.SEND_RETRY_S - 5})
    )
    assert A.maybe_send_in_background() is True
    assert len(bg) == 2


def test_background_send_false_when_off(home, bg, monkeypatch):
    monkeypatch.setenv("DO_NOT_TRACK", "1")
    fresh()
    assert A.maybe_send_in_background() is False and bg == []


def test_background_send_false_without_endpoint(home, bg, monkeypatch):
    monkeypatch.delenv("ATLAS_ANALYTICS_ENDPOINT")
    no_schema_endpoint(monkeypatch)
    assert A.maybe_send_in_background() is False and bg == []
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", "http://example.com/x")  # not https
    assert A.maybe_send_in_background() is False and bg == []


def test_background_send_false_until_notice_shown(home, bg):
    (home / "analytics" / "consent.json").unlink()  # undecided again
    fresh()
    assert A.maybe_send_in_background() is False and bg == []
    assert (
        A.boot_notice() is not None
    )  # showing the notice unlocks sending from the next call
    assert A.maybe_send_in_background() is True


def test_background_send_false_with_nothing_counted(home, bg):
    (home / "analytics" / "events.jsonl").write_text("")
    assert A.maybe_send_in_background() is False and bg == []


def test_background_send_fires_for_the_current_week_alone(home, bg):
    """Before 17.19 nothing left the machine until the week ended: a new install showed nothing for days."""
    (home / "analytics" / "events.jsonl").write_text("")
    write_events(home, [("2026-W45", "skill.atlas-setup", 1)])  # current week only
    assert A.maybe_send_in_background() is True and len(bg) == 1


def test_background_send_never_raises(home, bg, monkeypatch):
    import subprocess

    def boom(*a, **k):
        raise OSError("no fork")

    monkeypatch.setattr(subprocess, "Popen", boom)
    assert A.maybe_send_in_background() is False


# --- cost ---------------------------------------------------------------------------------------------------------
def test_record_timing_reported(home, capsys):
    import time

    disable()
    N = 5000
    t = time.perf_counter()
    for _ in range(N):
        A.record("skill.atlas-setup")
    off = (time.perf_counter() - t) / N * 1e6
    enable()
    A.record("skill.atlas-setup")  # warm schema cache
    N2 = 1000
    t = time.perf_counter()
    for _ in range(N2):
        A.record("skill.atlas-setup")
    on = (time.perf_counter() - t) / N2 * 1e6
    with capsys.disabled():
        print(
            f"\n[analytics timing] record() disabled: {off:.2f} us/call, enabled: {on:.1f} us/call"
        )
    assert events_text(home) != ""
    assert (
        off < 500 and on < 20000
    )  # loose: flake-proof guard against pathological regressions only


# --- schema 3 client behaviours ---------------------------------------------------------------------------------
def _raiser(exc):
    def _f(*a, **k):
        raise exc

    return _f


def _opener_raising(monkeypatch, exc):
    """_post always sends through build_opener (no redirect handler); make its opener raise exc."""
    monkeypatch.setattr(
        urllib.request, "build_opener", lambda *a, **k: types.SimpleNamespace(open=_raiser(exc))
    )


@pytest.mark.parametrize(
    "exc",
    [
        ssl.SSLError("CERTIFICATE_VERIFY_FAILED"),
        urllib.error.URLError(ssl.SSLCertVerificationError("unable to get local issuer certificate")),
    ],
)
def test_post_falls_back_to_curl_on_ssl_failure(monkeypatch, exc):
    # python.org macOS builds ship no CA bundle: urllib fails every HTTPS send, curl uses the OS store.
    calls = []
    _opener_raising(monkeypatch, exc)
    monkeypatch.setattr(shutil, "which", lambda name: "/usr/bin/curl")

    def fake_run(cmd, **kw):
        calls.append((cmd, kw))
        return types.SimpleNamespace(stdout=b"204", returncode=0)

    monkeypatch.setattr(subprocess, "run", fake_run)
    assert A._post(ENDPOINT, '{"a":1}') == (204, "curl")
    assert calls[0][0][0] == "/usr/bin/curl" and calls[0][1]["input"] == b'{"a":1}'


def test_post_ssl_failure_without_curl_is_a_send_error(monkeypatch):
    _opener_raising(monkeypatch, ssl.SSLError("x"))
    monkeypatch.setattr(shutil, "which", lambda name: None)
    with pytest.raises(A.SendError) as ei:
        A._post(ENDPOINT, "{}")
    assert ei.value.kind == "ssl"


def test_post_returns_the_http_error_code(monkeypatch):
    err = urllib.error.HTTPError(ENDPOINT, 409, "x", {}, io.BytesIO(b""))
    _opener_raising(monkeypatch, err)
    assert A._post(ENDPOINT, "{}") == (409, "urllib")


@pytest.mark.parametrize(
    "exc,kind",
    [
        (urllib.error.URLError(socket.timeout()), "timeout"),
        (urllib.error.URLError(ConnectionRefusedError()), "network"),
    ],
)
def test_send_failure_is_counted_by_kind_and_keeps_the_week(home, net, exc, kind):
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    net.statuses[:] = [exc]
    assert A.main(["send", "--week", "2026-W44"]) == 1
    assert ("2026-W44", "skill.atlas-setup") in events_lines(home)  # nothing dropped
    assert ("2026-W45", "delivery.fail." + kind) in events_lines(home)
    assert json.loads((home / "analytics" / "last_send.json").read_text())["result"] == f"failed ({kind})"


def test_refused_anonymity_check_is_counted(home, net, monkeypatch):
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    monkeypatch.setattr(A, "check_payload", lambda p, ident=None: [("no paths", False, "x")])
    assert A.main(["send"]) == 1
    assert net.posts == []  # nothing left the machine
    assert ("2026-W45", "delivery.fail.refused") in events_lines(home)


@pytest.mark.parametrize("how", ["flag", "env"])
def test_send_test_marks_the_payload_test_true(home, net, monkeypatch, how):
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    if how == "env":
        monkeypatch.setenv("ATLAS_ANALYTICS_TEST", "1")
        assert A.main(["send"]) == 0
    else:
        assert A.main(["send", "--test"]) == 0
    sent = [json.loads(b) for _, b, _, _ in net.posts]
    assert sent and all(p["test"] is True for p in sent)
    assert all(ok for _, ok, _ in A.check_payload(sent[0], []))  # prove accepts a test payload
    monkeypatch.delenv("ATLAS_ANALYTICS_TEST", raising=False)
    assert "test" not in A.build_payload("2026-W44")  # off unless asked


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p.update(extra=1),
        lambda p: p.update(partial="yes"),
        lambda p: p.update(partial=1),  # 1 == True, but not a bool
        lambda p: p.update(test=False),
    ],
)
def test_check_payload_rejects_bad_envelope_fields(home, mutate):
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    p = A.build_payload("2026-W44")
    assert p["partial"] is False  # a finished week is final; schema 3 carries the flag
    assert all(ok for _, ok, _ in A.check_payload(p, []))
    mutate(p)
    res = A.check_payload(p, [])
    assert len(res) == 1 and res[0][1] is False


def _mod_file(home, name, doc, age_s):
    d = home / "analytics" / "mod"
    d.mkdir(parents=True, exist_ok=True)
    f = d / name
    f.write_text(doc if isinstance(doc, str) else json.dumps(doc))
    t = time.time() - age_s
    os.utime(f, (t, t))
    return f


def test_fold_mod_usage_folds_old_files_and_skips_fresh_ones(home):
    old = _mod_file(home, "a.json", {"v": 1, "counts": {
        "mod.open.dock": 3,
        "mod.bogus.key": 5,  # not allowlisted
        "skill.atlas-setup": 9,  # not a mod.* key
    }}, 3600)
    fresh_f = _mod_file(home, "b.json", {"v": 1, "counts": {"mod.open.dock": 7}}, 0)
    assert A.fold_mod_usage() == 1
    assert not old.exists() and fresh_f.exists()  # a live session may still rewrite its file
    assert A.build_payload("2026-W45")["counts"] == {"mod.open.dock": 3}


def test_fold_mod_usage_survives_a_corrupt_file(home):
    bad = _mod_file(home, "bad.json", "{not json", 3600)
    good = _mod_file(home, "good.json", {"v": 1, "counts": {"mod.open.dock": 1}}, 3600)
    assert A.fold_mod_usage() >= 1
    assert not good.exists() and A.build_payload("2026-W45")["counts"] == {"mod.open.dock": 1}
    assert not bad.exists()  # a broken file must not be retried forever


def test_fold_mod_usage_deletes_without_counting_when_disabled(home):
    f = _mod_file(home, "a.json", {"v": 1, "counts": {"mod.open.dock": 3}}, 3600)
    disable()
    assert A.fold_mod_usage() == 1 and not f.exists()
    assert events_lines(home) == []


def test_session_start_records_active_day_and_folds_mod_usage(home):
    f = _mod_file(home, "a.json", {"v": 1, "counts": {"mod.open.dock": 2}}, 3600)
    A.on_session_start({})
    assert not f.exists()
    c = A.build_payload("2026-W45")["counts"]
    assert c["active.day.tue"] == 1 and c["mod.open.dock"] == 2  # NOW is a Tuesday


def test_status_shows_the_last_send_result(home, net, capsys):
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    assert A.main(["send"]) == 0
    capsys.readouterr()
    assert A.main(["status"]) == 0
    out = capsys.readouterr().out
    assert "last send:" in out and "ok (HTTP 200" in out and "via urllib" in out


def test_allowed_keys_merge_keeps_old_keys_and_drops_malformed(home, tmp_path, capsys):
    prior = tmp_path / "prior.json"
    prior.write_text(json.dumps({"keys": ["skill.retired-skill", "bad key!", 7, "../x"]}))
    assert A.main(["allowed-keys", "--merge", str(prior)]) == 0
    doc = json.loads(capsys.readouterr().out)
    assert "skill.retired-skill" in doc["keys"]  # older installs still send it
    assert not {"bad key!", 7, "../x"} & set(doc["keys"])
    assert "skill.atlas-setup" in doc["keys"] and doc["schemas"] == [2, 3]
    assert A.main(["allowed-keys", "--merge", str(tmp_path / "missing.json")]) == 0  # no file: just the current keys


def test_sent_log_is_trimmed_to_its_newest_200_lines(home, monkeypatch):
    monkeypatch.setattr(A, "SENT_LOG_MAX", 2000)
    for i in range(300):
        A._log_sent(json.dumps({"i": i, "pad": "x" * 20}))
    lines = (home / "analytics" / "sent.jsonl").read_text().splitlines()
    assert len(lines) <= 200 and json.loads(lines[-1])["i"] == 299
    assert json.loads(lines[0])["i"] >= 100  # oldest lines went first


# --- client review fixes: UTC weeks, locking, concurrent appends, redirects, versions, vocab, mod deltas -----------------
import http.server  # noqa: E402
import multiprocessing  # noqa: E402
import threading  # noqa: E402

import atlas_analytics_hot as H  # noqa: E402

_FORK = multiprocessing.get_context("fork")


def _fake_clock(monkeypatch, modules):
    """Instant = Sun 2026-11-08 23:00 UTC = Mon 2026-11-09 in UTC+13: local date W46, UTC date W45."""
    inst = datetime.datetime(2026, 11, 8, 23, 0, tzinfo=datetime.timezone.utc)

    class FakeDT(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is not None:
                return inst.astimezone(tz)
            return inst.astimezone(datetime.timezone(datetime.timedelta(hours=13))).replace(tzinfo=None)

    class FakeDate(datetime.date):
        @classmethod
        def today(cls):
            return datetime.date(2026, 11, 9)

    for mod, attrs in modules:
        for name, val in attrs(FakeDT, FakeDate).items():
            monkeypatch.setattr(mod, name, val, raising=False)


def test_week_comes_from_the_utc_date_not_the_local_date(home, monkeypatch):
    real_now = _REAL_NOW
    ns = lambda dt, d: {"_dt": types.SimpleNamespace(date=d, datetime=dt, timezone=datetime.timezone, timedelta=datetime.timedelta)}  # noqa: E731
    _fake_clock(monkeypatch, [(A, ns), (H, lambda dt, d: {"datetime": dt, "date": d})])
    monkeypatch.setattr(A, "_now", real_now)
    assert A._week_of(A._now()) == "2026-W45"  # the server rejects W46 as "in the future"
    monkeypatch.setenv("ATLAS_ANALYTICS", "on")
    A._reset()
    A.record("gate.pass")
    H.record(["gate.pass"])
    assert {e["w"] for e in A.read_events()} == {"2026-W45"}


def _nonce_worker(barrier, weeks, q):
    out = []
    for w in weeks:
        barrier.wait()
        out.append(A.nonce_for(w, persist=True))
    q.put(out)


def test_four_processes_settle_on_one_nonce_per_week(home):
    weeks = [f"2026-W{n:02d}" for n in range(1, 41)]
    barrier, q = _FORK.Barrier(4), _FORK.Queue()
    procs = [_FORK.Process(target=_nonce_worker, args=(barrier, weeks, q)) for _ in range(4)]
    for p in procs:
        p.start()
    results = [q.get(timeout=60) for _ in procs]
    for p in procs:
        p.join(10)
    split = [w for i, w in enumerate(weeks) if len({r[i] for r in results}) != 1]
    assert split == []
    assert json.loads((home / "analytics" / "outbox.json").read_text()).keys() == set(weeks)


def test_nonce_and_gate_still_work_when_no_lock_module_imports(home, monkeypatch):
    monkeypatch.setattr(A, "_fcntl", None)
    monkeypatch.setattr(A, "_msvcrt", None)
    n = A.nonce_for("2026-W44", persist=True)
    assert A.nonce_for("2026-W44", persist=True) == n


def _gate_worker(barrier, trials, marker_dir, q):
    import subprocess as sp

    sp.Popen = lambda *a, **k: open(os.path.join(marker_dir, f"{os.getpid()}-{time.time_ns()}"), "w").close()
    out = []
    for _ in range(trials):
        barrier.wait()
        out.append(A.maybe_send_in_background())
        barrier.wait()
    q.put(out)


def test_background_send_gate_starts_one_send_across_processes(home, monkeypatch, tmp_path):
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", ENDPOINT)
    enable()
    A.record("skill.atlas-setup")
    stamp = home / "analytics" / "last_send.json"
    marks = tmp_path / "marks"
    marks.mkdir()
    trials = 30
    barrier, q = _FORK.Barrier(5), _FORK.Queue()  # 4 workers + this test stepping the trials
    procs = [_FORK.Process(target=_gate_worker, args=(barrier, trials, str(marks), q)) for _ in range(4)]
    for p in procs:
        p.start()
    for _ in range(trials):
        stamp.unlink(missing_ok=True)
        barrier.wait()
        barrier.wait()
    results = [q.get(timeout=60) for _ in procs]
    for p in procs:
        p.join(10)
    per_trial = [sum(r[t] for r in results) for t in range(trials)]
    assert per_trial == [1] * trials
    assert len(list(marks.iterdir())) == trials


@pytest.mark.parametrize("op", ["compact", "drop_week"])
def test_lines_a_hook_appends_during_a_rewrite_are_kept(home, monkeypatch, op):
    # Hooks append by path. Inject an append at the worst moment: after the old file has been read and just
    # before it is swapped out (old code), or right after it was renamed away (new code).
    monkeypatch.setenv("ATLAS_ANALYTICS", "on")
    write_events(home, [("2026-W44", "skill.atlas-setup", 1), ("2026-W45", "gate.pass", 2)])
    real_replace, real_rename = os.replace, os.rename

    def inject():
        H.record(["session.claude"])

    def replace(src, dst, *a, **k):
        if str(dst).endswith("events.jsonl"):
            inject()
        return real_replace(src, dst, *a, **k)

    def rename(src, dst, *a, **k):
        r = real_rename(src, dst, *a, **k)
        if str(src).endswith("events.jsonl"):
            inject()
        return r

    monkeypatch.setattr(os, "replace", replace)
    monkeypatch.setattr(os, "rename", rename)
    if op == "compact":
        assert A.compact(force=True)
        assert ("2026-W44", "skill.atlas-setup") in events_lines(home)
    else:
        A._drop_week("2026-W44")
        assert ("2026-W44", "skill.atlas-setup") not in events_lines(home)
    assert [k for _, k in events_lines(home)].count("session.claude") == 1
    assert ("2026-W45", "gate.pass") in events_lines(home)
    assert not list((home / "analytics").glob("events.*.side"))


class _Redirector(http.server.BaseHTTPRequestHandler):
    hits: list = []

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/ingest":
            self.send_response(302)
            self.send_header("Location", "/final")
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            type(self).hits.append(self.path)
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

    do_GET = do_POST

    def log_message(self, *a):
        pass


@pytest.fixture
def redirector():
    _Redirector.hits = []
    srv = http.server.HTTPServer(("127.0.0.1", 0), _Redirector)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_port}/ingest"
    srv.shutdown()
    srv.server_close()


def test_a_redirect_is_a_failed_send_and_is_never_followed(home, monkeypatch, redirector):
    assert A._post(redirector, "{}") == (302, "urllib")
    assert _Redirector.hits == []
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", redirector)
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    assert A.main(["send", "--week", "2026-W44"]) == 1
    assert ("2026-W44", "skill.atlas-setup") in events_lines(home)  # the week is kept, not dropped
    assert ("2026-W45", "delivery.fail.other") in events_lines(home)
    assert _Redirector.hits == []


def test_curl_fallback_never_follows_redirects_and_a_3xx_is_a_failure(home, monkeypatch):
    calls = []
    _opener_raising(monkeypatch, ssl.SSLError("CERTIFICATE_VERIFY_FAILED"))
    monkeypatch.setattr(shutil, "which", lambda name: "/usr/bin/curl")
    monkeypatch.setattr(
        subprocess, "run", lambda cmd, **kw: calls.append(cmd) or types.SimpleNamespace(stdout=b"301", returncode=0)
    )
    assert A._post(ENDPOINT, "{}") == (301, "curl")
    assert "-L" not in calls[0] and "--location" not in calls[0]
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", ENDPOINT)
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    assert A.main(["send", "--week", "2026-W44"]) == 1
    assert ("2026-W44", "skill.atlas-setup") in events_lines(home)
    assert ("2026-W45", "delivery.fail.other") in events_lines(home)


@pytest.mark.parametrize(
    "version,expected",
    [("17.19.0", "17.19.0"), ("17.19.0-rc.1", "17.19.0"), ("17.19.0+build5", "17.19.0"), ("v17", "unknown"), ("", "unknown")],
)
def test_atlas_version_sends_the_core_of_a_prerelease(tmp_path, monkeypatch, version, expected):
    (tmp_path / ".claude-plugin").mkdir()
    (tmp_path / ".claude-plugin" / "plugin.json").write_text(json.dumps({"version": version}))
    monkeypatch.setattr(A, "PLUGIN_ROOT", tmp_path)
    assert A.atlas_version() == expected


def test_atlas_version_unknown_when_no_manifest(tmp_path, monkeypatch):
    monkeypatch.setattr(A, "PLUGIN_ROOT", tmp_path)
    assert A.atlas_version() == "unknown"


def test_atlas_analytics_disable_is_an_opt_out_for_client_and_hot_path(home, monkeypatch):
    monkeypatch.setenv("ATLAS_ANALYTICS", "disable")
    A._reset()
    assert A.state()[0] is False and H.enabled() is False
    A.record("gate.pass")
    H.record(["gate.pass"])
    assert events_text(home) == ""
    assert "disable" in A.OFF_VALUES and "disable" in H.OFF_VALUES


@pytest.mark.parametrize("base", ["linux", "lin", "true", "abc"])
def test_short_or_schema_word_directory_names_do_not_block_sending(home, monkeypatch, tmp_path, base):
    p = _good_payload(home)
    p["os"] = "linux"
    assert "no username, hostname, home dir, cwd, repo identifiers" not in _failed(
        A.check_payload(p, identities=[("cwd basename", base)])
    )
    d = tmp_path / base
    d.mkdir()
    monkeypatch.chdir(d)
    assert "no username, hostname, home dir, cwd, repo identifiers" not in _failed(
        A.check_payload(p, identities=[i for i in A.gather_identities() if i[0] == "cwd basename"])
    )


def test_a_long_unique_directory_name_planted_in_a_value_is_still_refused(home):
    p = _good_payload(home)
    p["os"] = "acme-billing"
    ids = [("cwd basename", "acme-billing")]
    assert "no username, hostname, home dir, cwd, repo identifiers" in _failed(A.check_payload(p, identities=ids))


def test_a_short_basename_that_is_not_schema_text_is_skipped_but_other_identities_still_count(home):
    p = _good_payload(home)
    p["os"] = "alice"
    ids = [("cwd basename", "alice"), ("username", "alice")]
    assert "no username, hostname, home dir, cwd, repo identifiers" in _failed(A.check_payload(p, identities=ids))


def _delta(home, name, counts, age_s=0, v=2):
    return _mod_file(home, name, {"v": v, "counts": counts}, age_s)


def test_fold_v2_delta_files_at_any_age_and_ignore_tmp_and_foreign_keys(home):
    a = _delta(home, "s1-1-aaaa.json", {"mod.open.dock": 2, "skill.atlas-setup": 9, "mod.bogus.x": 4})
    b = _delta(home, "s1-2-bbbb.json", {"mod.open.dock": 3})
    tmp = _mod_file(home, "s1-3-cccc.json.tmp", {"v": 2, "counts": {"mod.open.dock": 100}}, 7200)
    assert A.fold_mod_usage() == 2
    assert not a.exists() and not b.exists() and tmp.exists()
    assert A.build_payload("2026-W45")["counts"] == {"mod.open.dock": 5}


def test_fold_v1_cumulative_files_only_once_the_session_is_quiet(home):
    fresh_v1 = _delta(home, "live.json", {"mod.open.dock": 7}, 0, v=1)
    old_v1 = _delta(home, "done.json", {"mod.open.dock": 3}, 3600, v=1)
    v2 = _delta(home, "s9-1-zzzz.json", {"mod.open.dock": 1})
    assert A.fold_mod_usage() == 2
    assert fresh_v1.exists() and not old_v1.exists() and not v2.exists()
    assert A.build_payload("2026-W45")["counts"] == {"mod.open.dock": 4}


def test_fold_records_the_counts_before_it_deletes_the_file(home, monkeypatch):
    f = _delta(home, "s1-1-aaaa.json", {"mod.open.dock": 2})
    seen = []
    real = A.record
    monkeypatch.setattr(A, "record", lambda k, n=1: seen.append(f.exists()) or real(k, n))
    assert A.fold_mod_usage() == 1
    assert seen == [True] and not f.exists()


def test_fold_deletes_v2_deltas_uncounted_when_analytics_is_off(home):
    f = _delta(home, "s1-1-aaaa.json", {"mod.open.dock": 2})
    disable()
    assert A.fold_mod_usage() == 1 and not f.exists()
    assert events_lines(home) == []


def test_snapshot_timing_wording_says_session_start_not_while_atlas_runs(home, capsys):
    notice = A.notice_text()
    assert "at session start, at most once an hour" in notice and "while Atlas runs" not in notice
    assert "at session start, at most once an hour" in " ".join(A.__doc__.split())
    assert "while Atlas runs" not in A.__doc__
    A.main(["explain"])
    assert "while Atlas runs" not in capsys.readouterr().out
