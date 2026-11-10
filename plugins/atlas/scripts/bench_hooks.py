#!/usr/bin/env python3
"""Hook latency benchmark (stdlib). Reads hooks/hooks.json, runs each bound
command with a representative payload in a scratch git repo, ATLAS_HOME and
ATLAS_DB pointed at a temp dir, and prints median/p90 per hook and per
event/tool "call" (sum of every hook bound to it). The wall column is the median
over runs of the slowest hook in that call (Claude Code runs an event's hooks in
parallel); block is the serial sum without async hooks (format_after_edit).

    python3 scripts/bench_hooks.py [-n 10] [--root PLUGIN_ROOT]
    python3 scripts/bench_hooks.py --bytes [--root PLUGIN_ROOT]

--bytes skips timing and prints, per event/scenario and hook, the bytes of text
the model receives (additionalContext, reason, permission
reason, the growth of a rewritten dispatch prompt, or plain stdout).
"""
import argparse
import json
import os
import shlex
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


def to_argv(cmd, root):
    """hooks.json command string -> argv (no shell): expand the plugin-root variable, then shlex-split."""
    return shlex.split(cmd.replace("${CLAUDE_PLUGIN_ROOT}", root))


def run(cmd, payload, env, cwd):
    argv = cmd if isinstance(cmd, list) else shlex.split(cmd)
    t = time.perf_counter()
    subprocess.run(argv, input=json.dumps(payload), text=True,
                   capture_output=True, env=env, cwd=cwd, timeout=60)
    return (time.perf_counter() - t) * 1000


def p90(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * 0.9))]


_MODEL_KEYS = ("reason", "additionalContext", "permissionDecisionReason")  # systemMessage is user-facing only


def _spec(scope):
    return ("GOAL: x.\nDELIVERABLE: x.\nSUCCESS CRITERIA: x.\nOUT OF SCOPE: x.\nSTOP CONDITIONS: x.\n"
            f"SCOPE: {scope}\nTOOLS: ToolSearch lean-ctx (ctx_search, ctx_read)\nREPORT: x.")


def model_bytes(stdout, prompt_len=0):
    """UTF-8 bytes of the text one hook run puts in the model's context: the string
    fields of its JSON output the harness forwards, the growth of a rewritten
    dispatch prompt, or the whole of a non-JSON stdout."""
    if not stdout.strip():
        return 0
    try:
        doc = json.loads(stdout)
    except ValueError:
        return len(stdout.encode())
    if not isinstance(doc, dict):
        return 0
    spec = doc.get("hookSpecificOutput")
    spec = spec if isinstance(spec, dict) else {}
    n = sum(len(d[k].encode()) for d in (doc, spec) for k in _MODEL_KEYS if isinstance(d.get(k), str))
    upd = spec.get("updatedInput")
    if isinstance(upd, dict) and isinstance(upd.get("prompt"), str):
        n += max(0, len(upd["prompt"].encode()) - prompt_len)
    return n


def dispatch_parts(stdout, prompt):
    """(brief, board, advisory) bytes of an allowed dispatch's output: the CHANNEL block, the
    BOARD ITEM line, and the additionalContext advisory. Other prompt growth is left out."""
    try:
        spec = json.loads(stdout)["hookSpecificOutput"]
    except (ValueError, KeyError, TypeError):
        return 0, 0, 0
    grown = ((spec.get("updatedInput") or {}).get("prompt") or "")[len(prompt):]
    at, board = grown.find("CHANNEL:"), grown.find("\nBOARD ITEM:")
    if at < 0:
        return 0, 0, len((spec.get("additionalContext") or "").encode())
    end = board if board >= at else len(grown)
    return (len(grown[at:end].encode()), len(grown[end:].encode()),
            len((spec.get("additionalContext") or "").encode()))


