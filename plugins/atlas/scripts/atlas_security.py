#!/usr/bin/env python3
"""atlas_security - read GitHub security alerts and turn them into a fix plan.

Stdlib only. Every GitHub read goes through the `gh` CLI (never the network
directly). Kinds: Dependabot, code scanning, secret scanning.

CLI:
  alerts [--root R] [--repo owner/name] [--kinds dependabot,code,secret] [--json]
  plan   [same args]
  cache  [--root R] [--repo owner/name]      write <root>/.atlas/.run/security-cache.json
  refresh-async [--root R]                   spawn `cache` detached when the cache is stale

Module API for the boot hook: boot_line(root) reads the cache file only (no
subprocess, no network); refresh_async(root) is separate.

The leaked value of a secret-scanning alert (the API's `secret` field) is never
read into a row, the cache, a log or stdout.

Exit codes: 0 ok, 1 error, 2 bad usage.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

KINDS = ("dependabot", "code", "secret")
KIND_LABEL = {"dependabot": "Dependabot", "code": "code-scanning", "secret": "secret"}
ENDPOINT = {
    "dependabot": "dependabot/alerts",
    "code": "code-scanning/alerts",
    "secret": "secret-scanning/alerts",
}
SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
CODE_SEV_MAP = {"error": "high", "warning": "medium", "note": "low"}
TRIVIAL_REASONS = ("no_remote", "gh_missing")
CACHE_REL = Path(".atlas") / ".run" / "security-cache.json"
LOCK_REL = Path(".atlas") / ".run" / "security-refresh.lock"
PROTECTED_STAMP_REL = Path(".atlas") / ".run" / "git-protected-refresh.stamp"
GH_TIMEOUT = 90


def disabled() -> bool:
    return os.environ.get("ATLAS_SECURITY", "").strip().lower() in (
        "off",
        "0",
        "false",
        "disabled",
    )


# --------------------------------------------------------------------------- gh


def _run(argv: list[str], cwd: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        argv, capture_output=True, text=True, timeout=GH_TIMEOUT, cwd=cwd
    )


def parse_remote(url: str) -> tuple[str, str] | None:
    """owner/repo from an https, ssh:// or scp-style GitHub remote URL."""
    url = (url or "").strip()
    m = re.match(
        r"^(?:https?|ssh|git)://(?:[^@/]+@)?([^/:]+)(?::\d+)?/([^/]+)/([^/]+?)(?:\.git)?/?$",
        url,
    )
    if not m:
        m = re.match(r"^(?:[^@/]+@)?([^/:]+):([^/]+)/([^/]+?)(?:\.git)?/?$", url)
    if not m:
        return None
    host, owner, repo = m.groups()
    if host.lower() != "github.com" and not host.lower().startswith("github."):
        return None
    return owner, repo


def resolve_repo(
    root: str, repo: str | None
) -> tuple[str | None, str | None, str | None]:
    """-> (owner, repo, error_reason)."""
    if repo:
        if re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
            o, r = repo.split("/", 1)
            return o, r, None
        return None, None, "bad --repo (want owner/name)"
    try:
        p = _run(["git", "-C", root, "remote", "get-url", "origin"])
    except (OSError, subprocess.SubprocessError):
        return None, None, "no GitHub remote"
    if p.returncode != 0:
        return None, None, "no GitHub remote"
    parsed = parse_remote(p.stdout)
    if not parsed:
        return None, None, "no GitHub remote"
    return parsed[0], parsed[1], None


def _decode_stream(text: str) -> list:
    """gh --paginate prints one JSON array per page back to back."""
    dec = json.JSONDecoder()
    out: list = []
    i, n = 0, len(text)
    while i < n:
        while i < n and text[i].isspace():
            i += 1
        if i >= n:
            break
        val, i = dec.raw_decode(text, i)
        if isinstance(val, list):
            out.extend(val)
        else:
            out.append(val)
    return out


