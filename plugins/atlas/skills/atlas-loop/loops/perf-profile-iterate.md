---
id: perf-profile-iterate
name: Perf profile iterate
category: performance
cadence: self-paced
inputs:
  - workload: the benchmark or scenario that exercises the hot path reproducibly
  - profiler: how the profile is captured (flamegraph, query plan, trace, timing harness)
  - target: the metric and threshold to reach (p95 < 200ms, throughput > 1k rps)
  - regression_guard: the check that proves a fix did not break correctness
---

# perf-profile-iterate

Profile the workload, fix the single biggest hotspot, re-profile, repeat - until the metric hits target. Self-paced because each iteration depends on the previous profile: you cannot know the next hotspot until you have measured the effect of the last fix. Measure, do not guess; the profiler picks the target, not intuition.

## Steps

1. **Baseline.** Run `workload` under `profiler`. Record the current metric and the top hotspot with evidence (the flamegraph frame, the slow query, the trace span).
2. **Fix the top hotspot only.** Make the one change the profile points at. Resist fixing things the profile did not flag.
3. **Re-profile.** Run `workload` under `profiler` again. Compare the metric to baseline and confirm the hotspot actually moved (sometimes a fix shifts cost elsewhere instead of removing it).
4. **Guard correctness.** Run `regression_guard` to confirm the fix did not break behavior. A faster wrong answer is a regression. Per atlas-engine law 5, confirm both the measured improvement and `regression_guard` with an independent re-run in a fresh context (dispatch `atlas:verifier`) rather than the iterating agent self-attesting the before/after.
5. **Decide (self-pace).** If the metric is at `target`, stop. If not, the new profile names the next hotspot - go to step 2.

## Stop condition

The metric reaches `target`, or the profile shows no further hotspot worth the change cost (diminishing returns, documented).

## Template (self-paced /loop)

```
/loop Run <workload> under <profiler>, record the metric and the top hotspot with evidence. Make the single change the profile points at, re-profile, and confirm both that the metric improved and that <regression_guard> still passes. If the metric is at <target>, stop and print the before/after; otherwise continue with the next hotspot.
```

Omit the interval to self-pace. Each iteration must show a measured before/after, not a claimed speedup - reading a diff is not evidence of faster.
