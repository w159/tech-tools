"""Start every server in a plugin .mcp.json with no credentials and record how it behaves.

usage: mcp_probe.py <plugin_root> <out.json>
"""
import json, os, re, subprocess, sys, tempfile, threading, time, select

root = os.path.abspath(sys.argv[1]); out = sys.argv[2]
cfg = json.load(open(os.path.join(root, ".mcp.json")))["mcpServers"]
home = tempfile.mkdtemp()  # empty HOME: no ~/.config/atlas/atlas.env

def sub(s):
    s = s.replace("${CLAUDE_PLUGIN_ROOT}", root)
    return re.sub(r"\$\{user_config\.[^}]+\}", "", s)  # unset userConfig -> empty, as Claude Code passes it

def rpc(proc, msg, want_id, deadline, stderr_buf):
    proc.stdin.write(json.dumps(msg) + "\n"); proc.stdin.flush()
    if want_id is None: return None
    while time.time() < deadline:
        r, _, _ = select.select([proc.stdout], [], [], 0.5)
        if not r:
            if proc.poll() is not None: raise RuntimeError(f"exited rc={proc.returncode}")
            continue
        line = proc.stdout.readline()
        if not line:
            raise RuntimeError(f"stdout closed rc={proc.poll()}")
        try: m = json.loads(line)
        except ValueError: raise RuntimeError(f"non-JSON on stdout: {line[:200]!r}")
        if m.get("id") == want_id: return m
    raise TimeoutError("no response")

results = {}
for name, spec in cfg.items():
    env = {"PATH": os.environ["PATH"], "HOME": home, "CLAUDE_PLUGIN_ROOT": root}
    for k in ("HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "UV_CACHE_DIR", "REQUESTS_CA_BUNDLE"):
        if k in os.environ: env[k] = os.environ[k]
    env.update({k: sub(v) for k, v in spec.get("env", {}).items()})
    cmd = [spec["command"]] + [sub(a) for a in spec.get("args", [])]
    t0 = time.time(); rec = {"cmd": " ".join(cmd).replace(root, "$ROOT")}
    errf = tempfile.TemporaryFile(mode="w+")
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errf, text=True, env=env, cwd=home)
    try:
        dl = time.time() + (240 if name == "falcon" else 45)
        init = rpc(proc, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "probe", "version": "0"}}}, 1, dl, errf)
        rec["init_s"] = round(time.time() - t0, 1)
        rec["server"] = init.get("result", {}).get("serverInfo")
        rec["instructions"] = (init.get("result", {}).get("instructions") or "")[-250:]
        rpc(proc, {"jsonrpc": "2.0", "method": "notifications/initialized"}, None, dl, errf)
        tl = rpc(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, 2, dl, errf)
        tools = [t["name"] for t in tl.get("result", {}).get("tools", [])]
        rec["tools"] = tools
        st = next((t for t in tools if t.endswith("_status")), None)
        if st:
            r = rpc(proc, {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": st, "arguments": {}}}, 3, time.time() + 30, errf)
            res = r.get("result") or {}
            rec["status_tool"] = st
            rec["status_isError"] = res.get("isError")
            rec["status_text"] = " ".join(c.get("text", "") for c in res.get("content", []))[:600]
            if "error" in r: rec["status_rpc_error"] = r["error"]
        rec["ok"] = True
    except Exception as e:
        rec["ok"] = False; rec["error"] = f"{type(e).__name__}: {e}"
    finally:
        try: proc.stdin.close()
        except Exception: pass
        try: proc.wait(10); rec["exit_on_stdin_close"] = proc.returncode
        except subprocess.TimeoutExpired:
            proc.kill(); rec["exit_on_stdin_close"] = "HUNG (killed after 10s)"
        errf.seek(0); rec["stderr_tail"] = errf.read()[-600:]
        rec["total_s"] = round(time.time() - t0, 1)
    results[name] = rec
    print(name, "ok" if rec.get("ok") else "FAIL", rec.get("init_s"), len(rec.get("tools", [])), rec.get("status_tool"), rec.get("exit_on_stdin_close"), rec.get("error", ""), flush=True)
json.dump(results, open(out, "w"), indent=1)
