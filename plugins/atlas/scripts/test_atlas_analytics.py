"""Tests for atlas_analytics: opt-in, local-first, provably anonymous counters.

Every test runs against a throwaway ATLAS_HOME; the real ~/.atlas is never touched and the only
network traffic is to a local http.server on 127.0.0.1.
"""

from __future__ import annotations

import _test_isolation  # noqa: F401  (must be first: redirects ATLAS_HOME)

import copy
import http.server
import json
import os
import random
import string
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_analytics as A  # noqa: E402

PLUGIN = A.PLUGIN_ROOT
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
]


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_HOME", str(tmp_path / "ah"))
    monkeypatch.delenv("ATLAS_ANALYTICS", raising=False)
    monkeypatch.delenv("ATLAS_ANALYTICS_ENDPOINT", raising=False)
    monkeypatch.setattr(
        A, "_now", lambda: __import__("datetime").date(2026, 11, 3)
    )  # ISO 2026-W45
    A._reset()
    yield tmp_path / "ah"
    A._reset()


def enable(endpoint=None):
    assert A.main(["enable"] + (["--endpoint", endpoint] if endpoint else [])) == 0
    A._reset()


def events_text(h):
    p = h / "analytics" / "events.jsonl"
    return p.read_text() if p.exists() else ""


# --- off by default ---------------------------------------------------------------------------------
def test_undecided_records_nothing_and_preview_is_empty(home):
    for k in VALID:
        A.record(k)
    assert not (home / "analytics").exists()
    assert A.build_payload()["counts"] == {}
    assert not A.is_enabled() and not A.is_decided()


def test_disabled_after_decision_records_nothing(home):
    enable()
    A.main(["disable"])
    A.record("skill.atlas-setup")
    assert events_text(home) == ""


def test_env_off_forces_disabled_and_silences_notice(home, monkeypatch):
    enable()
    monkeypatch.setenv("ATLAS_ANALYTICS", "off")
    A._reset()
    A.record("skill.atlas-setup")
    assert events_text(home) == ""
    A.main(["delete"])
    assert A.boot_notice() is None
    assert A.main(["send"]) == 2


# --- recording and aggregation ------------------------------------------------------------------------
def test_enable_records_and_aggregates_per_week(home, monkeypatch):
    enable()
    A.record("skill.atlas-setup")
    A.record("skill.atlas-setup", 4)
    A.record("gate.a.block")
    monkeypatch.setattr(
        A, "_now", lambda: __import__("datetime").date(2026, 11, 10)
    )  # W46
    A.record("skill.atlas-setup")
    assert A.build_payload("2026-W45")["counts"] == {
        "gate.a.block": 1,
        "skill.atlas-setup": 5,
    }
    assert A.build_payload("2026-W46")["counts"] == {"skill.atlas-setup": 1}
    assert A.pending_week() == "2026-W45"  # oldest finished week first


def test_counts_clamped_and_bad_n_dropped(home):
    enable()
    A.record("skill.atlas-setup", 10**9)
    A.record("skill.atlas-setup", -3)
    A.record("skill.atlas-setup", 0)
    A.record("skill.atlas-setup", True)  # bool is not a count
    A.record("skill.atlas-setup", "5")  # type: ignore[arg-type]
    A.record("skill.atlas-setup", 2.5)  # type: ignore[arg-type]
    assert A.build_payload()["counts"] == {"skill.atlas-setup": 10000}


def test_record_never_raises(home, monkeypatch):
    enable()
    for bad in (None, 5, b"x", ["a"], object()):
        A.record(bad)  # type: ignore[arg-type]
    monkeypatch.setenv("ATLAS_HOME", "/proc/nonexistent/x")
    A.record("skill.atlas-setup")


# --- anonymity: validation at record AND build -----------------------------------------------------------
def _leaky_keys():
    import getpass
    import socket

    user = getpass.getuser() or "someuser"
    host = socket.gethostname() or "somehost"
    return [
        f"skill.{user}",
        f"skill.my-private-skill",
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
        "",
    ]


def test_unknown_and_leaky_keys_dropped_at_record(home):
    enable()
    for k in _leaky_keys():
        A.record(k)
    assert events_text(home) == ""
    A.record("skill.atlas-setup")
    assert A.build_payload()["counts"] == {"skill.atlas-setup": 1}


def test_unknown_keys_dropped_at_build_even_if_written_to_disk(home):
    enable()
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
    enable()
    user_skill = tmp_path / "proj" / ".claude" / "skills" / "acme-secret-skill"
    user_skill.mkdir(parents=True)
    (user_skill / "SKILL.md").write_text("---\nname: acme-secret-skill\n---\n")
    monkeypatch.chdir(tmp_path / "proj")
    A._reset()
    A.record("skill.acme-secret-skill")
    A.record("skill.proj")
    assert events_text(home) == ""


