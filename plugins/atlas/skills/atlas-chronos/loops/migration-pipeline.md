---
id: migration-pipeline
name: Migration pipeline
category: data
cadence: self-paced
inputs:
  - stages: the ordered migration steps (schema change, backfill, dual-write, cutover, cleanup)
  - per_stage_check: the verification that proves one stage landed correctly
  - rollback: how to undo the current stage if its check fails
  - done_definition: every stage applied and verified, old path retired
---

# migration-pipeline

Run a multi-step data or schema migration one stage at a time, proving each stage before advancing. Self-paced because you never move to the next stage on a timer - you move only when the current stage's check is green. A failed check triggers rollback of that stage, not a blind retry.

## Steps

1. **Order the stages.** Lay out `stages` in dependency order. Each stage is reversible via `rollback` and provable via `per_stage_check`.
2. **Apply one stage.** Execute the current stage. This is a write - gate for approval before the first mutating stage and before any irreversible one (cutover, drop).
3. **Verify the stage.** Run `per_stage_check`. Read the new state back to prove it; do not assume the command succeeding means the data is correct. Per atlas-metis law 5, run `per_stage_check` as an independent read-back in a fresh context (dispatch `atlas:verifier` or `atlas:db-prober`) rather than the agent that applied the stage self-attesting it landed.
4. **Branch.** If the check is green, advance to the next stage. If it is red, run `rollback` for this stage, report the failure with evidence, and stop - do not advance on a failed stage.
5. **Advance (self-pace).** Repeat until the last stage passes its check.

## Stop condition

Every stage is applied and its `per_stage_check` is green, the old path is retired (`done_definition`), or a stage failed and was rolled back.

## Template (self-paced /loop)

```
/loop Apply the next migration stage in <stages> (gate first - this writes; stop for approval before any irreversible stage). Run <per_stage_check> and read the new state back to prove it landed. If green, advance to the next stage; if red, run <rollback> for this stage and stop with evidence. When the last stage passes, stop and report the pipeline complete.
```

Omit the interval to self-pace. Every stage writes - never auto-advance past the approval gate, and prove each stage by reading data back, not by trusting exit codes.
