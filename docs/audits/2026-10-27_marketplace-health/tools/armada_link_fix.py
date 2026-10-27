"""Repoint armada department skill links like ../api-patterns/SKILL.md to the vendor-prefixed sibling
(../pax8-api-patterns/SKILL.md) when exactly that sibling exists. Quote unquoted descriptions that break YAML.

usage: armada_link_fix.py <armada_plugin_dir>   (edits in place; prints a count)
"""
import os, re, sys, glob
import yaml

root = sys.argv[1]; fixed = unresolved = yamlfix = 0
for p in glob.glob(os.path.join(root, "skills/armada/departments/*/skills/*/SKILL.md")):
    d = os.path.dirname(p); parent = os.path.dirname(d); name = os.path.basename(d)
    t = open(p, encoding="utf-8").read()
    def repl(m):
        global fixed, unresolved
        tgt = m.group(1)
        if os.path.exists(os.path.join(d, tgt)): return m.group(0)
        sib = tgt.split("/")[1]; parts = name.split("-")
        for i in range(len(parts) - 1, 0, -1):
            cand = "-".join(parts[:i]) + "-" + sib
            if os.path.isdir(os.path.join(parent, cand)):
                fixed += 1; return m.group(0).replace(tgt, f"../{cand}/SKILL.md")
        unresolved += 1; return m.group(0)
    t2 = re.sub(r"\]\((\.\./[a-z0-9-]+/SKILL\.md)\)", repl, t)
    m = re.match(r"^---\n(.*?)\n---\n", t2, re.S)
    if m:
        try: yaml.safe_load(m.group(1))
        except yaml.YAMLError:
            fm = re.sub(r"^description: (?![\"'|>])(.*)$", lambda x: "description: " + '"' + x.group(1).replace('\\', '\\\\').replace('"', '\\"') + '"', m.group(1), count=1, flags=re.M)
            yaml.safe_load(fm); yamlfix += 1
            t2 = t2.replace(m.group(1), fm, 1)
    if t2 != t: open(p, "w", encoding="utf-8").write(t2)
print(f"links fixed {fixed}, unresolved {unresolved}, frontmatter quoted {yamlfix}")
