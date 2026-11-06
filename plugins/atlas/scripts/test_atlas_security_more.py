"""More atlas_security tests: pure helpers, normalisers, plan building and rendering, cache and CLI branches.
`gh`, `git` and the filesystem clock are replaced in-process; nothing touches the network."""

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


def cp(stdout="", stderr="", rc=0):
    return subprocess.CompletedProcess([], rc, stdout, stderr)


@pytest.fixture(autouse=True)
def _no_security_off(monkeypatch):
    monkeypatch.delenv("ATLAS_SECURITY", raising=False)


# ---------------------------------------------------------------- small helpers


@pytest.mark.parametrize("val,want", [("off", True), (" OFF ", True), ("0", True), ("false", True), ("Disabled", True), ("", False), ("on", False), ("1", False)])
def test_disabled_values(monkeypatch, val, want):
    monkeypatch.setenv("ATLAS_SECURITY", val)
    assert sec.disabled() is want


def test_disabled_unset(monkeypatch):
    monkeypatch.delenv("ATLAS_SECURITY", raising=False)
    assert sec.disabled() is False


def test_run_passes_capture_timeout_and_cwd(monkeypatch):
    seen = {}

    def fake(argv, **kw):
        seen.update(argv=argv, **kw)
        return cp("x")

    monkeypatch.setattr(sec.subprocess, "run", fake)
    assert sec._run(["gh", "x"], cwd="/w").stdout == "x"
    assert seen == {"argv": ["gh", "x"], "capture_output": True, "text": True, "timeout": sec.GH_TIMEOUT, "cwd": "/w"}


@pytest.mark.parametrize(
    "url,want",
    [
        ("https://github.com/o/r", ("o", "r")),
        ("https://github.com/o/r.git/", ("o", "r")),
        ("https://user@github.com/o/r.git", ("o", "r")),
        ("ssh://git@github.com:22/o/r.git", ("o", "r")),
        ("git@github.com:o/r.git", ("o", "r")),
        ("  git@github.com:o/r  \n", ("o", "r")),
        ("https://github.acme.com/o/r", ("o", "r")),
        ("https://gitlab.com/o/r", None),
        ("git@bitbucket.org:o/r.git", None),
        ("https://github.com/onlyowner", None),
        ("", None),
        (None, None),
        ("not a url", None),
    ],
)
def test_parse_remote_cases(url, want):
    assert sec.parse_remote(url) == want


def test_resolve_repo_explicit_and_invalid():
    assert sec.resolve_repo("/r", "o/name.x-y") == ("o", "name.x-y", None)
    for bad in ("justname", "a/b/c", "a b/c", "o/"):
        assert sec.resolve_repo("/r", bad) == (None, None, "bad --repo (want owner/name)")


def test_resolve_repo_from_origin(monkeypatch):
    seen = []
    monkeypatch.setattr(sec, "_run", lambda argv, cwd=None: seen.append(argv) or cp("git@github.com:me/proj.git\n"))
    assert sec.resolve_repo("/the/root", None) == ("me", "proj", None)
    assert seen == [["git", "-C", "/the/root", "remote", "get-url", "origin"]]


def test_resolve_repo_failures(monkeypatch):
    err = (None, None, "no GitHub remote")
    monkeypatch.setattr(sec, "_run", lambda argv, cwd=None: cp("", "no", 2))
    assert sec.resolve_repo("/r", None) == err
    monkeypatch.setattr(sec, "_run", lambda argv, cwd=None: cp("https://gitlab.com/o/r"))
    assert sec.resolve_repo("/r", None) == err

    def boom(argv, cwd=None):
        raise OSError("no git")

    monkeypatch.setattr(sec, "_run", boom)
    assert sec.resolve_repo("/r", None) == err

    def tmo(argv, cwd=None):
        raise subprocess.TimeoutExpired("git", 1)

    monkeypatch.setattr(sec, "_run", tmo)
    assert sec.resolve_repo("/r", None) == err


def test_decode_stream_pages_whitespace_and_scalars():
    assert sec._decode_stream('[1,2]\n  [3]\n\n') == [1, 2, 3]
    assert sec._decode_stream('{"a":1} [2]') == [{"a": 1}, 2]
    assert sec._decode_stream("   ") == []
    assert sec._decode_stream("") == []
    with pytest.raises(ValueError):
        sec._decode_stream("[1] garbage")


def test_classify_error_branches():
    assert sec.classify_error("gh: HTTP 403 forbidden")[0] == "forbidden"
    assert "security_events scope" in sec.classify_error("HTTP 403")[1]
    assert sec.classify_error("HTTP 404 Not Found") == ("not_found", "HTTP 404: feature disabled, nothing analysed yet, or no access")
    for t in ("HTTP 401", "please run gh auth login", "You are Not Logged In", "bad Authentication", "set GH_TOKEN"):
        assert sec.classify_error(t) == ("not_authenticated", "gh is not authenticated (run gh auth login)"), t
    assert sec.classify_error("boom\nsecond") == ("error", "gh error: boom")
    assert sec.classify_error("") == ("error", "gh error: unknown error")
    assert sec.classify_error(None) == ("error", "gh error: unknown error")
    assert sec.classify_error("  \n  ") == ("error", "gh error: unknown error")
    assert sec.classify_error("x" * 300)[1] == "gh error: " + "x" * 160
    # 403 wins over auth wording in the same text
    assert sec.classify_error("HTTP 403 authentication")[0] == "forbidden"


# ---------------------------------------------------------------- fetch_kind


def test_fetch_kind_gh_missing(monkeypatch):
    monkeypatch.setattr(sec.shutil, "which", lambda n: None)
    assert sec.fetch_kind("code", "o", "r") == {"status": "unavailable", "reason": "gh CLI not installed", "reason_code": "gh_missing"}


