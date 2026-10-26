# agent-defs-readonly: Write-disallowed atlas agents return reports instead of writing; verifier/explorer marked fresh-only; contract invariant added

- id: agent-defs-readonly
- status: verified
- verified_by: orchestrator-test-run
- verified_at: 2026-09-28T10:13:02+00:00

## Evidence
- test_atlas_contract.ReadOnlyAgentsDoNotWriteContract OK

## Reproduction
python3 -m unittest plugins.atlas.hooks.test_atlas_contract.ReadOnlyAgentsDoNotWriteContract

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
