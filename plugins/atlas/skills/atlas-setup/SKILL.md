---
name: atlas-setup
description: "Manual atlas lifecycle: onboard (scaffold docs/ and .atlas/), install (claude-mem, context-mode, hooks), connectors (vendor MCP), repair, tour (first-session walkthrough), menu. Use when bringing atlas online, fixing it or learning it."
when_to_use: "first run, set up atlas, boot the workspace, SSOT scaffolding, tooling install, vendor connectors, what to run next, atlas menu, how does atlas work, atlas tour, subagents not launching, plugin acting like an older version"
disable-model-invocation: true
user-invocable: true
argument-hint: "[onboard | install | connectors | repair [--fix] | tour | task description | menu [need]]"
allowed-tools: Read, Glob, Grep, Bash(python3:*), Write(docs/**), Write(.atlas/evidence/**), Write(docs/audits/**), Write(.claude/atlas.local.md)
---

# atlas-setup - onboarding, install, connectors, repair

The one manual skill in the fleet: the user invokes it explicitly and it never auto-triggers.
Every other atlas skill auto-triggers from its description.

atlas-setup configures, fixes, and organizes any project it runs in. First run
scaffolds the SSOT from nothing; every later run checks the same structure and
repairs whatever is partial, missing, or drifted. The scaffold step is
idempotent, so running it again on an already-onboarded project is safe and is
the correct way to fix a broken or partial structure - not just a first-run
action. Structural writes (root entry files, the `docs/` base tree, and the
durable `.atlas/**` subfolders) go through this script under
`Bash(python3:*)`, not through the frontmatter's narrower direct `Write`
grants, which cover `docs/**` content edits and `.atlas/evidence/**`
captures made outside the scaffolder.

It has five modes plus a menu. Pick by argument, or infer from the ask:

| Mode | When | Reference |
|---|---|---|
| onboard (default) | First run, `docs/` missing, or "what should I run next" | this file |
| install | Tooling not wired: claude-mem, context-mode, hooks, project config | `references/install.md` |
| connectors | Vendor MCP connector setup (Auvik, CIPP, NinjaOne, ...) | `references/connectors.md` |
| repair | Atlas itself is broken: subagents not launching, stale version, missing hooks | `references/repair.md` |
| tour | First session, or "how does atlas work": orchestrator style, one dispatch, one gate event, one tiny task | `references/tour.md` |

Mode routing rules:

- No args -> always run `python3 scripts/scaffold_docs.py <repo-root>` first.
  It is idempotent: create-if-missing on a fresh project, gap-repair on a
  partial or drifted one, no-op on an already-correct one. This is the
  mechanism that fixes a partial, missing, or drifted `.atlas/` or `docs/`
  tree on every run, not just the first.
- No `docs/` before that call -> continue with the rest of onboard (below).
- `docs/` already existed -> the scaffold call above already repaired it;
  go straight to recommendations (below) instead of repeating onboard steps
  3-9.
- Anything that smells like a broken install (subagents do not launch, the
  plugin acts like an older version, marketplace points at a stale fork)
  -> repair. Auto-repair with `--fix` runs
  `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --fix`.
  In repair mode, if a `packs:` declaration exists in
  `.claude/atlas.local.md` and the resolver
  `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_packs.py` is present, also run the
  Compound Pack health check (section below) as part of the diagnosis.
- `tour` -> read `references/tour.md` and run it once per operator. Done when
  the operator has seen one dispatch, one gate result and one finished task.
- `menu [need]` -> print the intent-to-skill table in
  `${CLAUDE_PLUGIN_ROOT}/references/skill-finder.md`. With a described need, end
  with the single best-fit skill and a one-line why; when none fits, say so.
  Done when the table is shown and, if a need was given, one verdict is named.
- To build, fix, audit, or refactor code: this is NOT the skill. Route to
  atlas-orchestrate or the specific task skill.

## The mastery framework standard

Every atlas skill follows the Skills Mastery Framework. The full
standard is in `references/mastery-framework.md`. The summary:

- **L1 (metadata, ~100 tokens)** - `name` and `description` are always
  loaded for routing. `description` is the only signal the model uses to
  auto-trigger.
- **L2 (SKILL.md body, <5k tokens)** - the operating manual, loaded on
  trigger. Hard limit: 500 lines.
- **L3 (bundled files, on demand)** - `references/`, `scripts/`,
  `templates/` loaded only when L2 directs. One level deep. No chains.

Key rule: `triggers:` is NOT a real Claude Code field. Auto-trigger comes
ONLY from `description` + `when_to_use`. Never use `triggers:`.

## The docs/ SSOT

The docs/ tree and .atlas/ internal state follow a fixed layout. Read `${CLAUDE_SKILL_DIR}/references/docs-ssot-layout.md` for the full detail.
Scaffold sources live in `templates/` (root files `CHANGELOG.md`, `CLAUDE.md`, `README.md`, `ROADMAP.md`; each folder's `README.md` under api, architecture, audits, decisions, features, lessons, plans, reference_files, specs, wiki; and `findings/INDEX.md`).

## First run: onboarding

When `docs/` does not exist:

1. **Detect roots** - find the project root (nearest `.git` ancestor), any
   codebase roots (subdirectories with their own manifest), and whether the
   project exposes an API (OpenAPI file, routes/controllers dir, web
   framework) so the project-adaptive `docs/api/` scaffolds only when it fits.
2. **Scaffold the SSOT** - run `scripts/scaffold_docs.py`. It creates the
   root entry files, the full `docs/` base tree, and the full `.atlas/` tree
   shown above (project-adaptive `docs/api/` only when Step 1 detected an
   API). It is idempotent: re-running it against a partial or drifted
   structure fills in exactly what is missing and leaves everything else
   untouched, which is how atlas-setup fixes and organizes a project on
   every later run, not only the first.
3. **Wire graphify** - record the wiki producer pipeline (architecture/
   in, wiki/diagrams/ out) per `references/graphify-wiring.md`.
4. **Update .gitignore** - write or repair a zero-trust, deny-by-default
   `.gitignore` (see `atlas-gitignore`): allowlist the full `docs/` and
   `.atlas/` durable trees, ensure `.atlas/.run/` stays ignored except its
   durable `findings.json`, and re-exclude secrets last.
5. **Inventory skills** - read `references/manual-vs-auto-map.md` and
   report which skills just came online.
6. **Run the freshness gate** - wiki fresh, stale, missing, or N/A per
   `references/graphify-wiring.md`.
7. **Deploy self-improvement** - verify the atlas self-improvement system
   is deployed and functional:
   - `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_memory.py` exists and `~/.atlas/memory/` is writable
   - `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_curator.py` exists
   - `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_context_optimizer.py` exists
   - `hooks/memory_capture.py` and `hooks/chronicle_facet.py` exist; both run in-process from `hooks/stop_tail.py` (the single Stop entry in hooks.json), not as separate hook entries
   Run the context optimizer to disable unused skills/agents:
   `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_context_optimizer.py" optimize --dry-run`
   Present the savings estimate to the user and confirm before applying.
   This is the single most impactful action for reducing token cost - atlas
   loads 22 skills + 12 agents into every API call; disabling unused ones
   can cut that by 40%+.
8. **Compound Pack health check** - see the "Compound Pack health check"
   section below. Conditional: skipped silently when the pack resolver is
   not installed.
9. **Recommend** - run the recommendation analysis and present the top
   3-5 next steps.

Every no-args run executes step 2 (`scripts/scaffold_docs.py`) first,
whether or not `docs/` already exists - that call is what repairs a
partial, missing, or drifted structure before anything else happens. If
`docs/` did not exist, continue through the rest of onboarding (steps 3-9)
below. If `docs/` already existed, the scaffold call already repaired it;
skip straight to recommendations (below) instead of repeating steps 3-9.

## Compound Pack health check

Run the Compound Pack health check on request. Read `${CLAUDE_SKILL_DIR}/references/compound-pack-health.md` for the full detail.

## Subsequent runs: recommendations

The "what should I run next" mode. The analysis checks, in priority order:

1. **Setup gaps** - hooks wired? claude-mem installed? context-mode
   installed? If missing, run install mode.
2. **Self-improvement deployed?** - atlas_memory, atlas_curator,
   atlas_context_optimizer scripts present? Memory at `~/.atlas/memory/`
   writable? (Atlas never creates skills: lessons go to memory, findings,
   and docs.)
   Run `atlas_context_optimizer.py status` and if >15 skills are enabled,
   recommend running the optimizer.
3. **Security audit overdue** - has atlas-audit ever run? Is it stale?
4. **Architecture map missing or stale** - has atlas-audit mapped this
   codebase? Is the map older than the last code change?
5. **Run health regressing** - self-telemetry metrics (verifier_coverage,
   inline_ops, unpaired dispatches) trending the wrong way? See
   `${CLAUDE_SKILL_DIR}/references/self-telemetry.md`.
6. **UX coverage gap** - is there a frontend atlas-ux-test has not tested?
7. **Docs drift** - does AGENTS.md match the stack? Is CHANGELOG current?
8. **Recurring task identified** - repeated prompts atlas-loop could
   automate.
9. **Tech debt accumulation** - TODO/FIXME markers, stale branches.
10. **Connector not provisioned** - vendor signals present but the
    connector not configured (connectors mode).

See `references/recommendation-engine.md` for the full analysis matrix.
Present the top 3-5 recommendations as a numbered list, each with the
recommended skill, a one-sentence reason, a confidence level, and the
exact command to invoke.

## Activation: kick off a skill

The user can pick a recommendation ("run #2"), name a goal ("audit my
security" -> atlas-audit), name a skill, ask for a menu, or describe a
task. When routing is ambiguous, present the candidates as one
AskUserQuestion, recommendation first. See `references/skill-routing.md`
for the full task-to-skill mapping.

## The skill inventory (39 skills)

- **1 manual skill** - atlas-setup (this skill).
- **38 auto-trigger skills** - the full list with one-line triggers is
  `references/manual-vs-auto-map.md`; the intent-to-skill table is
  `${CLAUDE_PLUGIN_ROOT}/references/skill-finder.md`.

Org deployment (11 departments, 156 department skills) now lives in the
separate `armada` plugin; install it only for org use.

## The wiki pipeline (graphify wiring)

    docs/architecture/  -->  docs/wiki/diagrams/

graphify lives at the repo root (`skills/graphify/SKILL.md`), not inside
the atlas plugin. atlas-audit populates `architecture/`; graphify renders
it into `wiki/diagrams/`. If `architecture/` is newer than
`wiki/diagrams/`, the wiki is stale: recommend a graphify refresh. See
`references/graphify-wiring.md`.

## No-args behavior

No arguments: run the recommendation analysis and present the top 3-5.
Install or change nothing without the user picking a recommendation or
naming a task. "menu": see the menu routing rule above. A task description: route to the best
skill, asking one question if ambiguous.

## First move

Always run `scripts/scaffold_docs.py` first - it creates the tree from
nothing or repairs a partial/drifted one, and is a no-op when everything is
already correct. If `docs/` did not exist before that call: continue with
wire graphify, inventory, recommend. If it already existed: analyze and
recommend. If anything about the install itself looks broken, switch to
repair mode (`references/repair.md`).

## Additional references

- [Connector authoring](references/connector-authoring.md): how a vendor MCP connector is structured. Read when guiding connector setup alongside the vendors table.
- [Vendors](references/vendors.md): the bundled connector table. Read when enabling or diagnosing a specific vendor connector.
- [Checks matrix](references/checks-matrix.md): what each doctor check proves and what FAIL means. Read when interpreting doctor output.
- [Tool patterns](references/tool-patterns.md): skill vs plugin vs MCP decision rule. Read when building the Stage 2 recommendation shortlist.
- Scripts (run, do not read into context): `scripts/plugin-health.py` (read-only skill/agent count check against the manifest) and `scripts/test_scaffold_docs.py` (unit tests for `scaffold_docs.py`).
- Templates in `templates/`: `docs-agents.md`, `atlas-agents.md`, `atlas-claude.md` (orientation files for `docs/` and `.atlas/`), `endpoints.md` (API reference stub), `new-tool-scaffold.md` (new capability proposal), `connector-manifest.seed.json` (connector manifest seed). The empty scaffold directories (`understand-anything`, `memory`, `evidence`, `archive`, `plans`, `audits`, `specs`, `wiki`, `decisions`, `self-improvement`, `nudge`, `architecture`, `lessons`, `graphify`) each hold a `.gitkeep` placeholder so git keeps them; read only when changing the scaffold tree.
