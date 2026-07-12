# Validation Gate

The completion gate every atlas-validate run applies. A check is PASS
only when all three gates close with evidence. A check that lacks
evidence is not PASS, even if the code is correct.

The gate exists because "no error" does not mean "correct." A skill
that runs without throwing can still be wrong. The gate forces the
gap between "looks done" and "is done" to close before reporting.

## Gate 1: Execution-evidence artifact

Every PASS must be backed by an artifact that proves the check ran
against the real target, not against memory or assumption.

- For a structural check (file exists, manifest parses, fields are
  present): the artifact is the `file:line` of the field or file
  you read. Quote the value you observed.
- For a content check (frontmatter parses, name matches directory,
  description is in the length range): the artifact is the exact
  string you read and the length you measured.
- For a quality check (ASCII-only, no banned Unicode, no triggers:
  field): the artifact is the command you ran and its output. A
  scan that returned zero hits must show the command and the empty
  result.

A check that claims PASS without quoting the value it observed is a
claim, not evidence. The verifier will refuse it.

## Gate 2: Independent verifier

For non-trivial checks, the result must be confirmed by an
independent pass in a fresh context. The independent verifier:

- Re-opens the cited file at the cited line.
- Re-runs the cited command.
- Re-reads the diff or the artifact.
- Returns an evidence-backed verdict: CONFIRMED or REFUTED.

The verifier never fixes. It only confirms or refutes. If the
verifier refutes a PASS, that check is FAIL, and the report must
say so.

For trivial checks (a file exists at a path), an independent pass
is not required. The execution-evidence artifact (the path itself,
plus an `ls` output) is sufficient. The threshold for "trivial" is:
the check has exactly one possible outcome and exactly one
possible source.

## Gate 3: Docs current

If the check touches documentation (CHANGELOG, README, architecture
docs, AGENTS.md, a spec), the docs must reflect the current state of
the code. A PASS on a code check that contradicts stale docs is a
partial PASS. The gate requires:

- The doc file is current to the last commit that touched the code
  under check.
- The doc claim matches the code behavior at the cited lines.
- If the doc is stale, the check is WARN at minimum, FAIL if the
  staleness could mislead a user or operator.

This gate does not require you to update the docs. It requires you
to flag the drift. Use atlas:docs-auditor to confirm doc currency
when in doubt.

## What counts as PASS, WARN, FAIL

| Result | Condition |
|---|---|
| PASS | All three gates close with evidence. |
| WARN | Gate 1 and 2 close. Gate 3 has drift that does not mislead. |
| FAIL | Any gate is open. Any evidence is missing. Any claim is unverified. |

WARN does not block an overall PASS verdict. FAIL does.

## What this gate is not

- Not a unit test. A unit test proves behavior is correct. The gate
  proves the check was actually run and the result was actually
  observed. Both are needed; neither replaces the other.
- Not a code review. A code review judges quality. The gate judges
  evidence. A check can PASS the gate and still be a bad design.
- Not a rubber stamp. A PASS that says "valid" without citing the
  field, the line, and the observed value is not PASS. It is a
  claim the verifier will reject.

## Report shape

For every check, the report carries:

1. Check name.
2. Result: PASS, WARN, or FAIL.
3. Evidence: the exact `file:line` or path, plus the value observed.
4. For non-trivial checks: the independent verifier's verdict and
   the command it re-ran.

Then the summary:

```
Checks run:   <total>
Passed:       <n>
Warnings:     <n>
Failed:       <n>
Overall:      PASS / FAIL
```

The overall result is PASS only when zero checks are FAIL. WARNs do
not block a PASS.

A report that prints the summary without per-check evidence is
incomplete. The verifier will refuse it.