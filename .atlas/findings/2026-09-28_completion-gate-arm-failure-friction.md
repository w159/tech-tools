# completion-gate-arm-failure-friction: prompt_optimizer.arm_orchestration and dispatch_tripwire's mark_orchestrating call sites record a friction_events row when the DB write fails, instead of silently no-opping

- id: completion-gate-arm-failure-friction
- status: verified
- verified_by: orchestrator-test-run
- verified_at: 2026-09-28T11:49:24+00:00

## Evidence
- plugins/atlas/hooks/test_prompt_optimizer.py ArmOrchestrationTest: forced mark_orchestrating to raise, asserted friction row + no-raise, red before fix / green after
- plugins/atlas/hooks/test_dispatch_tripwire.py InProcessTest: same for both dispatch_tripwire.py call sites
- python3 -m unittest plugins.atlas.hooks.test_prompt_optimizer plugins.atlas.hooks.test_dispatch_tripwire -> 176 tests OK
- python3 -m unittest discover -s plugins/atlas/hooks -> 822 tests, 1 failure (pre-existing install-cache parity, unrelated)

## Reproduction
python3 -m unittest plugins.atlas.hooks.test_prompt_optimizer plugins.atlas.hooks.test_dispatch_tripwire

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
