# S-panos-errors-blamed-credentials: Every PAN-OS failure collapsed to an opaque string with a credential-blaming hint, sending operators to debug the one thing that was provably fine

- id: S-panos-errors-blamed-credentials
- status: verified
- verified_by: main-agent-live-appliance
- verified_at: 2026-09-17T15:45:00+00:00

## Evidence
- Live: panos_devices_list on a standalone PA-460 -> 'PAN-OS API error (code 17)' with hint 'Check PANOS_HOST and PANOS_API_KEY are set correctly', while 13 other calls succeeded with those same credentials in the same session. Code 17 = Invalid command (vendor table); appliance text was 'show -> devices is unexpected' because show devices is Panorama-only.
- Live: bad xpath -> bare 'PAN-OS API error', no code, no message, despite PanosApiError already carrying code/httpStatus/responseText where the appliance <msg> lives.
- Root cause: PanosApiError exposes httpStatus, not .status/.statusCode, so the shared @shared classifyError fell through to its plain-Error branch and discarded responseText.
- Fixed: shared vendor-code -> meaning -> failure-class -> hint mapping in src/utils/panos-error.ts, wired into 42 call sites across all ten domains; _helpers.ts no longer re-exports toolErrorFromCatch so the generic path is unreachable from a domain.
- Live post-fix: devices_list -> UNSUPPORTED_COMMAND, 'PAN-OS error code 17 (Invalid command) - show -> devices is unexpected', hint naming the Panorama constraint and stating the request authenticated successfully. Bad xpath -> 'PAN-OS returned status="error" with no error code - No such node'.

## Reproduction
node .atlas/.run/panos-live.mjs call .atlas/.run/panos-proof.json

## Proposed fix
none recorded

## Doc refs
- https://docs.paloaltonetworks.com/ngfw/api/getting-started/pan-os-xml-api-error-codes

## History
- no earlier verdicts
