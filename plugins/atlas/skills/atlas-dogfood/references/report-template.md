# Report template

Create the report at Phase 3 (matrix exists, everything `Pending`) and update it after every scenario and every fix - checkpoint, not a final write. Path: `docs/audits/atlas-dogfood-<branch-slug>-<YYYY-MM-DD>/report.md`. Directory created on demand; the docs-curator reconciles it on its next pass. Evidence lives in `.atlas/evidence/<YYYY-MM-DD>-dogfood-<branch-slug>/` (suffix `-refix-<n>` per re-drive).

```markdown
# Dogfood report - <branch/PR identifier> - <YYYY-MM-DD>

- Target: <PR number | branch | current> (diff base: <ref>)
- Diff: <N> files changed; <one-line summary of what the diff does>
- Dev server: <url or "user-run"> / torn down: <yes/no/none started>
- Verdict: **Ready | Not ready | Incomplete (checkpoint)**
  - Not ready if any scenario is `Blocked` or unexercised. A blocked scenario never silently drops.

## Scenario matrix

| ID | Flow | Input class | State | Fix attempts | Evidence | Notes |
|----|------|-------------|-------|--------------|----------|-------|
| S1 | <user journey> | happy path | Pass | 0 | .atlas/evidence/... | |
| S2 | <user journey> | edge: <what> | Fixed | 1 | ...-refix-1/ | fix F1 |
| S3 | <user journey> | regression neighbor | Blocked (needs human verify) | 0 | | OAuth step |

States: `Pending | Pass | Fixed | Skipped | Blocked (needs human verify) | Blocked (human decision)`.

## Fixes applied

Each fix, one block:
- **F1** - scenario S2. Symptom: <observed break + evidence path>. Diagnosis: <one line, layer>. Fix: <files changed, one line each>. Regression test: <path> (fails pre-fix / passes post-fix: <evidence ref>). Verified by: atlas:verifier (<verdict + evidence>). Re-drive: green (<evidence path>).

## Escalations

- S3 - Blocked (needs human verify): <exactly what a human must do externally>.
- Sx - Blocked (human decision): <why over budget/escalated>.

## Decisions for a human

One block per escalated decision: the observed failure, the diagnosis, 2-3 options with tradeoffs. Nothing here was implemented.

## Not tested / observations

- Skips with reasons; routes adjacent to the diff that were left alone and why.
- Written product expectations matched or contradicted (`<doc path>, <claim>`); contradictions intended by the branch are flagged as decisions about the doc, not fixes.
- Observations worth generalizing -> hand to atlas:docs-curator / compound pipeline.

## Working tree

- Files changed by fixes (uncommitted): <list>. Commit/push awaits explicit user confirmation.
- Findings written: <.atlas/.run/findings.json entry ids>.
```
