# uri-write-paths: URI-scheme writes (agent://, xd://, proc://) are non-file writes across hooks

- id: uri-write-paths
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-05T20:26:22+00:00

## Evidence
- real dispatch_tripwire.py w/ seeded orchestrating DB: Write agent://X -> rc0 empty (allow); Write src/real.py -> permissionDecision deny; 10 PostToolUse agent:// writes then Read a.py -> allowed. hooks pytest 956 passed; only failure test_atlas_contract.py::InstalledParityContract (6 files differ from installed 9.0.0: completion_gate, dispatch_tripwire, docs_drift_watch, format_after_edit, prompt_optimizer differ; prompt_decision.py missing from install) = expected until reinstall. scripts pytest 964 passed. Caveat: docs_drift_watch/format_after_edit/completion_gate verified via source diff + unit tests, not driven live; HEAD-baseline run was inconclusive (symlink harness rc=1); SQL counter uses LIKE '%://%' (any path containing ://).

## Reproduction
cd plugins/atlas/hooks && python3 -m pytest -q -p no:cacheprovider; cd ../scripts && python3 -m pytest -q -p no:cacheprovider; python3 /tmp/demo.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
