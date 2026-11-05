#!/usr/bin/env python3
"""Install the Atlas agents for Codex CLI as custom agent role files.

Codex plugins cannot ship agents, but Codex loads every `*.toml` in `<config folder>/agents/` (a
project's `.codex/agents/` once the project is trusted, or `~/.codex/agents/`) as a role that
`spawn_agent` can pick by `agent_type` (codex-rs agent-roles crate, rust-v0.166.0:
`parse_agent_role_file_contents`). A role file is a TOML table with `name`, `description` and
`developer_instructions` (all required here), optional `nickname_candidates`, plus any config key
(`model_reasoning_effort`, `sandbox_mode`, ...); unknown keys make Codex reject the file.

Each `plugins/atlas/agents/<name>.md` becomes `<target>/atlas-<name>.toml`, role name `atlas-<name>`
(the dispatch hooks map `atlas-<name>` back to `atlas:<name>`). Mapping:
  description            -> description
  body                   -> developer_instructions (after a short Codex note)
  effort low|medium|high -> model_reasoning_effort
  disallowedTools has Write or Edit -> a "never apply_patch / write repository files" line in the text
                           (not sandbox_mode = "read-only": these agents still run tests that write temp files)
  model, tier_allow, effort_allow, color, disallowedTools -> dropped (Claude only)

Usage:
  atlas_codex_agents.py [TARGET_DIR] [--plugin-root DIR] [--check]
TARGET_DIR defaults to ./.codex/agents; it must not be inside the plugin. `--plugin-root` replaces
${CLAUDE_PLUGIN_ROOT} in the agent text with an absolute path (Codex does not set it for agents).
`--check` writes nothing and exits 1 when TARGET_DIR is missing a current file. Only
`atlas-*.toml` files are written; other files in TARGET_DIR are never touched. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent
AGENTS = PLUGIN / "agents"
PREFIX = "atlas-"
EFFORTS = ("low", "medium", "high")
CODEX_NOTE = (
    "Running under Codex CLI. Tool names differ from the text below: use the shell tool for reads, "
    "searches and commands, apply_patch for edits, and an MCP tool by its mcp__<server>__<tool> name. "
    "Where this text names a Claude Code tool you do not have, use the nearest equivalent. "
    "You never spawn agents yourself.\n\n"
)
READ_ONLY_NOTE = "You are a read-only agent: never use apply_patch and never write or edit repository files.\n\n"
_FRONT = re.compile(r"\A---\n(.*?)\n---\n(.*)\Z", re.S)


def parse_agent(text: str) -> tuple[dict, str]:
    """(frontmatter keys as strings, body) for one agent .md; frontmatter is flat `key: value`."""
    m = _FRONT.match(text)
    if not m:
        raise ValueError("no frontmatter")
    meta = {}
    for line in m.group(1).splitlines():
        k, sep, v = line.partition(":")
        if sep and re.fullmatch(r"[A-Za-z_]+", k):
            v = v.strip()
            if v.startswith('"'):
                v = json.loads(v)
            elif v.startswith("'") and v.endswith("'"):
                v = v[1:-1].replace("''", "'")
            meta[k] = v
    return meta, m.group(2).lstrip("\n")


def toml_str(value: str) -> str:
    """A TOML basic string (JSON escapes are valid TOML except DEL, which TOML forbids raw)."""
    return json.dumps(value, ensure_ascii=False).replace("\x7f", "\\u007f")


def render_role(meta: dict, body: str, plugin_root: str | None = None) -> str:
    name = PREFIX + meta["name"]
    disallowed = meta.get("disallowedTools", "")
    note = CODEX_NOTE + (READ_ONLY_NOTE if re.search(r"\b(Write|Edit)\b", disallowed) else "")
    text = note + body
    if plugin_root:
        text = text.replace("${CLAUDE_PLUGIN_ROOT}", plugin_root)
    lines = [f"name = {toml_str(name)}", f"description = {toml_str(meta['description'])}"]
    if meta.get("effort") in EFFORTS:
        lines.append(f"model_reasoning_effort = {toml_str(meta['effort'])}")
    lines.append(f"developer_instructions = {toml_str(text)}")
    return "\n".join(lines) + "\n"


def convert(plugin_root: str | None = None) -> dict[str, str]:
    """{file name: TOML text} for every agent in plugins/atlas/agents."""
    out = {}
    for path in sorted(AGENTS.glob("*.md")):
        meta, body = parse_agent(path.read_text("utf-8"))
        if not meta.get("name") or not meta.get("description"):
            raise ValueError(f"{path.name}: frontmatter needs name and description")
        out[PREFIX + meta["name"] + ".toml"] = render_role(meta, body, plugin_root)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("target", nargs="?", default=".codex/agents")
    ap.add_argument("--plugin-root", help="absolute plugin path to substitute for ${CLAUDE_PLUGIN_ROOT}")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    target = Path(args.target).expanduser().resolve()
    if target == PLUGIN or PLUGIN in target.parents:
        print("refusing to write inside the plugin:", target, file=sys.stderr)
        return 2
    files = convert(args.plugin_root)
    if args.check:
        stale = [n for n, t in files.items() if not (target / n).is_file() or (target / n).read_text("utf-8") != t]
        print(f"{len(files) - len(stale)}/{len(files)} agent files current in {target}")
        return 1 if stale else 0
    target.mkdir(parents=True, exist_ok=True)
    for name, text in files.items():
        (target / name).write_text(text, "utf-8")
    print(f"wrote {len(files)} Codex agent files to {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
