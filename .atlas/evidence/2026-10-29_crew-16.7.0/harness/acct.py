"""Token accounting over claude stream-json / json logs. modelUsage and total_cost_usd in a `result` event are
cumulative for the process (a 2nd result after a background task repeats them), so each file counts its
last result; num_turns is per result and is summed.
total = input + cache_creation + cache_read + output (all tokens the API processed)."""
import json, sys, glob
def acct(path):
    tot = dict(inp=0, cc=0, cr=0, out=0, cost=0.0, turns=0, sids=set(), dur=0, models=set())
    for line in open(path, errors="replace"):
        line = line.strip()
        if not line.startswith("{"): continue
        try: e = json.loads(line)
        except ValueError: continue
        if e.get("type") == "system" and e.get("subtype") == "init": tot["sids"].add(e.get("session_id"))
        if e.get("type") != "result": continue
        tot["sids"].add(e.get("session_id")); tot["cost"] = e.get("total_cost_usd") or 0
        tot["turns"] += e.get("num_turns") or 0; tot["dur"] += (e.get("duration_ms") or 0)/1000
        tot.update(inp=0, cc=0, cr=0, out=0)
        for m, u in (e.get("modelUsage") or {}).items():
            tot["models"].add(m)
            tot["inp"] += u.get("inputTokens", 0); tot["cc"] += u.get("cacheCreationInputTokens", 0)
            tot["cr"] += u.get("cacheReadInputTokens", 0); tot["out"] += u.get("outputTokens", 0)
    tot["total"] = tot["inp"] + tot["cc"] + tot["cr"] + tot["out"]
    return tot
if __name__ == "__main__":
    grand = {}
    for p in sys.argv[1:]:
        for f in sorted(glob.glob(p)):
            t = acct(f)
            for k in ("inp","cc","cr","out","total","cost","turns"): grand[k] = grand.get(k, 0) + t[k]
            print(f"{f.split('/')[-1]:40s} total={t['total']:>10,} in={t['inp']:,} cc={t['cc']:,} cr={t['cr']:,} out={t['out']:,} turns={t['turns']} cost=${t['cost']:.3f} dur={t['dur']:.0f}s models={sorted(t['models'])} sids={[s[:8] for s in t['sids'] if s]}")
    print(f"{'ALL':40s} total={grand.get('total',0):>10,} in={grand.get('inp',0):,} cc={grand.get('cc',0):,} cr={grand.get('cr',0):,} out={grand.get('out',0):,} turns={grand.get('turns',0)} cost=${grand.get('cost',0):.3f}")