def classify_error(text: str) -> tuple[str, str]:
    t = text or ""
    if re.search(r"HTTP 403", t):
        return (
            "forbidden",
            "HTTP 403: token lacks the security_events scope, or this feature is not enabled for the repo",
        )
    if re.search(r"HTTP 404", t):
        return (
            "not_found",
            "HTTP 404: feature disabled, nothing analysed yet, or no access",
        )
    if re.search(
        r"HTTP 401|gh auth login|not logged in|authentication|GH_TOKEN", t, re.I
    ):
        return "not_authenticated", "gh is not authenticated (run gh auth login)"
    first = (t.strip().splitlines() or ["unknown error"])[0][:160]
    return "error", f"gh error: {first}"


def fetch_kind(kind: str, owner: str, repo: str) -> dict:
    """-> {"status": "ok", "raw": [...]} or {"status": "unavailable", "reason": str, "reason_code": str}."""
    if not shutil.which("gh"):
        return {
            "status": "unavailable",
            "reason": "gh CLI not installed",
            "reason_code": "gh_missing",
        }
    argv = [
        "gh",
        "api",
        "-X",
        "GET",
        "--paginate",
        f"repos/{owner}/{repo}/{ENDPOINT[kind]}",
        "-f",
        "state=open",
        "-f",
        "per_page=100",
    ]
    try:
        p = _run(argv)
    except (OSError, subprocess.SubprocessError) as e:
        return {
            "status": "unavailable",
            "reason": f"gh failed: {type(e).__name__}",
            "reason_code": "error",
        }
    if p.returncode != 0:
        code, reason = classify_error((p.stderr or "") + "\n" + (p.stdout or "")[:400])
        return {"status": "unavailable", "reason": reason, "reason_code": code}
    try:
        raw = _decode_stream(p.stdout)
    except ValueError:
        return {
            "status": "unavailable",
            "reason": "gh returned unparseable output",
            "reason_code": "error",
        }
    return {"status": "ok", "raw": raw}


# ----------------------------------------------------------------- normalization


def _sev(v) -> str:
    v = (v or "").lower()
    return v if v in SEV_ORDER else "medium"


def norm_dependabot(a: dict) -> dict:
    dep = a.get("dependency") or {}
    pkg = dep.get("package") or {}
    adv = a.get("security_advisory") or {}
    vul = a.get("security_vulnerability") or {}
    return {
        "kind": "dependabot",
        "number": a.get("number"),
        "severity": _sev(vul.get("severity") or adv.get("severity")),
        "summary": adv.get("summary") or "",
        "ecosystem": pkg.get("ecosystem")
        or (vul.get("package") or {}).get("ecosystem"),
        "package": pkg.get("name") or (vul.get("package") or {}).get("name"),
        "manifest_path": dep.get("manifest_path"),
        "scope": dep.get("scope"),
        "relationship": dep.get("relationship"),
        "vulnerable_range": vul.get("vulnerable_version_range"),
        "fixed_in": (vul.get("first_patched_version") or {}).get("identifier"),
        "ghsa_id": adv.get("ghsa_id"),
        "cve_id": adv.get("cve_id"),
        "html_url": a.get("html_url"),
    }


def norm_code(a: dict) -> dict:
    rule = a.get("rule") or {}
    loc = (a.get("most_recent_instance") or {}).get("location") or {}
    sev = rule.get("security_severity_level")
    sev = (
        _sev(sev)
        if sev
        else CODE_SEV_MAP.get((rule.get("severity") or "").lower(), "medium")
    )
    return {
        "kind": "code",
        "number": a.get("number"),
        "severity": sev,
        "summary": rule.get("description") or rule.get("name") or "",
        "rule_id": rule.get("id"),
        "tool": (a.get("tool") or {}).get("name"),
        "path": loc.get("path"),
        "start_line": loc.get("start_line"),
        "html_url": a.get("html_url"),
    }


