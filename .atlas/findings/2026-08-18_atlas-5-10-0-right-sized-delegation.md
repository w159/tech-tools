# ATLAS-5.10.0-right-sized-delegation: condition (g) accepts a run-scoped test-verified finding, so a simple task costs one subagent not two

- id: ATLAS-5.10.0-right-sized-delegation
- status: verified
- verified_by: deterministic contract suite
- verified_at: 2026-08-18T12:34:54+00:00

## Evidence
- plugins/atlas/hooks/completion_gate.py _test_verified_this_run
- plugins/atlas/skills/atlas-orchestrate/SKILL.md:111

## Reproduction
python3 -m pytest plugins/atlas/hooks/test_completion_gate.py -k TestRunPairs -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
