# ctxdiet-hookguard-tests: hook-guard concurrency tests lift lock bound in workers

- id: ctxdiet-hookguard-tests
- status: verified
- verified_by: lead
- verified_at: 2026-11-21T06:37:08+00:00

## Evidence
- test_atlas_hook_guard OK while a second full suite ran concurrently; original flake not reproduced

## Reproduction
cd plugins/atlas/scripts && python3 -m unittest test_atlas_hook_guard

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
