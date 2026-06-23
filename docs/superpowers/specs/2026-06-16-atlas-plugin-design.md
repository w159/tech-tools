# Atlas plugin design

Date: 2026-06-16
Status: approved design, pre-implementation
Supersedes: the `orchestrate` plugin (v0.5.0)

## Problem

The `orchestrate` plugin uses three different tokens for one concept: the plugin
is `orchestrate`, it contains a skill also named `orchestrate` (a name collision
with its parent), and every command and agent uses an `orc-` prefix that matches
neither. Typing `/orchestrate` hits the skill, `/orc-` hits the commands, and the
plugin is a third name. The mental model is muddy and the suite is hard to find.

On top of the rename, the user wants the plugin to become a complete operating
layer: one architect that loads and configures everything automatically, built-in
self-improvement that compounds as a codebase is worked, hard dependence on
claude-mem and context-mode, and the ability to discover and recommend new skills,
plugins, and tools based on a project's individual needs.

## Goals

1. Collapse the three tokens into one: `atlas`. Typing `/atlas` surfaces the whole
   suite.
2. A single architect entry, `/atlas`, plus an automatic SessionStart boot, that
   loads and configures the runtime so agents, hooks, skills, and optimizations are
   active without manual wiring.
3. Built-in self-improvement: capture lessons to claude-mem and committed
   `.agents/` notes, and nudge (non-spammy) to surface past lessons and capture new
   ones.
4. Integrate claude-mem and context-mode: detect, recommend-then-confirm install,
   and use them in the boot and nudge paths.
5. A read-only capability discovery engine that scans a project and recommends
   skills, plugins, and MCP servers to install, with exact commands, gated on user
   confirmation.

## Non-goals

- No second plugin and no parallel `atlas`-alongside-`orchestrate` build. In-place
  rename only (approach A), to avoid fragmentation and iCloud sync churn.
- No auto-install of capabilities without confirmation.
- No change to the underlying methodology of the existing 14 commands and 14 agents
  beyond retokening and reference updates. Their engineering behavior is preserved.

## Naming scheme (confirmed against Claude Code docs)

Claude Code invokes commands by bare filename, agents by `plugin:name`, and skills
by name (grouped under the plugin namespace in the Skill picker). The scheme:

| Surface | Form | Examples |
| --- | --- | --- |
| Plugin | `atlas` | `plugins/atlas/` |
| Architect command | `/atlas` | `commands/atlas.md` |
| Commands | `/atlas-<verb>` | `/atlas-feature`, `/atlas-debug` |
| Agents | `atlas:<role>` | `atlas:explorer`, `atlas:verifier` |
| Skills | name, shown `atlas:<skill>` | `atlas-engine`, `atlas-architect`, `operating-contract`, `self-improving` |

Typing `/atlas` filters to `/atlas` and every `/atlas-*` command. Agents are
plugin-namespaced automatically. Skills appear under the `atlas:` namespace in the
Skill picker. One token, everywhere.

## Architecture

The plugin has four layers, all under `plugins/atlas/`:

1. Architect layer: the `/atlas` command plus a SessionStart hook and the
   `atlas-architect` skill that drives boot, dependency setup, and discovery.
2. Engine layer: the `atlas-engine` skill (renamed core methodology), the
   `operating-contract` skill, the 14 agents, and the references.
3. Self-improvement layer: the `self-improving` skill plus the nudge hook and the
   memory-capture path (claude-mem + `.agents/`).
4. Automation layer: plugin-level `hooks/hooks.json` that auto-loads all hooks on
   install, so nothing needs manual wiring.

### Architect: both activation modes

SessionStart hook (`hooks/session_boot.py`) - fast, idempotent, crash-proof. On
every session start it:
- emits an `additionalContext` block (capped at 10,000 chars) that points at the
  operating-contract and the capability-routing summary,
- reports whether claude-mem and context-mode are present,
- surfaces the top relevant claude-mem lessons for this repo (best-effort; silent
  if claude-mem is absent),
- prints a one-line "Atlas ready" status via `systemMessage`.
It must never block session start. On any error it exits 0 with no output.

`/atlas` command (`commands/atlas.md`) - heavy, on demand. It:
- verifies and, with confirmation, installs claude-mem and context-mode,
- runs `scripts/discover_capabilities.py` to scan the stack,
- presents a ranked recommendation list (skills, plugins, MCP servers) with reasons
  and exact install commands, and installs only what the user confirms,
- ensures hooks are wired (plugin install does this automatically; the command
  verifies and repairs),
- writes a project config to `.claude/atlas.local.md` (YAML frontmatter per the
  plugin-settings pattern),
- seeds the docs/ single source of truth and `.agents/` if absent,
- reports a status summary.

### Discovery engine

`scripts/discover_capabilities.py` is strictly read-only. It detects signals -
languages, frameworks, package managers, infra files (Terraform, Dockerfiles, k8s),
test runners, cloud providers, CI - and maps them against
`references/capability-catalog.md`, a maintained table of signal to recommended
asset. Output is a ranked list with a one-line reason and the exact install command
per item. The `/atlas` command presents this for confirmation; the script never
installs anything itself.

### Self-improvement and nudge

