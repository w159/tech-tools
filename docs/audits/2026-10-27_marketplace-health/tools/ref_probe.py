"""Check skills/agents frontmatter and file references inside a plugin.

usage: ref_probe.py <plugin_root>
Reports: skill name != dir, missing/long description, broken relative markdown links,
broken ${CLAUDE_PLUGIN_ROOT}/... paths, and subagent_type / agent names that no agent file defines.
"""
import os, re, sys, glob
import yaml

root = os.path.abspath(sys.argv[1]); plugin = os.path.basename(root.rstrip("/"))
issues = []
def fm(path):
    t = open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n", t, re.S)
    if not m: return None, t
    try: return yaml.safe_load(m.group(1)) or {}, t
    except yaml.YAMLError as e: return {"__yaml_error__": str(e)}, t

agents = {os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(root, "agents", "*.md"))}
for p in glob.glob(os.path.join(root, "agents", "*.md")):
    meta, _ = fm(p)
    if meta and meta.get("name"): agents.add(meta["name"])

mdfiles = glob.glob(os.path.join(root, "**", "*.md"), recursive=True)
for p in sorted(mdfiles):
    rel = os.path.relpath(p, root)
    if "/Books/" in "/" + rel or rel.startswith("tests/"): continue
    meta, text = fm(p)
    is_skill = os.path.basename(p) == "SKILL.md"
    is_agent = rel.startswith("agents/")
    if is_skill or is_agent:
        if meta is None: issues.append((rel, "no frontmatter")); continue
        if "__yaml_error__" in meta: issues.append((rel, "frontmatter YAML error: " + meta["__yaml_error__"][:120])); continue
        if is_skill and meta.get("name") and meta["name"] != os.path.basename(os.path.dirname(p)):
            issues.append((rel, f"skill name {meta['name']!r} != dir {os.path.basename(os.path.dirname(p))!r}"))
        d = meta.get("description")
        if not d: issues.append((rel, "missing description"))
        elif len(str(d)) > 1024: issues.append((rel, f"description {len(str(d))} chars > 1024"))
    body = re.sub(r"```.*?```", "", text, flags=re.S)  # ignore fenced examples
    for link in re.findall(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", body):
        if re.match(r"^[a-z]+:", link) or link.startswith("/"): continue
        if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(p), link))):
            issues.append((rel, f"broken link -> {link}"))
    for ref in set(re.findall(r"\$\{CLAUDE_PLUGIN_ROOT\}/([A-Za-z0-9_./-]+[A-Za-z0-9_])", text)):
        if "*" in ref or "<" in ref: continue
        if not os.path.exists(os.path.join(root, ref)):
            issues.append((rel, f"missing ${{CLAUDE_PLUGIN_ROOT}}/{ref}"))
    for name in set(re.findall(r"subagent_type[\"'`:= ]+[\"'`]?([a-z0-9:_-]+)", text)):
        n = name.split(":")[-1]
        if name.startswith(plugin + ":") or ":" not in name:
            if n not in agents and n not in ("general-purpose", "Explore", "Plan", "claude", "fork"):
                issues.append((rel, f"dispatches undefined agent {name!r}"))
    if is_skill:
        m = re.search(r"Agents?:\s*(`[^\n]+)", text)
        if m:
            for n in re.findall(r"`([a-z0-9-]+)`", m.group(1)):
                if n not in agents: issues.append((rel, f"names agent `{n}` but no agents/{n}.md exists"))
for rel, msg in issues: print(f"{rel}: {msg}")
print(f"-- {plugin}: {len(issues)} issues, {len(agents)} agents defined", file=sys.stderr)
