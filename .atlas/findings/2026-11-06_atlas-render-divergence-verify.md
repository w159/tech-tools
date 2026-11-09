# atlas-render-divergence-verify: Independent check of the run that documented the ATLAS render divergence: the atlas plugin contract suite passes (111 passed, 3 skipped, 122 subtests) and atlas-doctor --hook runs clean of new breakage - the only doctor warnings are pre-existing (13 files need renaming, 3 global memory entries to migrate)

- id: atlas-render-divergence-verify
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-06T20:51:59+00:00

## Evidence
- python3 -m pytest plugins/atlas/hooks/test_atlas_contract.py -q -> 111 passed, 3 skipped, 122 subtests passed in 6.56s
- python3 plugins/atlas/scripts/atlas_doctor.py --hook -> warns codex-wiring (hooks must be ./hooks/hooks.json) and omp-bridge (omp runs 17.2.0 but this plugin is 16.4.2); both are pre-existing repo state, not caused by this run
- git status shows only docs/CHANGELOG.md, .atlas/evidence/2026-11-06-atlas-render-divergence.md and .atlas/.run/findings.json changed by this run; every other dirty file belongs to another workstream

## Reproduction
cd /Users/jerry/MEGA/Projects/Agentic/tech-tools && python3 -m pytest plugins/atlas/hooks/test_atlas_contract.py -q && python3 plugins/atlas/scripts/atlas_doctor.py --hook

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
