# ctxdiet-doctor: atlas_doctor context-footprint check

- id: ctxdiet-doctor
- status: verified
- verified_by: lead
- verified_at: 2026-11-21T06:37:07+00:00

## Evidence
- test_atlas_doctor and test_atlas_hook_guard: Ran 257 OK; live line: main session 109228 tokens, atlas subagent median 75599

## Reproduction
cd plugins/atlas/scripts && python3 -m unittest test_atlas_doctor

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-11-21T06:08:19+00:00 verified by atlas:verifier: doctor slice (47ce29c5): footprint check, 218 doctor tests OK, seeded fault fails, --hook output identical except worktr