def test_fetch_kind_argv_and_ok(monkeypatch):
    monkeypatch.setattr(sec.shutil, "which", lambda n: "/bin/gh")
    seen = []
    monkeypatch.setattr(sec, "_run", lambda argv, cwd=None: seen.append(argv) or cp('[{"a":1}]\n[{"a":2}]'))
    assert sec.fetch_kind("secret", "own", "rep") == {"status": "ok", "raw": [{"a": 1}, {"a": 2}]}
    assert seen == [["gh", "api", "-X", "GET", "--paginate", "repos/own/rep/secret-scanning/alerts", "-f", "state=open", "-f", "per_page=100"]]


def test_fetch_kind_failures(monkeypatch):
    monkeypatch.setattr(sec.shutil, "which", lambda n: "/bin/gh")
    monkeypatch.setattr(sec, "_run", lambda argv, cwd=None: cp("body", "gh: HTTP 404", 1))
    assert sec.fetch_kind("code", "o", "r")["reason_code"] == "not_found"
    # the failure text is stderr then the first 400 chars of stdout
    monkeypatch.setattr(sec, "_run", lambda argv, cwd=None: cp("HTTP 403" + "x" * 500, "", 1))
    assert sec.fetch_kind("code", "o", "r")["reason_code"] == "forbidden"
    monkeypatch.setattr(sec, "_run", lambda argv, cwd=None: cp("x" * 450 + "HTTP 403", "plain", 1))
    assert sec.fetch_kind("code", "o", "r")["reason_code"] == "error"
    monkeypatch.setattr(sec, "_run", lambda argv, cwd=None: cp("not json"))
    assert sec.fetch_kind("code", "o", "r") == {"status": "unavailable", "reason": "gh returned unparseable output", "reason_code": "error"}

    def boom(argv, cwd=None):
        raise subprocess.TimeoutExpired("gh", 1)

    monkeypatch.setattr(sec, "_run", boom)
    assert sec.fetch_kind("code", "o", "r") == {"status": "unavailable", "reason": "gh failed: TimeoutExpired", "reason_code": "error"}


# ---------------------------------------------------------------- normalizers


def test_sev_defaults_and_case():
    assert sec._sev("HIGH") == "high"
    assert sec._sev(None) == "medium"
    assert sec._sev("bogus") == "medium"
    assert sec._sev("critical") == "critical"


def test_norm_dependabot_fallbacks():
    row = sec.norm_dependabot(
        {
            "number": 4,
            "html_url": "u",
            "dependency": {"manifest_path": "m", "scope": "runtime", "relationship": "direct"},
            "security_advisory": {"summary": "s", "severity": "low", "ghsa_id": "G", "cve_id": "C"},
            "security_vulnerability": {"package": {"ecosystem": "pip", "name": "p"}, "vulnerable_version_range": "<1", "first_patched_version": {"identifier": "1.0"}},
        }
    )
    assert row == {
        "kind": "dependabot", "number": 4, "severity": "low", "summary": "s", "ecosystem": "pip", "package": "p",
        "manifest_path": "m", "scope": "runtime", "relationship": "direct", "vulnerable_range": "<1", "fixed_in": "1.0",
        "ghsa_id": "G", "cve_id": "C", "html_url": "u",
    }
    empty = sec.norm_dependabot({})
    assert (empty["severity"], empty["summary"], empty["fixed_in"], empty["package"]) == ("medium", "", None, None)
    # vulnerability severity beats advisory severity
    assert sec.norm_dependabot({"security_advisory": {"severity": "low"}, "security_vulnerability": {"severity": "critical"}})["severity"] == "critical"


def test_norm_code_severity_sources():
    base = {"number": 1, "html_url": "u", "tool": {"name": "CodeQL"}, "most_recent_instance": {"location": {"path": "a.py", "start_line": 7}}}
    r = sec.norm_code({**base, "rule": {"id": "r1", "description": "d", "name": "n", "security_severity_level": "CRITICAL", "severity": "note"}})
    assert (r["severity"], r["summary"], r["rule_id"], r["tool"], r["path"], r["start_line"]) == ("critical", "d", "r1", "CodeQL", "a.py", 7)
    assert sec.norm_code({**base, "rule": {"severity": "error"}})["severity"] == "high"
    assert sec.norm_code({**base, "rule": {"severity": "WARNING"}})["severity"] == "medium"
    assert sec.norm_code({**base, "rule": {"severity": "note", "name": "nm"}})["severity"] == "low"
    assert sec.norm_code({**base, "rule": {"severity": "weird"}})["severity"] == "medium"
    assert sec.norm_code({**base, "rule": {"name": "nm"}})["summary"] == "nm"
    bare = sec.norm_code({})
    assert (bare["severity"], bare["summary"], bare["path"]) == ("medium", "", None)


def test_norm_secret_never_reads_value():
    a = {"number": 3, "secret": "ghp_TOPSECRET", "secret_type": "github_pat", "secret_type_display_name": "GitHub PAT", "validity": "active", "first_location_detected": {"path": "x.env"}, "html_url": "u"}
    r = sec.norm_secret(a)
    assert r == {"kind": "secret", "number": 3, "severity": "critical", "summary": "GitHub PAT", "secret_type": "github_pat", "validity": "active", "path": "x.env", "html_url": "u"}
    assert "TOPSECRET" not in json.dumps(r)
    assert sec.norm_secret({"secret_type": "t"})["summary"] == "t"
    assert sec.norm_secret({"first_location_detected": "oops"})["path"] is None
    assert sec.norm_secret({})["summary"] == ""


def test_sort_rows_by_severity_kind_number():
    rows = [
        {"severity": "low", "kind": "code", "number": 1},
        {"severity": "critical", "kind": "secret", "number": 9},
        {"severity": "high", "kind": "code", "number": 5},
        {"severity": "high", "kind": "dependabot", "number": 7},
        {"severity": "high", "kind": "code", "number": 2},
        {"severity": "high", "kind": "code", "number": None},
    ]
    got = [(r["severity"], r["kind"], r["number"]) for r in sec.sort_rows(rows)]
    assert got == [("critical", "secret", 9), ("high", "dependabot", 7), ("high", "code", None), ("high", "code", 2), ("high", "code", 5), ("low", "code", 1)]