`self-improving` skill (promoted from today's `references/self-improving.md`)
defines the capture format and the loop. The capture path writes lessons,
decisions, errors, and patterns to claude-mem (cross-session) and to committed
`.agents/` notes (in-repo).

`hooks/nudge.py` runs on Stop and SubagentStop, rate-limited and non-spammy. It:
- surfaces a relevant past lesson when the current work matches one
  (`additionalContext`),
- prompts to capture a new lesson after notable work,
- runs a light docs-drift check against the docs/ SSOT.
It returns `additionalContext` only; it never blocks the stop (no exit 2). It
self-throttles using a timestamp marker so it fires at most once per N minutes.

### Automation layer

`hooks/hooks.json` at the plugin root auto-loads on install. It wires:

| Event | Script | Purpose |
| --- | --- | --- |
| SessionStart | `session_boot.py` | boot + status + lessons |
| PreToolUse (Bash) | `bash_guard.py` | block unsafe bash |
| PreToolUse (Bash) | `validate-readonly-query.sh` | enforce read-only SQL in audits |
| PostToolUse (Edit/Write) | `format_after_edit.py` | format after edits |
| UserPromptSubmit | `prompt_optimizer.py` | optimize prompts |
| Stop | `completion_gate.py` | gate "done" on evidence |
| Stop, SubagentStop | `nudge.py` | surface and capture lessons |

`scripts/install_hooks.py` is kept only as a fallback for non-plugin installs and
updated to point at the new paths.

## Migration map

### Directory

`plugins/orchestrate/` to `plugins/atlas/` (via `git mv` to preserve history).

### plugin.json

- `name`: `orchestrate` to `atlas`
- `version`: `0.5.0` to `1.0.0`
- `homepage` / `repository` paths: `plugins/orchestrate` to `plugins/atlas`
- `description` and `keywords`: rewritten to describe the architect, memory,
  discovery, and self-improvement layers and the `/atlas` entry.

### Commands (rename, drop `orc-`, add `atlas-`)

orc-component to atlas-component, orc-db-audit to atlas-db-audit, orc-debug to
atlas-debug, orc-feature to atlas-feature, orc-frontend to atlas-frontend,
orc-gitignore to atlas-gitignore, orc-grafana to atlas-grafana, orc-handoff to
atlas-handoff, orc-harden to atlas-harden, orc-m365 to atlas-m365, orc-prompt to
atlas-prompt, orc-readme to atlas-readme, orc-refactor to atlas-refactor,
orc-vendor-assessment to atlas-vendor-assessment. New: `atlas.md` (architect).

### Agents (rename file and `name`, drop `orc-`)

orc-completeness-critic to completeness-critic, orc-db-prober to db-prober,
orc-docs-auditor to docs-auditor, orc-docs-curator to docs-curator, orc-explorer to
explorer, orc-implementer to implementer, orc-planner to planner,
orc-ui-runtime-tester to ui-runtime-tester, orc-ux-accuracy-oracle to
ux-accuracy-oracle, orc-ux-cartographer to ux-cartographer, orc-ux-fuzzer to
ux-fuzzer, orc-ux-persona to ux-persona, orc-ux-reporter to ux-reporter,
orc-verifier to verifier. All in-file references to `orc-<role>` become
`atlas:<role>`.

### Skills

- `skills/orchestrate/` to `skills/atlas-engine/`, frontmatter `name: atlas-engine`.
- `skills/operating-contract/` unchanged.
- New `skills/atlas-architect/SKILL.md`.
- New `skills/self-improving/SKILL.md` (content seeded from
  `references/self-improving.md`).

### Hooks and scripts

- Move the 5 hook scripts from `skills/orchestrate/hooks/` to `plugins/atlas/hooks/`.
- New `hooks/session_boot.py`, `hooks/nudge.py`, `hooks/hooks.json`.
- Move `skills/orchestrate/scripts/install_hooks.py` to `scripts/install_hooks.py`,
  repath, keep as fallback.
- New `scripts/discover_capabilities.py`.

### References

The 16 references move with the engine skill to
`skills/atlas-engine/references/`. Internal mentions of `orc-*` and `orchestrate`
retoken to `atlas`. New `references/capability-catalog.md`.

### Cleanup

Remove committed `.DS_Store` and `__pycache__`. Add both to the plugin and repo
`.gitignore`.

### Propagation (per repo CLAUDE.md)

- `.claude-plugin/marketplace.json`: update the `orchestrate` entry to `atlas`
  (name, source path, description, keywords).
- `plugins/atlas/README.md`: rewrite for the atlas token, the architect, and the
  new layers, with accurate counts (15 commands, 14 agents, 4 skills, 7 hooks).
- Keep counts and tables consistent across plugin.json, README, and marketplace.

## Error handling and resilience

- `session_boot.py` and `nudge.py` must exit 0 on any internal error and never
  block. They degrade silently when claude-mem or context-mode is absent.
- The discovery script is read-only and side-effect free.
- All install actions in `/atlas` are confirm-gated.
- Hooks use `${CLAUDE_PLUGIN_ROOT}` for all bundled script paths.

## Testing and verification

- `plugin-dev:plugin-validator` agent over `plugins/atlas/` (structure, plugin.json,
  frontmatter).
- `plugin-dev:skill-reviewer` agent over the 4 skills.
- YAML frontmatter parse check across every command, agent, and skill file (the
  repo had a prior systematic frontmatter-quoting failure; re-verify zero parse
  errors).
- ASCII-only check (no em dash, curly quotes, ellipsis) across all new and edited
  prose, per writing-style rules.
- Manual: confirm `/atlas` and at least two `/atlas-*` commands resolve, one agent
  resolves as `atlas:<role>`, `hooks.json` parses, and `session_boot.py` /
  `nudge.py` exit 0 with no creds present.
- Confirm no stale `orc-` or `orchestrate` token remains in the atlas tree
  (grep sweep), excluding intentional historical mentions in this spec.

## Risks

- Large retoken (28 file renames plus reference edits). Mitigated by `git mv` and a
  final grep sweep for stale tokens.
- iCloud bulk-move caution: renames are done file-by-file via `git mv`, not bulk
  filesystem moves; confirmed with the user before executing.
- A skill or command that other repo assets reference by the old name would break.
  Mitigated by the grep sweep across the whole repo, not just the plugin tree.
