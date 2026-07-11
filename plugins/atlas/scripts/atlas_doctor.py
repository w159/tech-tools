#!/usr/bin/env python3
"""atlas-doctor: detect and repair the plugin-rollback failure mode.

Root cause this guards against (2026-07-01 incident): the tech-tools
marketplace entry in known_marketplaces.json pointed at a stale fork with
autoUpdate on, so every marketplace update silently rolled atlas back to
1.0.1 and the whole subagent/hook engine vanished.

Checks (CHECK), optionally repairs (--fix = SET), then re-checks (VERIFY).
Exit 0: healthy or remediated. Exit 1: problems remain. Exit 2: internal error.
--hook mode always exits 0 and prints a loud warning only when broken, so it
is safe to wire into SessionStart.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

# --- environment (overridable so tests never touch the real install) ---
PLUGINS_DIR = os.environ.get("ATLAS_PLUGINS_DIR") or os.path.expanduser(
    "~/.claude/plugins"
)
STATE_PATH = os.environ.get("ATLAS_DOCTOR_STATE") or os.path.expanduser(
    "~/.atlas/doctor-state.json"
)


def _load_json(path):
    with open(path) as f:
        return json.load(f)


def _save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def _git(args, cwd):
    return subprocess.run(
        ["git"] + args, cwd=cwd, capture_output=True, text=True, timeout=60
    )


def norm_repo(url):
    """Compare repo URLs by owner/name only (scheme and .git suffix vary)."""
    if not url:
        return ""
    url = url.strip().rstrip("/")
    url = re.sub(r"\.git$", "", url)
    m = re.search(r"(?:github\.com[:/])([^/]+/[^/]+)$", url)
    return (m.group(1) if m else url).lower()


def ver_tuple(v):
    parts = re.findall(r"\d+", str(v))
    return tuple(int(p) for p in parts[:3]) or (0,)


def self_manifest():
    """Manifest of the plugin this script ships inside of."""
    root = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
    return root, _load_json(os.path.join(root, ".claude-plugin", "plugin.json"))


def find_registration(installed, plugin_name):
    for key, entries in installed.get("plugins", {}).items():
        if key.split("@")[0] == plugin_name and entries:
            return key, entries[0]
    return None, None


def marketplace_plugin_version(clone_dir, plugin_name):
    mf = os.path.join(
        clone_dir, "plugins", plugin_name, ".claude-plugin", "plugin.json"
    )
    return _load_json(mf)["version"] if os.path.exists(mf) else None


# --- checks: each appends (check_id, ok, detail) ---


# Renamed/deprecated asset names that must not shadow the live set anywhere.
# Plugin-era renames (left) and pre-plugin ancestors (right) both linger as
# ghost slash-commands/agents when a stale copy survives an upgrade.
DEPRECATED_SKILLS = {
    "atlas-connectors",
    "atlas-loop",
    "atlas-operating-contract",
    "atlas-self-improving",
    "atlas-uxt-swarm",
    "orchestrate",
    "uxt-swarm",
    "self-improving",
    "connector-ops",
}
DEPRECATED_AGENTS = {
    "orc-completeness-critic",
    "orc-db-prober",
    "orc-docs-auditor",
    "orc-docs-curator",
    "orc-explorer",
    "orc-implementer",
    "orc-planner",
    "orc-ui-runtime-tester",
    "orc-verifier",
}


def count_assets(ip):
    """Count only real assets: .md files for commands/agents, dirs holding a
    SKILL.md for skills - so .DS_Store or stray files never skew the count."""
    counts = {}
    for d in ("commands", "agents"):
        p = os.path.join(ip, d)
        counts[d] = (
            len([f for f in os.listdir(p) if f.endswith(".md")])
            if os.path.isdir(p)
            else 0
        )
    sp = os.path.join(ip, "skills")
    counts["skills"] = (
        len(
            [
                s
                for s in os.listdir(sp)
                if os.path.isfile(os.path.join(sp, s, "SKILL.md"))
            ]
        )
        if os.path.isdir(sp)
        else 0
    )
    return counts


def find_stale_assets(ip, clone, plugin_name, user_skills=None, user_agents=None):
    """Locate deprecated/renamed skill dirs and agent files that still exist.

    Scans the installed copy, the marketplace clone's plugin dir, and the
    user-level ~/.claude/skills and ~/.claude/agents dirs (symlinks resolved).
    Returns absolute paths; the fixer quarantines them (reversible move)."""
    stale = []
    plugin_roots = [ip]
    if clone:
        plugin_roots.append(os.path.join(clone, "plugins", plugin_name))
    for root in plugin_roots:
        sk = os.path.join(root or "", "skills")
        if os.path.isdir(sk):
            for name in sorted(os.listdir(sk)):
                if name.split(".backup-")[0] in DEPRECATED_SKILLS:
                    stale.append(os.path.join(sk, name))
    # Derive user-level dirs as siblings of PLUGINS_DIR (~/.claude/plugins ->
    # ~/.claude/{skills,agents}) so tests that patch PLUGINS_DIR stay sandboxed.
    claude_home = os.path.dirname(os.path.realpath(PLUGINS_DIR))
    user_skills = user_skills or os.path.join(claude_home, "skills")
    if os.path.isdir(user_skills):
        for name in sorted(os.listdir(user_skills)):
            if name.split(".backup-")[0] in DEPRECATED_SKILLS:
                stale.append(os.path.join(user_skills, name))
    user_agents = user_agents or os.path.join(claude_home, "agents")
    if os.path.isdir(user_agents):
        for name in sorted(os.listdir(user_agents)):
            if name.split(".", 1)[0] in DEPRECATED_AGENTS:
                stale.append(os.path.join(user_agents, name))
    return stale


def check_orchestration_wiring(ip):
    """Verify the wiring that makes subagent discipline actually engage:
    the tripwire must see Skill/Agent/Task events and auto-set the
    orchestration marker - otherwise the gates silently never fire."""
    problems = []
    hooks_file = os.path.join(ip, "hooks", "hooks.json")
    try:
        blob = _load_json(hooks_file)
        matcher = ""
        for grp in blob.get("hooks", {}).get("PostToolUse", []):
            if "dispatch_tripwire.py" in json.dumps(grp):
                matcher = grp.get("matcher", "")
        for tool in ("Agent", "Task", "Skill"):
            if tool not in matcher:
                problems.append(f"PostToolUse matcher missing {tool}")
    except Exception as e:
        problems.append(f"hooks.json unreadable: {e}")
    tripwire = os.path.join(ip, "hooks", "dispatch_tripwire.py")
    try:
        with open(tripwire, encoding="utf-8") as f:
            src = f.read()
        if "ORCH_SKILLS" not in src:
            problems.append("dispatch_tripwire.py lacks ORCH_SKILLS auto-marking")
        if "mark_orchestrating" not in src:
            problems.append("dispatch_tripwire.py never calls mark_orchestrating")
    except Exception as e:
        problems.append(f"dispatch_tripwire.py unreadable: {e}")
    return problems


def run_checks(plugin_name="atlas"):
    results = []
    ctx = {}

    def add(cid, ok, detail):
        results.append({"check": cid, "ok": ok, "detail": detail})

    try:
        _, manifest = self_manifest()
    except Exception as e:  # manifest unreadable = cannot even self-describe
        add("self-manifest", False, f"cannot read own plugin.json: {e}")
        return results, ctx
    expected_repo = norm_repo(manifest.get("repository", ""))
    ctx["expected_repo"] = expected_repo

    installed_path = os.path.join(PLUGINS_DIR, "installed_plugins.json")
    markets_path = os.path.join(PLUGINS_DIR, "known_marketplaces.json")
    try:
        installed = _load_json(installed_path)
        markets = _load_json(markets_path)
    except Exception as e:
        add("config-readable", False, f"cannot read plugin config: {e}")
        return results, ctx

    key, reg = find_registration(installed, plugin_name)
    if not reg or not key:
        add("registered", False, f"{plugin_name} not found in installed_plugins.json")
        return results, ctx
    add("registered", True, f"{key} at {reg['version']}")
    mkt_name = key.split("@", 1)[1]
    mkt = markets.get(mkt_name, {})
    ctx.update(key=key, reg=reg, mkt_name=mkt_name, mkt=mkt)

    # C1: marketplace source must be the canonical repo, not a fork
    # known_marketplaces.json stores the source as {"source": "github", "repo": "owner/name"}
    src = mkt.get("source", {})
    src_url = src.get("url", "") or src.get("repo", "")
    ok = norm_repo(src_url) == expected_repo
    add("marketplace-source", ok, f"{src_url or 'MISSING'} (expected {expected_repo})")

    # C2: the marketplace git clone's origin must match too
    clone = mkt.get("installLocation", "")
    ctx["clone"] = clone
    if clone and os.path.isdir(os.path.join(clone, ".git")):
        r = _git(["remote", "get-url", "origin"], clone)
        remote = r.stdout.strip()
        add(
            "clone-remote",
            norm_repo(remote) == expected_repo,
            f"{remote or r.stderr.strip()}",
        )
    else:
        add("clone-remote", False, f"marketplace clone missing at {clone or '?'}")

    # C3: installed version matches what the marketplace currently offers
    mkt_ver = marketplace_plugin_version(clone, plugin_name) if clone else None
    ctx["mkt_ver"] = mkt_ver
    if mkt_ver:
        add(
            "version-sync",
            reg["version"] == mkt_ver,
            f"installed {reg['version']}, marketplace {mkt_ver}",
        )
    else:
        add("version-sync", False, "marketplace copy has no readable plugin.json")

    # C4: rollback tripwire - never accept a version below the high-water mark
    state = _load_json(STATE_PATH) if os.path.exists(STATE_PATH) else {}
    floor = state.get(key, "0")
    if ver_tuple(reg["version"]) < ver_tuple(floor):
        add(
            "rollback",
            False,
            f"installed {reg['version']} is BELOW previously seen {floor} - "
            "a marketplace update downgraded this plugin",
        )
    else:
        add("rollback", True, f"{reg['version']} >= floor {floor}")
        state[key] = max(reg["version"], floor, key=ver_tuple)
        _save_json(STATE_PATH, state)

    # C5: install path is intact and not marked for garbage collection
    ip = reg.get("installPath", "")
    ip_mf = os.path.join(ip, ".claude-plugin", "plugin.json")
    if not os.path.exists(ip_mf):
        add("install-path", False, f"missing manifest under {ip}")
    elif os.path.exists(os.path.join(ip, ".orphaned_at")):
        add("install-path", False, f"{ip} is marked .orphaned_at (GC will delete it)")
    else:
        v = _load_json(ip_mf)["version"]
        add(
            "install-path",
            v == reg["version"],
            f"cache manifest {v} vs entry {reg['version']}",
        )

    # C6: every hook the plugin declares must exist in the installed copy
    hooks_file = os.path.join(ip, "hooks", "hooks.json")
    if os.path.exists(hooks_file):
        missing = []
        blob = json.dumps(_load_json(hooks_file))
        for rel in re.findall(r"\$\{CLAUDE_PLUGIN_ROOT\}/([^\"\\ ]+)", blob):
            if not os.path.exists(os.path.join(ip, rel)):
                missing.append(rel)
        add(
            "hooks-wired",
            not missing,
            f"missing: {missing}" if missing else "all hook files present",
        )
    else:
        add("hooks-wired", False, "hooks/hooks.json absent from installed copy")

    # C7: the engine's moving parts are actually there
    counts = count_assets(ip)
    add("assets", all(counts.values()), json.dumps(counts))

    # C8: no deprecated/renamed asset may shadow the live set anywhere
    stale = find_stale_assets(ip, clone, plugin_name)
    ctx["stale_assets"] = stale
    add(
        "stale-assets",
        not stale,
        f"{len(stale)} deprecated asset(s): {stale[:4]}" if stale else "none found",
    )

    # C9: the subagent-discipline wiring must be able to engage
    wiring = check_orchestration_wiring(ip)
    add(
        "orchestration-wiring",
        not wiring,
        "; ".join(wiring)
        if wiring
        else "tripwire sees Skill/Agent/Task and auto-marks",
    )
    return results, ctx


# --- fixes (SET) ---


def apply_fixes(ctx, plugin_name="atlas"):
    actions = []
    expected = ctx.get("expected_repo")
    mkt_name, key, reg = ctx.get("mkt_name"), ctx.get("key"), ctx.get("reg")
    if not (expected and key):
        return ["cannot fix: context incomplete"]
    url = f"https://github.com/{expected}.git"

    markets_path = os.path.join(PLUGINS_DIR, "known_marketplaces.json")
    markets = _load_json(markets_path)
    # Also handle the "repo" format used by Claude Code's known_marketplaces.json
    if norm_repo(markets[mkt_name]["source"].get("url", "") or
                  markets[mkt_name]["source"].get("repo", "")) != expected:
        markets[mkt_name]["source"]["url"] = url
        _save_json(markets_path, markets)
        actions.append(f"repointed marketplace source to {url}")

    clone = ctx.get("clone")
    if clone and os.path.isdir(os.path.join(clone, ".git")):
        _git(["remote", "set-url", "origin", url], clone)
        _git(["fetch", "origin"], clone)
        branch = "main"
        r = _git(["symbolic-ref", "refs/remotes/origin/HEAD"], clone)
        if r.returncode == 0:
            branch = r.stdout.strip().rsplit("/", 1)[-1]
        _git(["reset", "--hard", f"origin/{branch}"], clone)
        actions.append(f"reset marketplace clone to origin/{branch}")

    mkt_ver = marketplace_plugin_version(clone, plugin_name)
    if mkt_ver and reg and reg["version"] != mkt_ver:
        cache_dir = os.path.join(PLUGINS_DIR, "cache", mkt_name, plugin_name, mkt_ver)
        if not os.path.exists(os.path.join(cache_dir, ".claude-plugin", "plugin.json")):
            shutil.copytree(
                os.path.join(clone, "plugins", plugin_name),
                cache_dir,
                dirs_exist_ok=True,
            )
            actions.append(f"staged {mkt_ver} into cache from marketplace clone")
        sha = _git(["rev-parse", "HEAD"], clone).stdout.strip()
        installed_path = os.path.join(PLUGINS_DIR, "installed_plugins.json")
        installed = _load_json(installed_path)
        entry = installed["plugins"][key][0]
        entry.update(
            installPath=cache_dir,
            version=mkt_ver,
            gitCommitSha=sha or entry.get("gitCommitSha", ""),
            lastUpdated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        )
        _save_json(installed_path, installed)
        actions.append(f"re-registered {key} at {mkt_ver}")

    stale = ctx.get("stale_assets") or []
    if stale:
        trash = os.path.join(PLUGINS_DIR, f".trash-atlas-doctor-{int(time.time())}")
        os.makedirs(trash, exist_ok=True)
        for p in stale:
            dest = os.path.join(trash, os.path.basename(p.rstrip("/")))
            try:
                shutil.move(p, dest)
                actions.append(f"quarantined stale asset {p} -> {dest}")
            except Exception as e:
                actions.append(f"could not quarantine {p}: {e}")

    if reg:
        orphan = os.path.join(reg.get("installPath", ""), ".orphaned_at")
        for path in {
            orphan,
            os.path.join(
                PLUGINS_DIR,
                "cache",
                mkt_name,
                plugin_name,
                mkt_ver or "",
                ".orphaned_at",
            ),
        }:
            if path and os.path.exists(path):
                os.remove(path)
                actions.append(f"cleared {path}")
    return actions


def main(argv=None):
    ap = argparse.ArgumentParser(description="atlas plugin health check")
    ap.add_argument("--fix", action="store_true", help="repair what CHECK finds")
    ap.add_argument(
        "--hook",
        action="store_true",
        help="SessionStart mode: warn only, always exit 0",
    )
    ap.add_argument("--plugin", default="atlas")
    args = ap.parse_args(argv)

    results, ctx = run_checks(args.plugin)
    failed = [r for r in results if not r["ok"]]

    if args.fix and failed:
        for a in apply_fixes(ctx, args.plugin):
            print(f"FIX: {a}")
        results, ctx = run_checks(args.plugin)  # VERIFY
        failed = [r for r in results if not r["ok"]]

    if args.hook:
        if failed:
            print(
                f"ATLAS-DOCTOR WARNING: {args.plugin} plugin is unhealthy - "
                + "; ".join(f"{r['check']}: {r['detail']}" for r in failed)
                + ". Run: python3 <plugin>/scripts/atlas_doctor.py --fix, then /reload-plugins."
            )
        return 0

    for r in results:
        print(f"{'PASS' if r['ok'] else 'FAIL'}  {r['check']:20} {r['detail']}")
    print(
        ("HEALTHY" if not failed else f"{len(failed)} PROBLEM(S)") + f" - {args.plugin}"
    )
    return 0 if not failed else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never crash a hook chain; report and signal error
        print(f"atlas_doctor internal error: {e}")
        sys.exit(2)