# ---------------------------------------------------------------- collect


def test_collect_no_remote_marks_every_kind_unavailable(monkeypatch):
    monkeypatch.setattr(sec, "resolve_repo", lambda r, repo: (None, None, "no GitHub remote"))
    out = sec.collect("/r", None, ["dependabot", "code"])
    assert out["repo"] is None and out["rows"] == []
    assert out["kinds"] == {k: {"status": "unavailable", "reason": "no GitHub remote", "reason_code": "no_remote"} for k in ("dependabot", "code")}
    monkeypatch.setattr(sec, "resolve_repo", lambda r, repo: (None, None, "bad --repo (want owner/name)"))
    assert sec.collect("/r", "x", ["secret"])["kinds"]["secret"]["reason_code"] == "error"


def test_collect_mixed_ok_and_failed_kinds(monkeypatch):
    monkeypatch.setattr(sec, "resolve_repo", lambda r, repo: ("o", "r", None))

    def fk(kind, owner, repo):
        if kind == "code":
            return {"status": "unavailable", "reason": "nope", "reason_code": "forbidden", "extra": 1}
        raw = {"dependabot": [{"number": 2, "security_advisory": {"severity": "low"}}, "skip", {"number": 1}], "secret": [{"number": 3}]}[kind]
        return {"status": "ok", "raw": raw}

    monkeypatch.setattr(sec, "fetch_kind", fk)
    out = sec.collect("/r", None, ["dependabot", "code", "secret"])
    assert out["repo"] == "o/r"
    assert out["kinds"] == {
        "dependabot": {"status": "ok", "count": 2},
        "code": {"status": "unavailable", "reason": "nope", "reason_code": "forbidden"},
        "secret": {"status": "ok", "count": 1},
    }
    assert [(r["kind"], r["number"]) for r in out["rows"]] == [("secret", 3), ("dependabot", 1), ("dependabot", 2)]


# ---------------------------------------------------------------- versions, lockfiles, fix commands


def test_version_ordering():
    assert sec._vmax(["1.9.0", "1.10.0", "1.2.0"]) == "1.10.0"
    assert sec._vmax(["1.2", "1.2.1"]) == "1.2.1"
    assert sec._vmax(["4.17.21", "4.17.22"]) == "4.17.22"
    assert sec._vkey(None) == ()
    assert sec._vkey("1.a") == ((0, 1), (-1, "a"))


def test_lockfiles_lists_names_and_tolerates_missing_dir(tmp_path):
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "yarn.lock").write_text("")
    (tmp_path / "web" / "package.json").write_text("")
    assert sec._lockfiles(str(tmp_path), "web") == {"yarn.lock", "package.json"}
    assert sec._lockfiles(str(tmp_path), "nodir") == set()
    (tmp_path / "top.lock").write_text("")
    assert "top.lock" in sec._lockfiles(str(tmp_path), "")


@pytest.mark.parametrize(
    "eco,direct,files,want",
    [
        ("npm", True, {"pnpm-lock.yaml"}, "pnpm add p@2.0"),
        ("npm", False, {"pnpm-lock.yaml"}, "pnpm update p@2.0 --depth Infinity  (or a pnpm.overrides entry 'p': '>=2.0')"),
        ("npm", True, {"yarn.lock"}, "yarn add p@2.0"),
        ("npm", False, {"yarn.lock"}, "add a resolutions entry 'p': '>=2.0' to package.json, then yarn install"),
        ("npm", True, {"bun.lock"}, "bun add p@2.0"),
        ("npm", False, {"bun.lockb"}, "bun update p  (or an overrides entry 'p': '>=2.0')"),
        ("NPM", True, set(), "npm install p@2.0"),
        ("npm", False, set(), "npm update p  (or an overrides entry 'p': '>=2.0' in package.json)"),
        ("pip", False, {"uv.lock"}, "uv lock --upgrade-package p"),
        ("pip", True, {"uv.lock"}, "uv add 'p>=2.0'"),
        ("pip", True, {"poetry.lock"}, "poetry update p"),
        ("pip", True, set(), "edit api/req.txt: pin p>=2.0, then reinstall"),
        ("go", True, set(), "go get p@v2.0 && go mod tidy"),
        ("go", True, set(), "go get p@v2.0 && go mod tidy"),
        ("rust", True, set(), "cargo update -p p --precise 2.0"),
        ("composer", True, set(), "edit api/req.txt: require p >=2.0, then composer update p"),
        ("rubygems", True, set(), "edit Gemfile: gem 'p', '>= 2.0', then bundle update p"),
        ("maven", True, set(), "edit api/req.txt: set p version >= 2.0 (or dependencyManagement), then rebuild"),
        ("nuget", True, set(), "edit api/req.txt: set PackageReference p Version >= 2.0, then dotnet restore"),
        ("weird", True, set(), "edit api/req.txt: bump p to >= 2.0"),
        (None, True, set(), "edit api/req.txt: bump p to >= 2.0"),
    ],
)
def test_fix_command(eco, direct, files, want):
    assert sec.fix_command(eco, "p", "2.0", direct, files, "api/req.txt") == want


def test_fix_command_go_strips_one_leading_v_and_package_manager_priority():
    assert sec.fix_command("go", "m", "v1.2.3", True, set(), "go.mod") == "go get m@v1.2.3 && go mod tidy"
    assert sec.fix_command("npm", "p", "1", True, {"yarn.lock", "pnpm-lock.yaml"}, "m") == "pnpm add p@1"
    assert sec.fix_command("npm", "p", "1", True, {"bun.lock", "yarn.lock"}, "m") == "yarn add p@1"
    assert sec.fix_command("pip", "p", "1", True, {"poetry.lock", "uv.lock"}, "m") == "uv add 'p>=1'"


# ---------------------------------------------------------------- build_plan


