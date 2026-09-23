# Phase 3: Plan artifact contract

Ported from CE `ce-plan/references/plan-sections.md` (Goal Capsule + Product Contract + Planning Contract + Implementation Units + Verification Contract + DoD), adapted to atlas date-first naming, docs-ssot write ownership, and orchestrate's consumption contract. This artifact is **implementation-ready** - the exact complement of the brainstorm artifact, which is requirements-only.

## Path and naming

`docs/plans/<YYYY-MM-DD>-<slug>-plan.md`

- `<YYYY-MM-DD>` = today's date (atlas date-first convention, enforced by `${CLAUDE_PLUGIN_ROOT}/scripts/lint_docs_names.py` - never CE's HHMM-timestamped or undated names).
- `<slug>`: lowercase; every character outside `a-z 0-9 . _ -` replaced by `-`; collapsed and trimmed (Windows-safe per docs-ssot).
- Collision: if the exact path exists and is NOT the resume target, suffix `-2`, `-3`, ... Do not overwrite. If it IS the resume target, edit it in place under resume semantics (`references/intake.md`).

## Section contract

```markdown
# Plan: <topic>

Date: <YYYY-MM-DD>
Source: atlas-plan
Upstream: docs/plans/<YYYY-MM-DD>-<slug>-brainstorm.md  (or "inline intake" for bare descriptions)
artifact_contract: atlas-plan/v1
product_contract_source: atlas-brainstorm | atlas-plan (inline intake)
execution: atlas-orchestrate

## Goal Capsule

<Carried from the brainstorm artifact: model of success, primary actor, non-goals. Refine wording
only; changing meaning is a conflict to flag, not an edit to make quietly. Inline-intake plans
compose it here following the brainstorm contract's field rules.>

## Product Contract

### Requirements

<Carried `R-###` IDs verbatim - same ID, same meaning. Inline-intake plans mint them here.
Superseded requirements keep their ID with a `[superseded by R-XXX]` marker.>

### Settled decisions

<Carried `D-###` decisions - binding. New decisions settled during planning are appended with
their rationale.>

## Planning Contract

### Research findings

<At most five distilled lessons/findings, each with its file path and which units it shapes.
"No prior lessons/findings matched" is a valid entry.>

### Pack rules applied

<Matched `(pack: <id>, <path>)` rules, quoted and cited, with what they shaped. "None matched"
or "atlas_packs.py absent" when applicable. Pack warnings/errors surfaced once here.>

### Grounding

<Explorer finding summary: the affected surface, established patterns (file:line), test homes.>

### Question inventory

**Resolved:** <each with its basis: (grounded: path) | (pack: id, path) | D-### | A-### resolved by ...>
**Deferred:** <Q-### with Default / Owner / Latest safe moment - or "none", which must be true,
not convenient>

### Conflicts flagged

<Challenge-pass findings that contradict a settled decision, a pack rule, or repo reality -
stated with both sides. "None" when empty.>

## Implementation Units

### U1: <title>
<all eight fields per references/units.md - goal, requirements, dependencies, files, approach,
test scenarios, verification, definition of done>
### U2: ...
<...>

## Verification Contract

<How the whole plan is proven done - the aggregate the per-unit checks roll up into:
- The exact command set: the full test/lint/build invocation(s) that must pass on the final tree.
- Independent verification: atlas:verifier dispatch(es) per orchestrate law 5 - the implementer's
  receipts are self-reports; the contract names what a fresh context must re-run.
- Evidence destination: `.atlas/evidence/<YYYY-MM-DD>-<unit-id>-receipt.md` per unit, plus any
  runtime captures (screenshots, curl output, query results) user-facing units require.
- Deferred-question resolution: each Q-### names where its answer lands in the evidence.>

## Definition of Done

<The plan-level gate, ALL of:
1. Every unit's own DoD holds - each failable check observed passing, receipts written.
2. The Verification Contract is executed, not just satisfiable - commands run, output captured.
3. Independent verification recorded in `.atlas/.run/findings.json` (verifier stamps per unit
   or per stage, never a blanket "all verified").
4. docs-current per docs-ssot: CHANGELOG entry, ROADMAP reconciled, affected docs/ subfolders
   updated, verified findings distilled to `.atlas/findings/`.
5. No push, PR, or merge - those require explicit user confirmation, always.>

## Appendix (optional)

<Research detail, rejected alternatives and why, flow analysis for Deep tiers.>
```

## Metadata contract

`artifact_contract: atlas-plan/v1` marks this as an atlas plan (CE's `ce-unified-plan/v1` frontmatter does not port - different naming, different execution plane). `product_contract_source` records provenance for the resume path. `execution: atlas-orchestrate` names the only consumer - there is no `atlas-work` executor and never will be; execution goes through orchestrate's dispatch + verification machinery.

## Consumption by atlas-orchestrate

- Orchestrate's stage map sequences these `U<N>` IDs as-is. It may group them into stages/waves (`S2` containing `U4`-`U6`), and its per-stage failable checks reference the units' verification fields. It never mints replacement unit IDs - `implementation-units.md`'s rule ("do not invent IDs the plan does not supply") applies.
- The per-unit **Verification** field pre-answers orchestrate's evidence-strategy choice (`proof-first | characterization | no-test-exception`); the dispatch prompt carries it verbatim.
- The **Verification Contract** and **Definition of Done** feed orchestrate's loop gates directly: the command set is the stage gate, the DoD is the completion gate's checklist.

## Ready checks (gate before Phase 4)

1. **Complete:** every `R-###` covered by a unit or an explicit deferred question; every unit has all eight fields; no placeholder, TBD, or `...` anywhere.
2. **Consistent:** units don't contradict each other or the settled decisions; the dependency graph is acyclic; Files lists don't grant the same exclusive surface to two "independent" units.
3. **Executable:** every Verification field names a command or observable runnable by someone outside this session; every test scenario is failable.
4. **Usable:** orchestrate could dispatch U1 without a single question back to the planner - every deferred question has its default, every unit its evidence strategy.

A failed check is fixed in the draft (or back in Phase 2 for Complete/Consistent) - never handed off as-is.

## Write via atlas:docs-curator

Per docs-ssot, `docs/` writes belong to `atlas:docs-curator`. Dispatch it (subagent-kit shape, fork per `subagent-kit.md` when `CLAUDE_CODE_FORK_SUBAGENT=1`): ROLE = write the assembled plan artifact verbatim to the target path, creating `docs/plans/` if missing; TOOLS ALLOWED: Read, Glob, Grep, Bash, Edit, Write with writable scope `docs/plans/**` only; DELIVERABLE: the written path + confirmation the section contract is complete. Supply the full assembled artifact verbatim in the prompt. If subagent dispatch is genuinely unavailable on the host, write the file directly and state that in the report.
