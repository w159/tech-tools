# ATLAS-5.10.0-no-nested-subagents: subagents could dispatch subagents: no disallowedTools entry, no hook deny

- id: ATLAS-5.10.0-no-nested-subagents
- status: verified
- verified_by: deterministic contract suite
- verified_at: 2026-08-18T12:34:54+00:00

## Evidence
- plugins/atlas/agents/*.md disallowedTools
- plugins/atlas/hooks/dispatch_tripwire.py:123

## Reproduction
python3 -m pytest plugins/atlas/hooks/test_dispatch_tripwire.py -k NestedSubagentDeny plugins/atlas/hooks/test_atlas_contract.py -k NoNestedSubagents -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
