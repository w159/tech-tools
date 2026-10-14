# Red feedback loop first, then red-green

Source: adapted from Matt Pocock's `diagnosing-bugs` and `tdd` skills.

A bug is diagnosable only through a tight pass/fail signal that goes red on THIS bug. Everything after it (bisecting, hypotheses, instrumentation) just consumes that signal. Spend the most effort here, before any theory.

## Build the loop (try in this order)

1. A failing test at whatever seam reaches the bug (unit, integration, e2e).
2. A curl or HTTP script against a running dev server.
3. A CLI run on a fixture input, diffed against a known-good snapshot.
4. A headless browser script asserting on DOM, console or network.
5. A replay of a captured trace, payload or event log through the code path alone.
6. A throwaway harness: a minimal subset of the system, one function call.
7. A property or fuzz loop (1000 random inputs) when the output is "sometimes wrong".
8. A bisection harness (`git bisect run`) when the bug appeared between two known states.
9. A differential loop: same input through old and new version, diff the outputs.
10. Last resort: a human-in-the-loop script that still prints a structured verdict.

## Tighten it

- Faster: cache setup, skip unrelated init, narrow scope. Seconds, not minutes.
- Sharper: assert the specific symptom, never "did not crash".
- Deterministic: pin time, seed the RNG, isolate the filesystem. For a flaky bug, raise the reproduction rate (loop 100x, add stress, narrow timing windows) until it is debuggable.

## Gate

Loop done when one command, already run once with its output shown (secrets redacted), is red-capable (asserts the user's exact symptom), deterministic, fast and runnable unattended. If you cannot build one, stop and list what you tried; ask for access to the environment, a redacted captured artifact, or permission to add temporary instrumentation. Do not form hypotheses without a loop.

## Red-green

Fix only against the loop. Done when the loop goes red on the unfixed code for the right reason (the failure message names the root cause, not a missing fixture or import error) and green after the fix, then the adjacent error path stays green. Leave the loop behind as a regression test when a seam exists. See `debug-workflow.md` for the hypothesis and defense-in-depth rules.