def norm_secret(a: dict) -> dict:
    # Explicit field copy only: the `secret` value is never read.
    loc = a.get("first_location_detected") or {}
    return {
        "kind": "secret",
        "number": a.get("number"),
        "severity": "critical",
        "summary": a.get("secret_type_display_name") or a.get("secret_type") or "",
        "secret_type": a.get("secret_type"),
        "validity": a.get("validity"),
        "path": loc.get("path") if isinstance(loc, dict) else None,
        "html_url": a.get("html_url"),
    }


NORMALIZERS = {"dependabot": norm_dependabot, "code": norm_code, "secret": norm_secret}


def sort_rows(rows: list[dict]) -> list[dict]:
    return sorted(
        rows,
        key=lambda r: (
            SEV_ORDER.get(r["severity"], 9),
            KINDS.index(r["kind"]),
            r.get("number") or 0,
        ),
    )


def collect(root: str, repo: str | None, kinds: list[str]) -> dict:
    """-> {"repo": "o/r"|None, "kinds": {kind: {status, count|reason, reason_code}}, "rows": [...]}."""
    owner, name, err = resolve_repo(root, repo)
    result: dict = {
        "repo": f"{owner}/{name}" if owner else None,
        "kinds": {},
        "rows": [],
    }
    for kind in kinds:
        if err:
            result["kinds"][kind] = {
                "status": "unavailable",
                "reason": err,
                "reason_code": "no_remote" if "remote" in err else "error",
            }
            continue
        got = fetch_kind(kind, owner, name)
        if got["status"] != "ok":
            result["kinds"][kind] = {
                k: got[k] for k in ("status", "reason", "reason_code")
            }
            continue
        rows = [NORMALIZERS[kind](a) for a in got["raw"] if isinstance(a, dict)]
        result["rows"].extend(rows)
        result["kinds"][kind] = {"status": "ok", "count": len(rows)}
    result["rows"] = sort_rows(result["rows"])
    return result


# -------------------------------------------------------------------------- plan

ECO_ALIASES = {"rust": "cargo", "rubygems": "bundler", "go": "go"}


def _vkey(v: str | None):
    parts = re.findall(r"\d+|[A-Za-z]+", v or "")
    return tuple((0, int(p)) if p.isdigit() else (-1, p) for p in parts)


def _vmax(versions: list[str]) -> str:
    return max(versions, key=_vkey)


def _lockfiles(root: str, mdir: str) -> set[str]:
    d = Path(root) / mdir
    try:
        return {p.name for p in d.iterdir()}
    except OSError:
        return set()


def fix_command(
    eco: str, pkg: str, ver: str, direct: bool, files: set[str], manifest: str
) -> str:
    eco_l = (eco or "").lower()
    if eco_l == "npm":
        if "pnpm-lock.yaml" in files:
            return (
                f"pnpm add {pkg}@{ver}"
                if direct
                else f"pnpm update {pkg}@{ver} --depth Infinity  (or a pnpm.overrides entry '{pkg}': '>={ver}')"
            )
        if "yarn.lock" in files:
            return (
                f"yarn add {pkg}@{ver}"
                if direct
                else f"add a resolutions entry '{pkg}': '>={ver}' to package.json, then yarn install"
            )
        if "bun.lock" in files or "bun.lockb" in files:
            return (
                f"bun add {pkg}@{ver}"
                if direct
                else f"bun update {pkg}  (or an overrides entry '{pkg}': '>={ver}')"
            )
        return (
            f"npm install {pkg}@{ver}"
            if direct
            else f"npm update {pkg}  (or an overrides entry '{pkg}': '>={ver}' in package.json)"
        )
    if eco_l == "pip":
        if "uv.lock" in files:
            return (
                f"uv lock --upgrade-package {pkg}"
                if not direct
                else f"uv add '{pkg}>={ver}'"
            )
        if "poetry.lock" in files:
            return f"poetry update {pkg}"
        return f"edit {manifest}: pin {pkg}>={ver}, then reinstall"
    if eco_l == "go":
        return f"go get {pkg}@v{ver.lstrip('v')} && go mod tidy"
    if eco_l == "rust":
        return f"cargo update -p {pkg} --precise {ver}"
    if eco_l == "composer":
        return f"edit {manifest}: require {pkg} >={ver}, then composer update {pkg}"
    if eco_l == "rubygems":
        return f"edit Gemfile: gem '{pkg}', '>= {ver}', then bundle update {pkg}"
    if eco_l == "maven":
        return f"edit {manifest}: set {pkg} version >= {ver} (or dependencyManagement), then rebuild"
    if eco_l == "nuget":
        return f"edit {manifest}: set PackageReference {pkg} Version >= {ver}, then dotnet restore"
    return f"edit {manifest}: bump {pkg} to >= {ver}"


