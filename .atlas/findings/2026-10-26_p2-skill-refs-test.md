# P2-skill-refs-test: conformance test: skill names referenced by atlas skills/agents exist or sit on OPTIONAL_EXTERNAL_SKILLS; dead atlas-work name removed from atlas-plan

- id: P2-skill-refs-test
- status: verified
- verified_by: lead
- verified_at: 2026-10-26T11:14:21+00:00

## Evidence
- plugins/atlas/scripts/test_skill_agent_conformance.py

## Reproduction
cd plugins/atlas/scripts && python3 -m unittest test_skill_agent_conformance (Ran 40 tests OK; red run named atlas-work x3 before the atlas-plan fix)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
