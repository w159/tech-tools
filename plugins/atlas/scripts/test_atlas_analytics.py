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
import string
import sys
import urllib.error
import urllib.request
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_analytics as A  # noqa: E402

PLUGIN = A.PLUGIN_ROOT
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


def enable():
    assert A.main(["enable"]) == 0
    fresh()


def disable(*extra):
    assert A.main(["disable", *extra]) == 0
    fresh()


def events_text(h):
    p = h / "analytics" / "events.jsonl"
    return p.read_text() if p.exists() else ""


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
    }
    assert p["schema"] == 2 == A.SCHEMA_VERSION


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
    monkeypatch.setattr(A, "build_payload", lambda week=None, persist_nonce=False: p)
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
        doc["schema"] == 2
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
    assert A.build_payload()["counts"] == {"session.omp": 2}


def test_on_session_start_compacts_and_tries_background_send_only_when_on(
    home, monkeypatch
):
    calls = []
    monkeypatch.setattr(A, "maybe_send_in_background", lambda: calls.append("send"))
    monkeypatch.setattr(A, "compact", lambda force=False: calls.append("compact"))
    A.on_session_start({"turn_id": "x"})
    assert calls == ["compact", "send"]
    assert A.build_payload()["counts"] == {"session.codex": 1}
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
    assert c == {"enabled": True, "decided": "2026-11-03", "schema": 2}
    assert A.is_decided() and A.state() == (True, "turned on with `enable`")
    disable()
    c = json.loads((home / "analytics" / "consent.json").read_text())
    assert c["enabled"] is False and c["decided"] == "2026-11-03" and c["schema"] == 2
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


def test_status_explain_and_preview_run(home, capsys):
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
    assert json.loads((home / "analytics" / "notice.json").read_text())["schema"] == 2
    monkeypatch.setattr(A, "SCHEMA_VERSION", 3)
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
    assert A.endpoint() is None  # the shipped schema endpoint is empty
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", "  ")
    assert A.endpoint() is None
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


def test_send_with_no_endpoint_does_nothing_and_returns_cleanly(
    home, capsys, monkeypatch
):
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
    assert events_text(home) == ""
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
    assert [json.loads(b)["week"] for _, b, _, _ in net.posts] == [
        "2026-W43",
        "2026-W44",
    ]
    assert [json.loads(ln)["w"] for ln in events_text(home).splitlines()] == [
        "2026-W45"
    ]
    capsys.readouterr()
    assert A.main(["send"]) == 0
    assert "in progress" in capsys.readouterr().out and len(net.posts) == 2


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
    assert [json.loads(b)["week"] for _, b, _, _ in net.posts] == ["2026-W44"]
    assert (
        events_text(home) == ""
    )  # W30 and W36 (more than 8 weeks old) were dropped, never sent late


def test_retention_keeps_exactly_eight_weeks(home, net):
    write_events(home, [("2026-W37", "gate.a.block", 1)])  # cutoff week: still sent
    assert A.main(["send", "--auto"]) == 0
    assert [json.loads(b)["week"] for _, b, _, _ in net.posts] == ["2026-W37"]


def test_send_treats_409_as_already_delivered(home, monkeypatch, capsys):
    FakeNet(monkeypatch, statuses=[409])
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", ENDPOINT)
    write_events(home, [("2026-W44", "skill.atlas-setup", 1)])
    assert A.main(["send", "--week", "2026-W44"]) == 0
    assert events_text(home) == ""
    assert "sent week 2026-W44" in capsys.readouterr().out


def test_send_failure_keeps_events_and_stops_at_first_failed_week(home, monkeypatch):
    fake = FakeNet(monkeypatch, statuses=[500])
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", ENDPOINT)
    write_events(
        home,
        [("2026-W43", "skill.atlas-setup", 1), ("2026-W44", "skill.atlas-setup", 1)],
    )
    assert A.main(["send"]) == 1
    assert len(fake.posts) == 1  # the later week waits for the next attempt
    assert len(events_text(home).splitlines()) == 2
    assert (
        home / "analytics" / "sent.jsonl"
    ).exists()  # the attempted payload stays logged
    fake.statuses[:] = [200, 200]
    assert A.main(["send"]) == 0  # the retry reuses the persisted nonce
    nonces = [json.loads(b)["nonce"] for _, b, _, _ in fake.posts]
    assert nonces[0] == nonces[1] and events_text(home) == ""


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
    assert A.main(["send", "--auto"]) == 1  # first week sent, second failed
    assert len(fake.posts) == 2
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


def test_post_uses_a_direct_opener_for_localhost_and_urlopen_otherwise(
    home, monkeypatch
):
    seen = []
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda req, timeout=None: seen.append("urlopen") or _Resp(200),
    )

    class _O:
        def open(self, req, timeout=None):
            seen.append("opener")
            return _Resp(204)

    monkeypatch.setattr(urllib.request, "build_opener", lambda *a: _O())
    assert A._post(ENDPOINT, "{}") == 200
    assert A._post("http://127.0.0.1:9/x", "{}") == 204
    assert seen == ["urlopen", "opener"]


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


def test_background_send_false_without_a_finished_week(home, bg):
    (home / "analytics" / "events.jsonl").write_text("")
    write_events(home, [("2026-W45", "skill.atlas-setup", 1)])  # current week only
    assert A.maybe_send_in_background() is False and bg == []


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
