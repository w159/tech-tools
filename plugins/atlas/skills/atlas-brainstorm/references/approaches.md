# Phase 2: Model elevation and approach synthesis

Ported from CE `ce-brainstorm` `references/approaches.md`, minus CE's concurrent claim verifier (atlas:verifier owns independent claims checking in Phase 4 of the skill).

## Model elevation

Before listing options, state in 1-3 sentences what the user is *actually* trying to achieve - the model behind the request, not the literal request. "Add an export button" elevates to "users need to get their data into the tool their accountant uses." If grounding contradicted the literal request, say so here. This model is what the approaches must satisfy; it goes into the Goal Capsule.

## The 2-3 approaches

Synthesize **2-3 concrete approaches** for satisfying the requirements. Rules:

1. **At least one must be non-obvious** - not a variant of the others. Sources of non-obvious options: a different decomposition of the problem, a deliberate simplification that trades a small capability for large simplicity, an inverted assumption from the dialogue ("maybe this doesn't need to be interactive at all"), or reusing existing machinery the dialogue revealed. Three flavors of the same idea fail this requirement; so does a strawman third option.
2. **Concrete:** each approach names the real surfaces it would touch (at the requirement level - "extend the existing export path in <area>", not "U-01: edit src/x.ts line 42"; file-level precision is atlas-plan's job).
3. **Tradeoffs stated:** each approach gets one line of what it gives up.
4. **Present alternatives BEFORE the recommendation.** State which you recommend and why in one sentence, but let the user see the space first.
5. **Pack citations** carry over: if a Compound Pack rule favors an approach, cite it `(pack: <id>, <path>)`.

## Synthesis confirmation

- **Lightweight:** no confirmation question if no blocking fork remains - write.
- **Standard:** if synthesis left a genuine blocking fork between approaches (not just a preference), that is one final blocking question. Otherwise write.
- **Deep:** always one synthesis-confirmation question: present the approaches and the recommendation, confirm the chosen approach (or a user modification) before writing. Record the choice as a settled decision.

## Session-settled decisions

Every decision the user made in dialogue (tier-relevant scope cuts, the chosen approach, reopened prior decisions) is recorded in the artifact's Product Contract under "Settled decisions" - see `references/plan-sections.md`. These are binding input for `atlas-plan`: the planner must preserve their meaning and flag, not silently change, any conflict.
