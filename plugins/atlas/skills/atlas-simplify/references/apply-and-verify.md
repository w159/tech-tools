# Apply and Verify — triage, mutation boundary, gate

The rules that turn three reviewers' findings into a behavior-preserving applied pass.
The SKILL.md summarizes these; this file is authoritative.

## Finding acceptance (triage)

Proceed only after all three review outcomes are complete. Sort every finding into
**apply** or **skipped**; record false positives and low-value findings as skipped
without asking the user.

Apply a finding only when ALL of these hold:

- **Behavior-preserving and provable.** The fix preserves outputs, errors, side
  effects, and ordering. If that cannot be established from the code and its tests,
  skip it.
- **Worthwhile.** It removes real duplication, waste, or confusion — not a lateral
  style move. Fewer lines is not the goal.
- **Within the mutation boundary** (below).
- **Not a safety-check removal.** Trust-boundary validation, data-loss protection,
  security checks, and accessibility affordances are never thinned or removed. A
  finding with a `protected_subject` gets a second look for exactly this before
  acceptance.
- **Confidence 75/100** (50 is acceptable only when you can personally verify the
  equivalence in seconds, e.g. an obvious unused import).

## Mutation boundary

- Inspect beyond the resolved scope when needed to evaluate a finding, but **edit only
  the scope and the import/export lines it needs**.
- For a user-named file or directory scope, those import/export lines must also be
  inside it; skip any fix that would edit outside the mutation boundary.

## Compatibility scaffolding (unshipped scope only)

An interface or data shape that existed only in an earlier iteration of the current
unshipped scope is not protected behavior once you verify it has no deployed,
persisted, public, external, dependent-branch, or in-repo caller outside the resolved
scope. Remove that compatibility path only when every required caller update fits the
existing mutation boundary; otherwise preserve it. If uncertain, skip.

## Session-settled structure pins

A plan artifact passed with the scope (`docs/plans/<date>-<slug>.md` or a caller-named
plan) is context, not scope. Preserve its settled decisions — including deliberate
duplication or deliberate separation — exactly as written. A reviewer finding that
undoes a settled decision is skipped by definition.

## Applying via atlas:implementer

Group accepted findings by file and dispatch `atlas:implementer` per the subagent-kit
spec (GOAL / CONTEXT / TOOLS / DELIVERABLE / SUCCESS CRITERIA / OUT OF SCOPE / STOP
CONDITIONS). One dispatch per independent file group; all groups in ONE message when
independent; `isolation: "worktree"` when groups touch overlapping files. Give each
implementer the exact findings for its files (location, evidence, fix, autofix class)
— findings do the specifying, the implementer does the editing. The implementer runs
the local gate for its own change; that is NOT the final gate — Step 5's verifier owns
that.

## The gate (blast-radius verification)

Exactly like `atlas-refactor`'s VERIFY phase, run the project's real gate:

1. **Project-wide typecheck and lint**, whatever the repo configures (tsc, mypy,
   ruff, eslint, ...). Not just changed files — the point is blast radius.
2. **Tests matched to blast radius**: scoped tests for local changes, broader tests
   for shared or wide-reach changes, and the full suite when the runner cannot scope
   tests.
3. **No gate configured?** State that explicitly in the summary. Never silently skip
   verification.

On failure: fix the simplification-caused failure or revert the responsible change.
**Never relax assertions, weaken types, or skip tests to make a simplification pass.**

## Verifying via atlas:verifier

After the implementer wave lands, dispatch `atlas:verifier` in a FRESH context (never
a fork; independence law) to adversarially confirm the pass:

- re-reads the final diff against the accepted findings and confirms each applied fix
  is behavior-preserving (outputs, errors, side effects, ordering);
- re-runs the gate itself and compares against the implementer's claimed output;
- tries to refute, not confirm; defaults to `needs-evidence` when uncertain;
- stamps `.atlas/.run/findings.json` as its last action:

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" \
  --id simplify-<YYYY-MM-DD>-<slug> \
  --status verified|rejected|needs-evidence \
  --title "<one line: what was simplified and the gate result>" \
  --evidence "<gate command + output path or file:line>" \
  --reproduction "<the exact gate command>"
```

A `rejected` or `needs-evidence` verdict sends the responsible finding back to a fresh
implementer (fix) or reverts it; then re-verify. Re-read findings.json after the
verifier returns and re-dispatch if the verdict row is absent or truncated.

Persist the merged findings ledger (accepted + skipped, with reasons) to
`.atlas/evidence/simplify/<YYYY-MM-DD>-<slug>/findings.json` — evidence, not source of
truth; `.atlas/.run/findings.json` stays the verification ledger.

## Report format

Report what was already sound and what improved, then:

```
Applied:  reuse=<n>  quality=<n>  efficiency=<n>  (total=<n>)
Skipped:  <n>  (false positives, low-value, out-of-boundary, settled pins)
Gate:     typecheck <cmd/result> - lint <cmd/result> - tests <cmd/result, scope>
Verifier: <verdict + findings.json row id>
```

Net lines removed is never the success metric. If nothing changed, say so.
