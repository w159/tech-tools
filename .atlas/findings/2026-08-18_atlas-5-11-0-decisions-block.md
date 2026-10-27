# ATLAS-5.11.0-decisions-block: gating decisions must go through AskUserQuestion, not a DECISION NEEDED label that scrolls past

- id: ATLAS-5.11.0-decisions-block
- status: verified
- verified_by: deterministic contract suite
- verified_at: 2026-08-18T12:48:52+00:00

## Evidence
- plugins/atlas/output-styles/atlas-orchestrator.md
- plugins/atlas/skills/atlas-orchestrate/SKILL.md

## Reproduction
python3 -m pytest plugins/atlas/hooks/test_atlas_contract.py -k DecisionsAreBlocking -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
