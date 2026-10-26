# ATLAS-5.13.0-ninjaone-annotation-mislabel: name-pattern annotation marked ninjaone_devices_maintenance read-only (it mutates) and ninjaone_queries_run a write (it reads)

- id: ATLAS-5.13.0-ninjaone-annotation-mislabel
- status: verified
- verified_by: annotations test + live bundle tools/list annotation dump
- verified_at: 2026-08-18T15:10:14+00:00

## Evidence
- mcp_servers/ninjaone-mcp/src/annotate-tool.ts
- mcp_servers/ninjaone-mcp/src/__tests__/annotations.test.ts

## Reproduction
cd mcp_servers/ninjaone-mcp && npx vitest run src/__tests__/annotations.test.ts

## Proposed fix
none recorded

## Doc refs
- docs/CHANGELOG.md

## History
- no earlier verdicts
