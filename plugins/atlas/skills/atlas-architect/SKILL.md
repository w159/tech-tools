---
name: atlas-architect
description: "Use to boot and configure a project so the full atlas runtime is active - verify and install claude-mem and context-mode, scan the stack and recommend skills/plugins/MCP to install (recommend then confirm), confirm the automation hooks are wired, write the project config, and seed the docs/ single source of truth. This is the methodology the /atlas command and the SessionStart boot both lean on. Triggers on project bootstrap, onboarding a repo to atlas, or a request to configure tooling for a codebase. Orchestration posture lives in atlas-engine; the architect boots and configures only. Use atlas-engine directly to run an already-scoped build/fix/audit/refactor."
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
   (via atlas-orbit), vendor connectors (via atlas-harbor, disabled until setup),
   architecture mapping and structural dedup (atlas-cartographer), comprehensive
   quality and security audit (atlas-survey), UX runtime swarm (atlas-expedition),
   and measurable self-improvement with observability (atlas-sextant). Install only
   confirmed items.
3. Hooks. A plugin install auto-loads `hooks/hooks.json`. Verify the seven hooks are
   active (boot, prompt optimizer, bash guard, read-only SQL guard, format-after-edit,
   completion gate, nudge). Outside a plugin install, offer `scripts/install_hooks.py`.
4. Config. Write or update `.claude/atlas.local.md` (schema below). Show the diff and
   confirm before writing.
5. Docs seed and tracking. If `docs/` lacks the SSOT scaffold, offer to seed it per
   `../atlas-engine/references/docs-ssot.md`. Confirm first. Then ensure docs/ is
   git-tracked: atlas maintains docs/ as the project SSOT, so a deny-by-default
   `.gitignore` MUST allowlist the SSOT subtree (root `*.md` plus architecture/,
   features/, specs/, audits/, lessons/, wiki/, plans/, evidence/, reference_files/),
   keep `docs/.run/` ignored, and never blanket-allow `docs/**` (that would try to
   commit vendored doc clones that carry their own nested .git). Verify with
   `git check-ignore docs/CHANGELOG.md` (should NOT be ignored).
6. Report. Dependency state, capabilities installed vs declined, hooks active, config
   path, docs/ state, and the next recommended command.

## Recommend-then-confirm

Every install and every write outside `docs/` and `.claude/` is gated on the user's
explicit OK. The discovery script is read-only and side-effect free. Present the
shopping list; let the user choose; install only what they pick.

Orchestration posture lives in atlas-engine (see its `## Orchestration posture` section). The architect only boots and configures; it does not run work.

## No-args behavior (standard scan)

Invoked with no task or prompt, any atlas skill runs the standard scan: inspect the
project and report exactly what is missing to bring it to atlas standard, then
recommend-then-confirm. Check, in order:

- the session-augmentation trio - claude-mem (memory), context-mode (context
  protection), ponytail (less-code mode);
- the built-ins - loop-library (surfaced by atlas-orbit), connectors (enabled via
  atlas-harbor when MSP/vendor signals are present), atlas-cartographer (architecture
  map + structural dedup), atlas-survey (quality and security audit), atlas-expedition
  (UX runtime swarm), and atlas-sextant (measurable self-improvement + observability);
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
