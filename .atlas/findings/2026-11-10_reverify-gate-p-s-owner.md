# reverify-gate-p-s-owner: (p)/(s) session ownership by run.json lead_session; worker sessions exempt

- id: reverify-gate-p-s-owner
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-10T09:18:10+00:00

## Evidence
- plugins/atlas/hooks/completion_gate_core.py _team_records, _is_worker_session; /tmp/reverify/drive.py 1a 1b 1c 1d 2

## Reproduction
python3 /tmp/reverify/drive.py 1a|1b|2 (real completion_gate.py on stdin)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
