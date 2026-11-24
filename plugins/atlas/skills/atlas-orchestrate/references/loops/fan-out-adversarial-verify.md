---
id: fan-out-adversarial-verify
name: Fan-out adversarial verify
category: review
cadence: fan-out
inputs:
  - artifact: what is under review (a diff, a PR, a doc, a design, a finding set)
  - lenses: the independent review angles (correctness, security, performance, naming, tests)
  - refute_bar: what evidence a verifier needs to confirm or reject a finding
  - severity_scale: how findings are ranked (e.g. blocker / major / minor)
---

# fan-out-adversarial-verify

Review breadth-first in parallel, then trust nothing until a separate agent has tried to refute it. One reviewer per lens runs concurrently; their findings are pooled; then an adversarial verifier re-derives each finding from scratch and votes confirm or reject. The author never grades its own finding, and you never rubber-stamp it.

## Steps

1. **Split into lenses.** Turn `lenses` into N independent review jobs over the same `artifact`. Each lens is one subagent with its own narrow brief.
2. **Fan out (one message).** Dispatch all lens reviewers concurrently (~4-6 in flight). Each returns a short grounded list: finding, `file:line` evidence, proposed severity, and the lens it came from. No fixes.
3. **Pool and dedupe.** Merge the lists; collapse duplicates that different lenses surfaced.
4. **Adversarial verify pass.** Dispatch `atlas:verifier` agents in a fresh context, one per finding (or batched). Give each the artifact and the symptom, never the reviewer's conclusion. It re-derives its own check and votes confirm or reject against `refute_bar`.
5. **Synthesize.** Keep only confirmed findings, ranked by `severity_scale`. Report rejected ones separately with the refutation so they are not re-raised. Repeat the wave only if new artifact arrived.

## Stop condition

Every pooled finding has a confirm/reject verdict from a separate verifier, and no lens has unreviewed scope left.

## Workflow shape (fan-out)

```
Wave 1 - reviewers (single message, parallel):
  Agent(atlas:explorer | code-reviewer): review <artifact> through the <lens[i]> lens only.
    Return: [{finding, file:line, severity, lens}]. Find and report; do not fix.
  ... one per lens ...

Wave 2 - adversarial verify (single message, parallel, fresh context):
  Agent(atlas:verifier): here is <artifact> and the user-visible symptom. Derive your OWN
    check for this finding and vote confirm|reject against <refute_bar>. Never trust the
    reviewer's wording.

Synthesize: confirmed findings ranked by <severity_scale>; rejected findings listed with refutation.
```
