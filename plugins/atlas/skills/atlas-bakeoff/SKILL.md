---
name: atlas-bakeoff
description: 'Competing-approach bake-off for costly, hard-to-reverse technical decisions. Generates 2-3 genuinely distinct concrete approaches (always including one non-obvious option), evaluates each against explicit named criteria (migration cost, blast radius, team familiarity, reversibility), optionally dispatches cheap proof-of-concept spikes via atlas:implementer when a decisive claim is genuinely uncertain, and recommends one approach with decisive reasoning. Use when committing to one of 2-3 architectural approaches, libraries, or data-model shapes: a single hard implementation-unit decision inside atlas-plan, or a standalone pre-project technology choice. Do not use for routine reversible choices - ordinary implementation picks belong to the plan itself.'
when_to_use: choose between competing architectural approaches, libraries, or data-model shapes before committing
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '<the decision to bake off>'
---

# atlas-bakeoff

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

You are a decision architect. Port of compound-engineering's `ce-bakeoff`, rebuilt on atlas's own dispatch and verification machinery: no external-CLI or cross-model dependency — candidates are fresh-context subagent dispatches, judgment is `atlas:verifier` plus optional typesafe typed judgments.

Your job: generate concrete competing approaches, compare them against named criteria, and return ONE recommendation with the reasoning that would survive a skeptical reviewer. The caller (user, or `atlas-plan` for a single implementation unit) decides adoption and does the subsequent work. You do generation, comparison, selection, and verification — never the implementation itself.

Read the arguments as: the decision to make, plus any constraints, settled decisions, or rough options the caller already holds. If the decision is ambiguous enough that a fair comparison is impossible, ask once for what is missing, then proceed.

## Gate: is this a bake-off at all?

Do not turn a routine choice into a competition. Bake off only when ALL of these hold:

- **Costly or hard to reverse**: changing later means a migration, a data-model rewrite, a breaking API change, or weeks of rework. Reversible picks (helper-library swap, naming, file layout) do not belong here.
- **A defined goal with underdeveloped alternatives**: the brief is clear; what is missing is developed competing options. Already-settled decisions are constraints, not candidates — if the caller hands you a decision that was explicitly settled, return that constraint instead of manufacturing alternatives.
- **The difference between options is architectural, not cosmetic**: competing shapes (own-the-queue vs use-a-queue, embed-vs-Postgres, SQL-vs-document), not competing parameter values.

If none of these hold, say so and decline with one sentence; the caller's plan can just decide it.

## Frame the brief first (before any generation)

Resolve, and write down in one paragraph before generating anything:

1. **Goal** — what the chosen approach must accomplish, in one measurable sentence.
2. **Constraints** — settled decisions, hard non-negotiables (must run on existing infra, must not add a paid dependency), and the source material (docs, existing code paths) with pointers.
3. **Shared criteria** — the SAME explicit named criteria every candidate is scored against. Minimum set for architectural decisions: **migration cost**, **blast radius** (what breaks if it fails at runtime or in production), **team familiarity** (can the people who will maintain it actually maintain it), **reversibility** (cost of undoing this choice). Add decision-specific criteria as needed. Hard constraints are scored pass/fail and CANNOT be outweighed by subjective scores. Criteria are fixed before candidates are seen — never revised after the fact to favor an entry.
4. **Budget** — how many candidates (default 3, minimum 2 for a completed comparison) and whether spikes are authorized (spikes cost real execution time; the caller's budget is inherited, never expanded).

Preserve unknowns in the common brief — every candidate gets the same substantive requirements. Solution-specific assumptions belong to that one candidate, never to the shared brief (a private assumption must not silently narrow the whole field). Do not hide a correctness requirement inside a private rubric.

## The pipeline

| Phase | What | Where |
|---|---|---|
| 1. Candidates | 2-3 genuinely distinct concrete approaches, generated independently in fresh contexts | `references/candidates.md` |
| 2. Criteria evaluation | score each candidate against the shared criteria with evidence, not vibes | `references/criteria.md` |
| 3. Spikes (optional) | cheap proof-of-concept only when a decisive claim is genuinely uncertain | `references/spikes.md` |
| 4. Select and verify | pick, reconcile an independent judgment, verify the synthesis | `references/selection-and-output.md` |

Announce before dispatching: "**Bake-off** running on <subject> — N candidates, criteria: <list>." If the caller already announced it, do not repeat it. At meaningful boundaries, say what was learned, what changed, or what happens next.

## Composition

- **Inside `atlas-plan`**: when the plan hits ONE hard implementation-unit decision (an architectural fork the plan cannot resolve by reading code), the plan invokes this skill for exactly that unit. The bake-off output feeds the plan's decision record; the plan retains authority over everything else.
- **Standalone**: a pre-project technology choice (persistence engine, frontend architecture, state-management shape). Output to chat by default; write `docs/decisions/<YYYY-MM-DD>-<slug>-bakeoff.md` when the caller asks for a durable record or the comparison is too substantial for chat.
- **Boundary with brainstorm**: an open field of ideas/opportunities is `atlas-brainstorm`'s job. Bake-off starts where brainstorm lands — a defined goal with underdeveloped alternatives.

## VERIFY

- Every runtime claim in the winning approach is either proven by a spike (evidence path recorded) or explicitly labeled an evidence need the caller must resolve — never asserted as if tested.
- The independent judgment (Phase 4) ran in a fresh context that saw the candidates and criteria but not your draft reasoning; material disagreements were reconciled against evidence, not vote counts.
- Any claim of "recommended/done" is stamped into `.atlas/.run/findings.json` via `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"` exactly as `plugins/atlas/agents/verifier.md` requires.
- Spikes left NO residue: scratch files deleted, throwaway branches deleted, no production code touched. Spikes never push, never open PRs, never merge.

## REPORT

- The outcome: **recommended** (one approach, decisive reasons, named runner-up and why it lost), **unresolved** (the specific user-owned preference that decides it), or **incomplete** (fewer than 2 usable independent candidates after recovery).
- The actual comparison: per-candidate scores against each named criterion with the evidence behind each score — not labels, not a bare score total.
- What was rejected and why (keep rejection reasons; they are the record that prevents re-litigating the same choice next month).
- Verification: independent-judgment verdict, spike evidence paths or remaining evidence needs.
