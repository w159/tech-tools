# Phase 0-1: Resume, classify, scope, grounding, dialogue

Ported from CE `ce-brainstorm` `references/phase-0.md` + `dialogue.md` + `interaction-rules.md`, adapted to atlas dispatch and question discipline.

## Resume

Before any question, check for prior art:

1. `docs/plans/*-brainstorm.md` matching this topic. Found one whose Product Contract covers this request -> ask exactly:
   > Found an existing requirements-only plan for [topic]: <path>. Continue from this, or start fresh?
   Continuing means its settled decisions are fixed input; reopen one only when the user explicitly challenges it.
2. `docs/specs/`, `docs/features/`, and `docs/decisions/` for related settled decisions - these are context, not resume targets.
3. `.atlas/findings/INDEX.md` and `docs/lessons/` for prior art in the same area (docs-ssot requires consulting these before non-trivial work).

## Classify and scope

**Software classification.** Software (code changes implied) gets the full procedure. Non-software (process change, docs, research, workflow) skips implementation-shaped dialogue - no "which files", no "error paths" - and produces a reduced Goal Capsule + Product Contract. Never force non-software through software framing.

**Tier assessment** (your decision, stated in one line, never a question):

| Signal | Tier |
|---|---|
| One clear actor, existing pattern to follow, no user-visible design fork | Lightweight |
| Default: feature touches real code with design latitude | Standard |
| Multiple actors/integrations, irreversible fork (pricing, data model, security), or explicitly high-stakes | Deep |

**Coherent-work gate.** A request bundling unrelated goals is split: brainstorm the largest coherent piece, list the rest as separate follow-ups. One invocation = one coherent scope.

## Grounding

Discovery before questions - never ask what the repo can answer.

**Software, Standard/Deep:** dispatch `atlas:explorer` (read-only) per `plugins/atlas/skills/atlas-orchestrate/references/subagent-kit.md`. Required prompt fields: ROLE, GOAL, CONTEXT, TOOLS (starting with one batched `ToolSearch("select:...")`), NON-INTERACTIVE line, TOOLS ALLOWED (read-only), DELIVERABLE, REPORT BACK. Ask it to return, bounded to the feature area: (a) existing patterns/machinery that constrain or enable this feature, (b) conventions that shape the design, (c) adjacent error paths and integration points, (d) prior art found in `docs/`, `.atlas/findings/INDEX.md`, `docs/lessons/`. One explorer dispatch; do not fan out grounding waves.

**Software, Lightweight:** a direct targeted read of 1-2 known files substitutes for the dispatch.

**Compound Packs (conditional, silent):**

```bash
if [ -f "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_packs.py" ]; then
  python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_packs.py" --help   # discover the real CLI; never guess flags
  # then query for rules matching the request's topic using the discovered interface
fi
```

- Cite matched rules everywhere they inform a requirement as `(pack: <id>, <path>)` - in dialogue and in the artifact's Product Contract.
- Script absent -> skip with zero output. Never tell the user packs were unavailable; never invent a pack citation.

## Dialogue rules

Bounded-question discipline mirrors `plugins/atlas/skills/atlas-prompt/SKILL.md` Step 1, tightened to CE's one-question rule:

1. **One blocking question per turn.** AskUserQuestion (or numbered choices where the tool is absent), 2-4 concrete options with your recommended option first, plus "Other" for free text.
2. **Only questions discovery cannot answer.** Repository facts come from grounding, not the user. Before each question, check: could the explorer dispatch, a read, or an existing plan answer this? If yes, answer it yourself and state the finding.
3. **Broad to narrow.** Order: goal/actor ("what outcome counts as success, for whom") -> scope ("what's in bounds, what must not change") -> shape/design forks ("which of these behaviors matters") -> acceptance ("how will we know it works"). Only ask questions whose answer changes the requirements.
4. **No second speculative round.** When a blocking gap no longer exists, STOP questioning. Whatever is still unknown becomes an explicit assumption in the artifact. (Atlas-prompt allows at most one round of up to three questions; brainstorm may take several single-question turns, but each must still be blocking - convenience questions are prohibited.)
5. **Prototype escalation.** A high-cost, irreversible visual/interaction fork gets an explicit `atlas-prototype` offer before the first shape is settled - name it as a question option; never silently decide a visual contract.

**Exit criteria** (all tiers): no unresolved actor/outcome/scope/success gap; every settled decision recorded; remaining unknowns converted to explicit assumptions.