def dep(n, eco, pkg, manifest, sev, fixed, rel="direct", rng="<9", ghsa="GHSA-1"):
    return {
        "kind": "dependabot", "number": n, "severity": sev, "summary": f"{pkg} vuln", "ecosystem": eco, "package": pkg,
        "manifest_path": manifest, "scope": "runtime", "relationship": rel, "vulnerable_range": rng, "fixed_in": fixed,
        "ghsa_id": ghsa, "cve_id": f"CVE-{n}", "html_url": f"https://x/{n}",
    }


def code(n, rule, path, sev, line, tool="CodeQL"):
    return {"kind": "code", "number": n, "severity": sev, "summary": f"{rule} issue", "rule_id": rule, "tool": tool, "path": path, "start_line": line, "html_url": f"https://x/c{n}"}


def secret(n, path="a.env"):
    return {"kind": "secret", "number": n, "severity": "critical", "summary": "Token", "secret_type": "tok", "validity": "active", "path": path, "html_url": f"https://x/s{n}"}


def patch_plan(monkeypatch, rows, kinds=None, resolve=("o", "r", None), run=None, gh="/bin/gh"):
    kinds = kinds or {"dependabot": {"status": "ok", "count": 1}}
    monkeypatch.setattr(sec, "collect", lambda root, repo, ks: {"repo": "o/r", "kinds": kinds, "rows": rows})
    monkeypatch.setattr(sec, "resolve_repo", lambda root, repo: resolve)
    monkeypatch.setattr(sec.shutil, "which", lambda n: gh)
    monkeypatch.setattr(sec, "_run", run or (lambda argv, cwd=None: cp("[]")))


def test_plan_groups_by_package_picks_highest_fix_and_severity(tmp_path, monkeypatch):
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "yarn.lock").write_text("")
    rows = [
        dep(5, "npm", "lodash", "web/package.json", "high", "4.17.21", rel="transitive"),
        dep(2, "npm", "lodash", "web/package.json", "critical", "4.17.22", rel="direct"),
        dep(9, "npm", "lodash", "web/package.json", "low", "4.17.9", rel="transitive"),
        dep(3, "pip", "django", "requirements.txt", "medium", "4.2.5"),
        dep(4, "npm", "left-pad", "web/package.json", "low", "1.3.0"),
        dep(6, "rust", "serde", "Cargo.toml", "high", "1.0.1"),
    ]
    patch_plan(monkeypatch, rows)
    plan = sec.build_plan(str(tmp_path), None, ["dependabot"])
    eco = {e["ecosystem"]: e["items"] for e in plan["ecosystems"]}
    assert [e["ecosystem"] for e in plan["ecosystems"]] == ["cargo", "npm", "pip"]  # aliases applied, sorted
    lod, pad = eco["npm"]  # critical sorts before low
    assert (lod["package"], lod["fix_to"], lod["severity"], lod["direct"], lod["alerts"]) == ("lodash", "4.17.22", "critical", True, [2, 5, 9])
    assert lod["command"] == "yarn add lodash@4.17.22"
    assert lod["manifest_dir"] == "web" and lod["manifest_path"] == "web/package.json" and "_vers" not in lod
    assert (pad["package"], pad["command"]) == ("left-pad", "yarn add left-pad@1.3.0")
    dj = eco["pip"][0]
    assert dj["manifest_dir"] == "." and dj["command"] == "edit requirements.txt: pin django>=4.2.5, then reinstall"
    assert eco["cargo"][0]["command"] == "cargo update -p serde --precise 1.0.1"


def test_plan_transitive_only_group_is_not_direct_and_ties_sort_by_dir_then_package(tmp_path, monkeypatch):
    rows = [
        dep(1, "npm", "zeta", "b/package.json", "high", "1.0", rel="transitive"),
        dep(2, "npm", "alpha", "b/package.json", "high", "1.0", rel="transitive"),
        dep(3, "npm", "mid", "a/package.json", "high", "1.0", rel="transitive"),
    ]
    patch_plan(monkeypatch, rows)
    items = sec.build_plan(str(tmp_path), None, ["dependabot"])["ecosystems"][0]["items"]
    assert [(i["manifest_dir"], i["package"], i["direct"]) for i in items] == [("a", "mid", False), ("b", "alpha", False), ("b", "zeta", False)]


def test_plan_no_patch_rows_listed_separately(tmp_path, monkeypatch):
    patch_plan(monkeypatch, [dep(1, "npm", "p", "package.json", "high", None, rng="<1", ghsa="GHSA-2")])
    plan = sec.build_plan(str(tmp_path), None, ["dependabot"])
    assert plan["ecosystems"] == []
    assert plan["no_patch"] == [
        {"number": 1, "severity": "high", "ecosystem": "npm", "package": "p", "manifest_path": "package.json", "vulnerable_range": "<1",
         "ghsa_id": "GHSA-2", "cve_id": "CVE-1", "summary": "p vuln", "html_url": "https://x/1"}
    ]


def test_plan_code_scanning_dedupes_by_rule_and_path_keeping_worst_severity(tmp_path, monkeypatch):
    rows = [
        code(1, "py/sql", "a.py", "medium", 10),
        code(2, "py/sql", "a.py", "critical", 20),
        code(3, "py/sql", "b.py", "low", 5),
        code(4, "py/xss", "a.py", "medium", 1),
        code(5, "py/sql", None, "medium", 1),
    ]
    patch_plan(monkeypatch, rows)
    plan = sec.build_plan(str(tmp_path), None, ["code"])
    got = [(c["rule_id"], c["path"], c["severity"], c["alerts"], c["lines"]) for c in plan["code_scanning"]]
    assert got == [
        ("py/sql", "a.py", "critical", [1, 2], [10, 20]),
        ("py/sql", None, "medium", [5], [1]),
        ("py/xss", "a.py", "medium", [4], [1]),
        ("py/sql", "b.py", "low", [3], [5]),
    ]


def test_plan_secrets_have_rotation_action_and_no_value(tmp_path, monkeypatch):
    patch_plan(monkeypatch, [secret(7)])
    s = sec.build_plan(str(tmp_path), None, ["secret"])["secrets"]
    assert s == [{"number": 7, "secret_type": "tok", "summary": "Token", "path": "a.env", "validity": "active", "html_url": "https://x/s7",
                  "action": "rotate the credential at its provider, then remove it from history; Atlas cannot fix this by code"}]


