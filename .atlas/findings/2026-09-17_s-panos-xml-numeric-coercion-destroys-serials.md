# S-panos-xml-numeric-coercion-destroys-serials: fast-xml-parser default value coercion turned PAN-OS serials into numbers and destroyed the leading zero, silently breaking target=<serial> routing

- id: S-panos-xml-numeric-coercion-destroys-serials
- status: verified
- verified_by: main-agent-live-appliance
- verified_at: 2026-09-17T15:45:00+00:00

## Evidence
- Live appliance serial is 023009014025; panos_version returned "serial": 23009014025 (number) before the fix. Unit-level repro: parser with {attributeNamePrefix:'@',ignoreAttributes:false} -> {"serial":23009014025,"av-version":0}; with parseTagValue:false,parseAttributeValue:false -> {"serial":"023009014025","av-version":"0"}.
- Blast radius: every Panorama-routed call addresses a managed firewall by target=<serial>, and PANOS_TARGET is documented as a serial. A serial read back from panos_version/panos_system_info/panos_devices_list and passed as target would be 23009014025 != 023009014025 and address nothing - failing open, with no error.
- Also corrupted: av-version, family, and log-row serial fields; job ids arrived as numbers while commit() and the jobId schemas declared string, so the types were a runtime lie.
- Fixed: parseTagValue:false + parseAttributeValue:false (fast-xml-parser 4.5.7; semantics read from the installed fxp.d.ts, not recalled). 3 regression guards added, all three confirmed FAILING before the fix (expected 23009014025 to be '023009014025').
- Live post-fix: panos_version -> "serial": "023009014025". node-panos suite 6 -> 9 tests, all green.

## Reproduction
set -a; . plugins/atlas/.env; set +a; node .atlas/.run/panos-live.mjs call .atlas/.run/panos-proof.json

## Proposed fix
none recorded

## Doc refs
- docs/architecture/panos-connector-design.md
- .atlas/evidence/2026-09-17-panos-live-validation.md

## History
- no earlier verdicts
