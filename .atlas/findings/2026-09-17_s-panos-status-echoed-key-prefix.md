# S-panos-status-echoed-key-prefix: panos_status printed a live API-key prefix into the conversation transcript

- id: S-panos-status-echoed-key-prefix
- status: verified
- verified_by: main-agent-live-appliance
- verified_at: 2026-09-17T15:45:00+00:00

## Evidence
- Live pre-fix: 'PANOS_API_KEY: <first-6-chars-of-key>...' - the leading characters of a long-lived credential, emitted into a transcript under a compliance regime (FTC Safeguards / Reg S-P) that treats avoidable credential exposure as a finding.
- Fixed: 'PANOS_API_KEY: configured (132 chars)' - presence plus a non-reversible descriptor. Boot probe now asserts no 6+ character prefix of the configured key appears in panos_status output, in every credential state.
- Verified live: grep for the real key's 6-char prefix across all probe output -> clean, no match.

## Reproduction
PREFIX=${PANOS_API_KEY:0:6}; node .atlas/.run/panos-live.mjs call .atlas/.run/panos-proof.json | grep -c "$PREFIX"

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
