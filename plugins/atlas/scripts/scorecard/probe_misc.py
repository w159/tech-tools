"""Doctor behaviour, MCP/contract drift, lint results."""

import json
import re
import sqlite3

from . import core
from .core import metric, run, skipped
from .probe_hooks import CMD


def probe_doctor(ctx):
    cmd = CMD + "doctor"
    env, atlas, home = core.iso_env(ctx, "doctor", tmux=False)
    doctor = str(ctx.scripts / "atlas_doctor.py")
    out = []
    # latency of the plain check in a clean HOME
    lat, rcs = [], set()
    for _ in range(3 if ctx.quick else 5):
        r = run([ctx.py, doctor], env=env, timeout=120)
        lat.append(r["ms"])
        rcs.add(r["rc"])
    out += core.latency_metrics("doctor_check", lat, "doctor", cmd)
    out.append(
        metric(
            "doctor_check_crashes",
            sum(1 for x in rcs if x not in (0, 1)),
            "rcs",
            "lower",
            cmd=cmd,
            group="doctor",
            note="exit codes other than 0/1 from the plain check",
        )
    )
    # --hook must never crash a hook chain, even on a corrupt state file
    state = atlas / "doctor-state.json"
    state.write_text("{not json")
    before = len(core.faults(atlas))
    r = run(
        [ctx.py, doctor, "--hook"],
        input=json.dumps({"hook_event_name": "SessionStart"}),
        env=env,
        timeout=60,
    )
    out.append(
        metric(
            "doctor_hook_corrupt_state_rc",
            0 if r["rc"] == 0 else 1,
            "rc!=0",
            "lower",
            cmd=cmd,
            group="doctor",
        )
    )
    out.append(
        metric(
            "doctor_hook_corrupt_state_traced",
            len(core.faults(atlas)) - before,
            "faults",
            "higher",
            cmd=cmd,
            group="doctor",
            note="corrupt state leaves a durable fault line",
        )
    )
    # miners on a DB with a NULL inline_ops row
    root = ctx.sub("doctor") / "proj"
    root.mkdir(exist_ok=True)
    try:
        core.seed_db(ctx, atlas / "atlas.db", root)
        c = sqlite3.connect(atlas / "atlas.db")
        c.execute(
            "update metrics set inline_ops=NULL, dispatches=2 where rowid in (select rowid from metrics limit 5)"
        )
        c.commit()
        c.close()
        r = run([ctx.py, doctor, "--mine", "--json"], env=env, timeout=300)
        errs = len(re.findall(r'"error: ', r["out"]))
        out.append(
            metric(
                "doctor_miner_errors",
                errs,
                "miners",
                "lower",
                cmd=cmd,
                group="doctor",
                note="--mine with NULL inline_ops rows",
            )
        )
    except Exception as e:  # noqa: BLE001
        out.append(
            skipped(
                "doctor_miner_errors",
                f"could not prepare DB: {e}",
                "miners",
                cmd=cmd,
                group="doctor",
                state="error",
            )
        )
    # does ATLAS_HOME alone isolate the DB? (hooks/dashboard/doctor must agree on one resolver)
    iso = {**env}
    iso.pop("ATLAS_DB", None)
    iso.pop("ATLAS_DASHBOARD_DB", None)
    r = run(
        [
            ctx.py,
            "-c",
            f"import sys; sys.path.insert(0, {str(ctx.scripts)!r}); import atlas_db; print(atlas_db.db_path())",
        ],
        env=iso,
        timeout=30,
    )
    out.append(
        metric(
            "isolation_db_follows_atlas_home",
            int(r["out"].strip().startswith(str(atlas))),
            "bool",
            "higher",
            cmd=cmd,
            group="doctor",
            note="with only ATLAS_HOME set, db_path() resolves under it",
        )
    )
    return out


