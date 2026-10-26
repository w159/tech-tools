# V-panos-claim4-error-surfacing: CLAIM 4 PASS: all three error surfaces reproduce live - Panorama constraint named, appliance message carried, job namespace explained, and no credential blame

- id: V-panos-claim4-error-surfacing
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-09-17T15:49:31+00:00

## Evidence
- panos_devices_list on the standalone PA-460: code=UNSUPPORTED_COMMAND, message='PAN-OS error code 17 (Invalid command) - show -> devices is unexpected', hint states 'the request authenticated successfully' and 'show devices is a Panorama-only command'. Regex checks on the full 754-char payload: /Check PANOS_HOST/i = false, /API_KEY are set correctly/i = false, /Panorama/ = true.
- Bad xpath (deviceconfig/no-such-node-xyz): code=VENDOR_ERROR, message='PAN-OS returned status="error" with no error code - No such node' - the appliance msg survives to the operator.
- panos_job_status on log-query id 117: code=NOT_FOUND, message='PAN-OS error code 7 (Object not present) - job 117 not found', hint explains a log-query or report job ID is NOT in the job table and routes to panos_logs_retrieve / panos_report_get.

## Reproduction
node .atlas/.run/panos-live.mjs call .atlas/.run/panos-proof.json  # LIVE: 5 passed, 0 failed

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
