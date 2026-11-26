#!/usr/bin/env python3
"""One crew run of a fixture for the learning-loop benchmark.

bench.py --fixture DIR --plugin PLUGIN_DIR --tag NAME [--store-in lessons.json] [--learn on|off]
Writes runs/<tag>/result.json and, when the run left one, runs/<tag>/lessons.json.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def sh(cmd, cwd, env=None, timeout=1800):
    return subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)


def check_calls(log: Path):
    """(check runs, failed check runs) a worker made, read from its stream-json log."""
    runs = fails = 0
    pending = {}
    for line in log.read_text(errors="replace").splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        msg = ev.get("message") if isinstance(ev, dict) else None
        content = msg.get("content") if isinstance(msg, dict) else None
        for part in content if isinstance(content, list) else []:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "tool_use" and part.get("name") == "Bash":
                cmd = (part.get("input") or {}).get("command", "")
                if "irc check" in cmd or "pytest" in cmd:
                    pending[part.get("id")] = True
            elif part.get("type") == "tool_result" and part.get("tool_use_id") in pending:
                runs += 1
                if part.get("is_error"):
                    fails += 1
    return runs, fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", required=True)
    ap.add_argument("--plugin", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--store-in")
    ap.add_argument("--learn", default="on")
    ap.add_argument("--model", default="claude-sonnet-5-5")
    ap.add_argument("--effort", default="medium")
    ap.add_argument("--collect", action="store_true", help="only re-collect an existing run's results")
    ap.add_argument("--check", help="global check; default: visible tests plus the fixture's hidden house/tests")
    a = ap.parse_args()
    out = HERE / "runs" / a.tag
    work = out / "work"
    house = (Path(a.fixture) / "house" / "tests").resolve()
    check = a.check or ("python3 -m pytest -q -p no:cacheprovider --import-mode=importlib tests " + (str(house) if house.is_dir() else ""))
    env = dict(os.environ, ATLAS_CREW_LEARN=a.learn, ATLAS_ANALYTICS="off")
    if a.collect:
        return collect(a, out, work, check, env, None)
    if out.exists():
        sys.exit(f"{out} exists")
    shutil.copytree(Path(a.fixture) / "task", work)
    for k in ("CLAUDE_CODE_SESSION_ID",):
        env.pop(k, None)
    sh(["git", "init", "-q"], work)
    sh(["git", "-c", "user.name=bench", "-c", "user.email=bench@example.invalid", "add", "-A"], work)
    sh(["git", "-c", "user.name=bench", "-c", "user.email=bench@example.invalid", "commit", "-qm", "stubs"], work)
    if a.store_in:
        (work / ".atlas" / "memory").mkdir(parents=True, exist_ok=True)
        shutil.copy(a.store_in, work / ".atlas" / "memory" / "lessons.json")
    crew = str(Path(a.plugin) / "scripts" / "atlas_crew.py")
    plan = sh([sys.executable, crew, "plan", "--root", str(work), "--spec", "SPEC.md", "--files", "kit/[!_]*.py",
               "--tests", "tests/test_{stem}.py", "--check", check,
               "--out", str(out / "plan.json")], work, env)
    if plan.returncode:
        sys.exit(f"plan failed: {plan.stdout}{plan.stderr}")
    t0 = time.time()
    run = sh([sys.executable, crew, "run", "--root", str(work), "--plan", str(out / "plan.json"),
              "--model", a.model, "--effort", a.effort, "--run-id", a.tag.replace(".", "_"), "--wait", "1500"],
             work, env)
    wall = time.time() - t0
    (out / "run.out").write_text(run.stdout + run.stderr)
    return collect(a, out, work, check, env, wall)


def collect(a, out, work, check, env, wall):
    rundir = next((work / ".atlas" / ".run" / "crew").glob("*"), None)
    full = {}
    if rundir and (rundir / "summary.json").exists():
        full = json.loads((rundir / "summary.json").read_text())
    final = sh(["bash", "-c", check], work, env)
    tail = final.stdout.strip().splitlines()[-1] if final.stdout.strip() else ""
    checks = fails = 0
    per = {}
    if rundir:
        for log in sorted((rundir / "logs").glob("*.log")):
            r, f = check_calls(log)
            per[log.stem] = {"check_runs": r, "check_fails": f}
            checks += r
            fails += f
    res = {
        "tag": a.tag,
        "learn": a.learn,
        "store_in": a.store_in,
        "wall_s": round(wall, 1) if wall is not None else None,
        "crew_wall_s": full.get("wall_s"),
        "ok": full.get("ok"),
        "final_pytest": tail,
        "final_rc": final.returncode,
        "tokens_workers": (full.get("tokens_workers") or {}).get("total"),
        "turns": sum((w.get("turns") or 0) for w in full.get("workers") or []),
        "gate_refusals": sum((w.get("gate_refusals") or 0) for w in full.get("workers") or []),
        "rounds": len(full.get("rounds") or []),
        "check_runs": checks,
        "check_fails": fails,
        "per_log": per,
        "workers": [{k: w.get(k) for k in ("name", "turns", "tokens", "gate_refusals")} for w in full.get("workers") or []],
        "lessons": full.get("lessons"),
        "tests_changed": sh(["git", "status", "--porcelain", "tests"], work).stdout.strip(),
    }
    (out / "result.json").write_text(json.dumps(res, indent=1))
    store = work / ".atlas" / "memory" / "lessons.json"
    if store.exists():
        shutil.copy(store, out / "lessons.json")
    if rundir:  # keep the logs and prompts, drop the rest of the work tree
        keep = out / "crew"
        shutil.copytree(rundir / "logs", keep / "logs", dirs_exist_ok=True)
        shutil.copytree(rundir / "prompts", keep / "prompts", dirs_exist_ok=True)
        for f in ("summary.json",):
            if (rundir / f).exists():
                shutil.copy(rundir / f, keep / f)
    print(json.dumps({k: res[k] for k in ("tag", "ok", "final_pytest", "tokens_workers", "turns", "check_runs", "check_fails", "crew_wall_s", "lessons")}))


if __name__ == "__main__":
    main()
