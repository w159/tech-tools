# mod-plan-factcheck: atlas-mod plan: 7 factual claims refuted (prompt.context once/conversation; claude -p runs mod hooks; turn_scoring/(o)(p) don't read headerFirstLinePattern; find_root markers; dash_colony has no input state; atlas-agents.ts:37 is runner; per-subagent effort already exists)

- id: mod-plan-factcheck
- status: rejected
- verified_by: atlas:verifier
- verified_at: 2026-10-09T20:58:47+00:00

## Evidence
- /tmp/mods-ref.md:81,290; /tmp/mods-ov.md:199; plugins/atlas/scripts/turn_scoring.py:40; plugins/atlas/hooks/completion_gate.py:87-106,1682; plugins/atlas/scripts/atlas_todo.py:149-162; plugins/atlas/scripts/atlas_dash_colony.py:12-15; plugins/atlas/omp/atlas-agents.ts:37-38; skills/atlas-orchestrate/references/squad-and-tiers.md:20-27

## Reproduction
curl code.claude.com mods docs into /tmp; rg/sed on cited lines; claude --version

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
