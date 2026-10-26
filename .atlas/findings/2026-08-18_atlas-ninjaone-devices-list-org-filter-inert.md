# ATLAS-ninjaone-devices-list-org-filter-inert: ninjaone_devices_list declares organization_id but does not scope on it: a call for org 2 returns devices from orgs 1, 2 and 3

- id: ATLAS-ninjaone-devices-list-org-filter-inert
- status: verified
- verified_by: live API call; pre-existing, not introduced by 5.13.0
- verified_at: 2026-08-18T21:54:33+00:00

## Evidence
- mcp_servers/ninjaone-mcp/src/domains/devices.ts

## Reproduction
ninjaone_devices_list(organization_id=2, limit=100) returns records with organizationId 1, 2 and 3

## Proposed fix
route through GET /v2/organization/{id}/devices, or send df 'org = <id>'

## Doc refs
- none

## History
- no earlier verdicts