def probe_mcp_drift(ctx):
    cmd = CMD + "mcp_drift"
    root = ctx.root
    try:
        mcp = json.loads((root / ".mcp.json").read_text())["mcpServers"]
        uc = set(
            json.loads((root / ".claude-plugin/plugin.json").read_text()).get(
                "userConfig", {}
            )
        )
    except (OSError, ValueError, KeyError) as e:
        return [
            skipped(
                "mcp_servers_vs_dirs_diff",
                f"cannot read .mcp.json/plugin.json: {e}",
                "servers",
                cmd=cmd,
                group="drift",
            )
        ]
    dirs = {
        p.name
        for p in (root / "mcp").iterdir()
        if p.is_dir() and not p.name.startswith(("_", ".")) and "cache" not in p.name.lower()
    }
    refs = set(re.findall(r"\$\{user_config\.([A-Za-z0-9_]+)\}", json.dumps(mcp)))
    cfg_env = {
        k[4:]
        for s in mcp.values()
        for k in (s.get("env") or {})
        if k.startswith("CFG_")
    }
    example = (
        (root / ".env.example").read_text() if (root / ".env.example").exists() else ""
    )
    have = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)\s*=", example, re.M))
    missing_example = sorted(cfg_env - have)
    bad = []
    for p in sorted((root / "contracts").glob("*.json")):
        try:
            json.loads(p.read_text())
        except ValueError:
            bad.append(p.name)
    return [
        metric(
            "mcp_servers_wired", len(mcp), "servers", "info", cmd=cmd, group="drift"
        ),
        metric(
            "mcp_servers_vs_dirs_diff",
            len(set(mcp) ^ dirs),
            "servers",
            "lower",
            cmd=cmd,
            group="drift",
            detail=sorted(set(mcp) ^ dirs),
        ),
        metric(
            "mcp_userconfig_unused",
            len(uc - refs),
            "keys",
            "lower",
            cmd=cmd,
            group="drift",
            detail=sorted(uc - refs),
        ),
        metric(
            "mcp_userconfig_undeclared",
            len(refs - uc),
            "keys",
            "lower",
            cmd=cmd,
            group="drift",
            detail=sorted(refs - uc),
        ),
        metric(
            "mcp_env_example_missing",
            len(missing_example),
            "keys",
            "lower",
            cmd=cmd,
            group="drift",
            detail=missing_example,
            note="CFG_* env wired in .mcp.json but absent from .env.example",
        ),
        metric(
            "contracts_unparseable",
            len(bad),
            "files",
            "lower",
            cmd=cmd,
            group="drift",
            detail=bad,
        ),
    ]


def probe_lint(ctx):
    cmd = f"cd {ctx.root}/scripts && python3 lint_skill_names.py; python3 lint_docs_names.py --all"
    env, _a, _h = core.iso_env(ctx, "lint", tmux=False)
    out = []
    for name, argv in (
        ("lint_skill_names", [ctx.py, str(ctx.scripts / "lint_skill_names.py")]),
        ("lint_docs_names", [ctx.py, str(ctx.scripts / "lint_docs_names.py"), "--all"]),
    ):
        r = run(argv, env=env, cwd=str(ctx.root), timeout=120)
        lines = [ln for ln in (r["out"] + r["err"]).splitlines() if ln.strip()]
        offenders = [ln for ln in lines if not re.search(r"\b(OK|conform)", ln)]
        out.append(
            metric(
                f"{name}_rc",
                0 if r["rc"] == 0 else 1,
                "rc!=0",
                "lower",
                cmd=cmd,
                group="lint",
            )
        )
        out.append(
            metric(
                f"{name}_violation_lines",
                len(offenders),
                "lines",
                "lower",
                cmd=cmd,
                group="lint",
                detail=offenders[:10],
            )
        )
    return out


PROBES = [
    (
        "doctor",
        probe_doctor,
        ["doctor_hook_corrupt_state_rc", "doctor_miner_errors"],
        False,
    ),
    ("mcp_drift", probe_mcp_drift, ["mcp_servers_vs_dirs_diff"], False),
    ("lint", probe_lint, ["lint_skill_names_rc", "lint_docs_names_rc"], False),
]
