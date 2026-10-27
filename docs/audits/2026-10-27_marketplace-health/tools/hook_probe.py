"""Run every command hook in a plugin's hooks/hooks.json against a sample payload for its event.

usage: hook_probe.py <plugin_root> <config_dir> <out.json>
Pass = exits 0 or 2 (2 is a documented block) within its timeout, and stdout is empty, plain text, or valid JSON.
"""
import json, os, subprocess, sys, tempfile, time

root, cfgdir, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]), sys.argv[3]
hooks = json.load(open(os.path.join(root, "hooks", "hooks.json"))).get("hooks", {})
proj = tempfile.mkdtemp(); subprocess.run(["git", "init", "-q", proj])
tx = os.path.join(proj, "transcript.jsonl")
open(tx, "w").write(json.dumps({"type": "user", "message": {"role": "user", "content": "hi"}}) + "\n")
base = {"session_id": "probe-session", "transcript_path": tx, "cwd": proj, "permission_mode": "default"}

def tool_for(matcher):
    first = (matcher or "*").split("|")[0]
    if first in ("*", ""): return "Read"
    if first.startswith("mcp__"): return "mcp__plugin_atlas_auvik__auvik_status"
    return first

def tool_input(tool):
    f = os.path.join(proj, "a.py")
    return {"Bash": {"command": "ls"}, "Read": {"file_path": f}, "Edit": {"file_path": f, "old_string": "a", "new_string": "b"},
            "Write": {"file_path": f, "content": "x = 1\n"}, "TodoWrite": {"todos": []}, "Agent": {"prompt": "x", "subagent_type": "Explore", "description": "x"}}.get(tool, {})

def payload(ev, matcher):
    p = dict(base, hook_event_name=ev)
    if ev == "SessionStart": p["source"] = "startup"
    if ev == "UserPromptSubmit": p["prompt"] = "fix the failing test in a.py"
    if ev in ("PreToolUse", "PostToolUse"):
        t = tool_for(matcher); p["tool_name"] = t; p["tool_input"] = tool_input(t)
        if ev == "PostToolUse": p["tool_response"] = {"content": "ok"}
    if ev in ("Stop", "SubagentStop"): p["stop_hook_active"] = False
    if ev in ("SubagentStart", "SubagentStop"): p.update(agent_id="a1", agent_type="Explore", agent_transcript_path=tx)
    if ev == "SessionEnd": p["reason"] = "other"
    if ev == "PreCompact": p.update(trigger="manual", custom_instructions="")
    return p

env = dict(os.environ, CLAUDE_PLUGIN_ROOT=root, CLAUDE_CONFIG_DIR=cfgdir, CLAUDE_PROJECT_DIR=proj, HOME=tempfile.mkdtemp())
for k in ("CLAUDE_CODE_SESSION_ID", "CLAUDE_PID"): env.pop(k, None)
res = []
for ev, arr in hooks.items():
    for m in arr:
        for h in m["hooks"]:
            if h.get("type") != "command": continue
            cmd = h["command"].replace("${CLAUDE_PLUGIN_ROOT}", root)
            t0 = time.time(); r = {"event": ev, "matcher": m.get("matcher", "*"), "cmd": h["command"].replace("${CLAUDE_PLUGIN_ROOT}/", "")}
            try:
                p = subprocess.run(cmd, shell=True, input=json.dumps(payload(ev, m.get("matcher"))), capture_output=True, text=True, timeout=h.get("timeout", 60), cwd=proj, env=env)
                r.update(rc=p.returncode, stdout=p.stdout[:400], stderr=p.stderr[-400:])
                so = p.stdout.strip()
                r["stdout_kind"] = "empty" if not so else ("json" if so[:1] in "{[" else "text")
                if r["stdout_kind"] == "json":
                    try: json.loads(so)
                    except ValueError: r["stdout_kind"] = "BAD_JSON"
                r["pass"] = p.returncode in (0, 2) and r["stdout_kind"] != "BAD_JSON" and "Traceback" not in p.stderr
            except subprocess.TimeoutExpired:
                r.update(pass_=False, rc="TIMEOUT"); r["pass"] = False
            r["secs"] = round(time.time() - t0, 2)
            res.append(r)
            print(("PASS" if r["pass"] else "FAIL"), ev, r["matcher"][:30], r["cmd"][:60], "rc", r.get("rc"), r.get("stdout_kind"), r["secs"], (r.get("stderr") or "").strip().splitlines()[-1:] , flush=True)
json.dump(res, open(out, "w"), indent=1)
