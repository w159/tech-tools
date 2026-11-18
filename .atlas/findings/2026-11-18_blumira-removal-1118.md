# blumira-removal-1118: Blumira connector removed; connectwise-manage and threatlocker gateway credentials per request

- id: blumira-removal-1118
- status: verified
- verified_by: lead
- verified_at: 2026-11-18T14:10:49+00:00

## Evidence
- pytest CI set 315 passed; atlas touched tests 41 passed; bun 5141 pass 0 fail; vitest connectwise 51, threatlocker 30, mcp-gateway 223 passed; check_versions ok

## Reproduction
python -m pytest -q scripts plugins/armada/tests plugins/programmer/tests plugins/atlas/hooks/test_atlas_contract.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
