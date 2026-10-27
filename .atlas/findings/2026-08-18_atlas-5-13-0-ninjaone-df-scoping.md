# ATLAS-5.13.0-ninjaone-df-scoping: NinjaOne /queries/* and /jobs have no organizationId parameter; tenant scoping must build df 'org = <id>' or the result is whole-tenant while reading as scoped

- id: ATLAS-5.13.0-ninjaone-df-scoping
- status: verified
- verified_by: deterministic domain tests
- verified_at: 2026-08-18T15:07:09+00:00

## Evidence
- mcp_servers/ninjaone-mcp/src/domains/queries.ts
- mcp_servers/ninjaone-mcp/src/domains/automation.ts
- docs/vendors/ninjaone/api-reference.md:136

## Reproduction
cd mcp_servers/ninjaone-mcp && npx vitest run src/__tests__/domains/queries.test.ts src/__tests__/domains/automation.test.ts

## Proposed fix
none recorded

## Doc refs
- docs/CHANGELOG.md

## History
- no earlier verdicts
