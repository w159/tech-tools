# A loop counter needs a progress signal, not just a repeat count
Date: 2026-11-17
Area: `plugins/atlas/hooks/completion_gate_core.py` (Stop-gate block-loop cap)

## What happened
The completion gate's block-loop cap counts consecutive Stops that failed the
same letters and allows the Stop once that count passes `BLOCK_LOOP_LIMIT`
(`_block_loop_state`, `completion_gate_core.py:2553`). Before today it took
only `session_id`, `failed` and `continuation` - an identical failure
signature on two consecutive Stops was indistinguishable from a real stuck
loop, even when the session spent those Stops dispatching a wave of parallel
explorers and made real progress between them. The fix adds a `progress`
argument - `_run_dispatch_count`, a COUNT of this run's `dispatches` rows
(`completion_gate_core.py:3625-3642`) - and resets the counter to 1 whenever
it changed since the previous block (`completion_gate_core.py:2600-2606`); a
repeat with no new dispatch still counts normally, unchanged
(`completion_gate_core.py:2553-2614`). `test_new_dispatches_between_blocks_are_not_a_loop`
and `test_identical_block_with_no_new_dispatch_is_still_a_loop`
(`plugins/atlas/hooks/test_completion_gate.py:5240-5257`) cover both halves.

## Why it happened
A loop detector built on "the same failure signature N times in a row"
conflates two different situations that produce identical signatures: a
model that is actually stuck repeating itself, and a model that is doing
real, valid work (a fan-out of read-only explorers) between Stops that
happen to fail the same gate letter each time. Counting the signature alone
cannot tell them apart; it needs an independent signal that work happened in
between. The gate already had that signal sitting in its own database
(`dispatches` rows for the run) - it just wasn't being read.

## What to do next time
1. Before shipping a cap that counts "the same thing N times", ask what
   legitimate activity could also produce that exact repeated signature.
2. If the answer is "parallel or batched work", find a cheap, already-tracked
   progress signal (a row count, a counter, a timestamp) and reset the count
   when it moves, rather than tightening the threshold or special-casing the
   activity.
3. Write both directions as separate tests: progress resets the count, and a
   true repeat with no progress still trips the cap. One without the other
   hides a regression in either direction.

## What to avoid
Treating "identical signature" as proof of a loop. It is only proof of a
repeat; whether it is a loop depends on whether anything else moved in
between.
