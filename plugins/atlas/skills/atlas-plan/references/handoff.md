# Phase 4: Mandatory review, verification, handoff

Ported from CE `ce-plan/references/final-review.md` + `plan-handoff.md`, with CE's mandatory `ce-doc-review` replaced by `atlas:completeness-critic` and CE's `ce-work` handoff replaced by `atlas-orchestrate`.

## 1. Mandatory review gate - atlas:completeness-critic

**This dispatch is not skippable.** CE gated every plan behind `ce-doc-review mode:non-interactive <plan-path>`; atlas's equivalent pre-done gap hunter is `atlas:completeness-critic`. A plan handed off without this review is invalid - not "weaker", invalid.

Dispatch (subagent-kit shape, fork per `subagent-kit.md` when `CLAUDE_CODE_FORK_SUBAGENT=1` - the critic judges gaps against everything this session established, which is the point):

```
ROLE: pre-done gap critic over an implementation-ready plan
GOAL: find every gap in <plan-path> before it is used as an execution contract
CONTEXT: <plan path>; upstream brainstorm path; the R-### / D-### / A-### IDs it carries;
  the research citations it claims (lessons, findings, pack rules); depth tier
TOOLS (required - name them, do not say "use the right tools"):
  ToolSearch first, ONE batched call, before any Read/Grep/Bash - paste it verbatim from
  ${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md
TOOLS ALLOWED: Read, Glob, Grep, Bash (read-only commands)
TOOLS FORBIDDEN: Write, Edit, package installs, git push
DELIVERABLE: blocking gaps vs advisory gaps, each with file:line or plan-line evidence
SUCCESS CRITERIA:
  - every R-### traces to at least one U<N> (or an explicit deferred question)
  - every U<N> has all eight fields with no placeholder/TBD/`...`
  - every Verification field is executable by an agent that was not in this session
  - every test scenario is failable and named to a real or plausible test home
  - every citation in the plan resolves to a real file (lessons, findings, pack paths, repo paths)
  - every deferred question has default + owner + latest safe moment
  - the Verification Contract's command set is plausible for this repo (the commands exist)
OUT OF SCOPE: judging requirement wisdom (that was brainstorm's), rewriting anything
STOP CONDITIONS: plan file unreadable or missing sections -> report immediately
REPORT BACK: SCHEMA subagent-report v1, with `verdict: pass | gaps-found` and each gap as
  { claim, evidence, severity: blocking|advisory }
```

**Gap routing:** blocking gaps route back into the plan (Phase 2 for structure gaps, Phase 3 for composition gaps), then re-run the critic **only over the changed sections** - no full re-review loop. Advisory gaps are recorded in the plan's Appendix or fixed when trivial. Recurring unfixable gaps mean the plan is blocked: say so and return, never hand off a plan with known blocking gaps.

## 2. Verification - atlas:verifier

Dispatch `atlas:verifier` (read-only, subagent-kit shape, **never forked** - law 5 independence) to adversarially check the written artifact against repo facts: each grounded claim traces to a real file or pattern, unit Files lists exist, the Verification Contract's commands exist in this repo, citations resolve. It stamps its verdict (PASS/FAIL + evidence) into `.atlas/.run/findings.json` per the atlas verifier contract. A FAIL routes back to the failing Ready check.

**Lightweight exception:** a Lightweight-tier plan with zero external claims (no pack citations, no lesson/finding citations beyond trivial reads) may run the Ready checks themselves as verification - state this choice in the report.

## 3. Ready-to-hand-off gate

All of the following, confirmed before any handoff message:

1. The written plan passes the four Ready checks (Complete, Consistent, Executable, Usable).
2. The completeness-critic verdict is `pass` (or every blocking gap is fixed and re-checked).
3. Verification is recorded (verifier verdict in findings.json, or the stated Lightweight exception).
4. No blocking question is left unasked - deferred questions all have defaults; irreversible forks were settled with the user or the plan is marked blocked.

## 4. Handoff

**Interactive - exactly one recommendation, not a menu sprawl:**

- **`atlas-orchestrate`** - it consumes this plan and executes it: stage map over the `U<N>` IDs, implementer dispatches carrying each unit's evidence strategy, independent verification, evidence receipts, docs-current closeout. There is no `atlas-work` skill and never will be - that concept was folded into `atlas-orchestrate/references/implementation-units.md`; never offer or create one.
- Offer **`atlas-prototype`** explicitly first, when a visual/interaction fork was deferred (`Q-###` with a UI surface) - settle the shape before executing units that depend on it.
- Offer **`atlas-bakeoff`** explicitly first, when a costly open technical fork was deferred - resolve it before, or as, the first execution step.

**Noninteractive / return-to-caller** - return exactly:

```json
{
  "status": "complete" | "blocked",
  "artifact_path": "docs/plans/<YYYY-MM-DD>-<slug>-plan.md",
  "unit_count": <N>,
  "requirements_covered": "<all R-### ids or the explicit gap>",
  "question_counts": { "resolved": <N>, "deferred": <N> },
  "deferred_questions": ["Q-001: <question> (default: ...)"],
  "review_verdict": "pass" | "gaps-found: <n blocking, n advisory>",
  "recommended_next": "atlas-orchestrate" | "atlas-prototype" | "atlas-bakeoff"
}
```

## Boundary reminder

atlas-plan ends at the artifact. It never executes units, never runs the Verification Contract itself, never commits, never pushes, never opens a PR. Execution belongs to `atlas-orchestrate`; git actions require explicit user confirmation there and are impossible here.
