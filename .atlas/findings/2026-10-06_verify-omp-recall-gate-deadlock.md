# verify-omp-recall-gate-deadlock: (3) PASS omp: mandates.ts arms only when a claude-mem search tool AND write are in activeTools; satisfiesRecall fires at tool_call (pre-execution) so a failing/unreachable server still satisfies. RISK (pre-existing) Python twin arms on plugin config only

- id: verify-omp-recall-gate-deadlock
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-06T23:04:36+00:00

## Evidence
- omp/mandates.ts:57-66 claudeMemRoute, :199-224; hooks/recall_gate.py:152 _claude_mem_enabled -> tool_routing.plugin_enabled (config), not tool availability

## Reproduction
read omp/mandates.ts, hooks/recall_gate.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
