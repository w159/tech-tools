"""Summarize a stream-json session run: tech-tools plugins, their MCP servers, hook outputs, result, and debug-log warnings."""
import json, sys, re, collections
pre = sys.argv[1]; ours = ("atlas", "armada", "programmer")
for l in open(pre + ".stream.jsonl"):
    d = json.loads(l); t, st = d.get("type"), d.get("subtype")
    if t == "system" and st == "init":
        print("plugins:", [p["name"] + "@" + p.get("path", "").split("/cache/")[-1] for p in d.get("plugins", []) if p["name"] in ours])
        print("mcp:", [(m["name"].split(":")[-1], m["status"]) for m in d.get("mcp_servers", []) if any(f":{o}:" in m["name"] for o in ours)])
        c = collections.Counter(s.split(":")[0] for s in d["skills"] + d["agents"] if s.split(":")[0] in ours); print("skills+agents:", dict(c))
    elif t == "system" and st == "hook_response" and (d.get("stdout") or d.get("stderr") or d.get("exit_code")):
        print("HOOK", d.get("hook_event"), "rc", d.get("exit_code"), "|", (d.get("stdout") or "")[:220].replace("\n", " "), "|", (d.get("stderr") or "")[:200])
    elif t == "result":
        print("RESULT", st, "is_error", d.get("is_error"), repr(str(d.get("result"))[:80]))
log = open(pre + ".debug.log").read().splitlines()
warn = [re.sub(r"^\S+ ", "", x) for x in log if ("[WARN]" in x or "[ERROR]" in x) and any(o in x for o in ours + ("Skill listing",))]
agg = collections.Counter(re.sub(r"/\S+/", "<path>/", w)[:160] for w in warn)
for k, v in agg.most_common(): print(f"LOG x{v}: {k}")
