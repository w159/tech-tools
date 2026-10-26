# verify-nondict-hook-guards: (5) report: hooks that crash on non-dict JSON and rely on fail-open: chronicle_facet, dispatch_tripwire, ingest_session, memory_capture, nudge, session_boot (AttributeError recorded to hook-faults.jsonl). Guarded: recall_gate, bash_advisor, completion_gate, connector_credential_watch, docs_drift_watch, fallow_gate, format_after_edit, prompt_optimizer, todo_capture, worker_report_gate

- id: verify-nondict-hook-guards
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-06T23:04:36+00:00

## Evidence
- subprocess probe stdin [] / null / 5 with ATLAS_HOME=tmp: rc=0 all; faults=1 for the six listed

## Reproduction
python probe in isolated HOME/ATLAS_HOME

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