def build_plan(root: str, repo: str | None, kinds: list[str]) -> dict:
    data = collect(root, repo, kinds)
    rows = data["rows"]
    groups: dict[tuple, dict] = {}
    no_patch: list[dict] = []
    for r in (x for x in rows if x["kind"] == "dependabot"):
        if not r["fixed_in"]:
            no_patch.append(
                {
                    k: r[k]
                    for k in (
                        "number",
                        "severity",
                        "ecosystem",
                        "package",
                        "manifest_path",
                        "vulnerable_range",
                        "ghsa_id",
                        "cve_id",
                        "summary",
                        "html_url",
                    )
                }
            )
            continue
        manifest = r["manifest_path"] or ""
        mdir = os.path.dirname(manifest)
        key = (r["ecosystem"], mdir, r["package"])
        g = groups.setdefault(
            key,
            {
                "ecosystem": r["ecosystem"],
                "manifest_dir": mdir or ".",
                "manifest_path": manifest,
                "package": r["package"],
                "direct": False,
                "severity": r["severity"],
                "alerts": [],
                "_vers": [],
            },
        )
        g["alerts"].append(r["number"])
        g["_vers"].append(r["fixed_in"])
        g["direct"] = g["direct"] or r["relationship"] == "direct"
        if SEV_ORDER[r["severity"]] < SEV_ORDER[g["severity"]]:
            g["severity"] = r["severity"]
    by_eco: dict[str, list[dict]] = {}
    for g in groups.values():
        ver = _vmax(g.pop("_vers"))
        g["alerts"].sort()
        files = _lockfiles(root, g["manifest_dir"] if g["manifest_dir"] != "." else "")
        g["fix_to"] = ver
        g["command"] = fix_command(
            g["ecosystem"], g["package"], ver, g["direct"], files, g["manifest_path"]
        )
        by_eco.setdefault(
            ECO_ALIASES.get(
                (g["ecosystem"] or "").lower(), g["ecosystem"] or "unknown"
            ),
            [],
        ).append(g)
    for items in by_eco.values():
        items.sort(
            key=lambda g: (
                SEV_ORDER[g["severity"]],
                g["manifest_dir"],
                g["package"] or "",
            )
        )
    ecosystems = [{"ecosystem": e, "items": by_eco[e]} for e in sorted(by_eco)]

    code_items: dict[tuple, dict] = {}
    for r in (x for x in rows if x["kind"] == "code"):
        it = code_items.setdefault(
            (r["rule_id"], r["path"]),
            {
                "rule_id": r["rule_id"],
                "path": r["path"],
                "tool": r["tool"],
                "severity": r["severity"],
                "summary": r["summary"],
                "alerts": [],
                "lines": [],
            },
        )
        it["alerts"].append(r["number"])
        it["lines"].append(r["start_line"])
        if SEV_ORDER[r["severity"]] < SEV_ORDER[it["severity"]]:
            it["severity"] = r["severity"]
    code = sorted(
        code_items.values(),
        key=lambda i: (SEV_ORDER[i["severity"]], i["path"] or "", i["rule_id"] or ""),
    )

    secrets = [
        {
            "number": r["number"],
            "secret_type": r["secret_type"],
            "summary": r["summary"],
            "path": r["path"],
            "validity": r["validity"],
            "html_url": r["html_url"],
            "action": "rotate the credential at its provider, then remove it from history; Atlas cannot fix this by code",
        }
        for r in rows
        if r["kind"] == "secret"
    ]

    prs: dict = {"status": "unavailable", "reason": "not queried", "items": []}
    owner, name, err = resolve_repo(root, repo)
    if not err and shutil.which("gh"):
        try:
            p = _run(
                [
                    "gh",
                    "pr",
                    "list",
                    "--repo",
                    f"{owner}/{name}",
                    "--author",
                    "app/dependabot",
                    "--state",
                    "open",
                    "--json",
                    "number,title,headRefName",
                ]
            )
            if p.returncode == 0:
                prs = {
                    "status": "ok",
                    "items": json.loads(p.stdout or "[]"),
                    "note": "Dependabot closes its own PR once the default branch contains the fix",
                }
            else:
                prs["reason"] = classify_error(
                    (p.stderr or "") + (p.stdout or "")[:400]
                )[1]
        except (OSError, subprocess.SubprocessError, ValueError) as e:
            prs["reason"] = f"gh failed: {type(e).__name__}"
    elif err:
        prs["reason"] = err
    return {
        "repo": data["repo"],
        "kinds": data["kinds"],
        "ecosystems": ecosystems,
        "no_patch": no_patch,
        "code_scanning": code,
        "secrets": secrets,
        "dependabot_prs": prs,
    }


