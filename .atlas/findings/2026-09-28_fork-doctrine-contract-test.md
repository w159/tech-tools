# fork-doctrine-contract-test: verifier.md/explorer.md 'always dispatched fresh, never forked' doctrine is now pinned by a contract test, not only by subagent-kit.md prose gated behind the orchestrate output style

- id: fork-doctrine-contract-test
- status: verified
- verified_by: orchestrator-test-run
- verified_at: 2026-09-28T11:49:24+00:00

## Evidence
- plugins/atlas/hooks/test_atlas_contract.py NoNestedSubagentsContract.test_verifier_and_explorer_refuse_forking added
- proven non-vacuous: deleting the sentence from a scratch copy of verifier.md/explorer.md turns the test red; restoring turns it green
- python3 -m unittest discover -s plugins/atlas/hooks -p test_atlas_contract.py -> 88 tests, 1 pre-existing failure (install-cache parity)

## Reproduction
python3 -m unittest plugins.atlas.hooks.test_atlas_contract.NoNestedSubagentsContract.test_verifier_and_explorer_refuse_forking

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
