# Phase 2 — Criteria evaluation

Score every candidate against the SAME named criteria, with evidence attached to every score. This phase turns "I like B" into "B wins on blast radius and reversibility; A wins on familiarity, and the familiarity gap costs two weeks of ramp."

## Scoring scale

Use one scale across all candidates and criteria:

| Score | Meaning |
|---|---|
| `pass` / `fail` | hard-constraint criteria only — these are binary and a `fail` is disqualifying regardless of everything else |
| `strong` | clearly better than the field on this criterion, with evidence |
| `adequate` | meets the requirement, no decisive advantage |
| `weak` | a real cost the decision must absorb |
| `unverified` | the claim cannot be assessed without running something — becomes a spike candidate (Phase 3) or an explicit evidence need |

## The minimum criteria set (architectural decisions)

1. **Migration cost** — engineering time, coordination, and downtime to get from the current state to this approach. Evidence: the modules touched, the data that must move, the cutover shape.
2. **Blast radius** — what breaks if this approach fails: runtime failure modes, production-incident shape, coupling to other subsystems. Evidence: named failure modes and what they take down.
3. **Team familiarity** — can the people who will maintain it actually maintain it? Evidence: existing codebase usage, the team's demonstrable experience, the learning curve's steepness for THIS codebase's conventions.
4. **Reversibility** — cost of undoing the choice. Evidence: what is locked in (data shape, external API surface, vendor contracts, infrastructure) after 3 months of building on it.

Add decision-specific criteria when they carry real weight — e.g. operational burden (who is paged), performance envelope, vendor lock-in, compliance surface. Every criterion is named BEFORE candidates are read (Phase Frame) and never added or re-weighted after the candidates are seen. A criterion that turns out to not discriminate between candidates is fine — record that it did not discriminate.

## Evidence discipline

- Ground each score in something actually read: `file:line` of the affected code, a doc section, a library's documented constraint, a spike result. A score with no citation is `unverified`, and unverified beats wrong — do not launder a guess into `adequate`.
- Cross-check library claims against current docs (context7 for library APIs, microsoft-docs for Azure/.NET) rather than training-data memory. A "known limitation" that was fixed two major versions ago is a comparison error.
- Divergence between a candidate's own self-assessment and the orchestrator's reading is normal and informative — record material disagreements; they are exactly what Phase 4's independent judgment should probe.

## Comparison artifact

Keep the working comparison in one place per run:

- Standalone + chat output: hold it in the response; it is the deliverable.
- Durable output (`docs/decisions/<YYYY-MM-DD>-<slug>-bakeoff.md`): one section per candidate with the full criterion table, then the head-to-head summary.

Hard-constraint `fail` anywhere eliminates the candidate immediately — record it, do not continue scoring it on softer criteria as if it were still alive.
