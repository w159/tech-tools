#!/usr/bin/env python3
"""Hook latency benchmark (stdlib). Reads hooks/hooks.json, runs each bound
command with a representative payload in a scratch git repo, ATLAS_HOME and
ATLAS_DB pointed at a temp dir, and prints median/p90 per hook and per
event/tool "call" (sum of every hook bound to it). The wall column is the median
over runs of the slowest hook in that call: Claude Code runs an event's hooks in
parallel, so wall is the latency the user waits.

    python3 scripts/bench_hooks.py [-n 10] [--root PLUGIN_ROOT]
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def payloads(cwd):
    f = os.path.join(cwd, "a.py")
    base = {"cwd": cwd, "session_id": "bench", "transcript_path": os.path.join(cwd, "t.jsonl")}
    def pt(ev, tool, inp):
        return dict(base, hook_event_name=ev, tool_name=tool, tool_input=inp, tool_response={"success": True})
    return [
        ("SessionStart", None, dict(base, hook_event_name="SessionStart", source="startup")),
        ("UserPromptSubmit", None, dict(base, hook_event_name="UserPromptSubmit", prompt="fix the bug")),
        ("PreToolUse", "Bash", pt("PreToolUse", "Bash", {"command": "ls -la"})),
        ("PreToolUse", "Read", pt("PreToolUse", "Read", {"file_path": f})),
        ("PreToolUse", "Edit", pt("PreToolUse", "Edit", {"file_path": f, "old_string": "a", "new_string": "b"})),
        ("PreToolUse", "Agent", pt("PreToolUse", "Agent", {"subagent_type": "general-purpose", "prompt": "x", "description": "x"})),
        ("PostToolUse", "Edit", pt("PostToolUse", "Edit", {"file_path": f, "old_string": "a", "new_string": "b"})),
        ("PostToolUse", "Read", pt("PostToolUse", "Read", {"file_path": f})),
        ("PostToolUse", "Bash", pt("PostToolUse", "Bash", {"command": "ls"})),
        ("Stop", None, dict(base, hook_event_name="Stop", stop_hook_active=False)),
    ]


def matches(matcher, tool):
    import re
    if matcher in (None, "", "*"):
        return True
    return tool is not None and re.fullmatch(matcher, tool) is not None


def run(cmd, payload, env, cwd):
    t = time.perf_counter()
    subprocess.run(cmd, shell=True, input=json.dumps(payload), text=True,
                   capture_output=True, env=env, cwd=cwd, timeout=60)
    return (time.perf_counter() - t) * 1000


def p90(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * 0.9))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=10)
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    a = ap.parse_args()
    root = a.root
    hooks = json.load(open(os.path.join(root, "hooks", "hooks.json")))["hooks"]
    with tempfile.TemporaryDirectory() as tmp:
        cwd = os.path.join(tmp, "proj")
        os.makedirs(cwd)
        subprocess.run(["git", "init", "-q", cwd], check=True)
        Path(cwd, "a.py").write_text("a = 1\n")
        env = dict(os.environ, CLAUDE_PLUGIN_ROOT=root, ATLAS_HOME=os.path.join(tmp, "home"),
                   ATLAS_DB=os.path.join(tmp, "atlas.db"), CLAUDE_PROJECT_DIR=cwd)
        os.makedirs(env["ATLAS_HOME"])
        floor = [run("python3 -c pass", {}, env, cwd) for _ in range(a.n)]
        print(f"python3 floor: median {statistics.median(floor):.0f} ms\n")
        print(f"{'event/tool':<26}{'hooks':>6}{'median':>9}{'p90':>8}{'wall':>8}   per-hook median ms")
        for ev, tool, pl in payloads(cwd):
            cmds = [h["command"] for g in hooks.get(ev, []) if matches(g.get("matcher"), tool)
                    for h in g["hooks"]]
            per = {c: [] for c in cmds}
            totals = []
            walls = []
            for _ in range(a.n):
                tot = 0
                longest = 0
                for c in cmds:
                    ms = run(c, pl, env, cwd)
                    per[c].append(ms)
                    tot += ms
                    longest = max(longest, ms)
                totals.append(tot)
                walls.append(longest)
            detail = " ".join(f"{Path(c.split('\"')[1]).stem}={statistics.median(v):.0f}" for c, v in per.items())
            print(f"{(ev + ' ' + (tool or '')).strip():<26}{len(cmds):>6}{statistics.median(totals):>9.0f}{p90(totals):>8.0f}{statistics.median(walls):>8.0f}   {detail}")


if __name__ == "__main__":
    sys.exit(main())
