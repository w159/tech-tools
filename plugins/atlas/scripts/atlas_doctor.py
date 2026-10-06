#!/usr/bin/env python3
"""atlas-setup: detect and repair the plugin-rollback failure mode.

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

import atlas_db

# --- environment (overridable so tests never touch the real install) ---
PLUGINS_DIR = os.environ.get("ATLAS_PLUGINS_DIR") or os.path.expanduser(
    "~/.claude/plugins"
)
STATE_PATH = os.environ.get("ATLAS_DOCTOR_STATE") or os.path.expanduser(
    "~/.atlas/doctor-state.json"
)

# --- maintenance caps (keep the plugin's own footprint bounded across runs) ---
# Per-run trash dirs (apply_fixes quarantines stale assets into one) grow
# forever without a cap; keep the N newest and prune the rest.
TRASH_PREFIX = ".trash-atlas-setup-"
TRASH_KEEP = 5
# atlas.db telemetry tables trimmed oldest-first when a row grows past the cap.
# metrics PK is run_id; every other listed table has an id PK used for ordering.
# `facets` and `findings` are deliberately NOT listed here -- they are atlas's
# long memory (per-session chronicle, cross-session findings ledger), not
# per-event telemetry, so they stay uncapped.
TELEMETRY_TABLES = (
    "runs",
    "events",
    "dispatches",
    "metrics",
    "improvements",
    "signals",
    "friction_events",
)
TELEMETRY_ROW_CAP = 5000


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


# The repo was renamed w159/atlas -> w159/tech-tools (2026-07-29). GitHub
# redirects the old URL, so a marketplace/clone still pointing at it is not
# broken - accept it too rather than raising a false alarm on unmigrated installs.
LEGACY_REPO_ALIAS = "w159/atlas"


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


ATLAS_OUTPUT_STYLE = "Atlas Orchestrator"


def check_output_style(settings_path=None):
    """Flag an explicit user outputStyle that may compete with the plugin style.

    Returns (ok, detail). ok True when unset or set to Atlas Orchestrator. Current
    Claude Code docs say force-for-plugin overrides the user setting, but 5.25.0
    observed ATLAS | headers vanishing under an explicit style, so a different
    value is still reported as a risk rather than a confirmed break.
    """
    path = settings_path or os.path.join(
        os.path.expanduser("~"), ".claude", "settings.json"
    )
    try:
        data = _load_json(path) if os.path.isfile(path) else {}
    except Exception as e:
        return (
            True,
            f"settings unreadable ({e}); boot will still inject header contract",
        )
    style = ""
    if isinstance(data, dict):
        style = data.get("outputStyle") or ""
        if not isinstance(style, str):
            style = ""
    style = style.strip()
    if not style:
        return True, "outputStyle unset (plugin force-for-plugin should apply)"
    if style == ATLAS_OUTPUT_STYLE:
        return True, f"outputStyle={style!r}"
    return (
        False,
        f"outputStyle={style!r} differs from {ATLAS_OUTPUT_STYLE!r}; docs say "
        f"force-for-plugin should still apply, but atlas 5.25.0 saw headers vanish "
        f'here. Set outputStyle to "{ATLAS_OUTPUT_STYLE}" to remove the risk '
        f"(SessionStart still injects the contract)",
    )


OMP_MECHANIC_ROLES = ("atlas-mechanic", "atlas-worker")


def check_omp_model_roles(config_path=None):
    """(ok, detail): are the omp roles atlas:runner/colony workers prefer set?

    Without `modelRoles.atlas-mechanic` the runner silently falls back to
    the configured @smol model, so the "cheap mechanical tier" is only thinking-off,
    not cheap. Skipped (ok) when no omp config exists. Stdlib only: scans the
    indented `modelRoles:` block, never loads YAML.
    """
    path = config_path or os.path.join(
        os.path.expanduser("~"), ".omp", "agent", "config.yml"
    )
    if not os.path.isfile(path):
        return True, "no omp config; skipped"
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError as e:
        return True, f"omp config unreadable ({e}); skipped"
    roles = {}
    in_block = False
    for line in lines:
        if re.match(r"^modelRoles:\s*$", line):
            in_block = True
            continue
        if in_block:
            if line and not line[0].isspace():
                break
            m = re.match(r"^\s+([A-Za-z0-9_-]+):\s*(\S.*?)\s*$", line)
            if m:
                roles[m.group(1)] = m.group(2)
    missing = [r for r in OMP_MECHANIC_ROLES if r not in roles]
    if not missing:
        return True, "omp modelRoles set for " + ", ".join(OMP_MECHANIC_ROLES)
    smol = roles.get("smol")
    fallback = f"@smol ({smol})" if smol else "@smol (unset)"
    return (
        False,
        "omp modelRoles missing " + ", ".join(missing) + ": atlas:runner and "
        f"colony workers fall back to {fallback}, which may not be a cheap model. "
        "Set modelRoles.atlas-mechanic (and atlas-worker) to a haiku/flash-class "
        "model in ~/.omp/agent/config.yml",
    )


ATLAS_TOOLING_MARKER = "<!-- atlas-tooling -->"


def check_typesafe_scoring(now=None):
    """(ok, detail) for the optional TypeSafe turn-scoring loop: key present
    (name only, never the value), turn_scores rows in the last 7 days, and the
    last scored_at. Never creates or writes the DB."""
    has_key = bool(os.environ.get("TYPESAFE_API_KEY"))
    off = os.environ.get("ATLAS_TYPESAFE_SCORING") == "off"
    path = atlas_db.db_path()
    rows, last, errs, last_err = 0, None, 0, None
    if os.path.exists(path):
        try:
            conn = atlas_db.connect(path)
            try:
                rows, last = conn.execute(
                    "SELECT COUNT(*), MAX(scored_at) FROM turn_scores "
                    "WHERE scored_at > ? AND judgment != 'scoring_error'",
                    ((now or time.time()) - 7 * 86400,),
                ).fetchone()
                last = conn.execute(
                    "SELECT MAX(scored_at) FROM turn_scores"
                ).fetchone()[0]
                import turn_scoring  # lazy: pulls in the ingest/client modules

                errs, last_err = turn_scoring.recent_errors(conn, now)
            finally:
                conn.close()
        except Exception:
            rows, last = 0, None
    last_s = (
        datetime.fromtimestamp(last, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        if last
        else "never"
    )
    detail = (
        f"TYPESAFE_API_KEY {'set' if has_key else 'not set'}; "
        f"ATLAS_TYPESAFE_SCORING={'off' if off else 'on'}; "
        f"{rows or 0} turn_scores row(s) in last 7d; last scored {last_s}"
    )
    if errs:
        detail += (
            f"; {errs} scoring error(s) in last 7d, latest: {(last_err or '')[:200]}"
        )
    return (has_key and not off and bool(rows) and not errs), detail


def check_context_tooling(root_path=None):
    """Detect whether this project's AGENTS.md carries the atlas-tooling
    routing block that tells agents to route through context-mode/lean-ctx/
    claude-mem/serena instead of raw Read/Grep/Bash on source.

    Returns (ok, detail). ok True when the marker is present. A missing
    AGENTS.md or a pre-atlas-tooling AGENTS.md means every agent working in
    this project reads/greps source directly, defeating the context-
    protection stack even when it is installed and reachable - scaffold_docs.py
    (via atlas-setup) is what inserts the block.
    """
    root = root_path or os.getcwd()
    path = os.path.join(root, "AGENTS.md")
    if not os.path.isfile(path):
        return False, f"{path} does not exist; run atlas-setup to scaffold it"
    try:
        with open(path, encoding="utf-8") as f:
            body = f.read()
    except Exception as e:
        return False, f"AGENTS.md unreadable: {e}"
    if ATLAS_TOOLING_MARKER in body:
        return True, "AGENTS.md carries the atlas-tooling routing block"
    return (
        False,
        "AGENTS.md lacks the atlas-tooling routing block; re-run atlas-setup's "
        "scaffold_docs.py to insert it",
    )


def run_checks(plugin_name="atlas"):
    results = []
    ctx = {}

    def add(cid, ok, detail, severity="fail"):
        results.append({"check": cid, "ok": ok, "detail": detail, "severity": severity})

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
    # or {"source": "directory", "path": "/local/path"} for local marketplaces
    src = mkt.get("source", {})
    src_url = src.get("url", "") or src.get("repo", "")
    # Directory-sourced marketplaces have no repo URL; check the clone remote instead
    if not src_url and src.get("source") == "directory":
        add("marketplace-source", True, f"directory: {src.get('path', '?')}")
    else:
        ok = norm_repo(src_url) in (expected_repo, LEGACY_REPO_ALIAS)
        add(
            "marketplace-source",
            ok,
            f"{src_url or 'MISSING'} (expected {expected_repo})",
        )

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

    # C7: the engine's moving parts are actually there. The plugin ships no
    # commands/ since 5.0.0 (skills replaced the launchers), so only agents
    # and skills are required.
    counts = count_assets(ip)
    add(
        "assets",
        counts["agents"] > 0 and counts["skills"] > 0,
        json.dumps(counts),
    )

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

    # C10: explicit user outputStyle must not hide Atlas Orchestrator headers
    style_ok, style_detail = check_output_style()
    add("output-style", style_ok, style_detail)

    # C11: the project this doctor runs in should carry the atlas-tooling
    # routing block. WARN-severity: it does not count toward `failed`/exit
    # code or --hook's SessionStart warning, because it is a property of the
    # *consuming project*, not the plugin install, and would otherwise fire
    # on every unscaffolded repo a user opens.
    tooling_ok, tooling_detail = check_context_tooling()
    add("context-tooling", tooling_ok, tooling_detail, severity="warn")

    # C11b: omp cheap-tier roles; WARN-severity (omp-only, user config).
    mr_ok, mr_detail = check_omp_model_roles()
    add("omp-model-roles", mr_ok, mr_detail, severity="warn")

    # C12: TypeSafe turn scoring is optional; WARN-severity, never a failure.
    ts_ok, ts_detail = check_typesafe_scoring()
    add("typesafe-scoring", ts_ok, ts_detail, severity="warn")

    return results, ctx


# --- fixes (SET) ---


def cap_trash_dirs(plugins_dir, keep=TRASH_KEEP):
    """Remove the oldest per-run trash dirs beyond `keep`, newest kept.

    Trash dirs are named f"{TRASH_PREFIX}{stamp}"; stamps are compared
    numerically when possible (so 200 sorts after 99), falling back to
    lexicographic for any non-numeric suffix. Returns the count removed."""
    if not os.path.isdir(plugins_dir):
        return 0

    def stamp_key(name):
        s = name[len(TRASH_PREFIX) :]
        try:
            return (0, int(s), "")
        except ValueError:
            return (1, 0, s)

    dirs = sorted(
        (d for d in os.listdir(plugins_dir) if d.startswith(TRASH_PREFIX)),
        key=stamp_key,
    )
    removed = 0
    while len(dirs) > keep:
        shutil.rmtree(os.path.join(plugins_dir, dirs.pop(0)), ignore_errors=True)
        removed += 1
    return removed


def purge_telemetry(db_path=None, row_cap=TELEMETRY_ROW_CAP):
    """Trim atlas_db telemetry tables to `row_cap` rows, oldest first.

    Returns {table: {before, after, dropped}} for every table that exists.
    Tables absent from the DB are skipped silently so this is safe to run
    against a fresh or partially-migrated schema."""
    import sqlite3

    path = (
        db_path or os.environ.get("ATLAS_DB") or os.path.expanduser("~/.atlas/atlas.db")
    )
    if not os.path.exists(path):
        return {}
    # metrics has no id column; its PK run_id is the ordering key.
    order_col = {"metrics": "run_id"}
    conn = sqlite3.connect(path, timeout=5.0)
    try:
        summary = {}
        for table in TELEMETRY_TABLES:
            try:
                before = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            except sqlite3.OperationalError:
                continue  # table absent
            col = order_col.get(table, "id")
            try:
                conn.execute(
                    f"DELETE FROM {table} WHERE {col} NOT IN ("
                    f"SELECT {col} FROM {table} ORDER BY {col} DESC LIMIT ?)",
                    (row_cap,),
                )
            except sqlite3.OperationalError:
                continue  # column absent / schema mismatch
            after = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            summary[table] = {
                "before": before,
                "after": after,
                "dropped": before - after,
            }
        conn.commit()
        return summary
    finally:
        conn.close()


def record_hook_verdict(plugin_name, failed, root_path=None):
    """Persist the --hook path's health verdict to asset_verdicts.

    Before this, --hook only ever printed a warning; it never wrote to the
    DB, which is why asset_verdicts went stale (no row in 27 days) even
    though this hook runs every SessionStart. record_asset_verdicts()
    replaces (not accumulates) the prior non-applied/non-restored row for
    this (project, kind, key), so this stays one row per project rather
    than growing unbounded across sessions.

    Fast + fail-open: any error here must never block a SessionStart hook."""
    try:
        conn = atlas_db.connect()
        atlas_db.init(conn)
        project_id = atlas_db.register_project(conn, root_path or os.getcwd())
        atlas_db.record_asset_verdicts(
            conn,
            project_id,
            [
                {
                    "kind": "plugin_health",
                    "key": plugin_name,
                    "tags": [],
                    "verdict": "unhealthy" if failed else "healthy",
                    "est_tokens": 0,
                }
            ],
        )
        conn.close()
    except Exception:
        pass  # fail-open


def record_maintenance(action, details=None):
    """Append a maintenance log entry to doctor-state.json.

    The entry always carries a UTC timestamp and `action`; callers pass any
    before/after sizes or row counts in `details`."""
    state = _load_json(STATE_PATH) if os.path.exists(STATE_PATH) else {}
    log = state.setdefault("maintenance_log", [])
    entry = {"timestamp": datetime.now(timezone.utc).isoformat(), "action": action}
    if details:
        entry.update(details)
    log.append(entry)
    _save_json(STATE_PATH, state)
    return entry


def apply_fixes(ctx, plugin_name="atlas", trash_stamp=None):
    actions = []
    expected = ctx.get("expected_repo")
    mkt_name, key, reg = ctx.get("mkt_name"), ctx.get("key"), ctx.get("reg")
    if not (expected and key):
        return ["cannot fix: context incomplete"]
    url = f"https://github.com/{expected}.git"

    markets_path = os.path.join(PLUGINS_DIR, "known_marketplaces.json")
    markets = _load_json(markets_path)
    # Also handle the "repo" format used by Claude Code's known_marketplaces.json
    if (
        norm_repo(
            markets[mkt_name]["source"].get("url", "")
            or markets[mkt_name]["source"].get("repo", "")
        )
        != expected
    ):
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
        stamp = trash_stamp if trash_stamp is not None else int(time.time())
        trash = os.path.join(PLUGINS_DIR, f"{TRASH_PREFIX}{stamp}")
        os.makedirs(trash, exist_ok=True)
        for p in stale:
            dest = os.path.join(trash, os.path.basename(p.rstrip("/")))
            try:
                shutil.move(p, dest)
                actions.append(f"quarantined stale asset {p} -> {dest}")
            except Exception as e:
                actions.append(f"could not quarantine {p}: {e}")
        # M20: cap per-run trash dirs so they do not accumulate unbounded.
        pruned = cap_trash_dirs(PLUGINS_DIR)
        if pruned:
            actions.append(f"capped trash dirs: removed {pruned} old")

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
    # M22: record what this fix run did so there is an audit trail.
    record_maintenance("fix", {"actions": actions})
    return actions


# --- self-improvement: finding miners (PHASE 2 of the /atlas-doctor skill) ----
# One function per miner, registered in MINERS. Each miner(conn, root) returns
# a list of _finding() dicts. To add a new class of defect detection: write a
# miner function, register it in MINERS -- nothing else needs to change; mine()
# fingerprints/upserts/dedupes generically for every entry in the registry.


def _finding(
    dimension,
    severity,
    title,
    detail,
    proposed_action,
    target_path,
    key,
    metric_value,
    **evidence,
):
    """One miner-produced finding, pre-fingerprint. `key` is the part of the
    fingerprint unique within this miner (e.g. a tool name, a category, or a
    fixed literal for a miner that only ever emits one instance). `metric_value`
    is the headline number remeasure() recomputes later to judge improved/
    no_change/regressed -- always a plain float/int, never a formatted string."""
    return {
        "dimension": dimension,
        "severity": severity,
        "title": title,
        "detail": detail,
        "proposed_action": proposed_action,
        "target_path": target_path,
        "key": key,
        "metric_value": metric_value,
        "evidence": evidence,
    }


def mine_memory_capture_silent_drop(conn, root):
    """Static check: memory_capture.py's write path checks atlas_memory.add()'s
    {"success": False} case (raised when MEMORY.md/PROJECT.md is at its char
    cap) but has no `else` branch -- a fact that cannot fit is silently
    dropped instead of surfacing anywhere (not even a friction_event)."""
    path = os.path.join(root, "hooks", "memory_capture.py")
    try:
        with open(path, encoding="utf-8") as f:
            src = f.read()
    except OSError:
        return []
    checks = len(re.findall(r'if result\.get\("success"\):', src))
    handled = len(
        re.findall(r'if result\.get\("success"\):(?:\n[ \t]+.*)*\n[ \t]*else:', src)
    )
    missing = checks - handled
    if missing <= 0:
        return []
    return [
        _finding(
            dimension="reliability",
            severity="MED",
            title="memory_capture drops facts silently when MEMORY.md/PROJECT.md is at cap",
            detail=(
                f"{missing} call site(s) in hooks/memory_capture.py check "
                'atlas_memory.add()\'s result.get("success") but have no else '
                "branch -- when the char cap (atlas_memory.DEFAULT_MEMORY_LIMIT) "
                "is hit, the fact is discarded with no record anywhere."
            ),
            proposed_action=(
                "Add an else branch at each call site that records the drop via "
                'atlas_db.record_friction(conn, session_id, "memory_capture_dropped", '
                "snippet=fact[:80]) so a capped memory is an observable signal, not "
                "a silent loss."
            ),
            target_path="plugins/atlas/hooks/memory_capture.py",
            key="silent_drop",
            metric_value=missing,
        )
    ]


def mine_doctor_hook_stale_verdicts(conn, root, stale_days=7.0):
    """DB check: asset_verdicts should get a fresh row every SessionStart now
    that record_hook_verdict() runs there. Flags a stale table (no verdict in
    `stale_days`) the same way the pre-fix table went 27 days quiet."""
    row = conn.execute("SELECT MAX(ts) FROM asset_verdicts").fetchone()
    max_ts = row[0] if row else None
    age_days = (time.time() - max_ts) / 86400.0 if max_ts else None
    if age_days is not None and age_days <= stale_days:
        return []
    return [
        _finding(
            dimension="observability",
            severity="LOW",
            title="asset_verdicts table is stale",
            detail=(
                "No asset_verdicts row in over "
                f"{stale_days:.0f} days (age: {age_days!r})."
                " The --hook SessionStart path is the only writer that runs "
                "every session; if it stops writing, this table goes quiet again."
            ),
            proposed_action=(
                "Confirm atlas_doctor.py's --hook branch still calls "
                "record_hook_verdict() every SessionStart (fixed in this run; "
                "verify it stays wired after future edits to main())."
            ),
            target_path="plugins/atlas/scripts/atlas_doctor.py",
            key="stale_verdicts",
            metric_value=age_days if age_days is not None else 999999.0,
        )
    ]


def mine_gate_block_silences_capture(conn, root):
    """DB check: RECENT sessions with an ingested transcript (session_logs)
    but no facets row at all. The historical all-time backlog can never
    clear (sessions ingested before chronicle_facet existed will never grow
    a facet row), so only sessions from the last
    RECENT_WINDOW_DAYS count: a live capture hole keeps this fresh,
    while old backlog stops reading as a permanent regression. The
    historical root cause (stop_hook_active starving capture hooks) was
    fixed by the kind="capture" carve-out in atlas_hook_guard.should_run;
    a fresh nonzero means chronicle_facet is not running for those Stops
    (plugin absent, ATLAS_CHRONICLE off, or the circuit breaker)."""
    window = f"-{RECENT_WINDOW_DAYS} days"
    n = conn.execute(
        "SELECT COUNT(*) FROM session_logs "
        "WHERE session_id NOT IN (SELECT session_id FROM facets) "
        "AND started_at > strftime('%s','now', ?)",
        (window,),
    ).fetchone()[0]
    if n <= 0:
        return []
    return [
        _finding(
            dimension="observability",
            severity="MED",
            title="recent sessions with no facet row despite an ingested transcript",
            detail=(
                f"{n} session(s) started within the last "
                f"{RECENT_WINDOW_DAYS} days have an ingested "
                "transcript but no matching facets row. Capture hooks are no "
                "longer silenced on blocked Stops (kind='capture' carve-out "
                "in atlas_hook_guard.should_run), so a fresh nonzero means "
                "chronicle_facet never ran for those sessions."
            ),
            proposed_action=(
                "Check whether chronicle_facet.py is wired for the agent(s) "
                "producing those sessions and that ATLAS_CHRONICLE is not "
                "off / the circuit breaker is not tripped."
            ),
            target_path="plugins/atlas/hooks/chronicle_facet.py",
            key="gate_silences_capture",
            metric_value=n,
        )
    ]


def mine_facet_uningested_hardcoded_zero(conn, root):
    """DB check: legacy facets rows written before chronicle_facet.py NULL'd
    its deterministic columns for un-ingested sessions -- message_count NULL
    (never ingested) but one of the dependent counts still reads a fabricated
    0 rather than NULL."""
    n = conn.execute(
        "SELECT COUNT(*) FROM facets WHERE message_count IS NULL AND ("
        "edit_count=0 OR read_count=0 OR correction_count=0 OR "
        "dispatch_count=0 OR gate_block_count=0)"
    ).fetchone()[0]
    if n <= 0:
        return []
    return [
        _finding(
            dimension="data quality",
            severity="LOW",
            title="facets rows carry fabricated 0s instead of NULL for un-ingested sessions",
            detail=(
                f"{n} facets row(s) have message_count IS NULL (never ingested) "
                "but a dependent column still reads 0 rather than NULL -- data "
                "written before chronicle_facet.py's NULL-for-un-ingested fix."
            ),
            proposed_action=(
                "One-time backfill: UPDATE facets SET edit_count=NULL, "
                "read_count=NULL, correction_count=NULL, dispatch_count=NULL, "
                "gate_block_count=NULL WHERE message_count IS NULL. New rows are "
                "already correct as of chronicle_facet.py's ingested-flag fix."
            ),
            target_path="plugins/atlas/hooks/chronicle_facet.py",
            key="uningested_hardcoded_zero",
            metric_value=n,
        )
    ]


def mine_inline_dispatch_ratio(conn, root, threshold=5.0, limit=50):
    """Behavioral check: average inline_ops/dispatches ratio across recent
    orchestrator runs. High = the dispatch discipline is being bypassed
    ("too small to delegate") rather than fanning out to subagents."""
    rows = conn.execute(
        "SELECT m.inline_ops, m.dispatches FROM metrics m "
        "JOIN runs r ON r.id = m.run_id "
        "WHERE COALESCE(r.kind,'orchestrator')='orchestrator' AND m.dispatches>0 "
        "ORDER BY r.id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    ratios = [io / d for io, d in rows if d]
    if not ratios:
        return []
    avg_ratio = sum(ratios) / len(ratios)
    if avg_ratio <= threshold:
        return []
    return [
        _finding(
            dimension="orchestration discipline",
            severity="MED",
            title="high inline-op-to-dispatch ratio across recent runs",
            detail=(
                f"Average inline_ops/dispatches over the last {len(ratios)} "
                f"orchestrator run(s) is {avg_ratio:.1f} (threshold {threshold})."
            ),
            proposed_action=(
                "Tighten the dispatch-tripwire threshold or the operating "
                "contract's dispatch rule so more work routes to subagents "
                "instead of running inline in the orchestrator's own context."
            ),
            target_path="plugins/atlas/hooks/dispatch_tripwire.py",
            key="inline_dispatch_ratio",
            metric_value=avg_ratio,
        )
    ]


def mine_low_verifier_coverage(conn, root, threshold=0.7, limit=50):
    """Behavioral check: average verifier_coverage across recent orchestrator
    runs. Below threshold means changes are shipping without an independent
    verifier checking them (engine law 5)."""
    rows = conn.execute(
        "SELECT m.verifier_coverage FROM metrics m JOIN runs r ON r.id = m.run_id "
        "WHERE COALESCE(r.kind,'orchestrator')='orchestrator' "
        "AND m.verifier_coverage IS NOT NULL ORDER BY r.id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    vals = [v[0] for v in rows]
    if not vals:
        return []
    avg = sum(vals) / len(vals)
    if avg >= threshold:
        return []
    return [
        _finding(
            dimension="verification discipline",
            severity="HIGH",
            title="low average verifier coverage across recent runs",
            detail=(
                f"Average verifier_coverage over the last {len(vals)} "
                f"orchestrator run(s) is {avg:.2f} (threshold {threshold})."
            ),
            proposed_action=(
                "Audit recent shipping-agent dispatches lacking a paired "
                "atlas:verifier dispatch; tighten the completion gate's "
                "unpaired_implementer_dispatches check if it is not already "
                "blocking on this."
            ),
            target_path="plugins/atlas/hooks/completion_gate.py",
            key="verifier_coverage_low",
            metric_value=avg,
        )
    ]


def mine_tool_error_rate(conn, root, threshold=0.2, min_calls=5):
    """Behavioral check: per-tool error rate from the tool_calls mirror. One
    finding per tool crossing the threshold, so each can be triaged (and
    remeasured) independently.

    TOOL_ERROR_THRESHOLD_OVERRIDES carves out tools whose counted "errors"
    are largely expected control flow rather than defects: Write's
    read-before-edit gate rejecting a blind write, ctx_patch's stale-anchor
    CONFLICT that routes the caller through a re-read, and WebFetch's
    site-side failures. Their threshold is raised so normal re-reading flow
    does not pollute the findings list; a genuine defect on these tools can
    still surface by exceeding the higher bar."""
    overrides = {
        "Write": 0.35,
        "lean-ctx.ctx_patch": 0.55,
        "WebFetch": 0.60,
    }
    out = []
    for r in atlas_db.tool_usage(conn):
        calls = r.get("calls") or 0
        if calls < min_calls:
            continue
        rate = (r.get("errors") or 0) / calls
        tool_threshold = overrides.get(r.get("target") or "", threshold)
        if rate <= tool_threshold:
            continue
        target = r.get("target") or "?"
        out.append(
            _finding(
                dimension="tool reliability",
                severity="MED",
                title=f"high error rate on {r.get('kind')}:{target}",
                detail=(
                    f"{r.get('errors')}/{calls} calls to {target} errored "
                    f"({rate:.0%}, threshold {tool_threshold:.0%})."
                ),
                proposed_action=(
                    f"Investigate recurring failures calling {target}; check "
                    "for a wrong argument shape, a missing precondition check, "
                    "or a wrapper that should retry/back off."
                ),
                target_path=target,
                key=f"{r.get('kind')}:{target}",
                metric_value=rate,
                calls=calls,
                errors=r.get("errors"),
            )
        )
    return out


CACHE_HIT_MIN = 0.5
# Guard so a thin DB (a handful of sessions, or a codex-only history that
# undercounts cache reads) cannot fire the miner on noise.
CACHE_HIT_MIN_TOKENS = 100_000


def mine_low_cache_hit(conn, root):
    """Behavioral check: the context-protection layer must actually help.
    atlas_db.context_tool_health() computes the session cache-read share, but
    nothing in the doctor's report path surfaced it -- the ratio lived only in
    the manual audit lens. A low cache_hit_ratio on a non-trivial token base
    means the trio (claude-mem/context-mode/ponytail) is configured but the
    cache is not being hit; surface it as a remeasurable finding (the ratio is
    the baseline the self-telemetry lens already prescribes)."""
    health = atlas_db.context_tool_health(conn)
    denom = (health["cache_read_tokens"] or 0) + (health["fresh_input_tokens"] or 0)
    if denom < CACHE_HIT_MIN_TOKENS:
        return []
    ratio = health["cache_hit_ratio"]
    if ratio >= CACHE_HIT_MIN:
        return []
    return [
        _finding(
            dimension="context efficiency",
            severity="MED",
            title=f"cache hit ratio {ratio:.0%} below {CACHE_HIT_MIN:.0%}",
            detail=(
                f"cache_read_tokens={health['cache_read_tokens']} vs "
                f"fresh_input_tokens={health['fresh_input_tokens']} "
                f"(cache_hit_ratio={ratio}). Low cache-read share means the "
                "context-protection layer is not actually helping."
            ),
            proposed_action=(
                "Check whether claude-mem/context-mode/ponytail calls are "
                "actually being issued (context_tool_health.context_tools); "
                "if they are absent, the protection is configured but unused - "
                "propose a CLAUDE.md nudge or a hook with this ratio as the "
                "baseline."
            ),
            target_path="plugins/atlas/scripts/atlas_db.py",
            key="cache_hit_ratio_low",
            metric_value=ratio,
            cache_read_tokens=health["cache_read_tokens"],
            fresh_input_tokens=health["fresh_input_tokens"],
        )
    ]


def mine_recurring_friction(conn, root, min_count=3):
    """Behavioral check: friction_events categories (user_correction,
    assumption_admission, error_report, ...) recurring often enough to be a
    pattern rather than a one-off.

    Windowed to RECENT_WINDOW_DAYS on purpose. A lifetime count can only grow,
    so an improvement baseline taken from it can never be met however well the
    underlying behavior improves - the same defect the missing-facets miner
    had. Recent recurrence is the actionable signal; history stays in the DB.
    """
    rows = conn.execute(
        "SELECT category, COUNT(*) AS n FROM friction_events "
        "WHERE ts > strftime('%s','now', ?) "
        "GROUP BY category HAVING n >= ? ORDER BY n DESC",
        ("-%d days" % RECENT_WINDOW_DAYS, min_count),
    ).fetchall()
    out = []
    for category, n in rows:
        out.append(
            _finding(
                dimension="behavioral friction",
                severity="MED" if n >= min_count * 2 else "LOW",
                title=f"recurring {category} friction ({n}x in {RECENT_WINDOW_DAYS}d)",
                detail=(
                    f"{n} friction_events row(s) categorized '{category}' in the "
                    f"last {RECENT_WINDOW_DAYS} days."
                ),
                proposed_action=(
                    f"Read the recent snippets for category='{category}' "
                    "(atlas_db.signal_rollup or friction_events directly) and "
                    "turn the recurring pattern into a CLAUDE.md rule, a hook "
                    "guard, or a skill fix -- whichever closes the gap."
                ),
                target_path="CLAUDE.md",
                key=category,
                metric_value=n,
            )
        )
    return out


# --- colony adherence (lean-ctx/context-mode usage + dispatch discipline) ---
# Thresholds: native_reader_share is measured where LOWER is better (the
# lean-ctx/CLAUDE.md contract wants native Grep/Glob/Read/Bash routed through
# ctx_*), delegation_rate where HIGHER is better. A finding uses a single
# remeasure-friendly metric_value, so it emits violation DEPTH (share over the
# cap plus the delegation deficit), which is always lower-is-better.
COLONY_NATIVE_SHARE_MAX = 0.5  # fire when the native reader share exceeds this
COLONY_DELEGATION_MIN = 0.8  # fire when the delegation rate is below this
# below COLONY_MIN_SESSIONS in the window the miner is silent: "not known to
# be broken" must not read as "fixed".
COLONY_MIN_SESSIONS = 5
# session_ingest.summarize_input() caps input_summary at 500 chars, so a
# capped summary can hide the `name` argument of a dispatch.
COLONY_INPUT_SUMMARY_CAP = 500

_COLONY_EDIT_TOOLS = {
    "Edit",
    "Write",
    "MultiEdit",
    "NotebookEdit",
    "edit",
    "write",
}
_COLONY_DISPATCH_TOOLS = {"Agent", "Task", "task"}
_COLONY_NATIVE_READERS = {
    "claude-code": ("Read", "Grep", "Glob", "Bash"),
    "omp": ("read", "grep", "glob", "bash"),
}
# Named-dispatch contract for omp/colony agents: the task tool takes `name`.
_COLONY_NAME_RE = re.compile(
    r"""(?:"name"\s*:\s*["']?([^"'\n]{1,128})["']?|[\s:]name\s*[=:]\s*["']?"""
    r"""([A-Za-z0-9_.\-]{2,64})["']?)"""
)
_COLONY_NAMES_RE = re.compile(r'"names":\s*"\[(.*?)\]"')

# Internal/URI-ish targets are tool plumbing, not repo edits; a write to
# agent://... or xd://mcp__... never counts toward the delegation denominator.
_COLONY_URI_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:(?://|\\\\|_)")


def _colony_classify_harness(session_names):
    """claude-code vs omp from EACH SESSION's tool-name casing (the one
    property both telemetry paths preserve). Claude Code names its bare
    builtins Capitalized (Bash, Read, Agent, ToolSearch); omp names the same
    tools lowercase (bash, read, task, write) and records ctx_* builtins
    lowercase. MCP tool names are always lowercase on both sides
    (mcp__lean-ctx__ctx_search), so mcp__ rows carry no casing evidence and
    are ignored for classification, as are sessions whose window rows are all
    mcp rows (None). Sessions mixing evidence skew claude-code only if they
    show a Capitalized bare name (omp never emits one). Note: codex sessions
    also use lowercase names and are measured inside the omp class; they read
    through the same enforcement surfaces.

    Returns 'claude-code', 'omp', or None (unclassifiable)."""
    names = [n for n in session_names if n and not n.startswith("mcp__")]
    if any(n[:1].isupper() for n in names):
        return "claude-code"
    if names:
        return "omp"
    return None


def _colony_is_doc_path(path):
    """docs/ and .atlas/ targets are the orchestrator's own closeout writes
    (same carve-out as atlas_db.unsanctioned_inline_ops_since_last_dispatch:
    LIKE 'docs/%' OR '%/docs/%' OR '.atlas/%' OR '%/.atlas/%')."""
    if not path:
        return False
    p = path.replace("\\", "/")
    return p.startswith(("docs/", ".atlas/")) or "/docs/" in p or "/.atlas/" in p


def _colony_recover_path(tool_name, summary):
    """Pull a file path out of a (possibly truncated) input_summary.

    Claude Code Edit/Write carry file_path; omp write carries a bare `path`
    key; omp edit embeds the target in the patch header `[path#ANCHOR]`. None
    means the row shows no filesystem target at all (internal-URI callers
    return the URI instead, so _is_colony_repo_edit can reject it)."""
    if not summary:
        return None
    m = re.search(r'"file_path"\s*:\s*"([^"\n]+)"', summary)
    if m:
        return m.group(1)
    m = re.search(r'\{"path"\s*:\s*"([^"\n]+)"', summary)
    if m:
        return m.group(1)
    m = re.search(r"\[([^\[\]\n]+?)#[A-Za-z0-9]+\]", summary)
    if m:
        return m.group(1)
    return None


def _colony_is_repo_edit(tool_name, summary):
    """Is this edit/write row a non-docs REPO edit? Unknown-path rows count
    as edits (the same unknown-path-is-work rule the tripwire uses); writes
    to URIs (agent://, xd://...) and docs/.atlas/ targets do not."""
    if summary is None:
        return False  # only reachable with adversarial seeds; not an edit
    path = _colony_recover_path(tool_name, summary)
    if path is not None and _COLONY_URI_SCHEME_RE.match(path):
        return False
    return not (path is not None and _colony_is_doc_path(path))


# `lean-ctx -c '<cmd>'` runs <cmd> through lean-ctx's compressing shell: the
# Claude Code rewrite hook (updatedInput) and agents both produce it, and the
# transcript keeps the command as written, so a Bash/bash row whose command
# starts with it already travelled the ctx route.
_COLONY_LEAN_WRAP_RE = re.compile(r"^\s*(?:\S*/)?lean-ctx\s+-c\b")


def _colony_command(summary):
    """The bash `command` string from an input_summary, '' when none shows."""
    if not summary:
        return ""
    m = re.search(r'"command"\s*:\s*"((?:[^"\\]|\\.)*)', summary)
    if not m:
        return ""
    return m.group(1).replace('\\"', '"').replace("\\'", "'")


def _colony_is_ctx_call(tool_name, summary):
    """Any of the reachable ctx forms:
    1. an MCP call to lean-ctx or context-mode (mcp__lean-ctx__ctx_search,
       mcp__plugin_context-mode_context-mode__ctx_execute, ...),
    2. a bare builtin ctx_* name (omp records `ctx_search`/`ctx_read` as
       builtins once the MCP server's tools are reachable directly),
    3. an omp `write` into the eval harness to reach a ctx_* tool device
       (input_summary paths at xd://mcp__lean_ctx_... or
       xd://mcp__context_mode_...),
    4. a native shell tool whose command is wrapped in `lean-ctx -c`."""
    if tool_name.startswith("mcp__"):
        return "lean-ctx" in tool_name or "context-mode" in tool_name
    if tool_name.startswith("ctx_"):
        return True
    if tool_name == "write" and summary:
        return "xd://mcp__lean_ctx" in summary or "xd://mcp__context_mode" in summary
    if tool_name in ("Bash", "bash"):
        return bool(_COLONY_LEAN_WRAP_RE.match(_colony_command(summary)))
    return False


# Shell writes that change a repo file: `sed -i`, `tee <file>`, and `>`/`>>`
# redirects. Same idea as omp/delegation.ts's git-snapshot gate, but read from
# the command text because the miner only has the transcript.
_COLONY_SED_INPLACE_RE = re.compile(r"\bsed\b[^|;&]*?\s-[A-Za-z]*i")
_COLONY_TEE_RE = re.compile(r"\btee\b((?:\s+-[A-Za-z]+)*)\s+([^\s|;&<>]+)")
_COLONY_REDIRECT_RE = re.compile(r"(?<![&0-9<>])(?<!\d)>>?\s*([^\s|;&<>()]+)")


def _colony_write_target_is_repo(path):
    """A shell write target that counts as a repo edit: not a device/fd, not
    scratch space, not docs/.atlas closeout writes."""
    path = path.strip("'\"")
    if not path or path.startswith(("&", "/dev/", "/tmp/", "/private/tmp/", "/var/")):
        return False
    if path.startswith(("$TMPDIR", "${TMPDIR")):
        return False
    return not _colony_is_doc_path(path)


def _colony_is_shell_edit(command):
    """Does this bash command edit a non-docs repo file through the shell?"""
    if not command:
        return False
    command = re.sub(r"^\s*(?:\S*/)?lean-ctx\s+-c\s+", "", command)
    sed = _COLONY_SED_INPLACE_RE.search(command)
    if sed:
        # sed -i edits its last file operand; take the final word of the sed
        # segment. No visible operand (truncated summary) counts as an edit.
        seg = re.split(r"[|;&]", command[sed.start() :])[0]
        words = [w.strip("'\"") for w in seg.split() if not w.startswith("-")]
        operand = words[-1] if len(words) > 2 else None
        return True if operand is None else _colony_write_target_is_repo(operand)
    for m in _COLONY_TEE_RE.finditer(command):
        if _colony_write_target_is_repo(m.group(2)):
            return True
    for m in _COLONY_REDIRECT_RE.finditer(command):
        if _colony_write_target_is_repo(m.group(1)):
            return True
    return False


def _colony_named_dispatch_stats(rows):
    """(rate, text) over dispatch input_summaries: a dispatch is 'named' when
    its visible summary carries a non-empty `name` (token or JSON key),
    'uncounted' when NULL, or visible-only-truncated (>= cap, so the name
    argument could hide beyond the cap), or 'not named' when the summary is
    short enough to be complete and shows no name token. Rate is
    named/(named + not named); any uncountable row makes the summary carry
    the caveat, and zero countable rows report 'unknown', never 0."""
    named = not_named = uncountable = 0
    for summary in rows:
        s = (summary or "").strip()
        batch = _COLONY_NAMES_RE.search(s)
        if batch:
            # Batched omp `task`: ingest lifts per-item names into `names`
            # (first key, so it survives the cap). Named only if every item is.
            entries = re.findall(r'\\"(.*?)\\"', batch.group(1))
            if entries and all(e.strip() for e in entries):
                named += 1
            else:
                not_named += 1
            continue
        m = _COLONY_NAME_RE.search(s)
        val = (m.group(1) if m and m.group(1) else None) or (
            m.group(2) if m and m.group(2) else None
        )
        if val:
            named += 1
        elif not s or len(s) >= COLONY_INPUT_SUMMARY_CAP:
            uncountable += 1
        else:
            not_named += 1
    determinable = named + not_named
    rate = (named / determinable) if determinable else None
    total = named + not_named + uncountable
    if total == 0:
        text = "no dispatches"
    elif determinable == 0:
        text = (
            f"unknown ({total} dispatch summary/ies NULL or truncated, "
            "so a name argument cannot be ruled in or out)"
        )
    else:
        text = f"{named}/{determinable} named"
        if uncountable:
            text += f" ({uncountable} more with NULL/truncated summaries excluded)"
    return rate, text


def mine_colony_adherence(conn, root, window_days=None, min_sessions=None):
    """Behavioral check: is the colony contract actually binding per harness?

    Three measurements over main-thread (is_sidechain=0) tool_calls in the
    recency window, each session classified claude-code vs omp by tool-name
    casing (see _colony_classify_harness):
      native_reader_share -- native Read/Grep/Glob/Bash against the ctx_*
        routes that should have carried them (lean-ctx/context-mode MCP,
        bare ctx_* builtins, omp writes into xd://mcp tools). The CLAUDE.md
        lean-ctx contract forbids native Grep/Glob in docs/ projects; the
        share must sit at COLONY_NATIVE_SHARE_MAX or below.
      delegation_rate -- of sessions that edited non-docs repo files, the
        share that also dispatched a subagent (Agent/Task/task).
      named_dispatch_rate -- dispatches whose input_summary carries a
        non-empty `name`, informative only (it never fires a finding;
        truncated summaries report 'unknown' rather than 0).
    One finding per harness when native_reader_share > 0.5 or
    delegation_rate < 0.8, naming the enforcement surface for that harness
    (claude-code: dispatch_tripwire + completion_gate; omp: whether the
    plugins/atlas/omp extension is loaded). Silent under COLONY_MIN_SESSIONS
    sessions of that harness in the window."""
    window_days = window_days or RECENT_WINDOW_DAYS
    min_sessions = min_sessions if min_sessions is not None else COLONY_MIN_SESSIONS
    rows = conn.execute(
        "SELECT session_id, tool_name, input_summary FROM tool_calls "
        "WHERE is_sidechain=0 AND ts > strftime('%s','now', ?) "
        "AND tool_name IS NOT NULL AND COALESCE(denied,0)=0",
        (f"-{window_days} days",),
    ).fetchall()
    sessions = {}
    for sid, tool_name, summary in rows:
        s = sessions.setdefault(sid, {"names": [], "rows": []})
        s["names"].append(tool_name)
        s["rows"].append((tool_name, summary))

    per = {}
    for sid, s in sessions.items():
        harness = _colony_classify_harness(s["names"])
        if harness is None:
            continue  # mcp-only session: no casing evidence, not measured
        agg = per.setdefault(
            harness,
            {
                "sessions": 0,
                "native": 0,
                "ctx": 0,
                "repo_edit_sids": set(),
                "dispatch_sids": set(),
                "dispatch_summaries": [],
                "main_edits": 0,
                "shell_edits": 0,
            },
        )
        agg["sessions"] += 1
        for tool_name, summary in s["rows"]:
            if _colony_is_ctx_call(tool_name, summary):
                agg["ctx"] += 1
            elif tool_name in _COLONY_NATIVE_READERS[harness]:
                agg["native"] += 1
            is_edit = tool_name in _COLONY_EDIT_TOOLS and _colony_is_repo_edit(
                tool_name, summary
            )
            is_shell_edit = tool_name in ("Bash", "bash") and _colony_is_shell_edit(
                _colony_command(summary)
            )
            if is_edit or is_shell_edit:
                agg["repo_edit_sids"].add(sid)
                agg["main_edits"] += 1
                agg["shell_edits"] += 1 if is_shell_edit else 0
            if tool_name in _COLONY_DISPATCH_TOOLS:
                agg["dispatch_sids"].add(sid)
                agg["dispatch_summaries"].append(summary)

    out = MinerResult()
    for harness, agg in per.items():
        n = agg["sessions"]
        if n < min_sessions:
            continue  # not measured: too little data is not "fixed"
        denom = len(agg["repo_edit_sids"])
        delegated = len(agg["repo_edit_sids"] & agg["dispatch_sids"])
        delegation_rate = (delegated / denom) if denom else None
        reader_denom = agg["native"] + agg["ctx"]
        native_share = (agg["native"] / reader_denom) if reader_denom else None
        named_rate, named_text = _colony_named_dispatch_stats(agg["dispatch_summaries"])
        out.evaluated.add(harness)
        excess = 0.0
        if native_share is not None and native_share > COLONY_NATIVE_SHARE_MAX:
            excess += native_share - COLONY_NATIVE_SHARE_MAX
        if delegation_rate is not None and delegation_rate < COLONY_DELEGATION_MIN:
            excess += COLONY_DELEGATION_MIN - delegation_rate
        if excess <= 0:
            # Measured and within contract: only a quiet-window note rides in
            # evidence; mine() keeps or resolves open findings via `evaluated`.
            continue
        if harness == "omp":
            surface = (
                "Confirm the plugins/atlas/omp extension is loaded "
                "(plugins/atlas/omp/index.ts gates native grep/glob on "
                "lean-ctx/context-mode being reachable) and that colony "
                "dispatches stay named."
            )
            target = "plugins/atlas/omp/index.ts"
        else:
            surface = (
                "Check the native-Grep/Glob deny in "
                "plugins/atlas/hooks/dispatch_tripwire.py and the dispatch/"
                "completion enforcement in plugins/atlas/hooks/completion_gate.py."
            )
            target = "plugins/atlas/hooks/dispatch_tripwire.py"
        detail = (
            f"{harness}: native_reader_share="
            f"{'n/a' if native_share is None else f'{native_share:g}'} "
            f"({agg['native']}/{reader_denom} reader-route calls), "
            f"delegation_rate="
            f"{'n/a' if delegation_rate is None else f'{delegation_rate:g}'} "
            f"({delegated}/{denom} non-docs edit sessions dispatched; "
            f"{agg['main_edits']} main-thread edit(s), "
            f"{agg['shell_edits']} via shell), "
            f"named_dispatch_rate={named_text} "
            f"({n} sessions in the last {window_days} days)."
        )
        out.append(
            _finding(
                dimension="colony adherence",
                severity="MED" if excess >= 0.3 else "LOW",
                title=(
                    f"{harness} sessions run native readers / dispatch "
                    "outside the colony contract"
                ),
                detail=detail,
                proposed_action=surface,
                target_path=target,
                key=harness,
                metric_value=excess,
                native_reader_share=native_share,
                delegation_rate=delegation_rate,
                named_dispatch_rate=named_rate
                if named_rate is not None
                else named_text,
                native_calls=agg["native"],
                ctx_calls=agg["ctx"],
                sessions=n,
                main_thread_edits=agg["main_edits"],
                shell_edits=agg["shell_edits"],
                edit_sessions=denom,
            )
        )
    return out


# --- turn quality (TypeSafe-scored replies; see docs/atlas-turn-scoring.md) ---
# Tunable: fraction of scored turns that must hit a failure before a finding
# is emitted. Conservative on purpose; raise to quiet a noisy judgment.
TURN_QUALITY_DEFAULT_THRESHOLD = 0.25
TURN_QUALITY_THRESHOLDS = {}  # judgment id -> override of the default
NOUL_HIGH = 0.7  # noul probability counted as "yes" (hit=high judgments)
NOUL_LOW = 0.35  # noul probability counted as "no" (hit=low judgments)
HEADER_RATE_MIN = 0.8  # header_present rate below this -> finding
BANNED_PUNCT_RATE_MAX = 0.10  # share of replies with banned glyphs
# Agents whose sessions are shown the atlas output style, i.e. the ones the
# deterministic header_present / banned_punct metrics can fairly be held to.
HEADER_SCORED_AGENTS = frozenset({"claude", "omp"})


def _turn_hit(spec, row):
    """Did this scored row hit its judgment's failure direction? Score levels
    are 0-based and the stored value is probability-weighted, so the top level
    is round(value) == len(criteria) - 1."""
    value = row["value"]
    if value is None:
        return False
    if spec["type"] == "score":
        return round(value) >= len(spec["criteria"]) - 1
    if spec.get("hit") == "low":
        return value <= NOUL_LOW
    return value >= NOUL_HIGH


def mine_turn_quality(conn, root, window_days=None, min_turns=20):
    """Behavioral check: model-scored reply failures from turn_scores.

    One finding per (judgment[, project]) whose hit rate exceeds its
    threshold, each naming the atlas surface to fix (JUDGMENTS[j]['surface']).
    Predictive value -- P(next_turn_correction | hit) vs P(... | not hit) --
    rides in the detail so noise judgments are visible. Deterministic metrics
    (header_present, banned_punct) yield style-compliance findings. metric_value
    is always a rate where lower is better, so remeasure() needs no special
    casing. Judgments need min_turns scored turns in the window (per scope)."""
    import turn_scoring

    window_days = window_days or RECENT_WINDOW_DAYS
    cur = conn.execute(
        "SELECT t.session_id, t.message_uuid, t.judgment, t.kind, t.value, "
        "t.label, COALESCE(p.name, p.root_path, '(unknown)'), "
        "COALESCE(s.agent, 'claude'), t.ts "
        "FROM turn_scores t "
        "LEFT JOIN session_logs s ON s.session_id = t.session_id "
        "LEFT JOIN projects p ON p.id = s.project_id "
        "WHERE t.ts > strftime('%s','now', ?) ORDER BY t.ts",
        ("-%d days" % window_days,),
    )
    rows = [
        dict(
            zip(
                (
                    "sid",
                    "uuid",
                    "j",
                    "kind",
                    "value",
                    "label",
                    "project",
                    "agent",
                    "ts",
                ),
                r,
            )
        )
        for r in cur.fetchall()
    ]
    by_j = {}
    for r in rows:
        # header_present / banned_punct measure compliance with the atlas
        # output style, so they are only meaningful for a harness that
        # delivers it: Claude Code (force-for-plugin output style) and omp
        # (omp/style.ts renders the same output-styles/atlas-orchestrator.md
        # into the main session's system prompt). Codex sessions are mirrored
        # by the codex adapter but this plugin has no codex surface, so no
        # style ever reaches them and every codex reply would read as 100%
        # non-compliant. Any harness not listed in HEADER_SCORED_AGENTS is
        # skipped for the same reason: no proof the style reaches it.
        if (
            r["j"] in ("header_present", "banned_punct")
            and r["agent"] not in HEADER_SCORED_AGENTS
        ):
            continue
        by_j.setdefault(r["j"], []).append(r)

    ntc = {
        (r["sid"], r["uuid"]): _turn_hit(
            turn_scoring.JUDGMENTS["next_turn_correction"], r
        )
        for r in by_j.get("next_turn_correction", [])
        if "next_turn_correction" in turn_scoring.JUDGMENTS
    }

    # Deterministic ground truth, independent of Jev: the next real user prompt
    # after a scored reply carries a regex `user_correction` signal. Comparing a
    # Jev judgment only against Jev's own next_turn_correction is circular.
    gt = {}
    sids = {r["sid"] for r in rows}
    for sid in sids:
        prompts = conn.execute(
            "SELECT uuid, ts FROM user_prompts WHERE session_id=? AND ts IS NOT NULL "
            "ORDER BY ts",
            (sid,),
        ).fetchall()
        corrected = {
            u
            for (u,) in conn.execute(
                "SELECT message_uuid FROM signals WHERE session_id=? "
                "AND signal_type='user_correction'",
                (sid,),
            )
        }
        for r in rows:
            if r["sid"] != sid or (sid, r["uuid"]) in gt or r["ts"] is None:
                continue
            nxt = next((u for u, ts in prompts if ts > r["ts"]), None)
            if nxt is not None:
                gt[(sid, r["uuid"])] = nxt in corrected

    def split(truth, hits):
        """(P(corr|hit), n_hit, P(corr|not hit), n_not) over turns that have a
        verdict in `truth`; None where a side is empty."""
        a = [truth[k] for k, h in hits.items() if h and k in truth]
        b = [truth[k] for k, h in hits.items() if not h and k in truth]
        return (
            sum(a) / len(a) if a else None,
            len(a),
            sum(b) / len(b) if b else None,
            len(b),
        )

    def predictive(j, hits):
        return split(ntc, hits)

    def fmt(p):
        return "n/a" if p is None else f"{p:.0%}"

    out = MinerResult()
    for j, spec in turn_scoring.JUDGMENTS.items():
        jr = by_j.get(j, [])
        hits = {(r["sid"], r["uuid"]): _turn_hit(spec, r) for r in jr}
        pred = predictive(j, hits) if j != "next_turn_correction" else None
        pred_gt = split(gt, hits)
        scopes = [(None, jr)]
        for proj in sorted({r["project"] for r in jr}):
            scopes.append((proj, [r for r in jr if r["project"] == proj]))
        for proj, sub in scopes:
            n = len(sub)
            if n < min_turns:
                continue  # not measured: too little data is not "fixed"
            out.evaluated.add(f"{j}:{proj}" if proj else j)
            hit_rows = [r for r in sub if hits[(r["sid"], r["uuid"])]]
            rate = len(hit_rows) / n
            threshold = TURN_QUALITY_THRESHOLDS.get(j, TURN_QUALITY_DEFAULT_THRESHOLD)
            if rate <= threshold:
                continue
            examples = [[r["sid"], r["uuid"]] for r in hit_rows[:3]]
            scope = f" in {proj}" if proj else ""
            detail = (
                f"{len(hit_rows)}/{n} scored replies{scope} hit '{j}' "
                f"({rate:.0%}, threshold {threshold:.0%}) in the last "
                f"{window_days} days."
            )
            if pred:
                detail += (
                    f" Predictive value (window-wide): P(next-turn correction | hit)="
                    f"{fmt(pred[0])} (n={pred[1]}) vs | not hit={fmt(pred[2])} "
                    f"(n={pred[3]}) per Jev's next_turn_correction (model agreement)."
                )
            detail += (
                f" Ground truth (regex user_correction on the next prompt): "
                f"P(corr | hit)={fmt(pred_gt[0])} (n={pred_gt[1]}) vs | not hit="
                f"{fmt(pred_gt[2])} (n={pred_gt[3]}). A judgment that predicts "
                "neither is noise."
            )
            out.append(
                _finding(
                    dimension="reply quality",
                    severity="MED" if rate >= 2 * threshold else "LOW",
                    title=f"{j} hit in {rate:.0%} of replies{scope}",
                    detail=detail,
                    proposed_action=(
                        f"Read the example turns, then tighten the surface: "
                        f"{spec['surface']}. Baseline with --baseline after the "
                        "change and --remeasure later."
                    ),
                    target_path=spec["surface"],
                    key=f"{j}:{proj}" if proj else j,
                    metric_value=rate,
                    rate=rate,
                    n=n,
                    project=proj,
                    examples=examples,
                    predictive={
                        "p_corr_given_hit": pred[0],
                        "n_hit": pred[1],
                        "p_corr_given_not_hit": pred[2],
                        "n_not_hit": pred[3],
                    }
                    if pred
                    else None,
                    ground_truth={
                        "p_corr_given_hit": pred_gt[0],
                        "n_hit": pred_gt[1],
                        "p_corr_given_not_hit": pred_gt[2],
                        "n_not_hit": pred_gt[3],
                    },
                )
            )

    hdr = by_j.get("header_present", [])
    if len(hdr) >= min_turns:
        out.evaluated.add("metric:header_present")
        missing = [r for r in hdr if not r["value"]]
        miss_rate = len(missing) / len(hdr)
        if 1 - miss_rate < HEADER_RATE_MIN:
            out.append(
                _finding(
                    dimension="reply quality",
                    severity="MED",
                    title=f"status header missing in {miss_rate:.0%} of replies",
                    detail=(
                        f"header_present rate {1 - miss_rate:.0%} over {len(hdr)} "
                        f"replies in {window_days}d (min {HEADER_RATE_MIN:.0%}). "
                        "metric_value is the missing rate (lower is better)."
                    ),
                    proposed_action=(
                        "Check the header is injected and the output style is "
                        "active: style: Status header / hooks/session_boot.py"
                    ),
                    target_path="style: Status header / hooks/session_boot.py",
                    key="metric:header_present",
                    metric_value=miss_rate,
                    rate=miss_rate,
                    n=len(hdr),
                    examples=[[r["sid"], r["uuid"]] for r in missing[:3]],
                )
            )
    bp = by_j.get("banned_punct", [])
    if len(bp) >= min_turns:
        out.evaluated.add("metric:banned_punct")
        bad = [r for r in bp if (r["value"] or 0) > 0]
        rate = len(bad) / len(bp)
        if rate > BANNED_PUNCT_RATE_MAX:
            out.append(
                _finding(
                    dimension="reply quality",
                    severity="LOW",
                    title=f"banned punctuation in {rate:.0%} of replies",
                    detail=(
                        f"{len(bad)}/{len(bp)} replies in {window_days}d contain "
                        "em/en dashes, curly quotes or the ellipsis glyph "
                        f"(max {BANNED_PUNCT_RATE_MAX:.0%})."
                    ),
                    proposed_action="Tighten the style: Characters",
                    target_path="style: Characters",
                    key="metric:banned_punct",
                    metric_value=rate,
                    rate=rate,
                    n=len(bp),
                    examples=[[r["sid"], r["uuid"]] for r in bad[:3]],
                )
            )
    return out


# How far back the recency-windowed miners look (missing-facets backlog,
# recurring friction). Lifetime counts can only grow, so a baseline taken from
# one can never be met however well the behavior improves.
RECENT_WINDOW_DAYS = 14


class MinerResult(list):
    """Findings list that also carries `evaluated`: the keys the miner had
    enough data to judge this run. mine() auto-resolves an open finding only
    when its key was evaluated and did not fire, so a quiet or thin window is
    never mistaken for a fix. Miners returning a plain list are never swept."""

    def __init__(self, *a):
        super().__init__(*a)
        self.evaluated = set()


MINERS = {
    "memory_capture_silent_drop": mine_memory_capture_silent_drop,
    "doctor_hook_stale_verdicts": mine_doctor_hook_stale_verdicts,
    "gate_block_silences_capture": mine_gate_block_silences_capture,
    "facet_uningested_hardcoded_zero": mine_facet_uningested_hardcoded_zero,
    "inline_dispatch_ratio_high": mine_inline_dispatch_ratio,
    "verifier_coverage_low": mine_low_verifier_coverage,
    "tool_error_rate_high": mine_tool_error_rate,
    "cache_hit_ratio_low": mine_low_cache_hit,
    "recurring_friction": mine_recurring_friction,
    "colony_adherence": mine_colony_adherence,
    "turn_quality": mine_turn_quality,
}


def mine(conn, root=None):
    """Run every registered miner, upsert each finding (fingerprint =
    '<miner>:<key>', so re-running updates rather than duplicates), and
    return {miner_name: finding_count}."""
    root = root or self_manifest()[0]
    counts = {}
    for name, fn in MINERS.items():
        try:
            found = fn(conn, root)
        except Exception as e:
            found = []
            counts[name] = f"error: {e}"
            continue
        emitted = set()
        for f in found:
            evidence = dict(f["evidence"])
            evidence["miner"] = name
            evidence["metric_value"] = f["metric_value"]
            fp = f"{name}:{f['key']}"
            emitted.add(fp)
            atlas_db.upsert_finding(
                conn,
                fp,
                dimension=f["dimension"],
                severity=f["severity"],
                title=f["title"],
                detail=f["detail"],
                evidence_json=json.dumps(evidence),
                proposed_action=f["proposed_action"],
                target_path=f["target_path"],
            )
            # A finding that fires again after auto-resolving is live again.
            conn.execute(
                "UPDATE findings SET status='open' WHERE fingerprint=? AND status='resolved'",
                (fp,),
            )
        # Close only untriaged findings whose key the miner evaluated with
        # enough data and that no longer fire. Miners that do not report
        # `evaluated` are never swept; a user's accepted/rejected/applied/
        # verified verdict is never touched (status must be 'open').
        evaluated = getattr(found, "evaluated", None) or set()
        stale = [f"{name}:{k}" for k in evaluated if f"{name}:{k}" not in emitted]
        for fp in stale:
            conn.execute(
                "UPDATE findings SET status='resolved', decided_at=? "
                "WHERE fingerprint=? AND status='open'",
                (time.time(), fp),
            )
        conn.commit()
        counts[name] = len(found)
    return counts


def measure_finding_metric(conn, finding, root=None):
    """Recompute a finding's headline metric_value by re-running the miner
    that produced it (recorded in evidence_json) and matching on its key.
    Returns: the fresh value if the miner still reproduces this instance;
    0.0 if the miner ran clean but no longer reproduces it (resolved); None
    if the miner is unknown or errors (caller should skip, not guess)."""
    try:
        evidence = json.loads(finding.get("evidence_json") or "{}")
    except (TypeError, ValueError):
        return None
    miner_name = evidence.get("miner")
    fn = MINERS.get(miner_name)
    fingerprint = finding.get("fingerprint") or ""
    if not fn or ":" not in fingerprint:
        return None
    key = fingerprint.split(":", 1)[1]
    root = root or self_manifest()[0]
    try:
        found = fn(conn, root)
    except Exception:
        return None
    for f in found:
        if f["key"] == key:
            return f["metric_value"]
    return 0.0


# Metrics whose improvement direction is upward. Everything else a miner
# emits is a problem count/rate where lower is better.
HIGHER_IS_BETTER_METRICS = {"verifier_coverage"}


def remeasure(conn, root=None):
    """For every improvement due for remeasurement (measure_after_runs runs
    have elapsed since baseline), recompute its metric and record
    improved|no_change|regressed. Direction is per metric: most miners emit
    problem counts/rates (lower is better), while metrics listed in
    HIGHER_IS_BETTER_METRICS improve by increasing."""
    updated = []
    for imp in atlas_db.pending_remeasures(conn):
        runs_since = conn.execute(
            "SELECT COUNT(*) FROM runs WHERE started_at > ?", (imp["ts"],)
        ).fetchone()[0]
        if runs_since < (imp["measure_after_runs"] or 0):
            continue  # not due yet
        finding = (
            atlas_db.get_finding(conn, imp["finding_id"]) if imp["finding_id"] else None
        )
        if finding is None:
            continue  # nothing to remeasure against
        value = measure_finding_metric(conn, finding, root=root)
        if value is None:
            continue  # unknown/errored miner -- leave pending rather than guess
        baseline = imp.get("baseline_value")
        higher = (imp.get("metric") or "") in HIGHER_IS_BETTER_METRICS
        if baseline is None:
            verdict = "no_change"
        elif value == baseline:
            verdict = "no_change"
        elif (value > baseline) if higher else (value < baseline):
            verdict = "improved"
        else:
            verdict = "regressed"
        remeasured_at = time.time()
        atlas_db.set_improvement_remeasure(
            conn, imp["id"], value, verdict, remeasured_at
        )
        imp = dict(
            imp, remeasured_value=value, verdict=verdict, remeasured_at=remeasured_at
        )
        updated.append(imp)
    return updated


def main(argv=None):
    ap = argparse.ArgumentParser(description="atlas plugin health check")
    ap.add_argument("--fix", action="store_true", help="repair what CHECK finds")
    ap.add_argument(
        "--hook",
        action="store_true",
        help="SessionStart mode: warn only, always exit 0",
    )
    ap.add_argument(
        "--purge",
        action="store_true",
        help="purge atlas.db telemetry tables to the row cap and exit",
    )
    ap.add_argument(
        "--purge-cap",
        type=int,
        default=None,
        help=f"row cap for --purge (default: {TELEMETRY_ROW_CAP})",
    )
    ap.add_argument("--plugin", default="atlas")

    # --- self-improvement loop (the /atlas-doctor skill drives these) ---
    ap.add_argument(
        "--mine", action="store_true", help="run all finding miners and upsert results"
    )
    ap.add_argument(
        "--list-findings",
        action="store_true",
        help="print findings (optionally filtered by --status)",
    )
    ap.add_argument("--status", default=None, help="filter for --list-findings")
    ap.add_argument(
        "--set-status",
        nargs=2,
        metavar=("FINDING_ID", "STATUS"),
        help="transition a finding: open|accepted|rejected|applied|verified|regressed",
    )
    ap.add_argument(
        "--baseline",
        metavar="FINDING_ID",
        type=int,
        help="record an improvement baseline for an applied finding",
    )
    ap.add_argument("--metric", default=None, help="metric label for --baseline")
    ap.add_argument(
        "--target", type=float, default=None, help="target value for --baseline"
    )
    ap.add_argument(
        "--after",
        type=int,
        default=5,
        help="runs to wait before --remeasure is due (default: 5)",
    )
    ap.add_argument("--note", default=None, help="free-text note for --baseline")
    ap.add_argument(
        "--run-id", type=int, default=0, help="run id to attach --baseline to"
    )
    ap.add_argument(
        "--remeasure",
        action="store_true",
        help="remeasure every improvement due (measure_after_runs elapsed)",
    )
    ap.add_argument(
        "--pending-facets",
        type=int,
        nargs="?",
        const=50,
        default=None,
        metavar="LIMIT",
        help="print facets rows pending LLM enrichment (default limit 50)",
    )
    ap.add_argument(
        "--enrich-facet",
        nargs=2,
        default=None,
        metavar=("SESSION_ID", "JSON"),
        help="write LLM-judged facet columns for one session, e.g. "
        '--enrich-facet abc123 \'{"primary_success":"...","brief_summary":"..."}\'',
    )
    ap.add_argument(
        "--json", action="store_true", help="machine-readable output for the above"
    )
    args = ap.parse_args(argv)

    if args.enrich_facet:
        session_id, payload = args.enrich_facet
        try:
            fields = json.loads(payload)
        except (json.JSONDecodeError, ValueError) as exc:
            print("--enrich-facet: JSON is not parseable: %s" % exc, file=sys.stderr)
            return 2
        if not isinstance(fields, dict) or not fields:
            print("--enrich-facet: expected a non-empty JSON object", file=sys.stderr)
            return 2
        unknown = sorted(set(fields) - set(atlas_db.FACET_COLUMNS))
        if unknown:
            print(
                "--enrich-facet: unknown facet column(s): %s" % unknown, file=sys.stderr
            )
            return 2
        conn = atlas_db.connect()
        atlas_db.init(conn)
        atlas_db.upsert_facet(conn, session_id, **fields)
        conn.close()
        print(json.dumps({"session_id": session_id, "written": sorted(fields)}))
        return 0

    if args.mine:
        conn = atlas_db.connect()
        atlas_db.init(conn)
        counts = mine(conn, self_manifest()[0])
        conn.close()
        print(json.dumps(counts, indent=2) if args.json else counts)
        return 0

    if args.list_findings:
        conn = atlas_db.connect()
        atlas_db.init(conn)
        rows = atlas_db.list_findings(conn, status=args.status)
        conn.close()
        if args.json:
            print(json.dumps(rows, indent=2))
        else:
            for r in rows:
                print(
                    f"[{r['id']}] {r['status']:10} {r['severity']:4} "
                    f"{r['dimension']:24} {r['title']}"
                )
        return 0

    if args.set_status:
        finding_id, status = int(args.set_status[0]), args.set_status[1]
        conn = atlas_db.connect()
        atlas_db.init(conn)
        now = time.time()
        atlas_db.set_finding_status(
            conn,
            finding_id,
            status,
            decided_at=now if status in ("accepted", "rejected") else None,
            applied_at=now if status == "applied" else None,
        )
        conn.close()
        print(f"finding {finding_id} -> {status}")
        return 0

    if args.baseline is not None:
        if not args.metric or args.target is None:
            print("--baseline requires --metric and --target")
            return 2
        conn = atlas_db.connect()
        atlas_db.init(conn)
        finding = atlas_db.get_finding(conn, args.baseline)
        if finding is None:
            print(f"no finding with id {args.baseline}")
            conn.close()
            return 2
        baseline_value = measure_finding_metric(conn, finding, self_manifest()[0])
        if baseline_value is None:
            baseline_value = 0.0
        imp_id = atlas_db.record_improvement(
            conn,
            args.run_id,
            finding["dimension"],
            str(baseline_value),
            str(args.target),
            args.note,
            finding_id=args.baseline,
            metric=args.metric,
            baseline_value=baseline_value,
            target_value=args.target,
            measure_after_runs=args.after,
        )
        conn.close()
        print(
            f"improvement {imp_id}: finding {args.baseline} baseline={baseline_value} "
            f"target={args.target} (remeasure after {args.after} runs)"
        )
        return 0

    if args.remeasure:
        conn = atlas_db.connect()
        atlas_db.init(conn)
        updated = remeasure(conn, self_manifest()[0])
        conn.close()
        if args.json:
            print(json.dumps(updated, indent=2))
        else:
            for u in updated:
                print(
                    f"improvement {u['id']} (finding {u['finding_id']}): "
                    f"{u['baseline_value']} -> {u['remeasured_value']} "
                    f"({u['verdict']})"
                )
            if not updated:
                print("no improvements due for remeasurement")
        return 0

    if args.pending_facets is not None:
        conn = atlas_db.connect()
        atlas_db.init(conn)
        rows = atlas_db.pending_facets(conn, limit=args.pending_facets)
        conn.close()
        print(json.dumps(rows, indent=2))
        return 0

    if args.purge:
        # M21/M22: trim telemetry oldest-first to the cap and record the run.
        summary = purge_telemetry(row_cap=args.purge_cap or TELEMETRY_ROW_CAP)
        record_maintenance("purge", {"tables": summary})
        for table, s in summary.items():
            print(
                f"PURGE {table}: {s['before']} -> {s['after']} (dropped {s['dropped']})"
            )
        return 0

    results, ctx = run_checks(args.plugin)
    failed = [r for r in results if not r["ok"] and r.get("severity") != "warn"]

    if args.fix and failed:
        for a in apply_fixes(ctx, args.plugin):
            print(f"FIX: {a}")
        results, ctx = run_checks(args.plugin)  # VERIFY
        failed = [r for r in results if not r["ok"] and r.get("severity") != "warn"]

    if args.hook:
        record_hook_verdict(args.plugin, failed)
        if failed:
            print(
                f"ATLAS-DOCTOR WARNING: {args.plugin} plugin is unhealthy - "
                + "; ".join(f"{r['check']}: {r['detail']}" for r in failed)
                + ". Run: python3 <plugin>/scripts/atlas_doctor.py --fix, then /reload-plugins."
            )
        return 0

    for r in results:
        status = (
            "PASS" if r["ok"] else ("WARN" if r.get("severity") == "warn" else "FAIL")
        )
        print(f"{status}  {r['check']:20} {r['detail']}")
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
