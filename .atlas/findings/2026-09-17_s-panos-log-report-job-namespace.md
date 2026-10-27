# S-panos-log-report-job-namespace: Log-query and report job ids are a separate PAN-OS namespace invisible to panos_job_status, and nothing said so

- id: S-panos-log-report-job-namespace
- status: verified
- verified_by: main-agent-live-appliance
- verified_at: 2026-09-17T15:45:00+00:00

## Evidence
- Live: panos_logs_query -> 'query job enqueued with jobid 116'; panos_job_status jobId=116 -> code 7. panos_report_dynamic -> jobid 115; job_status -> code 7.
- Proved it is PAN-OS behavior, not bad command construction: raw panos_op '<show><jobs><id>116</id></jobs></show>' also returns code 7, while '<show><jobs><all/></jobs></show>' lists only job-table ids (28 Commit, 29 Device-certificate-fetch).
- panos_job_status / panos_job_wait on commit job 28 work correctly: {"id":"28","status":"FIN","progress":100,"result":"OK"}. The tools were never broken.
- Failure mode was discoverability: a model reads 'enqueued with jobid 116', reaches for the obviously-named panos_job_status, gets code 7, and concludes the connector is broken. The main agent did exactly that before checking the raw op.
- Fixed: logs_query routes to panos_logs_retrieve, the three report tools route to panos_report_get, both job tools state they only see job-table jobs; boot-probe asserts the descriptions name their retrieval tool.

## Reproduction
node .atlas/.run/panos-live.mjs call .atlas/.run/panos-jobq.json

## Proposed fix
none recorded

## Doc refs
- docs/architecture/panos-connector-design.md

## History
- no earlier verdicts
