# OH-1043-context-budget: SessionStart additionalContext ~1.1 KB with no static style rules; recallGate 279->197 B

- id: OH-1043-context-budget
- status: verified
- verified_by: SessionVerifier
- verified_at: 2026-10-09T15:12:54+00:00

## Evidence
- measured: session_boot.py under temp HOME (ATLAS_DASHBOARD=off) additionalContext = 1102 B (claim 1094; +8 B from env-dependent todo-board line); content has no repeated style rules
- contracts/mandates.json recallGate: HEAD 279 B -> working tree 197 B (measured)
- omp contracts/index tests pass. Pre-change 2987/2864 B baselines not re-measured

## Reproduction
echo '{...SessionStart}' | HOME=$(mktemp -d) ATLAS_DASHBOARD=off python3 hooks/session_boot.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