def byte_payloads(cwd, tag="t"):
    """Extra scenarios for --bytes: (label, event, tool, payload). `tag` makes the dispatch
    sessions unique to one run: the burst window keeps state per (root, session), so a reused
    session id from an earlier run would add the 2nd-dispatch advisory or a concurrent deny."""
    base = {"cwd": cwd, "session_id": "bench", "transcript_path": os.path.join(cwd, "t.jsonl")}
    def agent(role, name, scope, sid):
        return dict(base, session_id=sid, hook_event_name="PreToolUse", tool_name="Agent",
                    tool_use_id="tu-" + name,
                    tool_input={"subagent_type": "atlas:" + role, "name": name,
                                "description": "x", "prompt": _spec(scope)})
    def tool(ev, name, inp):
        return dict(base, hook_event_name=ev, tool_name=name, tool_input=inp, tool_response={"success": True})
    stop = dict(base, hook_event_name="Stop", stop_hook_active=False, last_assistant_message="All done.")
    sid_e, sid_i = f"bench-{tag}-explorer", f"bench-{tag}-implementer"
    first = agent("explorer", "bench-explorer", "audit/low", sid_e)
    big = "Refactor the auth module across the whole repo, add tests and update the docs"
    return [
        ("prompt orchestrate", "UserPromptSubmit", None, dict(base, hook_event_name="UserPromptSubmit", prompt=big)),
        ("Bash grep -rn", "PreToolUse", "Bash", tool("PreToolUse", "Bash", {"command": "grep -rn foo ."})),
        ("Bash git push", "PreToolUse", "Bash", tool("PreToolUse", "Bash", {"command": "git push --force origin main"})),
        ("Bash npm test fail", "PostToolUse", "Bash", tool("PostToolUse", "Bash", {"command": "npm test"})),
        ("SubagentStop empty", "SubagentStop", None,
         dict(base, hook_event_name="SubagentStop", agent_id="a1", agent_type="atlas:explorer",
              last_assistant_message="ok", stop_hook_active=False)),
        ("dispatch explorer", "PreToolUse", "Agent", first),
        ("dispatch implementer", "PreToolUse", "Agent",
         agent("implementer", "bench-implementer", "implement/medium", sid_i)),
        # the explorer returns, then a second dispatch inside the burst window: the advisory case
        ("explorer returns", "PostToolUse", "Agent", dict(first, hook_event_name="PostToolUse", tool_response={"success": True})),
        ("dispatch explorer #2", "PreToolUse", "Agent", dict(agent("explorer", "bench-explorer-2", "audit/low", sid_e))),
        ("Stop headerless #1", "Stop", None, stop),
        ("Stop headerless #2", "Stop", None, stop),
    ]


