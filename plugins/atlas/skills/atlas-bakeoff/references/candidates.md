# Phase 1 — Candidate generation

Two to three genuinely distinct concrete approaches. "Concrete" means the mechanism and its consequential tradeoffs can be assessed from the artifact alone: data flow, ownership boundaries, failure modes, migration path. Directional pseudocode is fine; a name and an adjective is not.

## Distinctness is the product

The value of a bake-off is divergence, not option count. Guard it:

- **Inspect mechanisms, not labels.** Independent attempts may converge. If two "different" candidates share the same underlying mechanism (both are "add a queue", one calls it Kafka and one calls it Redis), treat them as one candidate and note the convergence.
- **One non-obvious option is REQUIRED.** Alongside the conventional answers, deliberately include one approach the caller probably did not consider — the shape that inverts a default assumption (do it client-side instead of server-side; derive instead of store; single process instead of service split; invert the data flow). If the conventional field is exhausted, the non-obvious slot is where a bake-off earns its cost.
- **The one recovery launch.** If a candidate fails, stalls, or all candidates converge, launch at most one recovery candidate. A recovery candidate may target the unexplored dimension (e.g. nobody considered a data-model shape instead of an infrastructure shape) but must NOT see sibling outputs or any preferred answer. Recovery launches count toward the candidate budget, not the judge.
- **Completion bar.** At least two usable independent candidates are required for a completed comparison. A smaller field is incomplete — return `incomplete` with a provisional recommendation clearly labeled, never a forced pick from one option.

## Dispatch: fresh contexts, never forks

Each candidate is developed by a subagent with NO knowledge of the other candidates. Never use a fork (`subagent_type: "fork"`) — a fork inherits the orchestrator's assumptions verbatim, which defeats independence. Dispatch a general-purpose subagent per candidate, launched together in ONE message where capacity permits.

Every dispatch follows the required schema from `plugins/atlas/skills/atlas-orchestrate/references/subagent-kit.md` — GOAL / DELIVERABLE / SUCCESS CRITERIA / OUT OF SCOPE / STOP CONDITIONS, named tools, `REPORT BACK` — shaped like this:

```
ROLE: approach designer for one candidate in a decision bake-off
GOAL: develop ONE concrete approach for: <one-sentence goal from the brief>
CONTEXT: <the full common brief — goal, constraints, hard constraints, the shared criteria list,
  pointers to the relevant code/docs. Do NOT include other candidates, do NOT include a preferred answer.
  State this candidate's assigned seed: <conventional option A | conventional option B | non-obvious slot>.
  The seed is a starting direction the candidate may abandon with stated reasons if the brief
  drives it elsewhere — the seed shapes exploration, it does not force the outcome.>
TOOLS (required - name them, do not say "use the right tools"): [batched ToolSearch line per subagent-kit;
  ctx_compose / ctx_search / ctx_read for codebase grounding; context7 for library docs]
DELIVERABLE: candidate brief with REQUIRED sections, in this order:
  1. Mechanism — how it works end to end: components, data flow, who owns state, failure modes.
  2. Migration path — how the codebase gets from here to there, at sketch fidelity.
  3. Self-assessment against EACH named criterion with the evidence for each score — including the
     criterion the candidate scores WORST on, stated plainly.
  4. Assumptions made that were not in the brief (these belong to this candidate only).
  5. Open questions that only a running system or the user can answer.
SUCCESS CRITERIA: mechanism is concrete enough that its consequential tradeoffs are assessable;
  every criterion scored with evidence; worst criterion honestly named; no production files touched.
OUT OF SCOPE: writing production code - seeing or scoring other candidates - revising the shared criteria
STOP CONDITIONS: the brief is self-contradictory, or the seed is impossible under the hard constraints -
  report that back instead of inventing a requirement.
REPORT BACK: the candidate brief only. SCHEMA: candidate-brief v1
  approach_name: <short name>
  mechanism: <concrete description>
  migration_path: <sketch>
  criterion_scores: [ { criterion, score: pass|strong|adequate|weak|fail, evidence } ]
  assumptions: [ ... ]
  open_questions: [ ... ]
```

Bounded Task calls per the atlas dispatch convention; keep candidate scopes independent so no write sets collide (candidates are read-only over the codebase anyway — they produce briefs, not code).

## Budget discipline

- Default 3 candidates (two conventional seeds + the non-obvious slot); 2 is the floor for a complete comparison; more than 3 needs the caller to explicitly expand the budget.
- Candidates work at brief fidelity, not implementation fidelity. Runtime performance claims are not provable at this stage — identify them as evidence needs for Phase 3 spikes rather than asserting them.
- Each candidate consumes a full subagent context. If the decision is genuinely small, do not run a bake-off (see the gate in SKILL.md).
