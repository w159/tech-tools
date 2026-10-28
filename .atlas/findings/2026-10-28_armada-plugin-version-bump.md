# armada-plugin-version-bump: armada plugin version 2.2.1 -> 2.3.0 (plugin.json + marketplace.json) so the URL-only CIPP connector is installable; claude plugin validate passes and the armada contract suite is green (21 tests)

- id: armada-plugin-version-bump
- status: verified
- verified_by: main
- verified_at: 2026-10-28T20:15:11+00:00

## Evidence
- commit de83bb39: plugins/armada/.claude-plugin/plugin.json version 2.3.0, .claude-plugin/marketplace.json armada entry 2.3.0, plugins/armada/CHANGELOG.md 2.3.0 entry naming the CIPP change
- claude plugin validate plugins/armada -> Validation passed (PRIVACY_URL_MISSING warning only); cd plugins/armada && python3 tests/test_armada_contract.py -> Ran 21 tests OK; jq .userConfig|length = 54 matches the assertion

## Reproduction
claude plugin validate plugins/armada && cd plugins/armada && python3 tests/test_armada_contract.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