def test_plan_dependabot_prs_ok_with_argv(tmp_path, monkeypatch):
    seen = []

    def run(argv, cwd=None):
        seen.append(argv)
        return cp('[{"number": 8, "title": "Bump x", "headRefName": "dependabot/x"}]')

    patch_plan(monkeypatch, [], run=run)
    prs = sec.build_plan(str(tmp_path), None, ["dependabot"])["dependabot_prs"]
    assert prs == {"status": "ok", "items": [{"number": 8, "title": "Bump x", "headRefName": "dependabot/x"}], "note": "Dependabot closes its own PR once the default branch contains the fix"}
    assert seen == [["gh", "pr", "list", "--repo", "o/r", "--author", "app/dependabot", "--state", "open", "--json", "number,title,headRefName"]]


def test_plan_dependabot_prs_empty_stdout_is_empty_list(tmp_path, monkeypatch):
    patch_plan(monkeypatch, [], run=lambda argv, cwd=None: cp(""))
    assert sec.build_plan(str(tmp_path), None, ["dependabot"])["dependabot_prs"]["items"] == []


def test_plan_dependabot_prs_failure_reason_uses_stderr_then_stdout_head(tmp_path, monkeypatch):
    patch_plan(monkeypatch, [], run=lambda argv, cwd=None: cp("", "HTTP 403 forbidden", 1))
    prs = sec.build_plan(str(tmp_path), None, ["dependabot"])["dependabot_prs"]
    assert prs["status"] == "unavailable" and prs["items"] == []
    assert prs["reason"] == sec.classify_error("HTTP 403")[1]
    patch_plan(monkeypatch, [], run=lambda argv, cwd=None: cp("HTTP 404", "", 1))
    assert sec.build_plan(str(tmp_path), None, ["dependabot"])["dependabot_prs"]["reason"] == sec.classify_error("HTTP 404")[1]
    patch_plan(monkeypatch, [], run=lambda argv, cwd=None: cp("", "HTTP 401", 1))
    assert "not authenticated" in sec.build_plan(str(tmp_path), None, ["dependabot"])["dependabot_prs"]["reason"]


def test_plan_dependabot_prs_exceptions_and_unavailability(tmp_path, monkeypatch):
    def boom(argv, cwd=None):
        raise subprocess.TimeoutExpired("gh", 1)

    patch_plan(monkeypatch, [], run=boom)
    assert sec.build_plan(str(tmp_path), None, ["dependabot"])["dependabot_prs"]["reason"] == "gh failed: TimeoutExpired"
    patch_plan(monkeypatch, [], run=lambda argv, cwd=None: cp("not json"))
    assert sec.build_plan(str(tmp_path), None, ["dependabot"])["dependabot_prs"]["reason"] == "gh failed: JSONDecodeError"
    patch_plan(monkeypatch, [], gh=None)
    assert sec.build_plan(str(tmp_path), None, ["dependabot"])["dependabot_prs"] == {"status": "unavailable", "reason": "not queried", "items": []}
    patch_plan(monkeypatch, [], resolve=(None, None, "no GitHub remote"))
    assert sec.build_plan(str(tmp_path), None, ["dependabot"])["dependabot_prs"] == {"status": "unavailable", "reason": "no GitHub remote", "items": []}


def test_plan_passes_repo_and_kinds_to_collect(tmp_path, monkeypatch):
    seen = []
    monkeypatch.setattr(sec, "collect", lambda root, repo, ks: seen.append((root, repo, ks)) or {"repo": None, "kinds": {}, "rows": []})
    monkeypatch.setattr(sec, "resolve_repo", lambda root, repo: (None, None, "no GitHub remote"))
    plan = sec.build_plan("/the/root", "o/x", ["code"])
    assert seen == [("/the/root", "o/x", ["code"])]
    assert set(plan) == {"repo", "kinds", "ecosystems", "no_patch", "code_scanning", "secrets", "dependabot_prs"}


# ---------------------------------------------------------------- rendering


def test_render_alerts_exact_text():
    data = {
        "repo": "o/r",
        "kinds": {"dependabot": {"status": "ok", "count": 2}, "secret": {"status": "unavailable", "reason": "HTTP 403: nope", "reason_code": "forbidden"}},
        "rows": [
            dep(1, "npm", "lodash", "p.json", "high", "4.17.21", rng="<4.17.21"),
            {**dep(2, "pip", "dj", "r.txt", "low", None, rng=None), "summary": "bad"},
            code(3, "py/sql", "a.py", "medium", 12),
            secret(4),
            {**secret(5), "path": None, "validity": None},
        ],
    }
    out = sec.render_alerts(data).splitlines()
    assert out[:4] == ["repo: o/r", "Dependabot: ok, 2 open", "secret: UNAVAILABLE - HTTP 403: nope", ""]
    assert out[4] == "sev       kind           #     where / what"
    assert out[5] == "high      dependabot    1     lodash (npm) <4.17.21 -> 4.17.21: lodash vuln"
    assert out[6] == "low       dependabot    2     dj (pip) ? -> no patch: bad"
    assert out[7] == "medium    code          3     py/sql a.py:12: py/sql issue"
    assert out[8] == "critical  secret        4     Token in a.env [active]"
    assert out[9] == "critical  secret        5     Token"
    assert len(out) == 10


def test_render_alerts_unknown_repo_and_no_rows():
    assert sec.render_alerts({"repo": None, "kinds": {}, "rows": []}) == "repo: unknown"
    out = sec.render_alerts({"repo": "o/r", "kinds": {"code": {"status": "ok", "count": 0}}, "rows": []})
    assert out == "repo: o/r\ncode-scanning: ok, 0 open"


