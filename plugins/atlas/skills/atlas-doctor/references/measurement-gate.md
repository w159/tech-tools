### Measurement-first gate (ported from CE's `ce-retune`)

The baseline/remeasure loop above only means something if it is disciplined.
Before any accepted change to a skill, hook, or agent file may be claimed as
an improvement:

1. **Baseline from the archive, before the edit.** Historical sessions in
   `~/.atlas/atlas.db` are a free baseline - usually larger than any
   experiment you could run now. At DECIDE time, before Phase 4 touches the
   file, measure the specific friction the finding targets from existing
   telemetry: re-run the same miner that surfaced the finding over the
   pre-change window and keep that number with the finding. `--baseline` then
   registers the metric, target, and `--after` as before. A value recorded
   after the edit is not a baseline.
2. **No baseline, no claimed improvement.** If the friction is not observable
   in telemetry - no facet column or friction event captures it - say so
   plainly: the finding is accepted-but-unmeasurable until instrumented.
   Instrumenting first is the real fix. Auditing the skill and presenting the
   result as retuning is not.
3. **Register the bar in writing before the change exists.** Choose metric,
   target, and `--after` before seeing any post-change data. A bar chosen
   after seeing results is not a bar.
4. **Remeasure with the identical method.** `--remeasure` re-runs the same
   miner. Never change the metric definition, the miner, or the window
   semantics between baseline and remeasure - if the instrument must change,
   the comparison is void and the improvement claim resets to unproven.
5. **State the counter-argument.** For a corpus-wide retune (one pass touching
   more than one skill/hook/agent file), run the change-proposing and
   change-defending passes in independent contexts before applying; for a
   single-file change, the DECIDE question must state what the change might
   break, not only what it fixes.

The harness check ce-retune performs has a direct atlas analog, and it gates
the same way: the run archive is the ingested session telemetry; the build
selector is the plugin source in-repo (changes land in-tree, and sessions
before and after a change are the A/B); the repeatable task is the recurring
session work the friction appears in. If any of the three is missing for a
proposed corpus change, stop and name what to build instead of retuning blind.
