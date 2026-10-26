# V-panos-claim3-read-only-only: CLAIM 3 PASS: every tool this verification invoked is read-only; no mutating tool was called

- id: V-panos-claim3-read-only-only
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-09-17T15:49:08+00:00

## Evidence
- Tools invoked by this run (11 unique): panos_status, panos_version, panos_system_info, panos_config_show, panos_config_complete, panos_objects_list, panos_policies_list, panos_logs_query, panos_report_dynamic, panos_devices_list, panos_job_status. None carries the DESTRUCTIVE: description prefix; none is in the 32-tool destructive set; panos_op was never invoked by me.
- Server stderr trace for the proof run shows only reads reaching the appliance: 'API call: version', 'API call: op devices list', 'API call: config.show', 'API call: jobs.status'. panos_logs_query enqueues an ephemeral log-retrieval job (type=log) and writes no configuration.

## Reproduction
node .atlas/.run/panos-live.mjs call .atlas/.run/panos-plan.json (14 steps, all read-only) and .atlas/.run/panos-proof.json (5 steps)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
