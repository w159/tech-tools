#!/usr/bin/env python3
"""Deterministic, read-only plugin health check for the atlas plugin.

Counts the skills and agents in the installed copy and compares against the
plugin manifest's declared counts. Exits 0 if the counts match and 1 if they
differ. Does not repair anything; only reports.

This is a quick sanity check between full doctor runs. The full doctor script
(atlas_doctor.py in the plugin root) does the eight-check diagnosis and the
--fix repair; this script only checks the skill/agent counts.

Usage:
    python3 "${CLAUDE_SKILL_DIR}/scripts/plugin-health.py" <plugin-root>

Read-only: opens files for reading only; writes nothing to disk.
"""

import json
import sys
from pathlib import Path


def count_skill_files(skills_dir: Path) -> int:
    if not skills_dir.is_dir():
        return 0
    # Count SKILL.md files one or more levels under skills/.
    return sum(1 for _ in skills_dir.rglob("SKILL.md"))


def count_agent_files(agents_dir: Path) -> int:
    if not agents_dir.is_dir():
        return 0
    # Agent files are .md files directly under agents/.
    return sum(1 for _ in agents_dir.glob("*.md"))


def manifest_declared_counts(plugin_root: Path) -> tuple[int | None, int | None]:
    manifest = plugin_root / ".claude-plugin" / "plugin.json"
    if not manifest.is_file():
        return None, None
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None, None
    # The manifest may declare skills/agents as lists or as a count.
    skills = data.get("skills")
    agents = data.get("agents")
    skills_count = len(skills) if isinstance(skills, list) else skills
    agents_count = len(agents) if isinstance(agents, list) else agents
    return (
        skills_count if isinstance(skills_count, int) else None,
        agents_count if isinstance(agents_count, int) else None,
    )


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: plugin-health.py <plugin-root>", file=sys.stderr)
        return 2
    plugin_root = Path(argv[1]).expanduser().resolve()
    if not plugin_root.is_dir():
        print(f"FAIL: plugin-root not found: {plugin_root}")
        return 1

    actual_skills = count_skill_files(plugin_root / "skills")
    actual_agents = count_agent_files(plugin_root / "agents")
    decl_skills, decl_agents = manifest_declared_counts(plugin_root)

    healthy = True

    print(f"skills: actual={actual_skills} declared={decl_skills}")
    if decl_skills is not None and actual_skills != decl_skills:
        print(
            f"FAIL: skill count mismatch (actual {actual_skills} vs declared {decl_skills})"
        )
        healthy = False
    else:
        print("PASS: skills count matches manifest")

    print(f"agents: actual={actual_agents} declared={decl_agents}")
    if decl_agents is not None and actual_agents != decl_agents:
        print(
            f"FAIL: agent count mismatch (actual {actual_agents} vs declared {decl_agents})"
        )
        healthy = False
    else:
        print("PASS: agents count matches manifest")

    return 0 if healthy else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
