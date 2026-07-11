---
id: doc-reconcile
name: Doc reconcile
category: docs
cadence: self-paced
inputs:
  - doc_targets: which docs to reconcile (ROADMAP.md, CHANGELOG.md, docs/ subfolders, README)
  - change_set: what landed since the last reconcile (a diff range, a list of merged PRs)
  - drift_definition: what counts as drift (a doc claim no code supports, or a change no doc records)
  - done_definition: every doc target current against the change set
---

# doc-reconcile

Walk the docs back into sync with the code after work landed. Each iteration picks one doc target, diffs its claims against the actual `change_set`, and fixes the drift. Self-paced because you advance target by target until the tree is current. In a monorepo the propagation rule means a single change can touch many doc layers - reconcile all of them.

## Steps

1. **Inventory drift.** For each `doc_target`, list claims the code no longer supports and changes the doc fails to record. Cite `file:line` on both sides.
2. **Pick one target.** Take the highest-impact drifted doc (usually CHANGELOG, then ROADMAP, then architecture/feature docs).
3. **Reconcile.** Update that doc so every claim traces to a real file or commit. Add CHANGELOG entries for landed work; move completed ROADMAP items; refresh stale architecture notes.
4. **Verify the fix.** Re-diff the updated doc against the code. Confirm no remaining drift in that target. Per atlas-metis law 5, run this drift check as an independent re-diff in a fresh context (dispatch `atlas:docs-auditor` or `atlas:verifier`) rather than the agent that wrote the doc self-attesting that it is now current.
5. **Advance (self-pace).** If drifted targets remain, go to step 2. When all are current, stop and summarize what was reconciled.

## Stop condition

Every `doc_target` is current against `change_set` with no remaining drift (`done_definition`).

## Template (self-paced /loop)

```
/loop Pick the next drifted doc in <doc_targets>. Diff its claims against <change_set>, then update it so every claim traces to a real file or commit (CHANGELOG entries for landed work, completed ROADMAP items moved, stale architecture notes refreshed). Re-diff to confirm no remaining drift in that target. If drifted targets remain, continue; when all are current, stop and summarize.
```

Omit the interval to self-pace. In an atlas session, durable docs/ writes go to `atlas:docs-curator` and the drift check to `atlas:docs-auditor`.
