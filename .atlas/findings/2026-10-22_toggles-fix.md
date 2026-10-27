# toggles-fix: worker/toggles-fix: on-when-unset toggles paint real state and save

- id: toggles-fix
- status: verified
- verified_by: lead-tests
- verified_at: 2026-10-22T23:11:45+00:00

## Evidence
- wt test_atlas_control Ran 52 OK (lead rerun)
- wt bun test 154 pass 0 fail (lead rerun)
- live 7421 repro before fix: click on st-ATLAS_HOOK_BRIDGE sent no request; on='' equal to snapshot

## Reproduction
none recorded

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
