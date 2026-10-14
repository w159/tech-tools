# After: measured results vs baseline (atlas 12.0.0 -> 12.1.2)

Live evidence: live-121.md (installed 12.1.1, round 1), live-122.md (installed 12.1.2, round 2).
Baseline: baseline.md.

## Per feature

| feature | before (12.0.0) | after (12.1.2, installed, live) | evidence |
|---|---|---|---|
| Band branding | no ATLAS mark in band | inverse ` ATLAS ` pill on every band row | live-121 C1, live-122 R1 |
| Band activity animation | one braille spinner; live capture showed the same glyph every sample | 6-frame phase tables; 7+ distinct glyphs in 12 captures at 2 s | live-121 C1 FAIL, live-122 R1 PASS |
| Band activity detail | worker name + tool | worker name + tool + target (`Bash sleep 6`) | live-121 C1, live-122 R1 |
| Worker age | reset on every tool call | monotonic across tool calls (0,1,4,4,7,10,12,12,15,18,19 s) | live-122 R1 |
| Idle row | could print stale `done` phase | ` ATLAS ⚑ idle · 0 open` | live-121 C2, live-122 R4 |
| Pane default tab | reopened on last tab (team) | opens on route, resets to route on close | live-121 C3, live-122 R4 |
| Claude subagent member finished | never (444 of 535 members open) | exit_code + ended_at at worker end | live-121 C4 FAIL, live-122 R2 PASS |
| Claude lead channel at exit | never cleaned | reaped 7 s after /exit, archived | live-122 R3 |
| Dead channel reaping (real registry) | 32 channels / 544 members / 453 unfinished | 7 / 71 / 33 after first lead open; archive has 26 channels | live-121 C5 |
| Registry growth per session | +1 channel per session, forever | net 0 after a CC + omp session pair (9/77/38 -> 9/77/38) | live-122 R8 |
| omp ATLAS widget | channel notes only | `ATLAS 🔍 research 0/2 · 1 live` header + worker row with spinner, <= 10 lines | live-121 C6 FAIL, live-122 R5 PASS, live-123 T2 PASS |
| omp worker finish | member finished only at lead exit; widget stuck at "1 live" 30 s+ | member finished while lead runs; widget "0 live" within ~3 s of worker end | live-122 defect, live-123 T1 PASS |
| omp header scoping | whole-board "839/870" and an open-todo "31 gates" proxy | this session's todos only ("0/2"), no proxy gate count | live-122, live-123 T2 PASS |
| omp header contract | style-only, no fallback | reply opens `ATLAS \| 🏁 done \| ...`; fallback rule when style off/fails | live-121 C7 |
| omp lead channel at exit | never cleaned | reaped 8 s after exit, archived | live-121 C8 FAIL, live-122 R6 PASS |
| channel-open faults | 22 in log, one per dispatch from a stale omp install | 0 new faults across both live rounds; stale install now one actionable fault per session | live-121 C8, live-122 R7 |
| omp hook coverage | delegation_prewarn, edit_read_nudge not bridged | bridged; contract test green | omp suite |
| Scope resolver | no code; 3 tier sources, 1 disagreeing (implementer) | one matrix, Python and TS resolvers, byte-identical repeat output; 0 disagreeing sources | live-121 C9, test_atlas_resolve |
| Install parity | omp ran stale enforcement | Claude Code and omp both 12.1.2, 78 runtime files match | atlas_doctor |

## Test suites

| suite | before | after |
|---|---|---|
| hooks | 1450 run, 6 failures | 1463 run, 1 failure (pre-existing condition_g, also fails on clean 12.0.0) |
| scripts | same 7 failures + 1 error as clean 12.0.0 | unchanged (no regressions) |
| omp | 374 pass / 1 fail | 396 pass / 0 fail |
| mod (host runner) | 255 pass, 0 mod failures | 267 pass, 0 mod failures (170 known load-only files) |
