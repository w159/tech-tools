# P1-audit-skill: atlas-audit runs without graphify/security-review/codeql/quality-playbook: conditional composition, fallbacks, literal atlas_finding.py command, hub glob fix, AskUserQuestion+Workflow allowed

- id: P1-audit-skill
- status: verified
- verified_by: lead
- verified_at: 2026-10-26T11:14:21+00:00

## Evidence
- plugins/atlas/skills/atlas-audit/SKILL.md
- .atlas/.run/proof-2026-10-26/audit-deps.md

## Reproduction
cd plugins/atlas/scripts && python3 -m unittest test_skill_agent_conformance (Ran 40 tests OK); grep -rn 'atlas-\*-\*' plugins/atlas/skills/atlas-audit (no hits)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
