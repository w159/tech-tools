# Debug Workflow

The deterministic loop every atlas-debug run follows. Five stages,
each with a gate that must close before the next opens. No stage is
skipped because the symptom "looks obvious." Obvious symptoms hide
the actual cause more often than they reveal it.

## Stage 1: Reproduce (RED)

Goal: observe the failure with your own eyes, in this environment, on
this commit.

- Run the exact reproduction command. Capture the full output, not the
  first line.
- If the failure is environment-dependent (only in CI, only at 3am,
  only under load), name the condition that triggers it.
- If you cannot reproduce here, state the exact command, the
  environment it requires, and the expected failing output. Do not
  move to stage 2 against a failure you have not observed.

Gate: a captured RED output that matches the reported symptom. Quote
it verbatim in the report.

## Stage 2: Localize to a layer

Goal: name the single layer where the cause lives, before reading code
at random.

Layers, in order of probability and cost to inspect:

1. Input boundary: the data entering the system is malformed, missing,
   or violates an unstated assumption.
2. Configuration: an env var, feature flag, or runtime config is wrong,
   absent, or stale.
3. Integration: a dependency returned an unexpected shape, status, or
   timing. Check its docs via Context7 or Microsoft Learn before
   assuming.
4. Business logic: a condition, arithmetic, or state transition is
   wrong in code you own.
5. Concurrency: a race, deadlock, or ordering assumption broke under
   real scheduling.
6. Resource: disk, memory, file descriptor, or connection pool
   exhausted.

For each layer, name the file and line that owns the decision. Use
symbol-level navigation (find_symbol, find_referencing_symbols) rather
than re-reading whole files.

Gate: one sentence naming the root cause and the file:line that owns
it. If you cannot write that sentence, you have not localized yet.

## Stage 3: Fix the cause in place

Goal: change the code that produced the failure, not the code that
observes it.

- Fix the owning layer from stage 2. Do not add a guard one layer up
  to mask the cause.
- If the real fix is out of scope (a dependency bug, a config you
  cannot touch), say which part is out of scope, why, and what the
  minimal in-scope mitigation is. Mark the workaround as a workaround.
- Prefer the smallest diff that changes behavior. A debug fix is not
  a refactor.
- If the cause is in a library, confirm the expected behavior against
  its docs (Context7, Microsoft Learn) before coding around it.

Gate: a diff that touches the owning layer, plus a one-line rationale
for why this change fixes the cause.

## Stage 4: Verify (GREEN)

Goal: prove the symptom is gone with the same command that showed RED.

- Run the reproduction command from stage 1 again. Capture the output.
- Prove GREEN with that output. "It should work now" is not proof.
- If the output is not GREEN, you have not fixed the cause. Return to
  stage 2.

Gate: captured GREEN output from the same command that produced RED.

## Stage 5: Negative case

Goal: confirm the fix did not break an adjacent error path.

- Exercise one adjacent failure mode: bad input, missing file, failed
  auth, empty result, or network error. Pick the one closest to the
  fix.
- Capture its output. Confirm it still behaves correctly (errors
  loudly, does not crash silently, does not return wrong data).

Gate: captured output from the adjacent path showing correct error
behavior.

## What this workflow is not

- Not a patch-over. A patch-over suppresses the symptom at a different
  layer than the cause. This workflow fixes the owning layer.
- Not a bisection. Bisection finds the commit that introduced the bug;
  this workflow finds the code that causes it. Use git bisection only
  when stage 2 cannot localize.
- Not a single-shot. If GREEN fails or the negative case breaks, you
  re-enter at stage 2, not stage 3.

## Report shape

Every atlas-debug report carries all five gates:

1. RED: the command and its failing output, verbatim.
2. Cause: one sentence, file:line.
3. Fix: the diff and the one-line rationale.
4. GREEN: the same command and its passing output, verbatim.
5. Negative: the adjacent path command and its output.

A report missing any gate is incomplete. The verifier will refuse it.