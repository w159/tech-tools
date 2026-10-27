#!/usr/bin/env python3
"""Fail when plugin versions drift between plugin.json, marketplace.json, CHANGELOGs and README.

Errors (exit 1): marketplace entry != plugin.json; no released `## <ver>` CHANGELOG
section; README "Current versions:" line missing a plugin's version.
Warning only: CHANGELOG has an Unreleased section while plugin.json equals the top release.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGINS = ("atlas", "armada", "programmer")


def check(root=ROOT):
    errors, warnings = [], []
    market = json.loads((root / ".claude-plugin/marketplace.json").read_text("utf-8"))
    entries = {p["name"]: p for p in market["plugins"]}
    readme = (root / "README.md").read_text("utf-8")
    line = re.search(r"^Current versions:.*$", readme, re.M)
    if not line:
        errors.append('README.md: no "Current versions:" line')
    for name in PLUGINS:
        base = root / "plugins" / name
        ver = json.loads((base / ".claude-plugin/plugin.json").read_text("utf-8"))["version"]
        got = entries.get(name, {}).get("version")
        if got != ver:
            errors.append(f"{name}: marketplace.json version {got!r} != plugin.json {ver!r}")
        heads = re.findall(r"^##\s+(.+)$", (base / "CHANGELOG.md").read_text("utf-8"), re.M)
        released = [h.split()[0] for h in heads if re.match(r"\d+\.\d+\.\d+", h)]
        if ver not in released:
            errors.append(f"{name}: CHANGELOG.md has no released '## {ver}' section")
        if line and not re.search(rf"\b{name} {re.escape(ver)}\b", line.group(0)):
            errors.append(f"{name}: README.md 'Current versions:' line does not name {name} {ver}")
        # only headings above the newest release count; old history may say "Unreleased"
        top = next((i for i, h in enumerate(heads) if re.match(r"\d+\.\d+\.\d+", h)), 0)
        if any(h.lower().startswith("unreleased") for h in heads[:top]) and released[:1] == [ver]:
            warnings.append(f"{name}: CHANGELOG.md has Unreleased work on top of {ver}; bump before releasing")
    return errors, warnings


if __name__ == "__main__":
    errs, warns = check()
    for w in warns:
        print("WARN:", w)
    for e in errs:
        print("ERROR:", e)
    print("version check:", "FAILED" if errs else "ok")
    sys.exit(1 if errs else 0)
