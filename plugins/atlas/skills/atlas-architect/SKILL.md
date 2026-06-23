---
name: atlas-architect
description: "Use to boot and configure a project so the full atlas runtime is active - verify and install claude-mem and context-mode, scan the stack and recommend skills/plugins/MCP to install (recommend then confirm), confirm the automation hooks are wired, write the project config, and seed the docs/ single source of truth. This is the methodology the /atlas command and the SessionStart boot both lean on. Triggers on project bootstrap, onboarding a repo to atlas, or a request to configure tooling for a codebase. It also activates Architect Mode for the session: rewrite vague or incomplete prompts into structured, reference-backed tasks and route all execution to atlas-engine subagents while keeping the main context minimal. Configuration and the orchestration posture live here; use atlas-engine directly to run an already-scoped build/fix/audit/refactor."
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

1. Dependencies. Detect the session-augmentation trio: claude-mem, context-mode, and
   ponytail. If any is missing, show the exact install command and confirm before
   running it - never silently. claude-mem backs the self-improvement layer;
   context-mode keeps large output out of context; ponytail (lite/full/ultra/off)
   writes far less code while keeping safety.
2. Discover. Run `${CLAUDE_PLUGIN_ROOT}/scripts/discover_capabilities.py <root>` (read-only). Match its
   signals against `../atlas-engine/references/capability-catalog.md`. Present a
   ranked list (skill / plugin / mcp) with a reason and the exact install command
   per item. Also surface the built-ins this project can use now: the loop-library
   (via atlas-loop) and the vendor connectors (via atlas-connectors, disabled until
   setup). Install only confirmed items.
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

## Architect Mode

Once atlas is booted, the architect turns the active session into a pure orchestrator:
it does no production work in its own context; it directs subagents and synthesizes
their evidence.

1. Rewrite the prompt. Take the user's request - however vague, unoptimized, or
   incomplete - and restate it as a structured task before any work starts: the goal
   and acceptance criteria, the concrete subtasks, the principles that apply (the
   atlas-operating-contract), and direct quotations from the real API/SDK docs
   (Context7, Microsoft Learn) so natural language never steers a coding agent into a
   wrong API. Use the atlas-prompt command for the heavy rewrite. If acceptance
   criteria were ambiguous, confirm the rewritten task once, then proceed.
2. Delegate everything. Research, implementation, and testing each go to parallel
   subagents (atlas-engine standing-consent orchestration). The orchestrator keeps
   only conclusions, not file contents - context stays minimal.
3. Adversarial evidence. Hand every claimed change to a second, independent subagent
   that tries to refute it and must capture observed-behavior evidence (red -> green)
   before the change counts as done. No self-verification.
4. Synthesize and gate. Update docs/ via the docs-curator, reconcile ROADMAP/CHANGELOG
   per `../atlas-engine/references/session-lifecycle.md`, and present any
   write/migration with its blast radius before it runs.

The mechanics live in atlas-engine; the architect is the front door that rewrites the
ask and holds the orchestration posture. Say "mode off" to drop back to ordinary
inline behavior.

## No-args behavior (standard scan)

Invoked with no task or prompt, any atlas skill runs the standard scan: inspect the
project and report exactly what is missing to bring it to atlas standard, then
recommend-then-confirm. Check, in order:

- the session-augmentation trio - claude-mem (memory), context-mode (context
  protection), ponytail (less-code mode);
- the built-ins - loop-library (surfaced by atlas-loop) and connectors (enabled via
  atlas-connectors when MSP/vendor signals are present);
- the seven automation hooks (boot, prompt optimizer, bash guard, read-only SQL guard,
  format-after-edit, completion gate, nudge);
- the docs/ SSOT scaffold, and whether CHANGELOG.md and ROADMAP.md are current.

Report each as present or missing with the exact remediation. Install nothing without
the user's explicit OK.

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
