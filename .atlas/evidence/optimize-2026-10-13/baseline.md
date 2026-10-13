# Baseline before changes (atlas 12.0.0, 2026-10-13)

Measured before any edit in this run. Each row is re-measured after the change.

## Channel / subagent lifecycle (repo .atlas/.run)

| metric | value | source |
|---|---|---|
| channels in channels.json | 32 (31 lead + 1 main) | python json count |
| members total | 535 | same |
| members with no exit_code (never finished) | 444 | same |
| channels idle > 24h | 27 | same |
| largest channel | 210 members | same |
| board/*.jsonl | 275 files, 365 KB | ls |
| inbox entries | 717 | ls |
| dirty-snapshot-*.json | 263 | ls |
| tmux sessions / panes | 2 / 2 | tmux ls |
| reaper code | none (no prune/reap/archive for channels) | grep atlas_todo.py |
| Claude SubagentStop marks member finished | no (worker_report_gate validates only) | hooks.json:187 |

## Hook faults

| metric | value |
|---|---|
| atlas_doctor hook-faults | FAIL, 55 in 24h |
| channel-open fault cause | omp cache tech-tools___atlas___11.1.6 lacks scripts/atlas_todo.py (stale omp install), one fault per dispatch, no dedupe |
| atlas_doctor omp-bridge | FAIL (omp enforcement stale) |

## Test suites

| suite | result |
|---|---|
| hooks (unittest discover plugins/atlas/hooks) | 1450 run, 6 failures |
| omp + colony (bun test omp from plugins/atlas) | 625 pass, 7 skip, 4 fail (herdr client) |
| mod (bun test mod from plugins/atlas, wrong cwd) | 16 pass, 32 fail (load errors; correct invocation TBD by implementer) |

## Mod live defects (static source read, explorer-mod-visuals)

| defect | state |
|---|---|
| worker age resets on every tool call (orchestration.ts:80,90) | present |
| parked worker counted as working; idle row prints stale phase | present |
| pane reopens on last tab, default 'team' (register.ts:67) | present |
| Tab key does not cycle tabs; hint/doc mismatch | present |
| receipt duration uses host figure (9m02s for 77s turn) | present |
| band shows no ATLAS brand, single spinner for all phases, no tool target | present |

## Scoping determinism (explorer-scoping)

| metric | value |
|---|---|
| code that maps task class + effort to team | none (prose tables only) |
| tier sources | 3 (frontmatter, omp/atlas-agents.ts, squad-and-tiers.md) |
| known effort drift | implementer: Claude low, omp medium |
| path claims enforced | no (atlas_todo.py claim_paths has no callers) |

## omp parity (explorer-omp)

| metric | value |
|---|---|
| CC hooks not bridged to omp | delegation_prewarn.py, edit_read_nudge.py |
| omp header rule fallback when style render fails | none |
| omp channel close/reap at lead exit | none |
| omp phase/brand display | none (channel widget only) |
| test_omp_ignores_claude_output_style | passes now (7 tests OK) |
