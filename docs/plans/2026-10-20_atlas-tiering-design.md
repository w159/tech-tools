# Atlas cost tiering design (stage C1)

Status: design, 2026-10-20. Owner: lead (orchestrator). Implemented by stages C2 to C5 of
`2026-10-20_atlas-feature-audit.md`.

## Problem

Every atlas agent is pinned `model: sonnet`, `effort: low` (`plugins/atlas/agents/*.md:4-6`).
The resolver echoes the scope matrix cell and never emits a model
(`plugins/atlas/scripts/atlas_resolve.py:25-42`). The tripwire denies any `model` argument
that is not the pin (`plugins/atlas/hooks/dispatch_tripwire_core.py:1047-1075`, deny at
`:1312-1323`). The squad doc promises haiku for four roles and medium effort for the
implementer (`skills/atlas-orchestrate/references/squad-and-tiers.md:16,47,76`). Result: a
file scan costs the same as a design review, and a hard synthesis cannot get more than low
effort without the lead doing it inline.

## Goal

Route by cost at three points, with one source of truth:

1. The role's definition says what tiers it may run at.
2. The scope cell says which tier a task class and effort should use.
3. The dispatch gate accepts exactly that and nothing else.

## Tier table (what each role runs as by default)

| role | default model | default effort | tier_allow | why |
|---|---|---|---|---|
| runner | haiku | none | haiku, sonnet | executes numbered steps, no judgment |
| schema-inventory | haiku | none | haiku, sonnet | catalog dump |
| naming-glossary-audit | haiku | none | haiku, sonnet | pattern match against a glossary |
| docs-auditor | haiku | low | haiku, sonnet | drift check is compare, not design |
| explorer | haiku | low | haiku, sonnet | read-and-map; sonnet when the brief says "explain why" |
| db-prober | sonnet | low | haiku, sonnet | query plans need some judgment |
| ui-runtime-tester | sonnet | low | sonnet | drives a browser, must adapt to the page |
| docs-curator | sonnet | low | haiku, sonnet | writes prose that humans read |
| implementer | sonnet | medium | sonnet, opus | the doc already claims medium |
| test-engineer | sonnet | medium | sonnet | |
| verifier | sonnet | medium | sonnet, opus | adversarial; opus when refuting a security claim |
| completeness-critic | sonnet | medium | sonnet, opus | |
| rls-privilege-audit | sonnet | medium | sonnet, opus | regulated-data judgment |
| planner | sonnet | high | sonnet, opus | opus for whole-codebase or cross-harness design |

"none" effort means thinking off (omp `thinkingLevel: off`; Claude Code `effort: low` with
the agent body told not to deliberate). The lead stays opus; opus for a subagent is allowed
only where `tier_allow` lists it, and only through the sanctioned override below.

## Expression

### Agent frontmatter (`plugins/atlas/agents/<role>.md`, mirrored to `omp/agents/` by gen-agents.ts)

```yaml
model: haiku            # default tier (Claude Code honors this directly)
effort: low             # default effort
tier_allow: [haiku, sonnet]
effort_allow: [low, medium]
```

`tier_allow` and `effort_allow` are atlas keys; Claude Code ignores unknown frontmatter
keys, and the tripwire parses the file itself (`_model_override` already reads the pin from
frontmatter). Matrix role effort must still equal frontmatter effort
(`contracts/scope-matrix.json:2` rule stays).

### Scope matrix (`plugins/atlas/contracts/scope-matrix.json`)

Each seat gains an optional `model` and keeps `effort`:

```json
{"role": "explorer", "count": 2, "effort": "low", "model": "haiku", "tools_profile": "read"}
```

A cell that needs a stronger explorer (audit/high across harnesses) says `"model": "sonnet"`.
A `model` outside the role's `tier_allow` is a contract-test failure, not a runtime surprise.

### Resolver (`atlas_resolve.py`)

Emit `model` per seat (from the cell, else the frontmatter default). The orchestrator
copies that value into the Agent call's `model` argument. The resolver is the only place the
orchestrator should take a model from; guessing is the defect this design removes.

### Tripwire (`dispatch_tripwire_core.py`, `_model_override` :1047-1075)

Add a fourth accept to the existing three (exact pin, role alias, parent's live model):

> accept when `given` is in the role's `tier_allow` AND equals the model the resolver emits
> for the `SCOPE: <class>/<effort>` line already required on the prompt.

Everything else keeps the deny at `:1312-1323` with its current text. No new caller-trusted
field: the SCOPE line is already mandatory and already validated. The same rule applies to an
`effort` argument against `effort_allow`.

Tests (stage C3): haiku on explorer with `SCOPE: audit/medium` passes; opus on explorer is
denied; opus on planner with `SCOPE: implement/high` passes only if the cell says opus;
unlisted values still produce the old deny string.

### omp parity (`omp/atlas-agents.ts:32`, `omp/agents/*.md:6-7`)

`ATLAS_THINKING_LEVELS` is a closed union `off | low`. Map effort none -> off, low -> off,
medium -> low, high -> low until the union grows; stage C4 widens it to `off | low | medium |
high` only if omp's agent runtime accepts those values (ASSUMED; the C4 check is the omp
test script from A4 plus `bunx tsc --noEmit`). The model fallback lists stay; `tier_allow`
is appended to the generated frontmatter so the hook bridge enforces the same rule.

### codex

No hook surface. Stage D3 generates `.codex/AGENTS.md` (or the file codex reads; verify
against the Codex docs via Context7 before writing) from `contracts/operating-contract.json`
and includes the tier table as instructions. Enforcement there is UNVERIFIED by design.

## Orchestrator routing rule (goes into the output style and operating contract)

Before any dispatch, classify the unit:

- scan, list, read, count, run a fixed command, fetch a page: haiku, effort none, via runner
  or explorer, or a generic agent with `model: haiku` when no atlas role fits.
- map a call path, triage a failure, write a bounded diff: sonnet, effort low or medium.
- design across modules or harnesses, refute a security or regulated-data claim, synthesize
  many reports: sonnet high or opus (planner, verifier, critic), only through the override.

Name the tier in the dispatch line (`· haiku/none`) so the board shows it. A dispatch that
names a tier the resolver did not emit is denied; fix the matrix cell, not the call.

## Non-goals

- No per-turn model switching for the lead.
- No new agent roles.
- No change to what the gates check for evidence; cheaper tiers still stamp findings.

## Proven vs assumed

- PROVEN: pins, deny lines, resolver behavior, doc claims (audit reports w1-skills-agents.md).
- ASSUMED: Claude Code ignores unknown frontmatter keys (verify in stage C2 by loading an
  agent with `tier_allow` and dispatching it); omp accepts thinking levels beyond `low`
  (verify in C4); haiku explorer output is good enough (verify by rerunning one W1 explorer
  brief on haiku and diffing findings).
