---
description: "Chase down and fix a specific failing behavior or error; use when you have a reproducible bug, exception, or bad output and want the root cause fixed with evidence."
argument-hint: "[context] [stack] [symptom] [paste error/log]"
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/atlas-engine/references/operating-contract.md"
```

If the contract did not load above, read `skills/atlas-engine/references/operating-contract.md` and apply it before proceeding.

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
3. Fix the actual cause in place. Do not paper over it with a workaround unless the real fix is out of scope; if so, say which part and why.
4. If this is a recurring or iterative fix (a multi-round build-fix loop, a sweep across many failing cases, or an until-clean retry cycle), invoke the `atlas-loop` skill to select and instantiate the best-fit loop from the loop-library, then run that loop. Otherwise, for non-trivial single-pass work, dispatch the squad rather than doing it all inline: dispatch all independent jobs in ONE message (multiple Agent calls in a single message) so they run concurrently, roughly 4-6 in flight - atlas:explorer to locate the failing path and its callers, debugger to confirm the root cause, atlas:implementer to apply the fix. ALWAYS close the wave with an independent atlas:verifier in a fresh context before integrating results.

VERIFY:
- Run the reproduction command again. Show the exact command and the actual output.
- Prove the symptom is gone with that output, not "it should work."
- Exercise one adjacent error path (bad input, missing file, failed auth, empty result) and show it behaves correctly.

REPORT:
- Root cause in one sentence.
- The fix as a diff or file path.
- The command you ran and the actual output captured.
- The adjacent error path you checked and its result.
