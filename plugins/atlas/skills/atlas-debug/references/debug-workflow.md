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

### Ranked competing hypotheses

Before naming the root cause, write a ranked hypothesis list, not a
first guess. It must contain at least one genuinely competing
explanation for the same symptom besides the leading hypothesis, and
state why it ranks lower. A single-candidate list anchors on the first
plausible idea; writing the ranking down before any probe runs is the
cheapest moment to catch that. Each hypothesis states:

- What is wrong and where (file:line).
- At least one concrete observation that supports it: a runtime value,
  a log line, an instrumented boundary capture, a behavior delta
  against a working comparison case, or a specific code reference.
  "X seems off" is not evidence; "X is null at line 42 because Y was
  never initialized in the constructor path that runs under condition
  Z" is. An ungrounded hypothesis is theorizing — go back and
  instrument.
- The causal chain from trigger to symptom, step by step, with no
  gaps.
- For any uncertain link, a testable PREDICTION: something in a
  different code path or scenario that must also be true if the chain
  is correct. Verify the prediction before committing to the cause.

Test the top-ranked hypothesis first. Before forming a new hypothesis,
review what has already been ruled out and why.

### Escalation after exhausted hypotheses

After 2-3 hypotheses are exhausted without confirmation, stop guessing.
Diagnose why they failed and present that diagnosis to the user before
proceeding — a fourth blind hypothesis costs more than the pause:

| Pattern | Diagnosis | Next move |
|---------|-----------|-----------|
| Hypotheses point to different subsystems | Architecture/design problem, not a localized bug | Present findings; route to planning (`atlas-orchestrate` / make-plan), not more debugging |
| Evidence contradicts itself | Wrong mental model of the code | Step back; re-read the code path without assumptions |
| Works locally, fails in CI/prod | Environment problem | Focus on env differences, config, dependencies, timing |
| Fix works but the prediction was wrong | Symptom fix, not root cause | The real cause is still active; keep investigating |

Gate: one sentence naming the root cause and the file:line that owns
it, backed by the ranked competing hypotheses above. If you cannot
write that sentence, you have not localized yet.

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

### Red for the right reason

Before trusting any fix, confirm the RED instrument is red for the
targeted defect, not for an unrelated setup error. If a regression
test exists or was written for this bug, run it now and read the
failure message: it must point at the root cause — the missing init,
the wrong branch, the bad coercion — not at a missing fixture, a stale
build artifact, a wrong interpreter, or an import error. A test that
is red for the wrong reason proves nothing when it turns green. With
no regression test, the stage 1 reproduction command is the
instrument: its captured failure output must match the defect's
signature, not merely error somewhere nearby.

### What a failed fix means

If a fix does not turn the stage 1 reproduction GREEN, return to stage
2 and **explicitly invalidate the current hypothesis** before forming
a new one. State in writing the evidence that ruled it out, then form
a new hypothesis with its own grounding observation and prediction.
Do not retry variants of the same theory ("maybe it was the other
branch", "let me also catch this case"); that is a rationalization
spiral, not iteration.

**Three failed fixes = escalate.** After three fix attempts fail, the
root-cause identification was likely wrong. Stop patching. Diagnose
the failure pattern using stage 2's escalation table, present that
diagnosis to the user, and re-diagnose from stage 2 with a genuinely
new hypothesis. Never attempt a fourth patch blind.

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

## Optional: Defense-in-depth pass (conditional — NOT applied by default)

This pass is optional and conditional. It applies ONLY when one of
these triggers fires:

- The bug has recurred 3+ times (grep for the root-cause pattern to
  confirm; if it appears in 3+ other locations, the door is open).
- The bug would have been catastrophic in production.
- The vulnerable operation is dangerous regardless of caller
  (destructive side effects, security-sensitive, irreversible).

Skip it for a one-off logic error with no realistic recurrence path.
Defense-in-depth is a response to an observed failure mode, never a
generic code-hygiene practice, and never a default addition to a
debug fix.

When triggered, add layered hardening on top of the minimal stage 3
fix so the bug becomes structurally harder to re-create through other
code paths, refactors, or mocks. Pick the layers that apply; not
every bug needs all four:

| Layer | Purpose | Apply when | Example |
|-------|---------|------------|---------|
| 1. Entry validation | Reject obviously invalid input at the API boundary | A caller passed bad data that should have been rejected | Throw if `workingDirectory` is empty or missing, before any downstream code touches it |
| 2. Invariant / business-logic check | Enforce preconditions entry validation cannot express | The operation requires a state guarantee | Assert `user.state === 'verified'` before issuing a password reset |
| 3. Environment guard | Refuse dangerous operations in contexts where they make no sense | The operation is catastrophic in the wrong environment | In tests (`NODE_ENV === 'test'`), refuse `git init` outside the OS temp dir |
| 4. Diagnostic breadcrumb | Capture forensic context before the risky operation | Other layers may still be bypassed; future failures need evidence | Log `{ directory, cwd, env, stack }` immediately before `git init` |

Rules:

- Trace the bad value's origin through every function that passed it
  along, then map where validation could have rejected it earlier.
- Each guard is as narrow as possible — validating exactly what that
  layer owns, not duplicating checks from other layers. If layer 2
  just repeats layer 1, the second one is noise.
- Test each guard independently: construct a case that bypasses
  layer 1 and verify layer 2 still catches it.
- Never leave layer 4 out when layers 1-3 apply. Layers 1-3 will
  eventually be bypassed, and the breadcrumb is what makes the next
  failure debuggable.

Gate (only when the trigger fired): the hardening diff is separate
from the minimal fix, each added guard has its own bypass test, and
layer 4 exists if any of layers 1-3 were added.

## What this workflow is not

- Not a patch-over. A patch-over suppresses the symptom at a different
  layer than the cause. This workflow fixes the owning layer.
- Not a bisection. Bisection finds the commit that introduced the bug;
  this workflow finds the code that causes it. Use git bisection only
  when stage 2 cannot localize.
- Not a single-shot. If GREEN fails or the negative case breaks, you
  re-enter at stage 2, not stage 3.

## Report shape

Every atlas-debug report carries gates 1-5 below; gate 6 is conditional:

1. RED: the command and its failing output, verbatim.
2. Cause: one sentence, file:line.
3. Fix: the diff and the one-line rationale.
4. GREEN: the same command and its passing output, verbatim.
5. Negative: the adjacent path command and its output.
6. Defense-in-depth (ONLY when the conditional trigger fired): the
   layers added and the independent bypass test for each. When the
   trigger did not fire, state that the pass was evaluated and
   skipped, in one line.

A report missing gates 1-5 is incomplete. The verifier will refuse
it. Gate 6 is conditional and is never a default requirement.