#!/usr/bin/env python3
"""SWE-style history benchmark: Claude Code with the Atlas plugin vs plain Claude Code on this repo's own bug fixes.

Why a new file and not `atlas_provider.py bench`: that bench runs one synthetic fixture through the crew runner to compare
model providers. This one needs a per-task git worktree at a historical parent commit, two `claude -p` arms (plugin-free
and atlas-from-source), hidden-test scoring and a test-file tamper check, so none of the provider bench fits. It reuses
nothing from there except the idea of a results table.

Task source: commits that fix a bug in plugins/atlas/{hooks,scripts}/*.py and add or change a test that fails on the parent's
source and passes with the fix's source files (proved by `validate`, never assumed). Stored in bench_history_tasks.json.

Arms (same model, same prompt text, both with the Agent/Task tool available):
  plain  CLAUDE_CONFIG_DIR is an empty scratch dir holding only credentials, plugin and skill sync off: only Claude Code's
         built-in plugins load (verified from the stream-json init event, see assert_arm_init).
  atlas  the same scratch config plus `--plugin-dir <run dir>/plugin/<key>/plugins/atlas`, a `git archive` export of
         plugins/atlas at the task's PARENT commit (never the working tree, which holds every task's fix; never the
         install cache). The export is removed after the run.

Resolved = every fail-to-pass test passes AND every test in the test files the fix touched passes AND no test file was
added, changed or deleted (sha256 manifest compare).

CLI:
  atlas_history_bench.py mine     [--since 2026-09-15]
  atlas_history_bench.py validate --work DIR [--tasks F] [--only ID,...] [--candidates SHA,...] [--write]
  atlas_history_bench.py run      --work DIR [--tasks F] [--trials 3] [--arms plain,atlas] [--concurrency 3] [--budget 40]
  atlas_history_bench.py report   --results F
Stdlib only. Never writes under ~/.claude/plugins.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import math
import os
import re
import shutil
import signal
import statistics
import subprocess
import sys
import threading
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TASKS_FILE = Path(__file__).resolve().with_name("bench_history_tasks.json")
MODEL = "claude-sonnet-5-5"
PROMPT_SUFFIX = "Fix the bug so the failing test passes. Do not edit tests."
PYTEST = "/root/.local/bin/pytest"
PER_RUN_CAP_USD = 2.0
DEFAULT_TIMEOUT_S = 900
VALIDATE_TIMEOUT_S = 150
SLOW_TEST_RE = re.compile(r"tui|dashboard|herdr|panefeed|tmux|colony|mux|team|dash_|omp_")
SRC_RE = re.compile(r"^plugins/atlas/(hooks|scripts)/[^/]+\.py$")
TEST_RE = re.compile(r"(^|/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$")
FIX_RE = re.compile(
    r"fix|bug|regress|crash|leak|wrong|false|race|stale|never|survive", re.I
)
GATE_RE = re.compile(
    r"dispatch_denied|Stop hook|stop hook|blocked by hook|hook_blocked|gate block|Stop gate",
    re.I,
)
OUTCOME_RE = re.compile(r"^(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\s+(\S.*)$")
SKIP_DIRS = {"__pycache__", ".pytest_cache", ".atlas", ".git", "node_modules"}
_GIT_LOCK = threading.Lock()


# ---------------------------------------------------------------- git helpers


def git(*args, cwd=REPO, check=True, timeout=300):
    p = subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True, timeout=timeout
    )
    if check and p.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed in {cwd}: {p.stderr.strip()[:400]}"
        )
    return p.stdout


def is_test_path(path: str) -> bool:
    return bool(TEST_RE.search(path)) or "/tests/" in "/" + path


def classify_files(name_status_lines):
    """Split `git show --name-status` rows into (src, tests, other_count). src = modified atlas hook/script modules."""
    src, tests, other = [], [], 0
    for row in name_status_lines:
        if "\t" not in row:
            continue
        status, path = row.split("\t", 1)
        if (
            is_test_path(path)
            and path.startswith("plugins/atlas/")
            and status[:1] in ("M", "A")
        ):
            tests.append(path)
        elif SRC_RE.match(path) and not is_test_path(path) and status[:1] == "M":
            src.append(path)
        else:
            other += 1
    return src, tests, other


def mine(since: str = "2026-09-15", repo: Path = REPO):
    """Candidate fix commits: 1..3 source files, 1..3 test files, fix-like subject. Validation decides which are real."""
    out = git(
        "log",
        f"--since={since}",
        "--no-merges",
        "--format=%H|%s",
        "--",
        "plugins/atlas",
        cwd=repo,
    )
    cands = []
    for line in out.splitlines():
        sha, subject = line.split("|", 1)
        rows = git(
            "show", "--no-renames", "--name-status", "--format=", sha, cwd=repo
        ).splitlines()
        src, tests, other = classify_files(rows)
        if 1 <= len(src) <= 3 and 1 <= len(tests) <= 3 and FIX_RE.search(subject) and not any(SLOW_TEST_RE.search(t) for t in tests):
            cands.append(
                {
                    "commit": sha,
                    "subject": subject,
                    "src_files": src,
                    "test_files": tests,
                    "other_files": other,
                }
            )
    return cands


# ---------------------------------------------------------------- worktrees


def add_worktree(dest: Path, rev: str, repo: Path = REPO) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with _GIT_LOCK:
        git("worktree", "add", "--detach", "--force", str(dest), rev, cwd=repo)
    return dest


def remove_worktree(dest: Path, repo: Path = REPO) -> None:
    with _GIT_LOCK:
        subprocess.run(
            ["git", "worktree", "remove", "--force", str(dest)],
            cwd=str(repo),
            capture_output=True,
            text=True,
        )
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)


def prune_worktrees(repo: Path = REPO) -> None:
    with _GIT_LOCK:
        subprocess.run(
            ["git", "worktree", "prune"], cwd=str(repo), capture_output=True, text=True
        )


def overlay(wt: Path, rev: str, files) -> None:
    """Bring `files` to their state at `rev` inside worktree `wt` (the fix's tests, or its source files)."""
    if files:
        git("checkout", rev, "--", *files, cwd=wt)


def build_task_worktree(task: dict, dest: Path, repo: Path = REPO) -> Path:
    """Parent commit's tree plus the fix's test files: the state an agent starts from."""
    add_worktree(dest, task["parent"], repo)
    overlay(dest, task["commit"], task["test_files"])
    return dest


def export_plugin(task: dict, dest: Path, repo: Path = REPO) -> Path:
    """`git archive <task parent> plugins/atlas` into `dest`; returns dest/plugins/atlas. The parent commit cannot
    contain the task's fix, unlike the working tree. Raises RuntimeError when the export fails."""
    dest.mkdir(parents=True, exist_ok=True)
    with _GIT_LOCK:
        arc = subprocess.run(
            ["git", "archive", "--format=tar", task["parent"], "plugins/atlas"],
            cwd=str(repo),
            capture_output=True,
            timeout=120,
        )
    if arc.returncode != 0:
        raise RuntimeError("git archive failed: " + arc.stderr.decode(errors="replace")[:200])
    tar = subprocess.run(
        ["tar", "-x", "-C", str(dest)], input=arc.stdout, capture_output=True, timeout=120
    )
    if tar.returncode != 0:
        raise RuntimeError("tar extract failed: " + tar.stderr.decode(errors="replace")[:200])
    return dest / "plugins" / "atlas"


# ---------------------------------------------------------------- tamper check


def manifest(root: Path) -> dict:
    """sha256 of every test-looking file under root/plugins (skipping caches); the test-tamper baseline."""
    out = {}
    base = Path(root) / "plugins"
    if not base.is_dir():
        return out
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            rel = os.path.relpath(os.path.join(dirpath, fn), root)
            if is_test_path(rel):
                try:
                    out[rel] = hashlib.sha256(
                        Path(dirpath, fn).read_bytes()
                    ).hexdigest()
                except OSError:
                    out[rel] = "unreadable"
    return out


def modified_tests(before: dict, after: dict) -> list:
    """Test files added, changed or deleted between two manifests (sorted)."""
    return sorted(p for p in set(before) | set(after) if before.get(p) != after.get(p))


# ---------------------------------------------------------------- pytest


def clean_env(extra=None) -> dict:
    keep = {
        k: v
        for k, v in os.environ.items()
        if not re.match(r"(CLAUDE|CCR_|ATLAS_|SESSION_INGRESS|AI_AGENT|PYTEST_)", k)
    }
    keep.update(extra or {})
    return keep


def parse_pytest(text: str) -> dict:
    """node id -> outcome from `pytest -rA` short summary lines. Collection errors map the file path to ERROR."""
    res = {}
    for line in text.splitlines():
        m = OUTCOME_RE.match(line.strip())
        if not m:
            continue
        status, rest = m.group(1), m.group(2)
        node = rest.split(" - ", 1)[0].strip()
        if "::" in node or node.endswith(".py"):
            res[node] = status
    return res


def run_pytest(cwd: Path, targets, timeout=900, tmpdir=None) -> dict:
    env = clean_env({"TMPDIR": str(tmpdir)} if tmpdir else None)
    cmd = [PYTEST, "-q", "--tb=no", "-rA", "-p", "no:cacheprovider", *targets]
    try:
        p = subprocess.run(
            cmd, cwd=str(cwd), env=env, capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired:
        return {"rc": -9, "outcomes": {}, "timeout": True, "tail": ""}
    return {
        "rc": p.returncode,
        "outcomes": parse_pytest(p.stdout),
        "timeout": False,
        "tail": p.stdout[-400:],
    }


# ---------------------------------------------------------------- scoring (pure)


def fail_to_pass(before: dict, after: dict) -> list:
    """Tests that fail or error before the fix and pass after it."""
    return sorted(
        n
        for n, s in after.items()
        if s == "PASSED" and before.get(n) in ("FAILED", "ERROR", None)
    )


def tests_that_break(before: dict, after: dict) -> list:
    return sorted(
        n
        for n, s in before.items()
        if s == "PASSED" and after.get(n) in ("FAILED", "ERROR", None)
    )


def decide(task: dict, outcomes: dict, tampered) -> dict:
    """Resolved iff all fail-to-pass pass, every test in the touched files passes, and no test file changed."""
    f2p_bad = [n for n in task["fail_to_pass"] if outcomes.get(n) != "PASSED"]
    file_bad = [n for n, s in outcomes.items() if s in ("FAILED", "ERROR")]
    no_outcomes = not outcomes
    reasons = []
    if no_outcomes:
        reasons.append("no pytest outcomes")
    if f2p_bad:
        reasons.append(f"{len(f2p_bad)} target test(s) not passing")
    if file_bad:
        reasons.append(f"{len(file_bad)} test(s) failing in touched files")
    if tampered:
        reasons.append("test file modified: " + ",".join(tampered))
    return {
        "resolved": not reasons,
        "reasons": reasons,
        "f2p_bad": f2p_bad,
        "file_bad": file_bad,
        "tampered": list(tampered),
    }


# ---------------------------------------------------------------- task validation


def validate_task(task: dict, work: Path, repo: Path = REPO, runner=run_pytest) -> dict:
    """Prove failing-before and passing-after for one task. Returns evidence; `ok` says the task is usable."""
    wt = work / "val" / task["commit"][:8]
    tmp = work / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    ev = {"commit": task["commit"][:8], "ok": False}
    try:
        build_task_worktree(task, wt, repo)
        before = runner(wt, task["test_files"], timeout=VALIDATE_TIMEOUT_S, tmpdir=tmp)
        overlay(wt, task["commit"], task["src_files"])
        after = runner(wt, task["test_files"], timeout=VALIDATE_TIMEOUT_S, tmpdir=tmp)
    except Exception as exc:  # noqa: BLE001 - evidence, not control flow
        ev["error"] = str(exc)[:300]
        return ev
    finally:
        remove_worktree(wt, repo)
        prune_worktrees(repo)
    f2p = fail_to_pass(before["outcomes"], after["outcomes"])
    broken = tests_that_break(before["outcomes"], after["outcomes"])
    after_bad = [n for n, s in after["outcomes"].items() if s in ("FAILED", "ERROR")]
    ev.update(
        {
            "before_rc": before["rc"],
            "after_rc": after["rc"],
            "before_failed": sorted(
                n for n, s in before["outcomes"].items() if s in ("FAILED", "ERROR")
            ),
            "after_failed": after_bad,
            "fail_to_pass": f2p,
            "broken_by_fix": broken,
            "n_tests_after": len(after["outcomes"]),
            "timeout": bool(before["timeout"] or after["timeout"]),
        }
    )
    ev["ok"] = bool(f2p) and not after_bad and not broken and not ev["timeout"]
    return ev


# ---------------------------------------------------------------- claude runs


def arm_cmd(
    arm: str, prompt: str, plugin_dir: Path, cap_usd: float = PER_RUN_CAP_USD
) -> list:
    cmd = [
        "claude",
        "-p",
        prompt,
        "--model",
        MODEL,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--max-budget-usd",
        str(cap_usd),
    ]
    if arm == "atlas":
        cmd += ["--plugin-dir", str(plugin_dir)]
    elif arm != "plain":
        raise ValueError(f"unknown arm {arm}")
    return cmd


def arm_env(arm: str, cfg_dir: Path, state_dir: Path | None = None) -> dict:
    """Isolated env. state_dir (per run) takes atlas runtime state so the real ~/.atlas is never written."""
    extra = {"CLAUDE_CONFIG_DIR": str(cfg_dir), "CLAUDE_CODE_SYNC_PLUGINS": "0", "CLAUDE_CODE_SYNC_SKILLS": "0"}
    if state_dir is not None:
        extra.update(
            {
                "ATLAS_HOME": str(state_dir),
                "ATLAS_DB": str(state_dir / "atlas.db"),
                "ATLAS_DASHBOARD_DB": str(state_dir / "dashboard.db"),
                "ATLAS_HOOKSTATE_DIR": str(state_dir / "hookstate"),
            }
        )
    env = clean_env(extra)
    env.pop("CLAUDE_CODE_PLUGIN_SEED_DIR", None)
    return env


def build_prompt(task: dict) -> str:
    return task["statement"].rstrip() + "\n\n" + PROMPT_SUFFIX


def assert_arm_init(arm: str, init: dict) -> str | None:
    """None when the init event matches the arm; else the reason. plain must carry no non-builtin plugin."""
    names = [
        p.get("name") for p in init.get("plugins", []) if p.get("path") != "builtin"
    ]
    if arm == "plain" and names:
        return f"plain arm loaded plugins {names}"
    if arm == "atlas" and names != ["atlas"]:
        return f"atlas arm plugins {names}"
    if arm == "atlas" and not any(
        p.get("path", "").endswith("plugins/atlas") for p in init.get("plugins", [])
    ):
        return "atlas arm not loaded from a plugins/atlas source dir"
    if init.get("model") and MODEL not in str(init.get("model")):
        return f"model {init.get('model')}"
    return None


def parse_stream(text: str) -> dict:
    """Pull init, result, cost, tokens, tool and gate counts from stream-json lines."""
    init, result, gate, tools, agent_calls = {}, {}, 0, 0, 0
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        t = ev.get("type")
        if t == "system" and ev.get("subtype") == "init":
            init = ev
        elif t == "result":
            result = ev
        elif t == "assistant":
            for blk in (ev.get("message") or {}).get("content") or []:
                if isinstance(blk, dict) and blk.get("type") == "tool_use":
                    tools += 1
                    if blk.get("name") in ("Task", "Agent"):
                        agent_calls += 1
        elif t == "user":
            for blk in (ev.get("message") or {}).get("content") or []:
                if (
                    isinstance(blk, dict)
                    and blk.get("type") == "tool_result"
                    and blk.get("is_error")
                ):
                    if GATE_RE.search(json.dumps(blk.get("content"))[:2000]):
                        gate += 1
        elif (
            t == "system"
            and ev.get("subtype") in ("hook_response", "hook_blocked")
            and GATE_RE.search(json.dumps(ev)[:2000])
        ):
            if str(ev.get("outcome", "")) in (
                "block",
                "error",
                "deny",
            ) or "block" in str(ev.get("subtype")):
                gate += 1
    return {
        "init": init,
        "result": result,
        "gate_blocks": gate,
        "tool_calls": tools,
        "agent_calls": agent_calls,
    }


def tokens_from(result: dict) -> dict:
    """Fresh input, cache read, cache write, output; summed over models (subagents included) when modelUsage exists."""
    mu = result.get("modelUsage") or {}
    if mu:
        vals = list(mu.values())
        return {
            "input": sum(int(v.get("inputTokens", 0)) for v in vals),
            "cache_read": sum(int(v.get("cacheReadInputTokens", 0)) for v in vals),
            "cache_write": sum(int(v.get("cacheCreationInputTokens", 0)) for v in vals),
            "output": sum(int(v.get("outputTokens", 0)) for v in vals),
        }
    u = result.get("usage") or {}
    return {
        "input": int(u.get("input_tokens", 0)),
        "cache_read": int(u.get("cache_read_input_tokens", 0)),
        "cache_write": int(u.get("cache_creation_input_tokens", 0)),
        "output": int(u.get("output_tokens", 0)),
    }


def kill_group(proc) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def run_claude(
    arm: str,
    prompt: str,
    wt: Path,
    cfg_dir: Path,
    plugin_dir: Path,
    timeout: float,
    log: Path,
    state_dir: Path | None = None,
) -> dict:
    cmd = arm_cmd(arm, prompt, plugin_dir)
    if state_dir is not None:
        state_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    timed_out = False
    proc = subprocess.Popen(
        cmd,
        cwd=str(wt),
        env=arm_env(arm, cfg_dir, state_dir),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_group(proc)
        out, err = proc.communicate()
    kill_group(proc)
    wall = time.time() - t0
    log.write_text((out or "") + "\n--- stderr ---\n" + (err or "")[-4000:])
    st = parse_stream(out or "")
    res = st["result"]
    return {
        "wall_s": round(wall, 1),
        "timeout": timed_out,
        "rc": proc.returncode,
        "usd": float(res.get("total_cost_usd") or 0.0),
        "tokens": tokens_from(res),
        "num_turns": res.get("num_turns"),
        "is_error": bool(res.get("is_error")) or not res,
        "subtype": res.get("subtype"),
        "gate_blocks": st["gate_blocks"],
        "tool_calls": st["tool_calls"],
        "agent_calls": st["agent_calls"],
        "init_problem": assert_arm_init(arm, st["init"])
        if st["init"]
        else "no init event",
    }


def run_one(
    task: dict,
    arm: str,
    trial: int,
    work: Path,
    timeout: float,
    repo: Path = REPO,
) -> dict:
    key = f"{task['id']}-{arm}-{trial}"
    wt = work / "wt" / key
    cfg = work / "cfg" / arm
    cfg.mkdir(parents=True, exist_ok=True)
    (work / "logs").mkdir(parents=True, exist_ok=True)
    tmp = work / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    row = {"key": key, "task": task["id"], "arm": arm, "trial": trial}
    plugin_root = work / "plugin" / key
    try:
        plugin_dir = (
            export_plugin(task, plugin_root, repo) if arm == "atlas" else plugin_root / "plugins" / "atlas"
        )
        build_task_worktree(task, wt, repo)
        base = manifest(wt)
        row.update(
            run_claude(
                arm,
                build_prompt(task),
                wt,
                cfg,
                plugin_dir,
                timeout,
                work / "logs" / f"{key}.jsonl",
                work / "state" / key,
            )
        )
        tampered = modified_tests(base, manifest(wt))
        targets = list(task["test_files"])
        sc = run_pytest(wt, targets, timeout=600, tmpdir=tmp)
        row["score"] = decide(task, sc["outcomes"], tampered)
        row["resolved"] = row["score"]["resolved"]
        row["diff_stat"] = (
            git("diff", "--stat", "HEAD", "--", ".", cwd=wt, check=False)
            .strip()
            .splitlines()[-1:]
        )
    except Exception as exc:  # noqa: BLE001
        row.setdefault("resolved", False)
        row["error"] = str(exc)[:300]
    finally:
        remove_worktree(wt, repo)
        prune_worktrees(repo)
        shutil.rmtree(plugin_root, ignore_errors=True)
    return row


def load_done(path: Path) -> list:
    rows = []
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return rows


def plan_runs(tasks, arms, trials):
    """Trial-major order so an early stop leaves both arms with the same coverage."""
    return [(t, a, n) for n in range(1, trials + 1) for t in tasks for a in arms]


def may_launch(
    spent: float, inflight: int, budget: float, cap: float = PER_RUN_CAP_USD
) -> bool:
    """A run starts only if its worst case (cap) plus every in-flight cap still fits the budget."""
    return spent + (inflight + 1) * cap <= budget


def cmd_run(args) -> int:
    work = Path(args.work)
    tasks = json.loads(Path(args.tasks).read_text())["tasks"]
    if args.only:
        keep = set(args.only.split(","))
        tasks = [t for t in tasks if t["id"] in keep]
    arms = args.arms.split(",")
    out = work / "results.jsonl"
    done = {r["key"] for r in load_done(out)}
    todo = [
        (t, a, n)
        for (t, a, n) in plan_runs(tasks, arms, args.trials)
        if f"{t['id']}-{a}-{n}" not in done
    ]
    spent = sum(r.get("usd", 0.0) for r in load_done(out))
    inflight, lock, skipped = 0, threading.Lock(), []

    def go(item):
        nonlocal inflight, spent
        t, a, n = item
        with lock:
            if not may_launch(spent, inflight, args.budget):
                skipped.append(f"{t['id']}-{a}-{n}")
                return None
            inflight += 1
        row = run_one(t, a, n, work, args.timeout)
        with lock:
            inflight -= 1
            spent += row.get("usd", 0.0)
            with out.open("a") as fh:
                fh.write(json.dumps(row) + "\n")
            print(
                f"{row['key']} resolved={row.get('resolved')} usd={row.get('usd', 0):.2f} wall={row.get('wall_s')}s total=${spent:.2f}",
                flush=True,
            )
        return row

    with cf.ThreadPoolExecutor(max_workers=min(args.concurrency, 3)) as ex:
        list(ex.map(go, todo))
    prune_worktrees()
    print(json.dumps({"spent_usd": round(spent, 2), "skipped_for_budget": skipped}))
    return 0


# ---------------------------------------------------------------- statistics


def wilson(k: int, n: int, z: float = 1.96):
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - h) / d, (c + h) / d)


def percentile(vals, q: float):
    """Linear-interpolation percentile (numpy default). q in 0..100."""
    s = sorted(vals)
    if not s:
        return None
    if len(s) == 1:
        return s[0]
    pos = (len(s) - 1) * q / 100.0
    lo, hi = int(math.floor(pos)), int(math.ceil(pos))
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def summarize_arm(rows: list) -> dict:
    n = len(rows)
    k = sum(1 for r in rows if r.get("resolved"))
    lo, hi = wilson(k, n)
    walls = [r["wall_s"] for r in rows if "wall_s" in r]
    usd = [r.get("usd", 0.0) for r in rows]
    tok = {
        f: sum(r.get("tokens", {}).get(f, 0) for r in rows)
        for f in ("input", "cache_read", "cache_write", "output")
    }
    return {
        "n": n,
        "resolved": k,
        "wilson_lo": lo,
        "wilson_hi": hi,
        "wall_median": percentile(walls, 50),
        "wall_p90": percentile(walls, 90),
        "usd_total": sum(usd),
        "usd_median": statistics.median(usd) if usd else None,
        "usd_per_resolved": (sum(usd) / k) if k else None,
        "tokens": tok,
        "timeouts": sum(1 for r in rows if r.get("timeout")),
        "gate_block_runs": sum(1 for r in rows if r.get("gate_blocks", 0) > 0),
        "gate_blocks": sum(r.get("gate_blocks", 0) for r in rows),
        "errors": sum(1 for r in rows if r.get("error") or r.get("is_error")),
        "init_problems": sum(1 for r in rows if r.get("init_problem")),
    }


def paired(rows: list, arm_a="plain", arm_b="atlas") -> list:
    """Per task: resolved trials per arm and who won."""
    out = []
    for tid in sorted({r["task"] for r in rows}):
        a = sum(
            1
            for r in rows
            if r["task"] == tid and r["arm"] == arm_a and r.get("resolved")
        )
        b = sum(
            1
            for r in rows
            if r["task"] == tid and r["arm"] == arm_b and r.get("resolved")
        )
        na = sum(1 for r in rows if r["task"] == tid and r["arm"] == arm_a)
        nb = sum(1 for r in rows if r["task"] == tid and r["arm"] == arm_b)
        out.append(
            {
                "task": tid,
                arm_a: a,
                arm_b: b,
                f"n_{arm_a}": na,
                f"n_{arm_b}": nb,
                "winner": arm_a if a > b else arm_b if b > a else "tie",
            }
        )
    return out


def render_report(rows: list) -> str:
    arms = sorted({r["arm"] for r in rows}, key=lambda x: (x != "plain", x))
    lines = ["| metric | " + " | ".join(arms) + " |", "|---|" + "---|" * len(arms)]
    sm = {a: summarize_arm([r for r in rows if r["arm"] == a]) for a in arms}

    def f(v, nd=2):
        return "-" if v is None else f"{v:.{nd}f}"

    def row(label, fn):
        lines.append(f"| {label} | " + " | ".join(fn(sm[a]) for a in arms) + " |")

    row("runs", lambda s: str(s["n"]))
    row(
        "resolved",
        lambda s: (
            f"{s['resolved']}/{s['n']} (Wilson95 {s['wilson_lo'] * 100:.0f}-{s['wilson_hi'] * 100:.0f}%)"
        ),
    )
    row("wall median s", lambda s: f(s["wall_median"], 0))
    row("wall p90 s", lambda s: f(s["wall_p90"], 0))
    row("USD median per run", lambda s: f(s["usd_median"]))
    row("USD total", lambda s: f(s["usd_total"]))
    row("USD per resolved", lambda s: f(s["usd_per_resolved"]))
    for fld, lab in (
        ("input", "fresh input"),
        ("cache_read", "cache read"),
        ("cache_write", "cache write"),
        ("output", "output"),
    ):
        row(f"tokens {lab}", lambda s, fld=fld: f"{s['tokens'][fld]:,}")
    row("timeouts", lambda s: str(s["timeouts"]))
    row(
        "runs with a gate block",
        lambda s: f"{s['gate_block_runs']} ({s['gate_blocks']} blocks)",
    )
    row("errored runs", lambda s: str(s["errors"]))
    row("arm-init problems", lambda s: str(s["init_problems"]))
    lines += [
        "",
        "| task | plain resolved | atlas resolved | winner |",
        "|---|---|---|---|",
    ]
    for p in paired(rows):
        lines.append(
            f"| {p['task']} | {p['plain']}/{p['n_plain']} | {p['atlas']}/{p['n_atlas']} | {p['winner']} |"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------- CLI


def cmd_validate(args) -> int:
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    if args.candidates:
        cands = []
        for sha in args.candidates.split(","):
            full = git("rev-parse", sha).strip()
            rows = git(
                "show", "--no-renames", "--name-status", "--format=", full
            ).splitlines()
            src, tests, other = classify_files(rows)
            cands.append(
                {
                    "commit": full,
                    "subject": git("show", "-s", "--format=%s", full).strip(),
                    "src_files": src,
                    "test_files": tests,
                    "other_files": other,
                }
            )
    elif args.tasks and Path(args.tasks).exists() and not args.mine:
        cands = json.loads(Path(args.tasks).read_text())["tasks"]
        if args.only:
            keep = set(args.only.split(","))
            cands = [c for c in cands if c["id"] in keep]
    else:
        cands = mine(args.since)
    evid = []

    def one(c):
        c = dict(c)
        c.setdefault("parent", git("rev-parse", c["commit"] + "^").strip())
        return c, validate_task(c, work)

    with cf.ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        for c, ev in ex.map(one, cands):
            ev["subject"] = c.get("subject", "")[:80]
            ev["src"] = len(c["src_files"])
            ev["tests"] = len(c["test_files"])
            evid.append(ev)
            print(
                json.dumps(
                    {k: ev[k] for k in ("commit", "ok", "src", "tests") if k in ev}
                    | {
                        "f2p": len(ev.get("fail_to_pass", [])),
                        "after_failed": len(ev.get("after_failed", [])),
                        "err": ev.get("error", "")[:100],
                    }
                ),
                flush=True,
            )
    (work / "validation.json").write_text(json.dumps(evid, indent=1))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("mine")
    m.add_argument("--since", default="2026-09-15")
    v = sub.add_parser("validate")
    v.add_argument("--work", required=True)
    v.add_argument("--tasks", default=str(TASKS_FILE))
    v.add_argument("--only")
    v.add_argument("--candidates")
    v.add_argument("--mine", action="store_true")
    v.add_argument("--since", default="2026-09-15")
    v.add_argument("--concurrency", type=int, default=3)
    r = sub.add_parser("run")
    r.add_argument("--work", required=True)
    r.add_argument("--tasks", default=str(TASKS_FILE))
    r.add_argument("--only")
    r.add_argument("--arms", default="plain,atlas")
    r.add_argument("--trials", type=int, default=3)
    r.add_argument("--concurrency", type=int, default=3)
    r.add_argument("--budget", type=float, default=40.0)
    r.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S)
    rp = sub.add_parser("report")
    rp.add_argument("--results", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "mine":
        for c in mine(a.since):
            print(json.dumps(c))
        return 0
    if a.cmd == "validate":
        return cmd_validate(a)
    if a.cmd == "run":
        return cmd_run(a)
    if a.cmd == "report":
        print(render_report(load_done(Path(a.results))))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
