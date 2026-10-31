# Display parity, Atlas 16.11.0 (2026-10-31)

Real Claude Code 2.1.314 sessions (fresh install of this tree, same Atlas task, 2 to 3 subagents) captured with tmux at 24, 30, 40 and 50 rows, beside the omp reference captures. Each file is the visible screen at that height while subagents ran.

| Rows | omp | Claude Code inline (default renderer) | Claude Code fullscreen |
|---|---|---|---|
| 24 | Subagents + agent rows + Waiting line; TODO only as a one-row board summary | TODO tree rows, Subagents + agent rows, Waiting line, band | TODO summary row, Subagents + agent row; band yields |
| 30 | TODO tree (header scrolled off), Subagents, Waiting, band | TODO tree (header on screen in 4 of 8 running frames), Subagents + agent rows, Waiting, band | TODO summary row, Subagents + agent row, Waiting, compact band |
| 40 | full TODO tree, Subagents, Waiting, band | full | full |
| 50 | full | full | full |

Running-frame counts per height are in the round 4 notes of the display parity thread; inline at 30 rows: TODO tree 8 of 8, Subagents and an agent row 8 of 8.

## Claude Code limits (not fixable from a mod)

- Fullscreen renderer caps the whole bottom area (prompt, status line, Claude Code's own agent list and Atlas widgets) at half the screen. Claude Code 2.1.314 binary: `Math.min(Math.max(mn,Math.floor(a.rows/2)),D-q)`. No setting changes it. At 24 rows that leaves about 4 rows for Atlas.
- Claude Code's own agent list ("● main" plus one row per agent) under the prompt cannot be hidden and takes rows from the same area.
- The "Waiting on ... agents" line in Claude Code is Claude Code's own; omp's "Waiting for N background jobs" wording is omp's.

## atlas-doctor

doctor/doctor-before.txt: WARN display-renderer ("tui": "fullscreen"). doctor-fix.txt: --fix sets "tui": "default" and the status line refreshInterval. doctor-after.txt: PASS. Undo with /tui fullscreen.
