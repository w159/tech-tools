# Stage Routing - Diff Summary

Edit target: `plugins/atlas/skills/atlas-engine/references/capability-routing.md`

## What changed

1. **Added three Step 2 rows** (after the `atlas-sextant` row, before the `code-reviewer` row):
   - `Project boot / onboarding / configure tooling for a repo` -> `(orchestrator dispatches atlas-architect)` / `atlas-architect` / `serena`, hook/config wiring / sonnet
   - `Multi-stage / multi-surface orchestration ...` -> `(this skill is the orchestrator itself - normally entered via its own skill trigger, not routed to from within a session)` / `atlas-engine` / whatever Step 1 discovers live / sonnet
   - `Choosing / stacking which skills to run for a goal or stack` -> `(orchestrator dispatches atlas-stacks)` / `atlas-stacks` / - / sonnet

2. **Annotated built-in/global agent types** not shipped under `plugins/atlas/agents/` with a trailing `*` marker, plus a footnote line directly under the table:
   `\* Built-in/global agent type, not shipped under \`plugins/atlas/agents/\` - resolved from \`~/.claude/agents/\`, \`.claude/agents/\`, or Claude Code's built-in agent types.`
   Marked occurrences: `codebase-explorer`, `Explore`, `Plan`, `frontend-developer` (both rows), `backend-architect`, `debugger`, `test-executor`, `test-engineer`, `secondary-expert-validator`, `security-engineer`, `code-reviewer`, `devops-automator`.

3. **Removed/fixed rows referencing deleted agents**: none existed. Verified via
   `grep -n "ux-cartographer\|ux-persona\|ux-fuzzer\|ux-accuracy-oracle\|ux-reporter\|api-usage-map" plugins/atlas/skills/atlas-engine/references/capability-routing.md`
   returned no matches before the edit, so no row required removal.

All other rows are byte-identical to the pre-edit file (verified by diffing only the touched lines above; no other line's content changed).

## Evidence

- Shipped agent inventory: `ls plugins/atlas/agents/` ->
  `completeness-critic.md, db-prober.md, docs-auditor.md, docs-curator.md, explorer.md, implementer.md, naming-glossary-audit.md, planner.md, rls-privilege-audit.md, schema-inventory.md, ui-runtime-tester.md, verifier.md`
  (no `codebase-explorer`, `Explore`, `Plan`, `debugger`, `test-executor`, `test-engineer`, `security-engineer`, `code-reviewer`, `devops-automator`, `frontend-developer`, `backend-architect`, or `secondary-expert-validator` files present, confirming they are not shipped-in-plugin agent types.)
- Skill descriptions confirmed via `head -5` on `plugins/atlas/skills/atlas-stacks/SKILL.md` and `plugins/atlas/skills/atlas-architect/SKILL.md` to phrase the new rows' task signals accurately (atlas-stacks: "skill-stacking concierge... elicits the goal... composes them into an ordered stack"; atlas-architect: "boot and configure a project so the full atlas runtime is active... Orchestration posture lives in atlas-engine; the architect boots and configures only").
