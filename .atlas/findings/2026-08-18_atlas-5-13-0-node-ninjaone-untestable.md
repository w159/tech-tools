# ATLAS-5.13.0-node-ninjaone-untestable: node-ninjaone shipped a test suite and a vitest config with no way to run either: msw and vitest absent from devDependencies, empty scripts block

- id: ATLAS-5.13.0-node-ninjaone-untestable
- status: verified
- verified_by: npm test: 10 files, 94 passed
- verified_at: 2026-08-18T15:37:18+00:00

## Evidence
- mcp_node/node-ninjaone/package.json
- mcp_node/node-ninjaone/tests/
- mcp_node/node-ninjaone/tests/integration/resources.test.ts

## Reproduction
cd mcp_node/node-ninjaone && npm test  # 10 files, 94 passed

## Proposed fix
none recorded

## Doc refs
- docs/CHANGELOG.md

## History
- no earlier verdicts
