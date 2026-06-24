---
id: flaky-test-hunt
name: Flaky test hunt
category: testing
cadence: interval
inputs:
  - test_target: the suspect test or suite (read the run command from the project manifest)
  - run_count: how many repeats before declaring it stable, or "until first failure"
  - capture_on_fail: what to record when it fails (seed, order, timing, env, logs)
  - flake_definition: what proves flakiness (any failure across otherwise-identical runs)
---

# flaky-test-hunt

Re-run a suspect test over and over to make an intermittent failure show itself, then capture the exact conditions that tripped it. Interval cadence because you want repeated identical runs spaced out (to vary timing and surface order/race effects) until you either catch a failure or hit a clean streak that buys confidence.

## Steps

1. **Baseline.** Run `test_target` once. Note whether it passes and how long it takes.
2. **Repeat on the timer.** Each tick re-runs the same test under identical inputs. The spacing helps surface timing- and order-dependent flakes.
3. **Catch the failure.** On any failure, capture `capture_on_fail` (random seed, test order, wall-clock timing, env vars, full output) - this is the evidence that makes the flake reproducible.
4. **Count the streak.** Track consecutive passes. A long clean streak is weak evidence of stability; a single failure is strong evidence of flakiness.
5. **Stop and report.** Stop on the first captured failure (you have what you need to fix it) or after `run_count` clean repeats. Report the failure rate and the captured conditions. Per atlas-engine law 5, a captured failure must be reproducible by a different agent: dispatch `atlas:verifier` to re-run `test_target` under the captured conditions in a fresh context and independently confirm the flake (or the clean streak), rather than the hunting agent self-attesting the result.

## Stop condition

A failure is captured with reproducing conditions (`flake_definition` met), or `run_count` consecutive clean runs complete.

## Template (interval /loop)

```
/loop 30s Run <test_target> once. If it fails, capture <capture_on_fail> (seed, order, timing, env, full output) and stop - report the failure rate and the captured conditions. If it passes, increment the clean streak; after <run_count> consecutive passes, stop and report it stable across N runs.
```

Use a short interval (10-60s) so timing varies between runs. Read-only - test runs do not write, so no gate needed unless the suite has side effects.
