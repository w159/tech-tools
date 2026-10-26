# tripwire-false-positives: dispatch_tripwire allows system-temp writes and plural spec labels

- id: tripwire-false-positives
- status: verified
- verified_by: orchestrator-test-run
- verified_at: 2026-09-28T10:12:01+00:00

## Evidence
- plugins/atlas/hooks/test_dispatch_tripwire.py 77/77 OK

## Reproduction
python3 -m unittest discover -s plugins/atlas/hooks -p test_dispatch_tripwire.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