def test_render_alerts_orders_kinds_by_kinds_tuple_not_dict_order():
    data = {"repo": "o/r", "kinds": {"secret": {"status": "ok", "count": 0}, "dependabot": {"status": "ok", "count": 0}}, "rows": []}
    assert sec.render_alerts(data).splitlines()[1:] == ["Dependabot: ok, 0 open", "secret: ok, 0 open"]


def base_plan(**kw):
    p = {
        "repo": "o/r",
        "kinds": {"dependabot": {"status": "ok", "count": 3}, "code": {"status": "unavailable", "reason": "HTTP 404: x", "reason_code": "not_found"}},
        "ecosystems": [], "no_patch": [], "code_scanning": [], "secrets": [],
        "dependabot_prs": {"status": "unavailable", "reason": "not queried", "items": []},
    }
    p.update(kw)
    return p


def test_render_plan_header_skips_absent_kinds_and_pr_fallback():
    out = sec.render_plan(base_plan()).splitlines()
    assert out == ["repo: o/r", "Dependabot: ok, 3 open", "code-scanning: UNAVAILABLE - HTTP 404: x", "", "## open Dependabot PRs", "- not listed: not queried"]
    only = sec.render_plan(base_plan(kinds={"secret": {"status": "ok", "count": 1}})).splitlines()
    assert only[:2] == ["repo: o/r", "secret: ok, 1 open"] and not any("Dependabot:" in l for l in only[:2])
    assert sec.render_plan(base_plan(repo=None, kinds={})).splitlines()[0] == "repo: unknown"


def test_render_plan_full_sections():
    plan = base_plan(
        ecosystems=[{"ecosystem": "npm", "items": [
            {"severity": "high", "package": "a", "fix_to": "2", "direct": True, "manifest_dir": "web", "alerts": [1, 2], "command": "npm install a@2"},
            {"severity": "low", "package": "b", "fix_to": "3", "direct": False, "manifest_dir": ".", "alerts": [4], "command": "npm update b"},
        ]}],
        no_patch=[{"severity": "high", "package": "c", "ecosystem": "pip", "vulnerable_range": "<1", "ghsa_id": None, "summary": "bad"},
                  {"severity": "low", "package": "d", "ecosystem": "pip", "vulnerable_range": "<2", "ghsa_id": "GHSA-9", "summary": "worse"}],
        code_scanning=[{"severity": "medium", "rule_id": "r", "path": "p.py", "lines": [9, None, 3, 9, 0], "tool": "CodeQL", "summary": "s"}],
        secrets=[{"number": 7, "summary": "Tok", "path": "a.env", "action": "rotate"}, {"number": 8, "summary": "Tok2", "path": None, "action": "rotate2"}],
        dependabot_prs={"status": "ok", "items": [{"number": 5, "title": "Bump", "headRefName": "dependabot/x"}], "note": "N"},
    )
    out = sec.render_plan(plan).splitlines()
    assert "## npm" in out
    assert "1. [high] a -> 2 (direct, web, alerts [1, 2])" in out
    assert "   $ npm install a@2" in out
    assert "2. [low] b -> 3 (transitive, ., alerts [4])" in out
    assert "## no patch available" in out
    assert "- [high] c (pip) <1 : bad" in out
    assert "- [low] d (pip) <2 GHSA-9: worse" in out
    assert "## code scanning (one item per rule + path)" in out
    assert "- [medium] r p.py lines [3, 9] (CodeQL): s" in out
    assert "## secrets (needs the user)" in out
    assert "- #7 Tok in a.env: rotate" in out
    assert "- #8 Tok2: rotate2" in out
    assert out[-3:] == ["## open Dependabot PRs", "- #5 Bump (dependabot/x)", "note: N"]


def test_render_plan_ok_prs_with_no_items_says_none_and_empty_sections_absent():
    out = sec.render_plan(base_plan(dependabot_prs={"status": "ok", "items": [], "note": "N"})).splitlines()
    assert out[-3:] == ["## open Dependabot PRs", "- none", "note: N"]
    text = "\n".join(out)
    for hdr in ("no patch available", "code scanning", "secrets (needs", "## npm"):
        assert hdr not in text


# ---------------------------------------------------------------- summary, cache, boot line


def test_build_summary_counts_by_severity_and_unavailable(monkeypatch):
    real_gmtime = time.gmtime
    monkeypatch.setattr(sec.time, "time", lambda: 1000.0)
    monkeypatch.setattr(sec.time, "gmtime", lambda: real_gmtime(1000.0))
    data = {
        "repo": "o/r",
        "kinds": {"dependabot": {"status": "ok", "count": 3}, "code": {"status": "unavailable", "reason": "r", "reason_code": "forbidden"}, "secret": {"status": "ok", "count": 0}},
        "rows": [dep(1, "npm", "a", "m", "high", "1"), dep(2, "npm", "b", "m", "high", "1"), dep(3, "npm", "c", "m", "low", "1"), code(4, "r", "p", "high", 1)],
    }
    s = sec.build_summary(data)
    assert s["fetched_at"] == 1000.0
    assert s["fetched_iso"] == "1970-01-01T00:16:40Z"
    assert s["repo"] == "o/r"
    assert s["kinds"] == {
        "dependabot": {"status": "ok", "count": 3, "by_severity": {"high": 2, "low": 1}},
        "code": {"status": "unavailable", "reason": "r", "reason_code": "forbidden"},
        "secret": {"status": "ok", "count": 0, "by_severity": {}},
    }


def test_write_cache_round_trip_and_atomic(tmp_path, monkeypatch):
    monkeypatch.setattr(sec, "_record_alerts", lambda s: None)
    data = {"repo": "o/r", "kinds": {"code": {"status": "ok", "count": 1}}, "rows": [code(1, "r", "p", "low", 1)]}
    p = sec.write_cache(str(tmp_path / "repo"), data)
    assert p == tmp_path / "repo" / sec.CACHE_REL
    assert json.loads(p.read_text())["kinds"]["code"] == {"status": "ok", "count": 1, "by_severity": {"low": 1}}
    assert not p.with_suffix(".tmp").exists()
    assert sec._read_cache(str(tmp_path / "repo"))["repo"] == "o/r"


