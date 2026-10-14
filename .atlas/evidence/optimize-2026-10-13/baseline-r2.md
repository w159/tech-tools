# Round 2 baseline (installed 12.1.3, before the redesign)

User feedback: "doesn't seem to perform any better than before and ui/ux is same".

## UI (live-123.md, explorer-uxcaps)

| item | value |
|---|---|
| band rows | 1 text row: `ATLAS ◎ research 0/0 ▱▱▱▱▱ · ◝ explorer 1s · ▸ /atlas-cc` |
| borders / fills / Raster used | none (0 uses of borderStyle, backgroundColor, Raster) |
| transcript restyle of Agent/Task rows | none |
| channel messages in transcript | plain |
| unasked pane floor | 110 cols in code; engine places unasked panes only from 144, so 110-143 cols shows nothing |
| Tab cycling | not bound; engine has no global key API, only Button hotkey/action |

## Orchestration (explorer-colony, ~/.atlas/atlas.db, last 7 days)

| metric | value |
|---|---|
| default worker transport | in-process Agent/Task; tmux panes opt-in via ATLAS_COLONY_TRANSPORT |
| Agent+Task calls | 691 |
| median dispatch burst per run | 1 (median per-run max 1.5, max 21) |
| dispatches.wave_id populated | 0 of 1899 |
| atlas_resolve.py invocations | 0 |
| prompts carrying SCOPE: | 8 of 166 runs |
| SendMessage calls | 3 (all lead) |
| worker-to-worker board notes | 246 of 712 (mostly dev pane squads) |

## Hook latency (explorer-perf, scratch dir, 10 runs each)

| event | hooks | serial median ms |
|---|---|---|
| SessionStart | 2 | 223 |
| PreToolUse Bash | 4 | 178 |
| PreToolUse Edit | 3 | 130 |
| PostToolUse Edit | 4 | 202 |
| Read call (pre+post) | 4 | 190 |
| Edit call (pre+post) | 7 | 330 |
| Stop | 5 | 219 |
| python3 floor | - | 30 |
| slowest hook | atlas_doctor.py --hook | 145 |

## Faults

| item | value |
|---|---|
| hook faults 24h | 63, of which 55 are format_after_edit "formatter skipped: missing" (not real faults) |
