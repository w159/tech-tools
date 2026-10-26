# test-atlas-contract-hookstate-leak: test_atlas_contract.py's _run_hook did not isolate ATLAS_HOOKSTATE_DIR; fixed literal session ids in CompletionGateContract could permanently trip atlas_hook_guard's real on-disk circuit breaker under the developer's actual ~/.atlas/hookstate/, silently disabling completion_gate.py for that session id

- id: test-atlas-contract-hookstate-leak
- status: verified
- verified_by: orchestrator-test-run
- verified_at: 2026-09-28T13:40:00+00:00

## Evidence
- reproduced correctly (not the naive rapid loop, which collapses under STOP_EVENT_DEDUP_SECONDS=2): with a shared hookstate dir and >2s spacing between calls, an 8-call loop for a genuine block scenario goes silent after the 5th call (STOP_BURST_LIMIT=5, STOP_BURST_WINDOW=120s in atlas_hook_guard.py)
- root-caused a real regression seen mid-session: manual debug invocations of completion_gate.py using the test suite's literal session ids (no-such-run, s-block, s-quiet) tripped the real ~/.atlas/hookstate/*.json breaker files on this machine; clearing them restored the suite
- shipped fix: _run_hook now unconditionally points ATLAS_HOOKSTATE_DIR at a scoped tempfile.TemporaryDirectory() per call (or the caller's hookstate= dir, via contextlib.nullcontext, for a caller that wants to inspect/reuse state); test_completion_gate.py (both subprocess and in-process paths) and test_nudge.py already did this correctly and were not affected
- test test_run_hook_isolates_the_circuit_breaker_across_calls: no sleeps; pre-seeds a shared dir's session file with {breaker_tripped: true} and confirms it silences the gate, then forces ATLAS_HOOKSTATE_DIR=<that same dir> into os.environ via mock.patch.dict before a default (no hookstate=) call and asserts it still blocks -- proving _run_hook unconditionally overrides rather than only setting the key when hookstate is explicitly passed
- proven red against exactly that narrower regression (env['ATLAS_HOOKSTATE_DIR'] = hookstate or tempfile.mkdtemp() replaced with 'if hookstate: env[...] = hookstate') via a scratch-copy diff, restored after; proven green against the shipped fix; runs in under 1s
- python3 -m unittest discover -s plugins/atlas/hooks -> 823 tests, exit code 1 (captured directly, not through a masking pipe), sole failure is the pre-existing install-cache parity check (unrelated); plugins/atlas/scripts and plugins/programmer/hooks both exit 0
- targeted CompletionGateContract run (6 tests, 0.85s) confirms the shipped TemporaryDirectory scoping leaves no net /tmp growth attributable to the hookstate dir

## Reproduction
python3 -m unittest plugins.atlas.hooks.test_atlas_contract.CompletionGateContract.test_run_hook_isolates_the_circuit_breaker_across_calls

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
