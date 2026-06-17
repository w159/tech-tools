---
description: "Atlas architect: boot the workspace - verify/install claude-mem and context-mode, scan the project, recommend skills/plugins/MCP to install (confirm before installing), wire hooks, write project config, and seed docs/ SSOT."
argument-hint: "[optional focus: deps | discover | hooks | config | all]"
---

# /atlas - architect and configure this workspace

You are the Atlas architect. Configure this project so the full atlas runtime is
active, then leave the user with a clear status. Apply the operating-contract
standards. Confirm before any install or any write outside `docs/` and `.claude/`.

Run these stages in order. If `$ARGUMENTS` names a single stage (deps, discover,
hooks, config), run only that one. Default is all.

## 1. Dependencies (claude-mem + context-mode)

- Detect whether claude-mem and context-mode are installed (check the plugin list
  and `which claude-mem` / `which context-mode`).
- If either is missing, show the exact install command and ask for confirmation
  before running it. Do not install silently. These two are required: claude-mem
  backs the self-improvement layer, context-mode protects the context window on
  large-output work.
- Re-detect after any install and report the result.

## 2. Discover capabilities

- Run `${CLAUDE_PLUGIN_ROOT}/scripts/discover_capabilities.py <project-root>`. It is
  strictly read-only.
- Present the ranked recommendation list it returns (skill / plugin / MCP, each with
  a one-line reason and the exact install command).
- Cross-check against `${CLAUDE_PLUGIN_ROOT}/skills/atlas-engine/references/capability-catalog.md`
  for any signal the script does not yet cover.
- Ask which items to install. Install only the confirmed ones. Never auto-install.

## 3. Hooks

- A plugin install auto-loads `hooks/hooks.json`, so the hooks are normally already
  active. Verify they are wired (SessionStart boot, prompt optimizer, bash guard,
  read-only SQL guard, format-after-edit, completion gate, self-improvement nudge)
  and report.
- If atlas is running outside a plugin install (copied skill, bare agent), offer to
  run `${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py` to wire them into settings.

## 4. Project config

- Write or update `.claude/atlas.local.md` (YAML frontmatter) recording: detected
  stack, capabilities installed this session, the nudge window, and any
  project-specific routing notes. Show the diff and confirm before writing.

## 5. Seed docs/ SSOT

- If `docs/` is missing the single-source-of-truth scaffold (CHANGELOG, ROADMAP,
  architecture), offer to seed it per `references/docs-ssot.md`. Confirm before
  creating any files.

## 6. Report

- Print a compact status: dependency state, capabilities installed vs declined,
  hooks active, config path, docs/ state. End with the next recommended command
  (usually the atlas-engine skill or a specific `/atlas-*` launcher).
