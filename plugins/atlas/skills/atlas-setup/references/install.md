# Project bootstrap and install (atlas-setup mode)

The architect makes a project ready for atlas: the project's stack detected, the
tooling that fits that stack recommended and activated, memory on, context
protection on, hooks wired and confirmed active, config written, docs/ seeded. It
never installs or writes outside `docs/` and `.claude/` without explicit
confirmation. "Activated" means installed, wired into `hooks.json` or the
project's config, and verified live - not merely present on disk.

The full canonical project structure this mode configures against is defined once
in `atlas-loop/references/docs-ssot.md` ("## Tooling activation"); that file is the
structure authority for anything install.md scaffolds or verifies.

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

The three capability kinds (skill, plugin, MCP), the decision rule for which kind
fits a signal, and the config schema are documented in `references/tool-patterns.md`.
A scaffold for proposing a new capability is in `templates/new-tool-scaffold.md`. Read
the reference before building the recommend-then-confirm shortlist in Stage 2.

1. Dependencies. Detect the project's stack - languages, frameworks, package
   managers - from its manifests (this doubles as input to Stage 2's discovery
   run). Against that stack, check the minimum tooling bar every project gets:
   the session-augmentation trio (claude-mem for cross-session memory,
   context-mode for context-window protection, ponytail for simplicity
   discipline), the atlas completion/dispatch gate hooks (Stage 3), and any
   ecc gate hooks available for the detected stack (Stage 3). If any minimum-
   bar item is missing or inactive, show the exact install/activation command
   and confirm before running it - never silently. Stack-specific items beyond
   this minimum bar are recommended, not assumed: they join the Stage 2
   shortlist instead of being installed here.
2. Discover. Run `${CLAUDE_PLUGIN_ROOT}/scripts/discover_capabilities.py <root>` (read-only). Match its
   signals against `..`atlas-orchestrate`/references/capability-catalog.md`. Present a
   ranked list (skill / plugin / mcp) with a reason and the exact install command
   per item. Also surface the built-ins this project can use now: the loop-library
   (via atlas-loop), vendor connectors (via atlas-setup, disabled until setup),
   architecture mapping and structural dedup (atlas-audit), comprehensive
   quality and security audit (atlas-audit), UX runtime swarm (atlas-ux-test),
   and measurable self-improvement with observability (atlas-audit). Install only
   confirmed items.
3. Hooks. A plugin install auto-loads `hooks/hooks.json`. Verify all hooks are
   active (session boot, prompt optimizer, bash advisor, format-after-edit, dispatch
   tripwire, completion gate, memory capture, auto-skill, self-improvement nudge,
   session-transcript ingest) - these are the atlas completion/dispatch gate hooks
   referenced in Stage 1's minimum bar.
   A separate `hooks/validate-readonly-query.sh` SQL guard ships for the DB-audit
   subagents (schema-inventory, rls-privilege-audit, naming-glossary-audit) to use
   during read-only audits; it is not auto-loaded by hooks.json.
   If the ecc plugin (or another marketplace plugin bundling gate hooks) is
   already installed, verify its gate hooks are wired and active too. If it is
   not installed but its gate hooks fit the detected stack, add it to the
   Stage 2 shortlist rather than installing it here - Stage 1's minimum bar is
   about verifying what should already be active, not a second silent install
   path.
   Outside a plugin install, offer `scripts/install_hooks.py`.
4. Config. Write or update `.claude/atlas.local.md` (schema below). Show the diff and
   confirm before writing.
5. Self-improvement. Verify the atlas self-improvement system is deployed:
   - `scripts/atlas_memory.py` exists and `~/.atlas/memory/` is writable
   - `scripts/skill_factory.py` exists and `~/.atlas/skills/` is writable
   - `scripts/atlas_curator.py` exists
   - `scripts/atlas_context_optimizer.py` exists
   - `hooks/memory_capture.py` and `hooks/auto_skill.py` are wired in hooks.json
   Run the context optimizer to disable unused skills/agents:
   `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_context_optimizer.py optimize --dry-run`
   Present the savings estimate to the user and confirm before applying.
   This is the single most impactful action for reducing token cost - atlas loads
   27 skills + 23 agents (~6000+ tokens) into every API call; disabling unused ones
   can cut that by 70%+.
6. Docs seed and tracking. If `docs/` lacks the SSOT scaffold, offer to seed it per
   `..`atlas-orchestrate`/references/docs-ssot.md`. Confirm first. Then ensure docs/ is
   git-tracked: atlas maintains docs/ as the project SSOT, so a deny-by-default
   `.gitignore` MUST allowlist the SSOT subtree (root `*.md` plus architecture/,
   features/, specs/, audits/, lessons/, wiki/, plans/, evidence/, reference_files/),
   keep `.atlas/.run/` ignored, and never blanket-allow `docs/**` (that would try to
   commit vendored doc clones that carry their own nested .git). Verify with
   `git check-ignore docs/CHANGELOG.md` (should NOT be ignored).
7. Report. Dependency state, capabilities installed vs declined, hooks active, config
   path, docs/ state, self-improvement status, context optimization results,
   and the next recommended command. Persist the same activation record - what
   tooling was detected as fitting the stack, what was activated, what was
   declined, and why - to `.atlas/decisions/<YYYY-MM-DD>-tooling-activation.md`
   so a later session (or `atlas:docs-auditor`) can see the reasoning without
   re-deriving it.

## Recommend-then-confirm

Every install and every write outside `docs/` and `.claude/` is gated on the user's
explicit OK. The discovery script is read-only and side-effect free. Present the
shopping list; let the user choose; install only what they pick.

Orchestration posture lives in atlas-orchestrate (see its `## Orchestration posture` section). The architect only boots and configures; it does not run work.

## No-args behavior (standard scan)

Invoked with no task or prompt, any atlas skill runs the standard scan: inspect the
project and report exactly what is missing to bring it to atlas standard, then
recommend-then-confirm. Check, in order:

- the project's stack (languages, frameworks, package managers), so the rest of
  the scan and Stage 2's shortlist are matched to what this project actually is;
- the session-augmentation trio - claude-mem (memory), context-mode (context
  protection), ponytail (less-code mode);
- the built-ins - loop-library (surfaced by atlas-loop), connectors (enabled via
  atlas-setup when MSP/vendor signals are present), atlas-audit (architecture
  map + structural dedup), atlas-audit (quality and security audit), atlas-ux-test
  (UX runtime swarm), and atlas-audit (measurable self-improvement + observability);
- the automation hooks that auto-load via hooks.json (session boot, prompt
  optimizer, bash advisor, format-after-edit, dispatch tripwire, completion gate,
  memory capture, auto-skill, self-improvement nudge, session-transcript ingest),
  plus any ecc gate hooks available for the detected stack;
- whether `.atlas/decisions/` has a `tooling-activation` record from a prior run,
  so this scan can report drift against it instead of starting cold;
- the docs/ SSOT scaffold, and whether CHANGELOG.md and ROADMAP.md are current;
- the self-improvement system: atlas_memory, skill_factory, atlas_curator, and
  atlas_context_optimizer scripts present and functional;
- the context optimization state: run `atlas_context_optimizer.py status` and
  report how many skills/agents are enabled vs disabled and the estimated
  tokens per turn. If more than 15 skills are enabled, recommend running the
  optimizer.

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