def main_bytes(root, show=False):
    hooks = json.load(open(os.path.join(root, "hooks", "hooks.json")))["hooks"]
    with tempfile.TemporaryDirectory() as tmp:
        cwd = os.path.join(tmp, "proj")
        os.makedirs(cwd)
        subprocess.run(["git", "init", "-q", cwd], check=True)
        Path(cwd, "a.py").write_text("a = 1\n")
        home, scratch = os.path.join(tmp, "home"), os.path.join(tmp, "tmp")
        os.makedirs(home)
        os.makedirs(scratch)
        # TMPDIR too: the dispatch hook keeps its burst state under the temp dir when no root is found
        # ATLAS_BURST_SECS=99: the 2nd-dispatch advisory must not depend on how fast the hooks ran
        # (the default 10 s window is shorter than this scenario list on a slow machine)
        # The base env is a whitelist, not os.environ: a caller's ATLAS_* or CLAUDE_* switches
        # (gate off, solo mode, test isolation) change what the hooks print.
        base_env = {k: os.environ[k] for k in ("PATH", "LANG", "LC_ALL", "PYTHONHASHSEED") if k in os.environ}
        env = dict(base_env, CLAUDE_PLUGIN_ROOT=root, ATLAS_HOME=home, HOME=home, TMPDIR=scratch,
                   ATLAS_BURST_SECS="99", ATLAS_GATES="always",  # always: the scratch dir is not a "real project"
                   # off: with tmux on PATH the tripwire denies every in-process working dispatch, so the
                   # brief and burst-advisory bytes this table measures only exist on the advisory path
                   ATLAS_TEAM_GATE="off",
                   ATLAS_DB=os.path.join(tmp, "atlas.db"), CLAUDE_PROJECT_DIR=cwd,
                   ATLAS_HOOKSTATE_DIR=os.path.join(tmp, "hookstate"),
                   ATLAS_CONTRACT_GATE_DIR=os.path.join(tmp, "markers"))
        rows = [((ev + " " + (tool or "")).strip(), ev, tool, pl) for ev, tool, pl in payloads(cwd)]
        rows += [(lab, ev, tool, pl) for lab, ev, tool, pl in byte_payloads(cwd, os.urandom(3).hex())]
        sys.path.insert(0, os.path.join(root, "scripts"))
        import atlas_db
        c = atlas_db.connect(env["ATLAS_DB"])
        atlas_db.init(c)
        pid = atlas_db.register_project(c, cwd)
        for sid in sorted({pl["session_id"] for *_, pl in rows}):
            atlas_db.start_run(c, pid, sid)
            atlas_db.mark_orchestrating(c, sid)
        c.commit()
        c.close()
        print(f"{'scenario':<26}{'hook':<30}{'bytes':>7}")
        for label, ev, tool, pl in rows:
            prompt = (pl.get("tool_input") or {}).get("prompt") or ""
            for g in hooks.get(ev, []):
                if not matches(g.get("matcher"), tool):
                    continue
                for h in g["hooks"]:
                    argv = to_argv(h["command"], root)
                    r = subprocess.run(argv, input=json.dumps(pl), text=True, capture_output=True,
                                       env=env, cwd=cwd, timeout=60)
                    print(f"{label:<26}{' '.join(Path(a).stem for a in argv[2:])[:29]:<30}"
                          f"{model_bytes(r.stdout, len(prompt.encode())):>7}")
                    if label.startswith("dispatch") and r.stdout.strip():
                        brief, board, advisory = dispatch_parts(r.stdout, prompt)
                        print(f"{'':<26}{'  of which brief / board / advisory':<30}{brief:>7} {board} {advisory}")
                    if show and r.stdout.strip():
                        print("    " + r.stdout.strip()[:1200].replace("\n", "\n    "))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=10)
    ap.add_argument("--bytes", action="store_true", help="report model-visible output bytes, not timing")
    ap.add_argument("--show", action="store_true", help="with --bytes: also print each hook's stdout")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    a = ap.parse_args()
    root = a.root
    if a.bytes:
        return main_bytes(root, a.show)
    hooks = json.load(open(os.path.join(root, "hooks", "hooks.json")))["hooks"]
    with tempfile.TemporaryDirectory() as tmp:
        cwd = os.path.join(tmp, "proj")
        os.makedirs(cwd)
        subprocess.run(["git", "init", "-q", cwd], check=True)
        Path(cwd, "a.py").write_text("a = 1\n")
        env = dict(os.environ, CLAUDE_PLUGIN_ROOT=root, ATLAS_HOME=os.path.join(tmp, "home"),
                   ATLAS_DB=os.path.join(tmp, "atlas.db"), CLAUDE_PROJECT_DIR=cwd)
        os.makedirs(env["ATLAS_HOME"])
        floor = [run(["python3", "-c", "pass"], {}, env, cwd) for _ in range(a.n)]
        print(f"python3 floor: median {statistics.median(floor):.0f} ms\n")
        rows = {}
        print(f"{'event/tool':<26}{'hooks':>6}{'median':>9}{'p90':>8}{'wall':>8}{'block':>8}   per-hook median ms")
        for ev, tool, pl in payloads(cwd):
            found = [(h["command"], bool(h.get("async"))) for g in hooks.get(ev, [])
                     if matches(g.get("matcher"), tool) for h in g["hooks"]]
            cmds = [to_argv(c, root) for c, _ in found]
            asyncs = {tuple(to_argv(c, root)): a for c, a in found}
            per = {tuple(c): [] for c in cmds}
            totals = []
            walls = []
            blocks = []
            for _ in range(a.n):
                tot = 0
                longest = 0
                block = 0
                for c in cmds:
                    ms = run(c, pl, env, cwd)
                    per[tuple(c)].append(ms)
                    tot += ms
                    longest = max(longest, ms)
                    if not asyncs[tuple(c)]:
                        block += ms
                totals.append(tot)
                walls.append(longest)
                blocks.append(block)
            detail = " ".join(f"{Path(c[-1]).stem}={statistics.median(v):.0f}" for c, v in per.items())
            print(f"{(ev + ' ' + (tool or '')).strip():<26}{len(cmds):>6}{statistics.median(totals):>9.0f}{p90(totals):>8.0f}{statistics.median(walls):>8.0f}{statistics.median(blocks):>8.0f}   {detail}")
            rows[(ev, tool)] = (statistics.median(totals), statistics.median(blocks))
        print("\nPre+Post serial sum per tool (total = every hook process; block = excluding async hooks)")
        for tool in ("Read", "Bash", "Edit"):
            pre, post = rows[("PreToolUse", tool)], rows[("PostToolUse", tool)]
            print(f"{tool:<8} total {pre[0] + post[0]:>5.0f} ms   block {pre[1] + post[1]:>5.0f} ms")


if __name__ == "__main__":
    sys.exit(main())
