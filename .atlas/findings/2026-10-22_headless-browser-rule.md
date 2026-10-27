# headless-browser-rule: Headless-only browser rule landed; Playwright MCP headless via settings env; prettierignore stops markdown reflow

- id: headless-browser-rule
- status: verified
- verified_by: lead
- verified_at: 2026-10-22T12:35:02+00:00

## Evidence
- plugins/atlas/hooks/test_atlas_contract.py: Ran 110 tests OK
- git diff --numstat: CHANGELOG 1/0, ui-runtime-tester.md 2/2, tool-routing.md 2/0
- prettier --check plugins/atlas/agents/ui-runtime-tester.md: ignored, rc=0
- ~/.claude/settings.json env PLAYWRIGHT_MCP_HEADLESS=1

## Reproduction
cd plugins/atlas/hooks && python3 -m unittest test_atlas_contract

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
