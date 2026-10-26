# V-panos-claim5-no-key-fragment-in-status: CLAIM 5 PASS: panos_status emits no fragment of the API key - the 6, 8 and 12 character prefixes are all absent from its output

- id: V-panos-claim5-no-key-fragment-in-status
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-09-17T15:49:31+00:00

## Evidence
- Derived the first 6, 8 and 12 characters of PANOS_API_KEY (132 chars) from plugins/atlas/.env in memory and substring-tested the raw panos_status text. Result: f6=false, f8=false, f12=false, whole-key=false. Same three probes against the raw panos_devices_list error payload: all false. Fragments were never printed.
- panos_status key line is exactly: 'PANOS_API_KEY: configured (132 chars)'.

## Reproduction
Spawn the shipped bundle, tools/call panos_status, then assert raw text does not include KEY.slice(0,6) / slice(0,8) / slice(0,12); boot-probe.mjs asserts the same invariant offline

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