def test_read_cache_rejects_non_dict_and_bad_json(tmp_path):
    p = sec.cache_path(str(tmp_path))
    p.parent.mkdir(parents=True)
    p.write_text("[1]")
    assert sec._read_cache(str(tmp_path)) is None
    p.write_text("{bad")
    assert sec._read_cache(str(tmp_path)) is None
    p.write_text('{"a": 1}')
    assert sec._read_cache(str(tmp_path)) == {"a": 1}


def put_cache(tmp_path, kinds):
    p = sec.cache_path(str(tmp_path))
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"fetched_at": time.time(), "kinds": kinds}))
    return str(tmp_path)


def test_boot_line_wording(tmp_path):
    root = put_cache(tmp_path, {
        "dependabot": {"status": "ok", "count": 3, "by_severity": {"high": 2, "low": 1}},
        "code": {"status": "ok", "count": 1, "by_severity": {"medium": 1}},
        "secret": {"status": "ok", "count": 2, "by_severity": {"critical": 2}},
    })
    assert sec.boot_line(root) == "security: 3 open Dependabot alerts (2 high), 1 open code-scanning alert (1 medium), 2 secret alerts - run the atlas-security skill"
    root = put_cache(tmp_path, {"secret": {"status": "ok", "count": 1}, "dependabot": {"status": "ok", "count": 2, "by_severity": {}}})
    assert sec.boot_line(root) == "security: 2 open Dependabot alerts, 1 secret alert - run the atlas-security skill"


def test_boot_line_unreadable_suffix_and_skips(tmp_path):
    root = put_cache(tmp_path, {
        "dependabot": {"status": "ok", "count": 1, "by_severity": {"critical": 1}},
        "code": {"status": "unavailable", "reason": "r", "reason_code": "forbidden"},
        "secret": "junk",
    })
    assert sec.boot_line(root) == "security: 1 open Dependabot alert (1 critical) (code-scanning unreadable) - run the atlas-security skill"
    root = put_cache(tmp_path, {"dependabot": {"status": "ok", "count": 0}, "code": {"status": "unavailable", "reason": "r", "reason_code": "forbidden"}})
    assert sec.boot_line(root) is None  # nothing to report and one kind did read OK


def test_boot_line_all_unavailable_reports_first_real_reason(tmp_path):
    root = put_cache(tmp_path, {
        "dependabot": {"status": "unavailable", "reason": "no GitHub remote", "reason_code": "no_remote"},
        "code": {"status": "unavailable", "reason": "HTTP 403: scope", "reason_code": "forbidden"},
        "secret": {"status": "unavailable", "reason_code": "error"},
    })
    assert sec.boot_line(root) == "security: alerts unavailable (HTTP 403: scope)"
    root = put_cache(tmp_path, {"secret": {"status": "unavailable", "reason_code": "error"}})
    assert sec.boot_line(root) == "security: alerts unavailable (unknown)"
    root = put_cache(tmp_path, {"code": {"status": "unavailable", "reason": "gh CLI not installed", "reason_code": "gh_missing"}})
    assert sec.boot_line(root) is None


def test_boot_line_no_cache_or_empty_kinds(tmp_path):
    assert sec.boot_line(str(tmp_path)) is None
    assert sec.boot_line(put_cache(tmp_path, {})) is None
    p = sec.cache_path(str(tmp_path))
    p.write_text(json.dumps({"kinds": []}))
    assert sec.boot_line(str(tmp_path)) is None


def test_boot_line_off(tmp_path, monkeypatch):
    root = put_cache(tmp_path, {"secret": {"status": "ok", "count": 4}})
    monkeypatch.setenv("ATLAS_SECURITY", "off")
    assert sec.boot_line(root) is None


# ---------------------------------------------------------------- analytics, protected refresh, refresh_async


def test_record_alerts_records_each_nonzero_known_bucket(monkeypatch):
    import atlas_analytics

    calls = []
    monkeypatch.setattr(atlas_analytics, "record", lambda k, n: calls.append((k, n)))
    sec._record_alerts({"kinds": {
        "dependabot": {"status": "ok", "by_severity": {"high": 2, "low": 0, "bogus": 5}},
        "code": {"status": "unavailable", "by_severity": {"high": 9}},
        "weird": {"status": "ok", "by_severity": {"high": 9}},
        "secret": {"status": "ok", "by_severity": {"critical": 1}},
    }})
    assert sorted(calls) == [("security.alerts.dependabot.high", 2), ("security.alerts.secret.critical", 1)]
    sec._record_alerts({})  # never raises
    sec._record_alerts(None)


def test_refresh_protected_async_stamps_then_throttles(tmp_path, monkeypatch):
    runs = []
    monkeypatch.setattr(sec.subprocess, "run", lambda argv, **kw: runs.append((argv, kw)))
    assert sec.refresh_protected_async(str(tmp_path)) is True
    argv, kw = runs[0]
    assert argv[0] == sys.executable and argv[1].endswith("atlas_git.py") and argv[2:] == ["--root", str(tmp_path), "protected", "--refresh"]
    assert kw["timeout"] == sec.GH_TIMEOUT and kw["stdin"] == subprocess.DEVNULL and kw["stdout"] == subprocess.DEVNULL
    stamp = tmp_path / sec.PROTECTED_STAMP_REL
    assert stamp.exists()
    assert sec.refresh_protected_async(str(tmp_path)) is False
    old = time.time() - 25 * 3600
    os.utime(stamp, (old, old))
    assert sec.refresh_protected_async(str(tmp_path)) is True
    assert len(runs) == 2
    recent = time.time() - 23 * 3600
    os.utime(stamp, (recent, recent))
    assert sec.refresh_protected_async(str(tmp_path)) is False


def test_refresh_protected_async_spawn_errors_return_false(tmp_path, monkeypatch):
    def boom(argv, **kw):
        raise subprocess.TimeoutExpired("x", 1)

    monkeypatch.setattr(sec.subprocess, "run", boom)
    assert sec.refresh_protected_async(str(tmp_path)) is False
    assert (tmp_path / sec.PROTECTED_STAMP_REL).exists()  # stamped before the attempt, so no retry storm


