# PV-07-yield-finish: stop-bridge marks a sub finished on ANY successful yield, including incremental type:[...] sections omp treats as non-terminal; CHANGELOG says terminal yield

- id: PV-07-yield-finish
- status: rejected
- verified_by: ParityVerifier
- verified_at: 2026-10-09T18:01:01+00:00

## Evidence
- stop-bridge.ts:502 checks only toolName===yield && !isError; omp agent-session.ts:10336-10347 #isTerminalYieldToolResult excludes status success + non-empty string[] type; /tmp/pv/view.test.ts PROBE: incremental yield -> finished [Alpha]; view then stops after 3 quiet polls while the sub still works

## Reproduction
cd /tmp/pv && bun test view.test.ts

## Proposed fix
mirror omp predicate: skip when result.details.status===success && Array.isArray(type) && type.length

## Doc refs
- none

## History
- no earlier verdicts
