# ATLAS-OMP-STALE-INSTALL: omp hooks survive plugin upgrade; session-start lead channel; stop/root fixes

- id: ATLAS-OMP-STALE-INSTALL
- status: verified
- verified_by: lead
- verified_at: 2026-10-19T20:51:41+00:00

## Evidence
- BootEnsureOmp repro: stale daemon on :7491 replaced via bridged ensure_dashboard after fix (pid/version flip); hook-faults.jsonl had 0 session_boot rows while channels faults named deleted install dirs
- bun test plugins/atlas/omp 472 pass; pytest scripts+hooks 1847 passed (2 fails: pre-existing TMUX_TMPDIR on HEAD, installed-parity expected before release)

## Reproduction
none recorded

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