class Spawn:
    def __init__(self, monkeypatch):
        self.calls = []
        shim = types.SimpleNamespace(**{k: getattr(subprocess, k) for k in ("run", "DEVNULL", "SubprocessError")})
        shim.Popen = lambda argv, **kw: self.calls.append((argv, kw))
        monkeypatch.setattr(sec, "subprocess", shim)


def test_refresh_async_bad_hours_env_defaults_to_twelve(tmp_path, monkeypatch):
    sp = Spawn(monkeypatch)
    monkeypatch.setattr(sec.shutil, "which", lambda n: "/bin/gh")
    monkeypatch.setenv("ATLAS_SECURITY_REFRESH_HOURS", "soon")
    put_cache(tmp_path, {})
    assert sec.refresh_async(str(tmp_path)) is False  # fresh cache, default window
    assert not sp.calls


def test_refresh_async_lock_older_than_five_minutes_is_ignored(tmp_path, monkeypatch):
    sp = Spawn(monkeypatch)
    monkeypatch.setattr(sec.shutil, "which", lambda n: "/bin/gh")
    lock = tmp_path / sec.LOCK_REL
    lock.parent.mkdir(parents=True)
    lock.touch()
    assert sec.refresh_async(str(tmp_path)) is False
    old = time.time() - 301
    os.utime(lock, (old, old))
    assert sec.refresh_async(str(tmp_path)) is True
    assert sp.calls[0][0][-3:] == ["cache", "--root", str(tmp_path)]


def test_refresh_async_popen_failure_and_cache_without_timestamp(tmp_path, monkeypatch):
    monkeypatch.setattr(sec.shutil, "which", lambda n: "/bin/gh")

    class Bad:
        DEVNULL = subprocess.DEVNULL

        @staticmethod
        def Popen(*a, **k):
            raise OSError("fork failed")

    monkeypatch.setattr(sec, "subprocess", Bad)
    p = sec.cache_path(str(tmp_path))
    p.parent.mkdir(parents=True)
    p.write_text(json.dumps({"fetched_at": "yesterday", "kinds": {}}))
    assert sec.refresh_async(str(tmp_path)) is False


# ---------------------------------------------------------------- CLI


def test_parse_kinds():
    assert sec._parse_kinds("code, secret") == ["code", "secret"]
    assert sec._parse_kinds("dependabot,,") == ["dependabot"]
    import argparse

    for bad in ("", " , ", "code,nope"):
        with pytest.raises(argparse.ArgumentTypeError):
            sec._parse_kinds(bad)


def test_main_not_a_directory(tmp_path, capsys):
    assert sec.main(["alerts", "--root", str(tmp_path / "nope")]) == 1
    assert "atlas_security: not a directory:" in capsys.readouterr().err


def test_main_disabled_short_circuits(tmp_path, capsys, monkeypatch):
    monkeypatch.setenv("ATLAS_SECURITY", "off")
    monkeypatch.setattr(sec, "collect", lambda *a: pytest.fail("must not collect"))
    assert sec.main(["alerts", "--root", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "security disabled (ATLAS_SECURITY=off)"


def test_main_alerts_json_and_text_pass_args(tmp_path, capsys, monkeypatch):
    seen = []
    data = {"repo": "o/r", "kinds": {"code": {"status": "ok", "count": 0}}, "rows": []}
    monkeypatch.setattr(sec, "collect", lambda root, repo, kinds: seen.append((root, repo, kinds)) or data)
    assert sec.main(["alerts", "--root", str(tmp_path), "--repo", "o/r", "--kinds", "code,secret", "--json"]) == 0
    assert json.loads(capsys.readouterr().out) == data
    assert seen == [(str(tmp_path), "o/r", ["code", "secret"])]
    assert sec.main(["alerts", "--root", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "repo: o/r\ncode-scanning: ok, 0 open"
    assert seen[1][2] == ["dependabot", "code", "secret"]


def test_main_plan_json_and_text(tmp_path, capsys, monkeypatch):
    plan = base_plan()
    monkeypatch.setattr(sec, "build_plan", lambda root, repo, kinds: plan)
    assert sec.main(["plan", "--root", str(tmp_path), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["repo"] == "o/r"
    assert sec.main(["plan", "--root", str(tmp_path)]) == 0
    assert capsys.readouterr().out.startswith("repo: o/r\nDependabot: ok, 3 open")


def test_main_cache_writes_prints_path_and_refreshes_protected(tmp_path, capsys, monkeypatch):
    seen = {}
    monkeypatch.setattr(sec, "collect", lambda root, repo, kinds: seen.update(kinds=kinds) or {"repo": None, "kinds": {}, "rows": []})
    monkeypatch.setattr(sec, "_record_alerts", lambda s: None)
    monkeypatch.setattr(sec, "refresh_protected_async", lambda root: seen.update(protected=root))
    assert sec.main(["cache", "--root", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == str(tmp_path / sec.CACHE_REL)
    assert seen == {"kinds": list(sec.KINDS), "protected": str(tmp_path)}


def test_main_refresh_async_messages(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(sec, "refresh_async", lambda root: True)
    assert sec.main(["refresh-async", "--root", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "spawned"
    monkeypatch.setattr(sec, "refresh_async", lambda root: False)
    assert sec.main(["refresh-async", "--root", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "fresh or skipped"


def test_main_error_boundary(tmp_path, capsys, monkeypatch):
    def boom(*a):
        raise RuntimeError("kaput")

    monkeypatch.setattr(sec, "collect", boom)
    assert sec.main(["alerts", "--root", str(tmp_path)]) == 1
    assert capsys.readouterr().err.strip() == "atlas_security: RuntimeError: kaput"


def test_main_usage_errors_exit_two():
    for argv in ([], ["bogus"], ["alerts", "--kinds", "nope"]):
        with pytest.raises(SystemExit) as e:
            sec.main(argv)
        assert e.value.code == 2
