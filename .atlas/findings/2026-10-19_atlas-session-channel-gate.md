# ATLAS-SESSION-CHANNEL-GATE: session-start lead channel only in real projects

- id: ATLAS-SESSION-CHANNEL-GATE
- status: verified
- verified_by: lead
- verified_at: 2026-10-19T20:56:02+00:00

## Evidence
- before: channel-open in mktemp dir created .atlas; after: --only-project returns skipped, dir empty; git repo gets channel
- pytest test_atlas_todo SessionStartChannelGate 3 passed; test_atlas_todo+test_session_boot 140 passed; bun test omp 472 pass

## Reproduction
none recorded

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
