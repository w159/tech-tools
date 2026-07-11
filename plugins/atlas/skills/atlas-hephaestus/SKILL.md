---
name: atlas-hephaestus
description: "Boot and configure a project so the full atlas runtime is active: verify and install claude-mem and context-mode, scan the stack, recommend then confirm tooling, confirm automation hooks are wired, write project config, and seed the .atlas/docs/ single source of truth. Triggers on project bootstrap, onboarding a repo to atlas, or configuring tooling for a codebase. Boots and configures only; run scoped build/fix/audit/refactor through atlas-metis."
---

# atlas-hephaestus

The architect makes a project ready for atlas: memory on, context protection on,
the right capabilities recommended, hooks wired, config written, docs/ seeded. It
never installs or writes outside `.atlas/docs/` and `.claude/` without explicit
confirmation.

**Elicitation:** consent decisions go through the **AskUserQuestion tool**, not prose
offers the user must parse. Recommend-then-confirm means: present the install shortlist
(skills/plugins/MCP) as one multiSelect question with recommended items first; when
docs/ lacks the SSOT scaffold, ask one question - seed full scaffold (recommended),
seed minimal (CHANGELOG/ROADMAP only), or skip. Ask only about actions needing consent;
anything discoverable (stack, existing config, dependency presence) is detected, never
asked.

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
   signals against `../atlas-metis/references/capability-catalog.md`. Present a
   ranked list (skill / plugin / mcp) with a reason and the exact install command
   per item. Also surface the built-ins this project can use now: the loop-library
   (via atlas-chronos), vendor connectors (via atlas-hermes, disabled until setup),
   architecture mapping and structural dedup (atlas-ariadne), comprehensive
   quality and security audit (atlas-athena), UX runtime swarm (atlas-odysseus),
   and measurable self-improvement with observability (atlas-argus). Install only
   confirmed items.
3. Hooks. A plugin install auto-loads `hooks/hooks.json`. Verify all eight hooks are
   active (session boot, prompt optimizer, bash advisor, format-after-edit, dispatch
   tripwire, completion gate, self-improvement nudge, session-transcript ingest).
   A separate `hooks/validate-readonly-query.sh` SQL guard ships for the DB-audit
   subagents (schema-inventory, rls-privilege-audit, naming-glossary-audit) to use
   during read-only audits; it is not auto-loaded by hooks.json.
   Outside a plugin install, offer `scripts/install_hooks.py`.
4. Config. Write or update `.claude/atlas.local.md` (schema below). Show the diff and
   confirm before writing.
5. Docs seed and tracking. If `.atlas/docs/` lacks the SSOT scaffold, offer to seed it per
   `../atlas-metis/references/docs-ssot.md`. Confirm first. Then ensure .atlas/docs/ is
   git-tracked: atlas maintains .atlas/docs/ as the project SSOT, so a deny-by-default
   `.gitignore` MUST allowlist the SSOT subtree (root `*.md` plus architecture/,
   features/, specs/, audits/, lessons/, wiki/, plans/, evidence/, reference_files/),
   keep `.atlas/docs/.run/` ignored, and never blanket-allow `.atlas/docs/**` (that would try to
   commit vendored doc clones that carry their own nested .git). Verify with
   `git check-ignore .atlas/docs/CHANGELOG.md` (should NOT be ignored).
6. Report. Dependency state, capabilities installed vs declined, hooks active, config
   path, .atlas/docs/ state, and the next recommended command.

## Recommend-then-confirm

Every install and every write outside `.atlas/docs/` and `.claude/` is gated on the user's
explicit OK. The discovery script is read-only and side-effect free. Present the
shopping list; let the user choose; install only what they pick.

Orchestration posture lives in atlas-metis (see its `## Orchestration posture` section). The architect only boots and configures; it does not run work.

## No-args behavior (standard scan)

Invoked with no task or prompt, any atlas skill runs the standard scan: inspect the
project and report exactly what is missing to bring it to atlas standard, then
recommend-then-confirm. Check, in order:

- the session-augmentation trio - claude-mem (memory), context-mode (context
  protection), ponytail (less-code mode);
- the built-ins - loop-library (surfaced by atlas-chronos), connectors (enabled via
  atlas-hermes when MSP/vendor signals are present), atlas-ariadne (architecture
  map + structural dedup), atlas-athena (quality and security audit), atlas-odysseus
  (UX runtime swarm), and atlas-argus (measurable self-improvement + observability);
- the eight automation hooks that auto-load via hooks.json (session boot, prompt
  optimizer, bash advisor, format-after-edit, dispatch tripwire, completion gate,
  self-improvement nudge, session-transcript ingest);
- the .atlas/docs/ SSOT scaffold, and whether CHANGELOG.md and ROADMAP.md are current.

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
