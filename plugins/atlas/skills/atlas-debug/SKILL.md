---
name: atlas-debug
description: 'Reproducible bug, exception, stack trace, or bad output: root-cause fix with evidence, not a patch over. Use when you want the actual cause fixed, not the symptom hidden.'
when_to_use: a reproducible bug, exception, stack trace, or bad output needs a root-cause fix with evidence, not a patch over
allowed-tools: Read, Glob, Grep, Bash
argument-hint: '[context] [stack] [symptom] [paste error/log]'
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

Read `${CLAUDE_SKILL_DIR}/references/debug-workflow.md` and follow the reproduce-localize-fix-verify loop it defines for every debug run.

Debug and fix this: $ARGUMENTS

Read the arguments as four inputs:
- Context: what the system is and who depends on it.
- Stack: language/runtime, framework, datastore.
- Symptom: what is wrong, when it happens, what you expected instead.
- The full error/stack/log, pasted verbatim. Read all of it, not just the first line.

If the symptom or stack is missing detail you need, ask once for it, then proceed.

Steps:
1. Reproduce. Run it and observe the failure. If you cannot run it here, state the exact command to reproduce and the expected output.
2. Read the whole error. Trace it to the originating line. Name the root cause in one sentence before changing anything. If the cause is in a library, check its docs via Context7 first.
   - Ranked competing hypotheses (required before committing to a root cause): write a ranked hypothesis list, not a first guess. It must contain at least one genuinely competing explanation for the same symptom besides the leading hypothesis, with why it ranks lower — a single-candidate list anchors on the first plausible idea, and writing the ranking down before any probe runs is the cheapest moment to catch that. Each hypothesis states (a) what is wrong and where (file:line), (b) at least one concrete observation grounding it — a runtime value, a log line, an instrumented boundary capture, a behavior delta against a working comparison case, or a specific code reference; "X seems off" is not evidence — and (c) the causal chain from trigger to symptom, step by step, with a testable PREDICTION for any uncertain link: something in a different code path or scenario that must also be true if the chain is correct. Verify the prediction before committing. Test the top-ranked hypothesis first.
   - Escalation: after 2-3 hypotheses are exhausted without confirmation, stop guessing. Diagnose why they failed and present that diagnosis to the user before proceeding — hypotheses pointing at different subsystems mean an architecture/design problem (route to planning, not more debugging); self-contradicting evidence means a wrong mental model (re-read the code path without assumptions); works-locally-fails-elsewhere means an environment problem (config, dependencies, timing); a fix that worked but whose prediction was wrong means symptom fix, real cause still active. Never form a fourth hypothesis blind.
3. Fix the actual cause in place. Do not paper over it with a workaround unless the real fix is out of scope; if so, say which part and why.
   - Red for the right reason: before trusting any fix, confirm the RED instrument fails on the targeted defect, not on an unrelated setup error. If a regression test exists or was written, run it and read the failure message — it must point at the root cause (missing init, wrong branch, bad coercion), not at a missing fixture, stale build artifact, wrong interpreter, or import error. A test red for the wrong reason proves nothing when it turns green. With no regression test, the step 1 reproduction command is the instrument: its captured failure output must match the defect's signature, not merely error somewhere nearby.
   - Three-failed-fix invalidation: if a fix does not turn the reproduction GREEN, return to the hypothesis step and explicitly invalidate the current root-cause hypothesis — state in writing the evidence that ruled it out — before forming a new one with its own grounding observation and prediction. Do not retry variants of the same theory ("maybe it was the other branch"); that is a rationalization spiral, not iteration. After THREE failed fix attempts, the root-cause identification was likely wrong: stop patching, diagnose the failure pattern per the escalation rule above, present it to the user, and re-diagnose with a genuinely new hypothesis. Never attempt a fourth patch blind.
4. If this is a recurring or iterative fix (a multi-round build-fix loop, a sweep across many failing cases, or an until-clean retry cycle), invoke the `atlas-loop` skill to select and instantiate the best-fit loop from the loop-library, then run that loop. Otherwise, for non-trivial single-pass work, dispatch the squad rather than doing it all inline: dispatch all independent jobs in ONE message (multiple Agent calls in a single message) so they run concurrently, roughly 4-6 in flight - atlas:explorer to locate the failing path and its callers, debugger to confirm the root cause, atlas:implementer to apply the fix. ALWAYS close the wave with an independent atlas:verifier in a fresh context before integrating results.

VERIFY:
- Run the reproduction command again. Show the exact command and the actual output.
- Prove the symptom is gone with that output, not "it should work."
- Exercise one adjacent error path (bad input, missing file, failed auth, empty result) and show it behaves correctly.

OPTIONAL - Defense-in-depth pass (conditional; NEVER applied by default). Only when the bug has recurred 3+ times, OR would have been catastrophic in production, OR the vulnerable operation is dangerous regardless of caller (destructive, security-sensitive, irreversible), add layered hardening on top of the minimal fix: (1) entry validation at the API boundary, (2) invariant/business-logic checks enforcing preconditions validation cannot express, (3) environment guards refusing the operation in contexts where it makes no sense, (4) diagnostic breadcrumbs capturing forensic context immediately before the risky operation. Each layer catches a distinct class of failure - never duplicate the same check at every layer - and each guard gets an independent bypass test (construct a case that bypasses layer 1 and confirm layer 2 still catches it). Layer 4 is never omitted when layers 1-3 are added: they will eventually be bypassed, and the breadcrumb is what makes the next failure debuggable. Skip for a one-off error with no realistic recurrence path; hardening is a response to an observed failure mode, not generic code hygiene. See `${CLAUDE_SKILL_DIR}/references/debug-workflow.md` for the layer table and triggers.

REPORT:
- Root cause in one sentence.
- The fix as a diff or file path.
- The command you ran and the actual output captured.
- The adjacent error path you checked and its result.
- If the conditional defense-in-depth trigger fired, the layers added and each guard's bypass test; otherwise, one line stating the pass was evaluated and skipped.
