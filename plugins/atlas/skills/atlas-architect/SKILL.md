---
name: atlas-architect
description: "Use to boot and configure a project so the full atlas runtime is active - verify and install claude-mem and context-mode, scan the stack and recommend skills/plugins/MCP to install (recommend then confirm), confirm the automation hooks are wired, write the project config, and seed the docs/ single source of truth. This is the methodology the /atlas command and the SessionStart boot both lean on. Triggers on project bootstrap, onboarding a repo to atlas, or a request to configure tooling for a codebase. This is configuration and install, not task execution - to run an actual build/fix/audit/refactor through subagents, use atlas-engine."
---

# atlas-architect

The architect makes a project ready for atlas: memory on, context protection on,
the right capabilities recommended, hooks wired, config written, docs/ seeded. It
never installs or writes outside `docs/` and `.claude/` without explicit
confirmation.

Two entry points share this methodology:
- the `/atlas` command (heavy, on demand) runs all stages,
- the SessionStart boot hook (`hooks/session_boot.py`) does the fast read-only
  subset every session (status + lessons) and points the user at `/atlas` for the
  rest.

## Stages

1. Dependencies. Detect claude-mem and context-mode. If missing, show the exact
   install command and confirm before running it - never silently. claude-mem backs
   the self-improvement layer; context-mode keeps large output out of context.
2. Discover. Run `scripts/discover_capabilities.py <root>` (read-only). Match its
   signals against `../atlas-engine/references/capability-catalog.md`. Present a
   ranked list (skill / plugin / mcp) with a reason and the exact install command
   per item. Install only confirmed items.
3. Hooks. A plugin install auto-loads `hooks/hooks.json`. Verify the seven hooks are
   active (boot, prompt optimizer, bash guard, read-only SQL guard, format-after-edit,
   completion gate, nudge). Outside a plugin install, offer `scripts/install_hooks.py`.
4. Config. Write or update `.claude/atlas.local.md` (schema below). Show the diff and
   confirm before writing.
5. Docs seed. If `docs/` lacks the SSOT scaffold, offer to seed it per
   `../atlas-engine/references/docs-ssot.md`. Confirm first.
6. Report. Dependency state, capabilities installed vs declined, hooks active, config
   path, docs/ state, and the next recommended command.

## Recommend-then-confirm

Every install and every write outside `docs/` and `.claude/` is gated on the user's
explicit OK. The discovery script is read-only and side-effect free. Present the
shopping list; let the user choose; install only what they pick.

## Project config schema

`.claude/atlas.local.md` (YAML frontmatter, markdown body for notes):

```yaml
---
stack: [<detected languages/frameworks>]
capabilities_installed: [<asset ids confirmed this session>]
capabilities_declined: [<asset ids the user skipped>]
nudge_window_seconds: 900
routing_notes: <project-specific subagent/model routing, optional>
---
```

The body is free-form: project conventions, gotchas, and anything the architect
learned during setup that the team should see.
