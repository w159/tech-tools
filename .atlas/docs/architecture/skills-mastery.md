# Skills Mastery Framework Application

How the post-5.0.0 atlas fleet is structured to the Claude Code Skills Mastery
Framework. The fleet is now split across two plugins: a 21-skill
plugins/atlas (12 core agents in plugins/atlas/agents) and a separate
plugins/armada (11 department agents in plugins/armada/agents, with the
armada department skills under plugins/armada/skills/armada/departments/).
The authoritative spec is
plugins/atlas/skills/atlas-setup/references/mastery-framework.md (moved here
when atlas-olympus was merged into atlas-setup in 5.0.0).

Counts are verified by plugins/atlas/skills/atlas-setup/scripts/plugin-health.py,
which reports `skills: actual=21` and `agents: actual=12`, both PASS against
the atlas manifest. The 21 atlas skills are: atlas-audit, atlas-component,
atlas-db-audit, atlas-debug, atlas-feature, atlas-frontend, atlas-gitignore,
atlas-handoff, atlas-harden, atlas-launch, atlas-loop, atlas-m365,
atlas-orchestrate, atlas-prompt, atlas-readme, atlas-refactor, atlas-setup,
atlas-ux-test, atlas-validate, atlas-vendor-assessment, atlas-wiki. The 12
core agents live in plugins/atlas/agents/: completeness-critic, db-prober,
docs-auditor, docs-curator, explorer, implementer, naming-glossary-audit,
planner, rls-privilege-audit, schema-inventory, ui-runtime-tester, verifier.

## Progressive disclosure (three levels)

A skill is three layers, loaded in order of need. The full rules live in
mastery-framework.md; the summary:

- L1 metadata: always loaded, roughly 100 tokens per skill. The
  frontmatter fields (name, description, when_to_use, allowed-tools,
  paths, argument-hint, disable-model-invocation, context:fork, agent).
- L2 SKILL.md body: loaded on trigger, under 500 lines (a proxy for the
  5k-token budget). Anything longer is pushed to L3.
- L3 bundled files: references/, scripts/, templates/. Loaded only when
  L2 names them. No token budget at L3 because nothing loads until it is
  named. References are one level deep (no reference chains). References
  stay under 400 lines.

## Frontmatter standard

Required on every skill: name, description (third-person, what plus when,
key use first, under 1024 characters), when_to_use (trigger phrases).

Trigger control: `disable-model-invocation: true` marks a skill manual. In
the 5.0.0 atlas plugin, 11 skills are manual. Verified by
`grep -rl 'disable-model-invocation: true' plugins/atlas/skills/`, which
returns exactly: atlas-component, atlas-db-audit, atlas-frontend,
atlas-harden, atlas-m365, atlas-prompt, atlas-readme, atlas-refactor,
atlas-setup, atlas-vendor-assessment, atlas-wiki (each at
plugins/atlas/skills/<name>/SKILL.md, plus three reference files under
atlas-setup/references/). The pre-5.0.0 claim that only atlas-olympus and
atlas-doctor were manual is obsolete: atlas-olympus was merged into
atlas-setup and atlas-doctor no longer exists in the plugin. Every
non-manual skill auto-triggers from its description.

The atlas-invented `triggers:` field is NOT a real Claude Code frontmatter
field. The harness ignores it. Auto-trigger behavior comes only from the
combination of `description` and `when_to_use`. The rebuild removed
`triggers:` from the armada skills and folded its keywords into
description and when_to_use.

Tool pre-approval: `allowed-tools` pre-approves safe tools so the skill
does not prompt. The armada department skills gained per-department MCP
allowed-tools scoping.

Argument surface: `argument-hint` on parameterized skills (prompt, launch,
handoff, feature, refactor).

Isolation and delegation: `paths` restricts file access to a subtree;
`context:fork` runs the skill in a forked context so tool output does not
pollute the parent; `agent` delegates the body to a named subagent. The
pre-5.0.0 research/isolation skills (ariadne, athena, argus, nestor) that
used context:fork were merged or deleted in 5.0.0; their audit and setup
duties now live in atlas-audit and atlas-setup. The context:fork syntax was
confirmed against the Anthropic claude-code-setup skills reference.

## SKILL.md limits

The hard limit is 500 lines. The one skill that exceeded it,
data/interactive-dashboard-builder (786 lines), was split into a 235-line
SKILL.md plus references/interactive-dashboard-reference.md
(plugins/armada/skills/armada/departments/data/skills/interactive-dashboard-builder/SKILL.md).
Content was moved, not deleted; no reference chains.

## Deterministic operations: scripts/

Scripts are deterministic operations, not prose. They run under a stock
Python 3 interpreter with no external deps, using ${CLAUDE_SKILL_DIR} to
locate themselves. Examples in this run:

- plugins/atlas/skills/atlas-setup/scripts/scaffold_docs.py: scaffolds
  the 12-folder .atlas/docs/ tree from templates/. Idempotent, exit 0.
  (Moved from atlas-olympus/scripts/ when olympus merged into atlas-setup.)
- plugins/atlas/skills/atlas-setup/scripts/plugin-health.py: the health
  gate that verifies skill and agent counts against the manifest; source
  of the `skills: actual=21` / `agents: actual=12` evidence cited above.
- plugins/atlas/skills/atlas-wiki/scripts/check_wiki_freshness.sh: compares
  the newest mtime under .atlas/docs/wiki/diagrams/ against
  .atlas/docs/architecture/ and emits FRESH, MISSING, or STALE (exits 0,
  0, 1).
- validate_gitignore.sh and validate_harden_script.sh: validation scripts
  for the gitignore and harden skills.

## Templates

templates/ holds generated artifacts and seed files. atlas-setup templates/
carries the 12 durable docs tree seeds (CHANGELOG.md, ROADMAP.md,
AGENTS.md, and the architecture, audits, evidence, features, lessons,
plans, reference_files, specs, wiki subfolders). (Moved from
atlas-olympus/templates/ in 5.0.0.)

## Per-department MCP allowed-tools scoping

The armada department skills (now under plugins/armada/skills/armada/departments/)
scope their allowed-tools to the MCP servers their domain owns, matched to
the real .mcp.json server names:

- it-ops: auvik, ninjaone, connectwise, spanning. Verified: all 4
  wildcards match real .mcp.json names; restore-orchestrator stays AUTO.
- m365: cipp, microsoft-graph, microsoft-docs. The m365 skills each
  carry references/microsoft-graph-api.md with 53-plus learn.microsoft.com
  citations.
- hr: paylocity and context-mode MCP prefixes, confirmed against
  .mcp.json and the live tool list.

## Resource extractions (examples)

Where a SKILL.md carried heavy reference material, the material was
extracted to references/ linked one level deep:

- finance audit-support: 80-line SKILL.md plus five references
  (control-types.md, deficiency-classification.md, sample-selection.md,
  sox-testing-methodology.md, workpaper-standards.md), all under 400
  lines. No chains; content moved not deleted.
- support: article-templates.md (127 lines) and triage-rubric.md (115
  lines) extracted, linked one level deep.

## Status

The run is complete and verified. S1 through S8 are green (S7 armada all
11 departments verified, S8 scaffold verified), and S10 content fixes are
verified. See .atlas/docs/.run/findings.json for per-stage verifier
verdicts and .atlas/docs/CHANGELOG.md for the completion entry. The
post-5.0.0 fleet counts (21 atlas skills, 12 atlas agents, 11 armada
department agents) are re-verified by plugin-health.py as of this writing.