def test_fuzz_payload_only_schema_keys(home):
    enable()
    rnd = random.Random(1234)
    alphabet = string.ascii_letters + string.digits + "./-_:@ \\\n"
    for i in range(500):
        junk = "".join(rnd.choice(alphabet) for _ in range(rnd.randint(1, 60)))
        A.record(junk)
        A.record(
            rnd.choice(["skill.", "hook.", "git.", "agent.", "team.", "gate."]) + junk
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


# --- prove ---------------------------------------------------------------------------------------------
def test_prove_passes_on_real_payload_with_real_identities(home):
    enable()
    for k in VALID:
        A.record(k, 2)
    payload = A.build_payload()
    res = A.check_payload(payload)  # real username, hostname, cwd, git remote
    assert all(r[1] for r in res), [r for r in res if not r[1]]
    assert A.main(["prove"]) == 0


def _good_payload(home):
    enable()
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
            lambda p: p.update({"harness": "alice"}),
            "envelope values come from closed sets",
        ),
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
        (
            {"harness": "alice"},
            "no username, hostname, home dir, cwd, repo identifiers",
        ),
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


def test_prove_exit_code_is_nonzero_when_a_check_fails(home, monkeypatch):
    enable()
    A.record("skill.atlas-setup")
    monkeypatch.setattr(
        A, "check_payload", lambda p, identities=None: [("x", False, "planted")]
    )
    assert A.main(["prove"]) == 1


def test_gathered_identities_include_user_host_home_cwd(home):
    labels = {lab for lab, _ in A.gather_identities()}
    assert {"home dir", "cwd"} <= labels


# --- schema ----------------------------------------------------------------------------------------------
def test_every_family_has_purpose_and_patterns():
    sch = A.load_schema()
    assert sch["families"]
    for name, fam in sch["families"].items():
        assert len(fam["purpose"].strip()) > 40, name
        assert fam["patterns"], name
        for pat in fam["patterns"]:
            import re

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
        if f.name.startswith("test_") or f.stem in ("testenv", "conftest"):
            continue
        for dec in ("deny", "ask", "context", "fault"):
            assert A.valid_key(f"hook.{f.stem}.{dec}"), f.name
        assert A.valid_key(f"hook.{f.stem}.deny.protected")


def test_schema_covers_scope_matrix_and_gate_letters():
    sm = json.loads((PLUGIN / "contracts" / "scope-matrix.json").read_text())["classes"]
    for cls, efforts in sm.items():
        for eff in efforts:
            assert A.valid_key(f"team.{cls}.{eff}"), (cls, eff)
    for size in ("1", "2", "3-4", "5-8", "9+"):
        assert A.valid_key(f"team.size.{size}")
    for letter in string.ascii_lowercase:
        assert A.valid_key(f"gate.{letter}.block")


# --- lifecycle ---------------------------------------------------------------------------------------------
def test_disable_deletes_events_unless_keep(home):
    enable()
    A.record("skill.atlas-setup")
    A.main(["disable", "--keep"])
    assert events_text(home)
    enable()
    A.main(["disable"])
    assert events_text(home) == ""
    assert (
        json.loads((home / "analytics" / "consent.json").read_text())["enabled"]
        is False
    )


def test_delete_removes_directory(home):
    enable()
    A.record("skill.atlas-setup")
    assert (home / "analytics").exists()
    assert A.main(["delete"]) == 0
    assert not (home / "analytics").exists()
    assert not A.is_enabled()


def test_consent_file_shape(home):
    enable("http://127.0.0.1:9/x")
    c = json.loads((home / "analytics" / "consent.json").read_text())
    assert (
        c["enabled"] is True
        and c["schema"] == 1
        and c["endpoint"] == "http://127.0.0.1:9/x"
    )
    assert c["decided"] == "2026-11-03"


def test_export_writes_exact_preview(home, tmp_path, capsys):
    enable()
    A.record("skill.atlas-setup")
    capsys.readouterr()
    A.main(["preview"])
    prev = capsys.readouterr().out
    out = tmp_path / "p.json"
    A.main(["export", "--out", str(out)])
    assert out.read_text() == prev


# --- send ----------------------------------------------------------------------------------------------------
class _Sink:
    def __init__(self, sent_path, status=200):
        self.bodies, self.sent_had_it, self.status = [], [], status
        outer = self

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                outer.bodies.append(body)
                try:
                    outer.sent_had_it.append(
                        body.decode() in Path(sent_path).read_text()
                    )
                except Exception:
                    outer.sent_had_it.append(False)
                self.send_response(outer.status)
                self.end_headers()

            def log_message(self, *a):
                pass

        self.srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.srv.server_port}/ingest"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()