# ------------------------------------------------------------------------ output


def render_alerts(data: dict) -> str:
    lines = [f"repo: {data['repo'] or 'unknown'}"]
    for k in KINDS:
        s = data["kinds"].get(k)
        if s is None:
            continue
        lines.append(
            f"{KIND_LABEL[k]}: "
            + (
                f"ok, {s['count']} open"
                if s["status"] == "ok"
                else f"UNAVAILABLE - {s['reason']}"
            )
        )
    if data["rows"]:
        lines.append("")
        lines.append("sev       kind           #     where / what")
        for r in data["rows"]:
            if r["kind"] == "dependabot":
                what = f"{r['package']} ({r['ecosystem']}) {r['vulnerable_range'] or '?'} -> {r['fixed_in'] or 'no patch'}: {r['summary']}"
            elif r["kind"] == "code":
                what = f"{r['rule_id']} {r['path']}:{r['start_line']}: {r['summary']}"
            else:
                what = (
                    f"{r['summary']}"
                    + (f" in {r['path']}" if r.get("path") else "")
                    + (f" [{r['validity']}]" if r.get("validity") else "")
                )
            lines.append(
                f"{r['severity']:<9} {r['kind']:<13} {r['number']!s:<5} {what}"
            )
    return "\n".join(lines)


def render_plan(plan: dict) -> str:
    lines = [f"repo: {plan['repo'] or 'unknown'}"]
    for k in KINDS:
        s = plan["kinds"].get(k)
        if s is not None:
            lines.append(
                f"{KIND_LABEL[k]}: "
                + (
                    f"ok, {s['count']} open"
                    if s["status"] == "ok"
                    else f"UNAVAILABLE - {s['reason']}"
                )
            )
    for e in plan["ecosystems"]:
        lines += ["", f"## {e['ecosystem']}"]
        for i, g in enumerate(e["items"], 1):
            kind = "direct" if g["direct"] else "transitive"
            lines.append(
                f"{i}. [{g['severity']}] {g['package']} -> {g['fix_to']} ({kind}, {g['manifest_dir']}, alerts {g['alerts']})"
            )
            lines.append(f"   $ {g['command']}")
    if plan["no_patch"]:
        lines += ["", "## no patch available"]
        for n in plan["no_patch"]:
            lines.append(
                f"- [{n['severity']}] {n['package']} ({n['ecosystem']}) {n['vulnerable_range']} {n['ghsa_id'] or ''}: {n['summary']}"
            )
    if plan["code_scanning"]:
        lines += ["", "## code scanning (one item per rule + path)"]
        for c in plan["code_scanning"]:
            lines.append(
                f"- [{c['severity']}] {c['rule_id']} {c['path']} lines {sorted(set(x for x in c['lines'] if x))} ({c['tool']}): {c['summary']}"
            )
    if plan["secrets"]:
        lines += ["", "## secrets (needs the user)"]
        for s in plan["secrets"]:
            lines.append(
                f"- #{s['number']} {s['summary']}"
                + (f" in {s['path']}" if s["path"] else "")
                + f": {s['action']}"
            )
    prs = plan["dependabot_prs"]
    lines += ["", "## open Dependabot PRs"]
    if prs["status"] == "ok":
        lines += [
            f"- #{p['number']} {p['title']} ({p['headRefName']})" for p in prs["items"]
        ] or ["- none"]
        lines.append(f"note: {prs['note']}")
    else:
        lines.append(f"- not listed: {prs['reason']}")
    return "\n".join(lines)


