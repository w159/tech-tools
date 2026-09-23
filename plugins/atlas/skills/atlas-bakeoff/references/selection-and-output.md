# Phase 4 — Selection, independent judgment, output

## Select

Read every completed candidate brief in full before selecting. Then:

1. **Eliminate on hard constraints.** Any `fail` on a pass/fail criterion eliminates the candidate — subjective strength cannot outweigh it.
2. **Score against the shared criteria.** Head-to-head on the discriminating criteria (the ones that actually differ between candidates). Weight by what the decision is FOR — a data-model choice should weigh reversibility and blast radius more heavily than ramp time on a team that owns it for years.
3. **Select the strongest viable base** and state the decisive reasons in one paragraph. Reasons must be criterion-anchored ("B because reversibility: A locks the data into a shape a later vendor change cannot unwind, evidenced by X"), never vibes ("B feels more robust").
4. **Synthesize, carefully.** Incorporate a useful mechanism from a losing candidate only where the result stays coherent — a hybrid that quietly re-imports the loser's costs is worse than a clean win. Record what was incorporated and its origin; keep the material rejection reasons.

Agreement between candidates is not proof; difference alone is not a reason to restart. Convergence on a mechanism is evidence the field found the natural answer — record it as such.

## Independent judgment (required before declaring a winner)

Before finalizing, obtain an independent assessment in a context that has NOT seen your draft reasoning. Dispatch `atlas:verifier` (fresh context, never a fork) with the brief, all candidate briefs, the criteria, and your proposed recommendation, and ask it to adversarially attack the selection per `plugins/atlas/skills/atlas-orchestrate/references/verification-and-grounding.md`:

```
ROLE: adversarial decision verifier
GOAL: try to REFUTE the proposed bake-off recommendation: <name> over <alternatives>
CONTEXT: the decision brief, all candidate briefs, the criteria and hard constraints, and the
  recommendation's stated reasons. Your job is to find the flaw: a criterion scored without evidence,
  a hard constraint smuggled in as subjective, a runtime claim asserted without a spike, an eliminated
  candidate that should not have been, a synthesis that re-imports the loser's costs.
TOOLS: [batched ToolSearch line per subagent-kit; read-only tools]
DELIVERABLE: verdict report.
SUCCESS CRITERIA: every material objection cites the specific criterion/brief line it attacks.
OUT OF SCOPE: rewriting the recommendation yourself - producing a competing recommendation.
STOP CONDITIONS: cannot assess without information absent from the provided material - say so.
REPORT BACK: verdict + objections. SCHEMA: bakeoff-verify v1
  verdict: confirmed|refuted|needs-evidence
  objections: [ { target: <criterion or claim>, objection, evidence } ]
  evidence_gaps: [ ... ]
```

While the verifier runs, perform your own comparison (do not idle). Reconcile material disagreements against evidence, not vote counts. If the verifier returns `refuted`, address the objection in the selection before reporting — or, if the objection is unanswerable, return `unresolved` with the objection stated. Without a completed independent assessment, return the recommendation explicitly labeled provisional/incomplete.

Optional supplementary signal: run the `${CLAUDE_PLUGIN_ROOT}/references/jev-decisions.md` decision questions (simplicity / reversibility exposure of the proposed choice) via the typesafe connector, batched, as a second lens — same rule: it never overrides evidence, disagreement is a flag to investigate.

Stamp the outcome: `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"` writing the decision (selected approach, decisive reason, verifier verdict) into `.atlas/.run/findings.json` per `plugins/atlas/agents/verifier.md`.

## Output

### Chat (default)

Deliver in chat: outcome (recommended / unresolved / incomplete), the winning mechanism in brief, the comparison table (criteria × candidates with evidence one-liners), decisive rationale, runner-up and why it lost, spike evidence paths or remaining evidence needs. The full per-candidate detail stays in the response only if compact; otherwise summarize and note the durable location.

### Durable record

Write `docs/decisions/<YYYY-MM-DD>-<slug>-bakeoff.md` when the caller asks for a retained document or the comparison is too substantial for chat. Naming follows the docs SSOT date-first convention (validated by `lint_docs_names.py` — `<YYYY-MM-DD>-<slug>-bakeoff.md` satisfies it). Structure:

```markdown
# Bake-off: <decision>

Date: <YYYY-MM-DD> · Status: <recommended|unresolved|incomplete> · Decides: <ADR if this becomes one>

## Brief
<goal, constraints, hard constraints, criteria as fixed before generation>

## Candidates
### <A: name>
mechanism · migration path · criterion table (score + evidence per criterion)
### <B: name>
... (one section per candidate; converged candidates noted)

## Comparison
head-to-head on the discriminating criteria

## Recommendation
selected approach · decisive reasons · incorporated contributions and origins · material rejections
(independent-judgment verdict + spike evidence paths under .atlas/evidence/)

## Evidence needs
<what only running in production / the user can settle>
```

The orchestrator's write boundaries still apply: when `atlas:docs-curator` is available, hand the durable file to it rather than writing `docs/` directly.

### Unresolved and incomplete outcomes

- **Unresolved**: the deciding factor is a user-owned preference (cost ceiling, taste, org politics). Name the specific dependency and the two options it sits between — never invent a winner to avoid the question.
- **Incomplete**: fewer than two usable independent candidates after the recovery launch. Report what completed, the recovery attempt, and what a rerun needs.

### Composition contracts

- **Called from `atlas-plan`**: return the outcome + comparison + decisive rationale without a menu or downstream action; the plan incorporates it into its decision record and retains authority over implementation and its own approval gates.
- **Cleanup before returning**: spikes' residue removed per `references/spikes.md`; scratch deleted; the complete result accessible to its consumer first.