def test_send_refuses_without_endpoint(home, capsys):
    enable()
    A.record("skill.atlas-setup")
    assert A.main(["send", "--week", "2026-W45"]) == 2
    assert "no endpoint" in capsys.readouterr().out
    assert not (home / "analytics" / "sent.jsonl").exists()


def test_send_refuses_when_not_enabled(home, monkeypatch):
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", "https://example.invalid/x")
    assert A.main(["send"]) == 2


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
def test_send_and_enable_refuse_non_https_remote(home, url, monkeypatch, capsys):
    assert A.valid_endpoint(url)
    assert A.main(["enable", "--endpoint", url]) == 2
    enable()
    A.record("skill.atlas-setup")
    monkeypatch.setenv("ATLAS_ANALYTICS_ENDPOINT", url)
    assert A.main(["send", "--week", "2026-W45"]) == 2
    assert not (home / "analytics" / "sent.jsonl").exists()


def test_send_posts_exact_previewed_bytes_logs_first_then_truncates(home, capsys):
    sink = _Sink(home / "analytics" / "sent.jsonl")
    try:
        enable(sink.url)
        A.record("skill.atlas-setup", 3)
        A.record("gate.d.block")
        capsys.readouterr()
        A.main(["preview", "--week", "2026-W45"])
        previewed = capsys.readouterr().out.strip()
        assert A.main(["send", "--week", "2026-W45"]) == 0
    finally:
        sink.close()
    assert [b.decode() for b in sink.bodies] == [previewed]
    assert sink.sent_had_it == [True], "payload must be in sent.jsonl before the POST"
    assert (home / "analytics" / "sent.jsonl").read_text().splitlines() == [previewed]
    assert events_text(home) == ""  # sent week truncated


def test_send_keeps_other_weeks_and_waits_for_week_end(home, monkeypatch, capsys):
    sink = _Sink(home / "analytics" / "sent.jsonl")
    try:
        enable(sink.url)
        A.record("skill.atlas-setup")  # W45 (current)
        assert A.main(["send"]) == 0  # current week still running
        assert "in progress" in capsys.readouterr().out and not sink.bodies
        monkeypatch.setattr(
            A, "_now", lambda: __import__("datetime").date(2026, 11, 10)
        )
        A.record("gate.b.block")  # W46
        assert A.main(["send"]) == 0  # sends W45 only
    finally:
        sink.close()
    assert json.loads(sink.bodies[0])["week"] == "2026-W45"
    left = [json.loads(x) for x in events_text(home).splitlines()]
    assert [e["w"] for e in left] == ["2026-W46"]


def test_send_failure_keeps_events(home):
    sink = _Sink(home / "analytics" / "sent.jsonl", status=500)
    try:
        enable(sink.url)
        A.record("skill.atlas-setup")
        assert A.main(["send", "--week", "2026-W45"]) == 1
    finally:
        sink.close()
    assert events_text(home) != ""


# --- disclosure ----------------------------------------------------------------------------------------------
def test_boot_notice_once_per_version_and_never_after_decision(home, monkeypatch):
    n = A.boot_notice()
    assert (
        n
        and "OFF" in n
        and "preview" in n
        and "enable" in n
        and "explain" in n
        and "atlas_analytics.py" in n
    )
    assert A.boot_notice() is None
    monkeypatch.setattr(A, "atlas_version", lambda: "99.0.0")
    assert A.boot_notice() is not None  # new version shows again
    assert A.boot_notice() is None
    enable()
    monkeypatch.setattr(A, "atlas_version", lambda: "100.0.0")
    assert A.boot_notice() is None
    A.main(["disable"])
    assert A.boot_notice() is None  # a decision either way ends the notice


def test_status_and_explain_run(home, capsys):
    assert A.main(["status"]) == 0
    out = capsys.readouterr().out
    assert "OFF (undecided)" in out and "none configured" in out
    assert A.main(["explain"]) == 0
    out = capsys.readouterr().out
    for fam, spec in A.load_schema()["families"].items():
        assert spec["purpose"] in out
    assert "NEVER COLLECTED" in out


# --- cost ----------------------------------------------------------------------------------------------------
def test_record_timing_reported(home, capsys):
    N = 5000
    A._reset()
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
    assert not (events_text(home) == "")
    assert (
        off < 500 and on < 20000
    )  # loose: flake-proof guard against pathological regressions only
