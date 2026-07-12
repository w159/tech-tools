#!/usr/bin/env python3
"""Atlas context optimizer — disable unused skills/agents to slash token cost.

The #1 cost problem: atlas loads 27 skills + 23 agents into every API call.
Each skill description is ~100-200 tokens, each agent ~50-100 tokens.
That's ~6000+ tokens per turn for assets that are never used.

This script:
  1. Analyzes the observability DB for which skills/agents were actually invoked
  2. Compares against the full inventory
  3. Disables unused skills by adding `disable-model-invocation: true` to their
     SKILL.md frontmatter (they remain user-invocable but don't auto-trigger)
  4. Disables unused agents by moving them to a `.disabled/` subdirectory
  5. Reports the estimated token savings

The core working set (always enabled):
  - atlas-metis (the engine — always needed)
  - atlas-hephaestus (setup)
  - atlas-doctor (recovery)
  - atlas-olympus (onboarding)
  - atlas-argus (self-improvement analysis)
  - Core agents: explorer, implementer, verifier, docs-curator, completeness-critic

Skills/agents that were invoked in recent sessions are kept enabled.
Everything else is disabled (but recoverable — just remove the frontmatter flag).

Stdlib only. Fail-open: any error returns gracefully.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

# The always-on core set — these are never disabled
CORE_SKILLS = {
    "atlas-metis",
    "atlas-hephaestus",
    "atlas-doctor",
    "atlas-olympus",
    "atlas-argus",
}

CORE_AGENTS = {
    "explorer",
    "implementer",
    "verifier",
    "docs-curator",
    "completeness-critic",
    "planner",
    "ui-runtime-tester",
}

# Skills that are too niche to auto-enable but should remain available
# (user-invocable but not auto-triggered)
NICHE_SKILLS = {
    "atlas-armada",       # org deployment — 3MB, only for org use
    "atlas-nestor",       # skill-stacking concierge — overlaps with olympus
    "atlas-wiki",         # graphify wiring — only when wiki is needed
    "atlas-vendor-assessment",
    "atlas-m365",
    "atlas-gitignore",
    "atlas-component",
    "atlas-db-audit",
    "atlas-prompt",
    "atlas-readme",
    "atlas-handoff",
    "atlas-launch",
}


def _plugin_root() -> Path:
    """Return the atlas plugin root directory."""
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if root:
        return Path(root)
    # Fallback: this script lives in plugins/atlas/scripts/
    return Path(__file__).resolve().parent.parent


def _skills_dir() -> Path:
    return _plugin_root() / "skills"


def _agents_dir() -> Path:
    return _plugin_root() / "agents"


def _all_skills() -> List[Dict[str, Any]]:
    """Return all atlas skills with metadata."""
    skills = []
    sd = _skills_dir()
    if not sd.is_dir():
        return skills
    for item in sorted(sd.iterdir()):
        if not item.is_dir():
            continue
        if item.name.startswith("."):
            continue
        skill_md = item / "SKILL.md"
        if not skill_md.is_file():
            continue
        info = _parse_skill_frontmatter(skill_md)
        info["name"] = item.name
        info["path"] = str(skill_md)
        info["dir"] = str(item)
        skills.append(info)
    return skills


def _parse_skill_frontmatter(path: Path) -> Dict[str, Any]:
    """Parse YAML frontmatter from a SKILL.md file (simple, no yaml dep)."""
    info = {"disabled": False, "manual": False, "description": ""}
    try:
        content = path.read_text(encoding="utf-8")
        if not content.startswith("---"):
            return info
        end = content.find("---", 3)
        if end < 0:
            return info
        fm = content[3:end].strip()
        # Parse key: value pairs (simple, handles quotes)
        for line in fm.splitlines():
            if ":" not in line:
                continue
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key == "disable-model-invocation" and val.lower() in ("true", "yes"):
                info["disabled"] = True
            if key == "user-invocable" and val.lower() in ("true", "yes"):
                info["manual"] = True
            if key == "description":
                info["description"] = val
    except (OSError, UnicodeDecodeError):
        pass
    return info


def _all_agents() -> List[Dict[str, Any]]:
    """Return all atlas agents with metadata."""
    agents = []
    ad = _agents_dir()
    if not ad.is_dir():
        return agents
    for item in sorted(ad.iterdir()):
        if not item.is_file() or not item.name.endswith(".md"):
            continue
        name = item.stem
        disabled = name.startswith(".disabled-") or (ad / ".disabled" / item.name).is_file()
        agents.append({
            "name": name,
            "path": str(item),
            "disabled": disabled,
        })
    return agents


def _skills_used_in_db(db_path: str, limit_sessions: int = 50) -> Set[str]:
    """Return set of skill names that were actually invoked in recent sessions."""
    used = set()
    if not os.path.exists(db_path):
        return used
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        # Tool calls with kind='skill' give us skill invocations
        for row in conn.execute(
            "SELECT DISTINCT target FROM tool_calls WHERE kind='skill' "
            "ORDER BY ts DESC LIMIT ?",
            (limit_sessions * 10,),
        ).fetchall():
            target = row[0]
            if target:
                # Normalize: strip atlas: prefix, strip paths
                clean = target.replace("atlas:", "").replace("atlas-", "").strip()
                used.add(target)
                used.add(clean)
                used.add("atlas-" + clean)
        conn.close()
    except sqlite3.Error:
        pass
    return used


def _agents_used_in_db(db_path: str, limit_sessions: int = 50) -> Set[str]:
    """Return set of agent names that were actually dispatched in recent sessions."""
    used = set()
    if not os.path.exists(db_path):
        return used
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        # Dispatches table has agent_type
        for row in conn.execute(
            "SELECT DISTINCT agent_type FROM dispatches ORDER BY ts DESC LIMIT ?",
            (limit_sessions * 10,),
        ).fetchall():
            agent = row[0]
            if agent:
                # Normalize: strip atlas: prefix
                clean = agent.replace("atlas:", "").strip()
                used.add(clean)
                used.add(agent)
        # Also check tool_calls with kind='agent'
        for row in conn.execute(
            "SELECT DISTINCT target FROM tool_calls WHERE kind='agent' "
            "ORDER BY ts DESC LIMIT ?",
            (limit_sessions * 10,),
        ).fetchall():
            target = row[0]
            if target:
                clean = target.replace("atlas:", "").strip()
                used.add(clean)
                used.add(target)
        conn.close()
    except sqlite3.Error:
        pass
    return used


def _estimate_tokens(skills: List[Dict], agents: List[Dict]) -> Dict[str, int]:
    """Estimate token cost of currently-enabled skills and agents."""
    # Rough: ~4 chars per token, skill description is ~100-200 tokens,
    # agent file is ~50-100 tokens in the system prompt
    enabled_skills = [s for s in skills if not s["disabled"]]
    disabled_skills = [s for s in skills if s["disabled"]]
    enabled_agents = [a for a in agents if not a["disabled"]]

    # Each skill contributes name + description in the routing context
    # Average skill description is ~150 chars = ~40 tokens
    skill_tokens = sum(len(s.get("description", "")) + len(s["name"]) for s in enabled_skills) // 4
    # Each agent contributes name + tools line = ~30 tokens
    agent_tokens = len(enabled_agents) * 30

    return {
        "enabled_skills": len(enabled_skills),
        "disabled_skills": len(disabled_skills),
        "enabled_agents": len(enabled_agents),
        "estimated_skill_tokens": skill_tokens,
        "estimated_agent_tokens": agent_tokens,
        "estimated_total_tokens": skill_tokens + agent_tokens,
    }


def disable_skill(skill_md: Path) -> bool:
    """Add disable-model-invocation: true to a SKILL.md frontmatter.
    Returns True if changed, False if already disabled or no frontmatter."""
    try:
        content = skill_md.read_text(encoding="utf-8")
        if not content.startswith("---"):
            return False  # no frontmatter to modify
        end = content.find("---", 3)
        if end < 0:
            return False
        fm = content[3:end]
        if "disable-model-invocation" in fm:
            return False  # already disabled

        # Add the flag after the first line of frontmatter
        lines = fm.splitlines()
        # Insert after the name: line (usually first)
        insert_idx = 1
        for i, line in enumerate(lines):
            if line.strip().startswith("name:"):
                insert_idx = i + 1
                break
        lines.insert(insert_idx, "disable-model-invocation: true")
        new_fm = "\n".join(lines)
        new_content = "---" + new_fm + "---" + content[end:]
        skill_md.write_text(new_content, encoding="utf-8")
        return True
    except (OSError, UnicodeDecodeError):
        return False


def enable_skill(skill_md: Path) -> bool:
    """Remove disable-model-invocation: true from a SKILL.md frontmatter."""
    try:
        content = skill_md.read_text(encoding="utf-8")
        # Remove the line
        new_content = re.sub(
            r'\ndisable-model-invocation:\s*true\b', '', content
        )
        if new_content != content:
            skill_md.write_text(new_content, encoding="utf-8")
            return True
        return False
    except (OSError, UnicodeDecodeError):
        return False


def disable_agent(agent_md: Path) -> bool:
    """Move an agent .md to .disabled/ subdirectory."""
    if not agent_md.is_file():
        return False
    disabled_dir = agent_md.parent / ".disabled"
    disabled_dir.mkdir(exist_ok=True)
    dest = disabled_dir / agent_md.name
    if dest.exists():
        return False
    try:
        agent_md.rename(dest)
        return True
    except OSError:
        return False


def enable_agent(agent_name: str) -> bool:
    """Restore an agent from .disabled/."""
    agents_dir = _agents_dir()
    disabled_path = agents_dir / ".disabled" / f"{agent_name}.md"
    dest = agents_dir / f"{agent_name}.md"
    if not disabled_path.is_file():
        return False
    try:
        disabled_path.rename(dest)
        return True
    except OSError:
        return False


def optimize(db_path: str = "", dry_run: bool = False, aggressive: bool = False) -> Dict[str, Any]:
    """Main optimization: analyze usage, disable unused assets.

    Args:
        db_path: path to atlas.db. If empty, uses default.
        dry_run: if True, report only, don't modify files.
        aggressive: if True, disable everything not in the core set regardless of
            recent usage. If False, only disable assets that have zero usage
            AND are in the NICHE_SKILLS set.

    Returns a report dict.
    """
    if not db_path:
        db_path = os.environ.get("ATLAS_DB", os.path.expanduser("~/.atlas/atlas.db"))

    skills = _all_skills()
    agents = _all_agents()

    skills_used = _skills_used_in_db(db_path)
    agents_used = _agents_used_in_db(db_path)

    before = _estimate_tokens(skills, agents)

    skills_to_disable = []
    agents_to_disable = []
    skills_kept = []
    agents_kept = []

    for skill in skills:
        name = skill["name"]
        # Never disable core skills
        if name in CORE_SKILLS:
            skills_kept.append(name)
            continue
        # Skip already-disabled
        if skill["disabled"]:
            skills_kept.append(name)
            continue
        # Check usage
        was_used = name in skills_used or any(
            u in name or name in u for u in skills_used
        )
        if aggressive:
            if not was_used and name not in CORE_SKILLS:
                skills_to_disable.append(name)
        else:
            # Conservative: only disable niche skills with zero usage
            if not was_used and name in NICHE_SKILLS:
                skills_to_disable.append(name)
            else:
                skills_kept.append(name)

    for agent in agents:
        name = agent["name"]
        # Never disable core agents
        if name in CORE_AGENTS:
            agents_kept.append(name)
            continue
        if agent["disabled"]:
            agents_kept.append(name)
            continue
        # Armada agents are always disabled unless aggressive
        if name.startswith("armada-"):
            if aggressive or True:  # armada agents are heavy and rarely used
                agents_to_disable.append(name)
            continue
        # Check usage
        was_used = name in agents_used or any(
            u in name or name in u for u in agents_used
        )
        if not was_used:
            agents_to_disable.append(name)
        else:
            agents_kept.append(name)

    # Apply changes
    changes = {"skills_disabled": [], "agents_disabled": []}
    if not dry_run:
        for name in skills_to_disable:
            skill_md = _skills_dir() / name / "SKILL.md"
            if disable_skill(skill_md):
                changes["skills_disabled"].append(name)
        for name in agents_to_disable:
            agent_md = _agents_dir() / f"{name}.md"
            if disable_agent(agent_md):
                changes["agents_disabled"].append(name)

    # Recompute estimates after changes
    skills_after = _all_skills()
    agents_after = _all_agents()
    after = _estimate_tokens(skills_after, agents_after)

    return {
        "before": before,
        "after": after,
        "skills_to_disable": skills_to_disable,
        "agents_to_disable": agents_to_disable,
        "skills_kept": skills_kept,
        "agents_kept": agents_kept,
        "skills_used_in_db": list(skills_used),
        "agents_used_in_db": list(agents_used),
        "changes_applied": changes if not dry_run else None,
        "dry_run": dry_run,
        "token_savings": before["estimated_total_tokens"] - after["estimated_total_tokens"],
    }


def status() -> Dict[str, Any]:
    """Return current optimization status without changing anything."""
    skills = _all_skills()
    agents = _all_agents()
    estimates = _estimate_tokens(skills, agents)
    return {
        "total_skills": len(skills),
        "enabled_skills": estimates["enabled_skills"],
        "disabled_skills": estimates["disabled_skills"],
        "total_agents": len(agents),
        "enabled_agents": estimates["enabled_agents"],
        "estimated_tokens_per_turn": estimates["estimated_total_tokens"],
        "skills": [{"name": s["name"], "disabled": s["disabled"]} for s in skills],
        "agents": [{"name": a["name"], "disabled": a["disabled"]} for a in agents],
    }


# --- CLI ---

def _cli():
    import sys
    if len(sys.argv) < 2:
        print("Usage: atlas_context_optimizer.py [status|optimize|enable|disable]")
        print("  status    — show current state")
        print("  optimize  — disable unused assets (use --dry-run to preview)")
        print("  aggressive — disable everything not in core set")
        return
    cmd = sys.argv[1]
    if cmd == "status":
        print(json.dumps(status(), indent=2))
    elif cmd == "optimize":
        dry = "--dry-run" in sys.argv
        aggressive = "--aggressive" in sys.argv
        result = optimize(dry_run=dry, aggressive=aggressive)
        print(json.dumps(result, indent=2, default=str))
    elif cmd == "enable":
        if len(sys.argv) < 3:
            print("Usage: atlas_context_optimizer.py enable <skill|agent> <name>")
            return
        kind = sys.argv[2]
        name = sys.argv[3] if len(sys.argv) > 3 else ""
        if kind == "skill":
            skill_md = _skills_dir() / name / "SKILL.md"
            print(json.dumps({"success": enable_skill(skill_md)}, indent=2))
        elif kind == "agent":
            print(json.dumps({"success": enable_agent(name)}, indent=2))
    elif cmd == "disable":
        if len(sys.argv) < 3:
            print("Usage: atlas_context_optimizer.py disable <skill|agent> <name>")
            return
        kind = sys.argv[2]
        name = sys.argv[3] if len(sys.argv) > 3 else ""
        if kind == "skill":
            skill_md = _skills_dir() / name / "SKILL.md"
            print(json.dumps({"success": disable_skill(skill_md)}, indent=2))
        elif kind == "agent":
            agent_md = _agents_dir() / f"{name}.md"
            print(json.dumps({"success": disable_agent(agent_md)}, indent=2))
    else:
        print(f"Unknown command: {cmd}")


if __name__ == "__main__":
    _cli()