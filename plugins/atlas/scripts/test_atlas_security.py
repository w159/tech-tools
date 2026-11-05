"""Tests for atlas_security.py. A fake `gh` on PATH serves canned REST payloads; the real API is never called."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_security as sec  # noqa: E402

LEAK = "ghp_SUPERSECRETLEAKEDVALUE1234567890"

FAKE_GH = f"""#!{sys.executable}
import json, os, sys
d = os.environ["FAKE_GH_DIR"]
args = sys.argv[1:]
with open(os.path.join(d, "calls.log"), "a") as f:
    f.write(" ".join(args) + "\\n")
if args[:2] == ["pr", "list"]:
    p = os.path.join(d, "prs.json")
    sys.stdout.write(open(p).read() if os.path.exists(p) else "[]")
    sys.exit(0)
ep = next(a for a in args if a.startswith("repos/"))
kind = ep.rsplit("/", 2)[-2]
name = {{"dependabot": "dependabot", "code-scanning": "code", "secret-scanning": "secret"}}[kind]
st = os.path.join(d, name + ".status")
if os.path.exists(st):
    sys.stderr.write(open(st).read() + "\\n")
    print('{{"message": "x"}}')
    sys.exit(1)
sys.stdout.write(open(os.path.join(d, name + ".json")).read())
"""


def dep_alert(
    n, eco, pkg, manifest, sev, rng, fixed, rel="direct", ghsa="GHSA-xxxx-yyyy-zzzz"
):
    return {
        "number": n,
        "state": "open",
        "html_url": f"https://github.com/o/r/security/dependabot/{n}",
        "dependency": {
            "package": {"ecosystem": eco, "name": pkg},
            "manifest_path": manifest,
            "scope": "runtime",
            "relationship": rel,
        },
        "security_advisory": {
            "ghsa_id": ghsa,
            "cve_id": f"CVE-2026-{n}",
            "summary": f"{pkg} vuln",
            "severity": sev,
        },
        "security_vulnerability": {
            "package": {"ecosystem": eco, "name": pkg},
            "severity": sev,
            "vulnerable_version_range": rng,
            "first_patched_version": {"identifier": fixed} if fixed else None,
        },
    }


@pytest.fixture
def env(tmp_path, monkeypatch):
    d = tmp_path / "gh"
    d.mkdir()
    bindir = tmp_path / "bin"
    bindir.mkdir()
    gh = bindir / "gh"
    gh.write_text(FAKE_GH)
    gh.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bindir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("FAKE_GH_DIR", str(d))
    monkeypatch.delenv("ATLAS_SECURITY", raising=False)
    root = tmp_path / "repo"
    root.mkdir()

    def put(name, payload, pages=None):
        if pages:
            text = "".join(json.dumps(p) for p in pages)
        else:
            text = json.dumps(payload)
        (d / f"{name}.json").write_text(text)

    def fail(name, text):
        (d / f"{name}.status").write_text(text)

    class E:
        pass

    e = E()
    e.root, e.dir, e.put, e.fail = str(root), d, put, fail
    return e


def seed_all(e):
    e.put(
        "dependabot",
        None,
        pages=[
            [
                dep_alert(
                    1,
                    "npm",
                    "lodash",
                    "web/package.json",
                    "high",
                    "< 4.17.21",
                    "4.17.21",
                    "transitive",
                ),
                dep_alert(
                    2,
                    "npm",
                    "lodash",
                    "web/package.json",
                    "critical",
                    "< 4.17.22",
                    "4.17.22",
                    "direct",
                ),
            ],
            [
                dep_alert(
                    3,
                    "pip",
                    "django",
                    "api/requirements.txt",
                    "medium",
                    "< 4.2.5",
                    "4.2.5",
                ),
                dep_alert(
                    4,
                    "rust",
                    "tokio",
                    "Cargo.toml",
                    "low",
                    "< 1.0",
                    None,
                    ghsa="GHSA-nopatch",
                ),
            ],
        ],
    )
    e.put(
        "code",
        [
            {
                "number": 7,
                "state": "open",
                "html_url": "u",
                "rule": {
                    "id": "py/sql-injection",
                    "severity": "error",
                    "security_severity_level": "critical",
                    "description": "SQL injection",
                },
                "tool": {"name": "CodeQL"},
                "most_recent_instance": {
                    "ref": "refs/heads/main",
                    "location": {"path": "api/db.py", "start_line": 10},
                },
            },
            {
                "number": 8,
                "state": "open",
                "html_url": "u",
                "rule": {
                    "id": "py/sql-injection",
                    "severity": "error",
                    "security_severity_level": None,
                    "description": "SQL injection",
                },
                "tool": {"name": "CodeQL"},
                "most_recent_instance": {
                    "ref": "r",
                    "location": {"path": "api/db.py", "start_line": 40},
                },
            },
            {
                "number": 9,
                "state": "open",
                "html_url": "u",
                "rule": {
                    "id": "js/unused",
                    "severity": "note",
                    "description": "unused var",
                },
                "tool": {"name": "CodeQL"},
                "most_recent_instance": {
                    "ref": "r",
                    "location": {"path": "web/a.js", "start_line": 1},
                },
            },
        ],
    )
    e.put(
        "secret",
        [
            {
                "number": 5,
                "state": "open",
                "html_url": "https://github.com/o/r/security/secret-scanning/5",
                "secret_type": "github_personal_access_token",
                "secret_type_display_name": "GitHub Personal Access Token",
                "secret": LEAK,
                "validity": "active",
                "first_location_detected": {"path": ".env", "start_line": 3},
            },
        ],
    )


def run_cli(e, *args):
    p = subprocess.run(
        [
            sys.executable,
            str(Path(sec.__file__)),
            *args,
            "--root",
            e.root,
            "--repo",
            "o/r",
        ],
        capture_output=True,
        text=True,
    )
    return p


def test_help_exit_zero():
    for argv in (["--help"], ["alerts", "--help"]):
        assert (
            subprocess.run(
                [sys.executable, sec.__file__, *argv], capture_output=True
            ).returncode
            == 0
        )


def test_bad_usage_exit_two():
    assert (
        subprocess.run(
            [sys.executable, sec.__file__, "alerts", "--kinds", "bogus"],
            capture_output=True,
        ).returncode
        == 2
    )


def test_normalization_sorting_and_paginated_output(env):
    seed_all(env)
    data = sec.collect(env.root, "o/r", list(sec.KINDS))
    assert data["kinds"]["dependabot"] == {"status": "ok", "count": 4}
    rows = data["rows"]
    assert len(rows) == 8
    order = [sec.SEV_ORDER[r["severity"]] for r in rows]
    assert order == sorted(order)
    # ties broken by kind order: critical dependabot, critical code, critical secret
    crit = [r["kind"] for r in rows if r["severity"] == "critical"]
    assert crit == ["dependabot", "code", "secret"]
    dep = next(r for r in rows if r["kind"] == "dependabot" and r["number"] == 3)
    assert (
        dep["ecosystem"] == "pip"
        and dep["package"] == "django"
        and dep["manifest_path"] == "api/requirements.txt"
    )
    assert dep["scope"] == "runtime" and dep["relationship"] == "direct"
    assert dep["vulnerable_range"] == "< 4.2.5" and dep["fixed_in"] == "4.2.5"
    assert dep["ghsa_id"] and dep["cve_id"] == "CVE-2026-3"
    np = next(r for r in rows if r["number"] == 4)
    assert np["fixed_in"] is None and np["severity"] == "low"
    c7 = next(r for r in rows if r["kind"] == "code" and r["number"] == 7)
    assert (c7["rule_id"], c7["tool"], c7["path"], c7["start_line"]) == (
        "py/sql-injection",
        "CodeQL",
        "api/db.py",
        10,
    )
    # severity fallback: error -> high, note -> low
    assert next(r for r in rows if r["number"] == 8)["severity"] == "high"
    assert next(r for r in rows if r["number"] == 9)["severity"] == "low"
    s = next(r for r in rows if r["kind"] == "secret")
    assert (
        s["severity"] == "critical"
        and s["secret_type"] == "github_personal_access_token"
    )
    assert (
        s["validity"] == "active"
        and s["path"] == ".env"
        and s["summary"] == "GitHub Personal Access Token"
    )


def test_fetch_uses_documented_gh_invocation(env):
    seed_all(env)
    sec.collect(env.root, "o/r", ["dependabot"])
    call = (env.dir / "calls.log").read_text()
    assert (
        "api -X GET --paginate repos/o/r/dependabot/alerts -f state=open -f per_page=100"
        in call
    )


def test_secret_value_never_leaks(env):
    seed_all(env)
    for args in (
        ["alerts"],
        ["alerts", "--json"],
        ["plan"],
        ["plan", "--json"],
        ["cache"],
    ):
        p = run_cli(env, *args)
        assert p.returncode == 0, p.stderr
        assert LEAK not in p.stdout and LEAK not in p.stderr
    cache = Path(env.root, ".atlas/.run/security-cache.json").read_text()
    assert LEAK not in cache
    assert "secret_type" not in cache  # cache holds counts only, no alert details
    assert "SQL injection" not in cache


def test_unavailable_kind_reported_with_reason_never_zero(env):
    seed_all(env)
    env.fail("code", "gh: Resource not accessible (HTTP 403)")
    env.fail("secret", "gh: Not Found (HTTP 404)")
    data = sec.collect(env.root, "o/r", list(sec.KINDS))
    assert data["kinds"]["dependabot"]["status"] == "ok"
    for k, code in (("code", "forbidden"), ("secret", "not_found")):
        s = data["kinds"][k]
        assert (
            s["status"] == "unavailable"
            and s["reason_code"] == code
            and "count" not in s
        )
    assert "403" in data["kinds"]["code"]["reason"]
    out = run_cli(env, "alerts").stdout
    assert "code-scanning: UNAVAILABLE" in out and "secret: UNAVAILABLE" in out
    assert "code-scanning: ok, 0" not in out


def test_not_authenticated_and_gh_missing(env, monkeypatch):
    env.fail("dependabot", "To get started with GitHub CLI, please run:  gh auth login")
    d = sec.collect(env.root, "o/r", ["dependabot"])
    assert d["kinds"]["dependabot"]["reason_code"] == "not_authenticated"
    monkeypatch.setattr(sec.shutil, "which", lambda n: None)
    d = sec.collect(env.root, "o/r", ["dependabot"])
    assert d["kinds"]["dependabot"]["reason_code"] == "gh_missing"


def test_no_github_remote(env):
    subprocess.run(["git", "init", "-q", env.root], check=True)
    d = sec.collect(env.root, None, ["dependabot"])
    assert d["kinds"]["dependabot"]["status"] == "unavailable"
    assert d["kinds"]["dependabot"]["reason"] == "no GitHub remote"


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/acme/widget.git",
        "https://github.com/acme/widget",
        "git@github.com:acme/widget.git",
        "ssh://git@github.com/acme/widget.git",
        "https://user:tok@github.com/acme/widget.git",
    ],
)
def test_parse_remote_forms(url):
    assert sec.parse_remote(url) == ("acme", "widget")


def test_parse_remote_rejects_other_hosts():
    assert sec.parse_remote("https://gitlab.com/acme/widget.git") is None


def test_repo_from_origin_remote(env):
    seed_all(env)
    subprocess.run(["git", "init", "-q", env.root], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            env.root,
            "remote",
            "add",
            "origin",
            "git@github.com:acme/widget.git",
        ],
        check=True,
    )
    sec.collect(env.root, None, ["dependabot"])
    assert "repos/acme/widget/dependabot/alerts" in (env.dir / "calls.log").read_text()


def test_plan_grouping_and_highest_fix(env):
    seed_all(env)
    (Path(env.root) / "web").mkdir()
    (Path(env.root) / "web" / "pnpm-lock.yaml").write_text("")
    (Path(env.root) / "api").mkdir()
    (Path(env.root) / "api" / "uv.lock").write_text("")
    plan = sec.build_plan(env.root, "o/r", list(sec.KINDS))
    eco = {e["ecosystem"]: e["items"] for e in plan["ecosystems"]}
    assert set(eco) == {"npm", "pip"}  # tokio has no patch -> no group
    assert len(eco["npm"]) == 1  # two lodash alerts, one group
    lodash = eco["npm"][0]
    assert (
        lodash["fix_to"] == "4.17.22"
        and lodash["alerts"] == [1, 2]
        and lodash["severity"] == "critical"
    )
    assert lodash["direct"] is True and lodash["command"] == "pnpm add lodash@4.17.22"
    assert eco["pip"][0]["command"] == "uv add 'django>=4.2.5'"
    # no-patch alert is kept with its advisory
    assert [n["package"] for n in plan["no_patch"]] == ["tokio"] and plan["no_patch"][
        0
    ]["ghsa_id"] == "GHSA-nopatch"
    # code scanning: one item per rule+path
    assert len(plan["code_scanning"]) == 2
    sql = next(c for c in plan["code_scanning"] if c["rule_id"] == "py/sql-injection")
    assert sql["alerts"] == [7, 8] and sql["severity"] == "critical"
    assert plan["secrets"][0]["action"].startswith("rotate the credential")


def test_plan_commands_per_ecosystem(env):
    e = env
    e.put(
        "dependabot",
        [
            dep_alert(1, "npm", "a", "package.json", "high", "<1", "1.2.0"),
            dep_alert(
                2, "npm", "b", "package.json", "high", "<1", "1.2.0", "transitive"
            ),
            dep_alert(3, "go", "golang.org/x/net", "go.mod", "high", "<0.2", "0.2.0"),
            dep_alert(4, "rust", "tokio", "Cargo.toml", "high", "<1", "1.1.0"),
            dep_alert(5, "pip", "requests", "requirements.txt", "high", "<2", "2.32.0"),
        ],
    )
    plan = sec.build_plan(e.root, "o/r", ["dependabot"])
    cmds = {
        g["package"]: g["command"] for eco in plan["ecosystems"] for g in eco["items"]
    }
    assert cmds["a"] == "npm install a@1.2.0"
    assert cmds["b"].startswith("npm update b") and "overrides" in cmds["b"]
    assert cmds["golang.org/x/net"] == "go get golang.org/x/net@v0.2.0 && go mod tidy"
    assert cmds["tokio"] == "cargo update -p tokio --precise 1.1.0"
    assert (
        "requests>=2.32.0" in cmds["requests"]
        and "requirements.txt" in cmds["requests"]
    )


def test_version_compare_is_numeric():
    assert sec._vmax(["1.9.0", "1.10.0", "1.2.0"]) == "1.10.0"


def test_plan_lists_superseded_dependabot_prs(env):
    seed_all(env)
    (env.dir / "prs.json").write_text(
        json.dumps(
            [
                {
                    "number": 12,
                    "title": "Bump lodash",
                    "headRefName": "dependabot/npm/lodash",
                }
            ]
        )
    )
    plan = sec.build_plan(env.root, "o/r", ["dependabot"])
    assert (
        plan["dependabot_prs"]["status"] == "ok"
        and plan["dependabot_prs"]["items"][0]["number"] == 12
    )
    assert "closes its own PR" in plan["dependabot_prs"]["note"]
    assert (
        "--author app/dependabot --state open --json number,title,headRefName"
        in (env.dir / "calls.log").read_text()
    )


def no_subprocess(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("subprocess used")

    monkeypatch.setattr(subprocess, "run", boom)
    monkeypatch.setattr(subprocess, "Popen", boom)


def test_boot_line_reads_cache_only(env, monkeypatch):
    seed_all(env)
    sec.write_cache(env.root, sec.collect(env.root, "o/r", list(sec.KINDS)))
    no_subprocess(monkeypatch)
    line = sec.boot_line(env.root)
    assert line == (
        "security: 4 open Dependabot alerts (1 critical), 3 open code-scanning alerts (1 critical), "
        "1 secret alert - run the atlas-security skill"
    )


def test_boot_line_unavailable_and_trivial(env, monkeypatch):
    path = sec.cache_path(env.root)
    path.parent.mkdir(parents=True)
    unav = {
        "status": "unavailable",
        "reason": "HTTP 403: nope",
        "reason_code": "forbidden",
    }
    path.write_text(
        json.dumps({"fetched_at": time.time(), "kinds": {k: unav for k in sec.KINDS}})
    )
    no_subprocess(monkeypatch)
    assert sec.boot_line(env.root) == "security: alerts unavailable (HTTP 403: nope)"
    triv = {
        "status": "unavailable",
        "reason": "no GitHub remote",
        "reason_code": "no_remote",
    }
    path.write_text(
        json.dumps({"fetched_at": time.time(), "kinds": {k: triv for k in sec.KINDS}})
    )
    assert sec.boot_line(env.root) is None
    ok0 = {"status": "ok", "count": 0, "by_severity": {}}
    path.write_text(
        json.dumps({"fetched_at": time.time(), "kinds": {k: ok0 for k in sec.KINDS}})
    )
    assert sec.boot_line(env.root) is None


def test_boot_line_missing_or_corrupt_cache(env):
    assert sec.boot_line(env.root) is None
    p = sec.cache_path(env.root)
    p.parent.mkdir(parents=True)
    p.write_text("{not json")
    assert sec.boot_line(env.root) is None


class Spawn:
    def __init__(self, monkeypatch):
        self.calls = []
        shim = types.SimpleNamespace(
            **{k: getattr(subprocess, k) for k in ("run", "DEVNULL", "SubprocessError")}
        )
        shim.Popen = lambda argv, **kw: self.calls.append((argv, kw))
        monkeypatch.setattr(sec, "subprocess", shim)


def test_refresh_async_staleness(env, monkeypatch):
    sp = Spawn(monkeypatch)
    assert sec.refresh_async(env.root) is True  # no cache -> stale
    argv, kw = sp.calls[0]
    assert argv[1:2] == [os.path.abspath(sec.__file__)] and argv[2] == "cache"
    assert (
        kw["start_new_session"] is True
        and kw["stdout"] == subprocess.DEVNULL
        and kw["stdin"] == subprocess.DEVNULL
    )
    (Path(env.root) / sec.LOCK_REL).unlink()
    path = sec.cache_path(env.root)
    path.write_text(json.dumps({"fetched_at": time.time() - 3600, "kinds": {}}))
    assert sec.refresh_async(env.root) is False  # 1h old < 12h
    path.write_text(json.dumps({"fetched_at": time.time() - 13 * 3600, "kinds": {}}))
    assert sec.refresh_async(env.root) is True
    assert len(sp.calls) == 2
    (Path(env.root) / sec.LOCK_REL).unlink()
    monkeypatch.setenv("ATLAS_SECURITY_REFRESH_HOURS", "0.5")
    path.write_text(json.dumps({"fetched_at": time.time() - 3600, "kinds": {}}))
    assert sec.refresh_async(env.root) is True


def test_refresh_async_lock_and_no_gh(env, monkeypatch):
    sp = Spawn(monkeypatch)
    assert sec.refresh_async(env.root) is True
    assert sec.refresh_async(env.root) is False  # lock debounce
    assert len(sp.calls) == 1
    (Path(env.root) / sec.LOCK_REL).unlink()
    monkeypatch.setattr(sec.shutil, "which", lambda n: None)
    assert sec.refresh_async(env.root) is False


def test_security_off_disables_everything(env, monkeypatch):
    seed_all(env)
    sec.write_cache(env.root, sec.collect(env.root, "o/r", list(sec.KINDS)))
    monkeypatch.setenv("ATLAS_SECURITY", "off")
    sp = Spawn(monkeypatch)
    assert sec.boot_line(env.root) is None
    assert sec.refresh_async(env.root) is False and not sp.calls
    calls_before = (env.dir / "calls.log").read_text()
    p = run_cli(env, "alerts")
    assert p.returncode == 0 and "disabled" in p.stdout
    assert (env.dir / "calls.log").read_text() == calls_before  # gh never invoked


# ---- analytics + protected-branch refresh ---------------------------------------------------------
def _analytics_home(tmp_path, monkeypatch, enabled):
    """enabled: True = `enable` consent, False = `disable` consent, None = undecided (pytest guard decides)."""
    import atlas_analytics as A

    home = tmp_path / "ah"
    monkeypatch.setenv("ATLAS_HOME", str(home))
    monkeypatch.delenv("ATLAS_ANALYTICS", raising=False)
    monkeypatch.delenv("DO_NOT_TRACK", raising=False)
    if enabled is not None:
        (home / "analytics").mkdir(parents=True)
        (home / "analytics" / "consent.json").write_text(
            json.dumps({"enabled": enabled, "decided": True})
        )
    A._reset()
    return A, home / "analytics" / "events.jsonl"


def test_refresh_records_open_alert_tallies(env, tmp_path, monkeypatch):
    A, ev = _analytics_home(tmp_path, monkeypatch, True)
    seed_all(env)
    data = sec.collect(env.root, "o/r", list(sec.KINDS))
    want = {}
    for r in data["rows"]:
        k = f"security.alerts.{r['kind']}.{r['severity']}"
        want[k] = want.get(k, 0) + 1
    assert want
    sec.write_cache(env.root, data)
    got = {}
    for ln in ev.read_text().splitlines():
        d = json.loads(ln)
        got[d["k"]] = got.get(d["k"], 0) + d["n"]
    assert got == want
    A._reset()


def test_refresh_analytics_explicit_disable_writes_nothing(env, tmp_path, monkeypatch):
    A, ev = _analytics_home(tmp_path, monkeypatch, False)
    seed_all(env)
    sec.write_cache(env.root, sec.collect(env.root, "o/r", list(sec.KINDS)))
    assert not ev.exists()
    A._reset()


def test_refresh_analytics_undecided_under_pytest_writes_nothing(env, tmp_path, monkeypatch):
    """Default is on, but PYTEST_CURRENT_TEST counts as automation, so an undecided run stays off."""
    A, ev = _analytics_home(tmp_path, monkeypatch, None)
    assert A.state() == (False, "CI or test run (set ATLAS_ANALYTICS=on to count it)")
    seed_all(env)
    sec.write_cache(env.root, sec.collect(env.root, "o/r", list(sec.KINDS)))
    assert not ev.parent.exists()
    A._reset()


def test_unavailable_kind_records_nothing(env, tmp_path, monkeypatch):
    A, ev = _analytics_home(tmp_path, monkeypatch, True)
    seed_all(env)
    for k in ("dependabot", "code", "secret"):
        env.fail(k, "HTTP 403")
    sec.write_cache(env.root, sec.collect(env.root, "o/r", list(sec.KINDS)))
    assert not ev.exists()
    A._reset()


def test_protected_refresh_runs_once_per_24h(env, monkeypatch):
    calls = []

    def fake_run(argv, **kw):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 0, "", "")

    monkeypatch.setattr(sec.subprocess, "run", fake_run)
    assert sec.refresh_protected_async(env.root) is True
    assert sec.refresh_protected_async(env.root) is False
    assert len(calls) == 1
    assert calls[0][-2:] == ["protected", "--refresh"]
    assert calls[0][1].endswith("atlas_git.py")
    stamp = Path(env.root) / sec.PROTECTED_STAMP_REL
    old = time.time() - 25 * 3600
    os.utime(stamp, (old, old))
    assert sec.refresh_protected_async(env.root) is True
    assert len(calls) == 2


def test_cache_command_triggers_protected_refresh(env, monkeypatch):
    seed_all(env)
    real = sec.subprocess.run
    seen = []

    def spy(argv, **kw):
        if any(str(a).endswith("atlas_git.py") for a in argv):
            seen.append(argv)
            return subprocess.CompletedProcess(argv, 0, "", "")
        return real(argv, **kw)

    monkeypatch.setattr(sec.subprocess, "run", spy)
    monkeypatch.setattr(sec, "resolve_repo", lambda root, repo: ("o", "r", None))
    assert sec.main(["cache", "--root", env.root]) == 0
    assert len(seen) == 1 and seen[0][-2:] == ["protected", "--refresh"]
    assert sec.main(["cache", "--root", env.root]) == 0
    assert len(seen) == 1  # stamped: not again within 24h