# ------------------------------------------------------------------------- cache


def build_summary(data: dict) -> dict:
    kinds: dict = {}
    for k, s in data["kinds"].items():
        if s["status"] == "ok":
            by: dict[str, int] = {}
            for r in data["rows"]:
                if r["kind"] == k:
                    by[r["severity"]] = by.get(r["severity"], 0) + 1
            kinds[k] = {"status": "ok", "count": s["count"], "by_severity": by}
        else:
            kinds[k] = {
                "status": "unavailable",
                "reason": s["reason"],
                "reason_code": s["reason_code"],
            }
    return {
        "fetched_at": time.time(),
        "fetched_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "repo": data["repo"],
        "kinds": kinds,
    }


def cache_path(root: str) -> Path:
    return Path(root) / CACHE_REL


def write_cache(root: str, data: dict) -> Path:
    path = cache_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(build_summary(data), indent=2), encoding="utf-8")
    os.replace(tmp, path)
    _record_alerts(build_summary(data))
    return path


def _record_alerts(summary: dict) -> None:
    """Anonymous analytics: open-alert tallies per kind and severity from one refresh. Never raises."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from atlas_analytics import record

        for kind, st in (summary.get("kinds") or {}).items():
            if kind in KINDS and st.get("status") == "ok":
                for sev, n in (st.get("by_severity") or {}).items():
                    if sev in SEV_ORDER and n:
                        record(f"security.alerts.{kind}.{sev}", n)
    except Exception:  # noqa: BLE001 -- analytics never breaks a refresh
        pass


def refresh_protected_async(root: str) -> bool:
    """From the background refresh: ask atlas_git to re-read GitHub branch protection, at most once per 24h.

    The attempt is stamped before the call, so an unauthenticated gh or a 403 is not retried until tomorrow.
    True if the call was made."""
    stamp = Path(root) / PROTECTED_STAMP_REL
    try:
        if time.time() - stamp.stat().st_mtime < 24 * 3600:
            return False
    except OSError:
        pass
    try:
        stamp.parent.mkdir(parents=True, exist_ok=True)
        stamp.touch()
        subprocess.run(
            [
                sys.executable,
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "atlas_git.py"),
                "--root",
                root,
                "protected",
                "--refresh",
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=GH_TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return True


def _read_cache(root: str) -> dict | None:
    try:
        d = json.loads(cache_path(root).read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def boot_line(root: str) -> str | None:
    """One line for the session banner. Reads the cache file only."""
    if disabled():
        return None
    c = _read_cache(root)
    kinds = (c or {}).get("kinds")
    if not isinstance(kinds, dict) or not kinds:
        return None
    parts, unreadable = [], []
    for k in KINDS:
        s = kinds.get(k)
        if not isinstance(s, dict):
            continue
        if s.get("status") == "ok":
            n = int(s.get("count") or 0)
            if n <= 0:
                continue
            by = s.get("by_severity") or {}
            top = next((sv for sv in SEV_ORDER if by.get(sv)), None)
            noun = "alert" if n == 1 else "alerts"
            if k == "secret":
                parts.append(f"{n} secret {noun}")
            else:
                parts.append(
                    f"{n} open {KIND_LABEL[k]} {noun}"
                    + (f" ({by[top]} {top})" if top else "")
                )
        else:
            unreadable.append((k, s))
    if parts:
        line = "security: " + ", ".join(parts)
        if unreadable:
            line += f" ({', '.join(KIND_LABEL[k] for k, _ in unreadable)} unreadable)"
        return line + " - run the atlas-security skill"
    ok_any = any(
        isinstance(s, dict) and s.get("status") == "ok" for s in kinds.values()
    )
    if unreadable and not ok_any:
        real = [s for _, s in unreadable if s.get("reason_code") not in TRIVIAL_REASONS]
        if real:
            return f"security: alerts unavailable ({real[0].get('reason', 'unknown')})"
    return None


def refresh_async(root: str) -> bool:
    """Spawn `cache` detached when the cache is stale. True if a process was spawned."""
    if disabled() or not shutil.which("gh"):
        return False
    try:
        hours = float(os.environ.get("ATLAS_SECURITY_REFRESH_HOURS", "12"))
    except ValueError:
        hours = 12.0
    c = _read_cache(root)
    fetched = (c or {}).get("fetched_at")
    if isinstance(fetched, (int, float)) and time.time() - fetched < hours * 3600:
        return False
    lock = Path(root) / LOCK_REL
    try:
        if lock.exists() and time.time() - lock.stat().st_mtime < 300:
            return False  # a refresh was started in the last 5 minutes
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.touch()
    except OSError:
        pass
    try:
        subprocess.Popen(
            [sys.executable, os.path.abspath(__file__), "cache", "--root", root],
            start_new_session=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        return False
    return True


# --------------------------------------------------------------------------- CLI


def _parse_kinds(s: str) -> list[str]:
    out = [k.strip() for k in s.split(",") if k.strip()]
    bad = [k for k in out if k not in KINDS]
    if bad or not out:
        raise argparse.ArgumentTypeError(
            f"unknown kind(s) {bad or s!r}; choose from {','.join(KINDS)}"
        )
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="atlas_security.py",
        description="GitHub security alerts for Atlas (via gh)",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p: argparse.ArgumentParser, with_kinds=True, with_json=True):
        p.add_argument("--root", default=".", help="repo root (default: cwd)")
        p.add_argument(
            "--repo", help="owner/name (default: parsed from the origin remote)"
        )
        if with_kinds:
            p.add_argument(
                "--kinds",
                type=_parse_kinds,
                default=list(KINDS),
                help="comma list of dependabot,code,secret",
            )
        if with_json:
            p.add_argument(
                "--json", action="store_true", help="machine-readable output"
            )

    common(sub.add_parser("alerts", help="list open alerts, normalized"))
    common(sub.add_parser("plan", help="ordered fix plan"))
    common(
        sub.add_parser("cache", help="write the boot-line cache"),
        with_kinds=False,
        with_json=False,
    )
    r = sub.add_parser("refresh-async", help="spawn `cache` detached if stale")
    r.add_argument("--root", default=".")
    args = ap.parse_args(argv)

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print(f"atlas_security: not a directory: {root}", file=sys.stderr)
        return 1
    if disabled():
        print("security disabled (ATLAS_SECURITY=off)")
        return 0
    try:
        if args.cmd == "alerts":
            data = collect(root, args.repo, args.kinds)
            print(json.dumps(data, indent=2) if args.json else render_alerts(data))
        elif args.cmd == "plan":
            plan = build_plan(root, args.repo, args.kinds)
            print(json.dumps(plan, indent=2) if args.json else render_plan(plan))
        elif args.cmd == "cache":
            print(write_cache(root, collect(root, args.repo, list(KINDS))))
            refresh_protected_async(root)
        elif args.cmd == "refresh-async":
            print("spawned" if refresh_async(root) else "fresh or skipped")
    except Exception as e:  # noqa: BLE001 - CLI boundary
        print(f"atlas_security: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
