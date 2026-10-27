# PV-05b-doctor-cwd: Follow-up: cache-run doctor (__file__ in cache, CLAUDE_PLUGIN_ROOT=cache) picks the cwd source checkout; cwd=/tmp -> None (marketplace clone fallback)

- id: PV-05b-doctor-cwd
- status: verified
- verified_by: ParityVerifier
- verified_at: 2026-10-09T18:01:01+00:00

## Evidence
- B cache-doctor ref (cwd=repo): .../tech-tools/plugins/atlas; C CLAUDE_PLUGIN_ROOT=cache: same; D cwd=/tmp: None

## Reproduction
python3 heredoc patching atlas_doctor.__file__ to the cache path

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
