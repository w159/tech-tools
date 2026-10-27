# ATLAS-5.13.0-ninjaone-fields-param-inert: ninjaone_queries_run declares fields and full but the handler returns records via shapeRaw, so both are inert - the same declared-but-never-read defect as activity_type

- id: ATLAS-5.13.0-ninjaone-fields-param-inert
- status: verified
- verified_by: live API call against the shipped 5.13.0 bundle
- verified_at: 2026-08-18T21:54:33+00:00

## Evidence
- mcp_servers/ninjaone-mcp/src/domains/queries.ts

## Reproduction
ninjaone_queries_run(query='computer-systems', page_size=200, fields=['deviceId','name','serialNumber']) returns full unfiltered records and truncates at the 40000-char cap

## Proposed fix
honor fields/full in the queries handler, or drop both from the input schema

## Doc refs
- none

## History
- no earlier verdicts
