# Finding format and durable doc template (extensive path)

Output file: `docs/features/<YYYY-MM-DD>-feedback-analysis-<slug>.md`

The slug is derived from the feedback topic: lowercase, every character outside `a-z 0-9 . _ -` replaced by `-`, repeated `-` collapsed, leading/trailing `-` and `.` trimmed (docs-SSOT filesystem-safe rule - a colon in the filename blocks Windows checkouts).

## Per-finding entry

```markdown
### F1. <Short title naming the broken behavior or request>

- **Tags:** PainPoint (primary), Sentiment (secondary)
- **Severity:** P1
- **Confidence:** High - quote corroborated by the persisted spinner in frame 0412
- **Observed:** <What happened, grounded in a verbatim quote + anchor and/or frame>
- **Expected:** <What the user appeared to expect, or the product behavior that resolves it>
- **Evidence:** "verbatim redacted quote" (00:14:32); frame 0412 under .atlas/evidence/<date>-<slug>/
- **Source mapping:** likely surface - `src/web/export.ts:88` (request never awaited). Confidence: Medium. | unknown
- **Requirement candidates:** R1
```

Every field is mandatory; write `unknown` or `none` rather than omitting a field. Number findings `F1..Fn` contiguously and keep the numbering stable across edits - downstream planning references them.

## Requirements kickoff section

After the findings, convert evidence into requirement candidates with stable ids:

```markdown
## Requirements Kickoff

### Observed product behavior
- R1. <Concrete product behavior requirement, phrased as behavior not implementation>

### Feedback evidence and reviewability
- R2. <Requirement about making the issue observable or preventing recurrence,
       e.g. a visible error surface where one silently failed>

### Acceptance examples
- AE1. **Covers R1.** Given <state>, when <action>, <outcome>.

### Outstanding questions

#### Resolve before planning
- <Product questions that block planning only>

#### Deferred to planning
- [Technical] <Questions better answered during codebase exploration>

### Next steps
-> Hand the kickoff to `atlas-brainstorm` (or `atlas-prompt` / `make-plan`) with this
   document as the evidence manifest. The callee owns confirmation and prioritization.
```

Requirements describe product behavior, never implementation details; implementation hints live in the `Source mapping` fields only.

## Document skeleton

```markdown
---
date: YYYY-MM-DD
source: <artifact path or description; atlas-sweep run id if applicable>
---

# Feedback Analysis: <Topic>

## Provenance

<Where the feedback came from, who produced it (role, not name), artifact length,
how it was routed (quick vs extensive), and what was redacted. Raw/unsanitized
material lives at .atlas/evidence/<YYYY-MM-DD>-<slug>/ (local-only).>

## Summary

<3-6 sentences: who the users are, what they were trying to do, the dominant pain,
the dominant sentiment.>

## Findings

<PainPoint entries first (severity-ordered), then FeatureRequest, then
UsabilityFriction, then Sentiment. Every finding uses the per-finding entry above.>

## Requirements Kickoff

<As above.>

## Verification

<Verifier verdict: N of N quotes confirmed verbatim against the source artifact;
what was downgraded to inference or dropped and why; findings.json entry id.>
```

## Handoff

The durable doc is the evidence manifest for the next stage. Do not duplicate its content into the handoff message - name the file and the finding/requirement id ranges. If the user wants to skip brainstorm, the doc still stands alone as the project's record of this feedback.
