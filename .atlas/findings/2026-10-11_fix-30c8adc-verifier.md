# fix-30c8adc-verifier: 30c8adc independent re-verification: 5 of 6 fix surfaces verified; 2 caveats (squad pane stale zeros pre-measure; no regression test for unreadable-Stop-payload FAIL-OPEN branch)

- id: fix-30c8adc-verifier
- status: verified
- verified_by: VerifyFixCommit
- verified_at: 2026-10-11T04:44:22+00:00

## Evidence
- mod/register.ts:170-176,196-203: $.agent.list() added inside rebuild, not a new hot loop; rebuildTick (REBUILD_MS=1500, register.ts:17,279) gates rebuild on dataFingerprint change
- mod/register.ts:121-126: persona preserved from spawn record, unlisted spawn-records kept, cap slice(-64); session.start:265-266 resets usage+taskAgents then rebuild:273 re-syncs from host list
- mod/band.tsx:132-166 buildConveyor per-figure null checks -> 'ctx --'/'-- tok'/'$--'; absent usage prop falls back to snapshot numbers; snapshot.ts:100-102 measured-or-0 for contract fields
- mod/routing.ts:57-66 records generic task spawns persona 'unknown'; herdr.ts:197 mergeSquad resolves unknown via personaOf, no crash
- completion_gate.py:1034-1056 live subprocess: malformed JSON -> exit 0 + FAIL-OPEN line; binary -> exit 0 + FAIL-OPEN line; EMPTY stdin -> exit 0 SILENT (readable={} branch)
- omp bun test: 373 pass/0 fail/22 files EXIT=0; renderOmpStyle() probe: 9621 chars, no CLAUDE_CODE_ENABLE_TODO_TOOLS, no ENABLE_TOOL_SEARCH; style.test.ts:152-157 pins strip+source
- claude plugin test: 226 pass/169 fail, all 169 failing files colony/ or omp/ bun:test load residuals, zero under mod/
- CAVEAT 1: mod/pane/squad.tsx:227 renders snapshot.tokens/costUsd which are ?? 0 pre-measure (snapshot.ts:100-102) -> Squad tab still shows '0 tok / $0.00' unmeasured; CAVEAT 2: no test pins the new unreadable-Stop-payload FAIL-OPEN branch (message string exists only at completion_gate.py:1053; FailOpenVisibleTest test_completion_gate.py:3591-3606 covers the crash path, not this branch)
- CAVEAT 3: host agent appearance on an idle board is deferred until next dataFingerprint change (no rebuild trigger on agent.spawn/turn.complete); spawn-record fallback covers atlas spawns only

## Reproduction
cd plugins/atlas/omp && bun test  ->  373 pass / 0 fail; claude plugin test . (plugins/atlas) -> 226 pass / 169 fail all load residuals; printf '{not json' | python3 plugins/atlas/hooks/completion_gate.py -> exit 0 + FAIL-OPEN stdout

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
