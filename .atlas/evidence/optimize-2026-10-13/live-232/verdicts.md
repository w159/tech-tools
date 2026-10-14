# live-232 verdicts: installed atlas 12.3.1, Claude Code + omp, 2026-10-14

Sessions: atlv9-cc (plain `claude`, lead-85c17b, run 2770) and atlv9-omp (plain `omp`, lead-01a138, run 2774). Both killed at the end. Team sessions atlas-t5aac31 and atlas-tab80d5 were reaped by their leads.

| Capture | Verdict | What the frame shows |
|---|---|---|
| cc-band-running.png | PASS | Mission-control band `wave 1 · audit/low`, `2 live`, two RUN rows with live tool (Bash), detail (`sleep 20`, `wc -l ...`), bar and sparkline, channel ticker, gate pills. The `✖ completion` pill shows red while a clean read-only wave is still running. |
| cc-band-idle.png | PASS | Calm grey idle bar: `last wave: 2 workers · 48s · ✔ ok · $1.27`, phase strip all checked to DONE. The red "blocked" bar from live-230 is gone. An amber `gates ✖1` chip remains. The explorer-banda report bubble ends at `DELIVERABLE:` with nothing after it. |
| cc-card.png | PASS | Card for explorer-cardd: `explorer · sonnet·low`, goal, `now Bash python3 "/Users/jerry/MEGA/Projects/Agen · 5s · 2 tools`, band row `wave 3 · audit/low`. The `now` detail is a truncated path to atlas_todo.py, which tells the viewer nothing. |
| cc-card-done.png | PASS | Same card flipped in place to `✓ explorer-cardd ... done STATUS: DONE · 42s`, report bubble with 4 evidence lines, trailing `✔ explorer-cardd done` line, idle band `last wave: 1 worker · 54s`. |
| cc-header.png | PASS | `◆ ATLAS ⚑ DONE` pill header over the reply, then the idle band and phase strip. |
| cc-scope-deny.png | PASS | Red `✗ explorer-noscope explorer · ✖ denied` card with goal and deny reason; the full DENY text with absolute resolve/spawn-team paths below. A leftover `Initializing...` line sits under the card. The deny text paths point at `/Users/jerry/MEGA/Projects/Agentic/osprey/assets/plugins/cache/...` (symlink target) while SessionStart uses `~/.claude/plugins/cache/...`. Both resolve to the same file. |
| cc-team-lead.png | PASS | Lead ran the absolute installed paths. spawn-team was not denied. The lead band shows the team: `mission control · wave 4`, `3 live`, RUN rows for explorer-f61a, explorer-e2d5, completeness-critic-7c3f with tools (ctx_shell, ToolSearch). The band header leaves out `audit/medium`, the ticker still shows the old explorer-cardd message, and the tripwire pill is red. |
| cc-team.png (cc-team-pane-1..3.png) | PASS | Composed atlas-t5aac31 window: a full-width top pane and two half panes. Each has a full-width gradient header, goal, `#lead-85c17b` channel plus peers, timestamped tool chips, and peer-sync notes (`→ explorer-e2d5`, `→ completeness-critic-7c3f`), with a `working` footer showing tools/tok/cached. Workers report that `ctx_shell` permission was denied, so they used Bash for sleep. |
| omp-widget.png | PASS (with defects) | omp widget mid-run: `mission control · audit/medium`, `3 live`, `✖ 1 gates`, three rows with tool/detail (search, read README.md:1-5). All three rows are labelled THINK while the workers are using tools. The progress bar renders as vertical stripes. The member appears as `critic-78b5` in the rows but as `completeness-critic-78b5` in the ticker. The phase strip stays on RESEARCH. The channel is `#lead-01a138`, the same lead id as live-230's omp run. |
| omp-widget-idle.png | PASS (with defect) | Captured about 3 s after the reap JSON: idle band `last wave: 3 workers · 1m29s · ✔ ok` with a full phase strip. This was FAIL in live-230. A stale `⎋ Reaping team tab80d5` status line stays above the band after the reap finished. |

## Team flow evidence (CC)

SessionStart line, quoted by the lead:
`Team flow (absolute paths, use verbatim): python3 "/Users/jerry/.claude/plugins/cache/tech-tools/atlas/12.3.1/scripts/atlas_resolve.py" <class> <effort> --paths a,b ; python3 "/Users/jerry/.claude/plugins/cache/tech-tools/atlas/12.3.1/scripts/atlas_mux.py" spawn-team --class C --effort E --paths a,b --task "..." ; ... wait --team T ; ... reap --team T`

Command run: `python3 "/Users/jerry/.claude/plugins/cache/tech-tools/atlas/12.3.1/scripts/atlas_mux.py" spawn-team --class audit --effort medium --paths plugins/atlas/README....` -> `{"ok": true, "team_id": "t5aac31", ..., "wave_logged": true, "run_id": 2770, ...}`; wait -> all exit 0 `STATUS: DONE`, `notes_worker_to_worker: 6`, `elapsed_s: 26.6`; reap -> `killed: true, session_left: false, channels_reaped: 1, prompts_removed: 3`. The lead ran the commands first and quoted the line afterward, not before as the prompt asked. Full text: `cc-team-lead-scrollback.txt`.

omp: spawn tab80d5 run 2774, `harness: omp`, explorers level `low`, critic `medium` (live-230 showed `off`); wait `notes_worker_to_worker: 6, elapsed_s: 84.6`; reap `channels_reaped: 1` (live-230 showed 0). Full text: `omp-lead-scrollback.txt`.

## Defects seen

1. Idle band `last wave` duration keeps growing after the wave ends: `1 worker · 1m24s`, then `1m49s`, then `2m54s` for a 42 s worker. The same band read `54s` right after the wave finished.
2. After the 3-worker tmux team wave, the CC idle band still read `last wave: 1 worker · 2m54s`. The team wave is not recorded as the last wave in CC. omp correctly showed `3 workers`.
3. CC lead band header for the team wave reads `wave 4` with no `audit/medium`, and the ticker kept the stale explorer-cardd line.
4. Agent-tool dispatches (6826-6829) still log `wave_id NULL`. The omp critic row stores `anthropic/claude-sonnet-5-5:medium` while every other row stores `sonnet`.
5. Transcript duplication in CC: the `✔ explorer-cardc done` line and the lead's DONE reply printed two or three times in scrollback (lines 29-42 of carddone2.ansi).
6. Report bubbles cut off at `DELIVERABLE:` (explorer-banda), so the deliverable content is not visible.
7. The cardc card briefly showed a stale spinner (`now 4s · 0 tools`) after the worker had finished. It later flipped to `✓ ... done`.
8. The dispatch-hook REPORT check rejects `REPORT: STATUS: DONE plus the lines` as an empty REPORT, because it parses `STATUS:` as a new label. The hook warned and said it would deny the next dispatch.
9. Workers' `ctx_shell` calls are permission-denied in team panes (all three CC workers), so they fell back to Bash.
10. Harness blocks a standalone foreground `sleep 25` in subagents. Not an atlas bug, but it breaks sleep-based demos.
11. omp: all rows labelled THINK while tools run, striped progress bar, `critic-78b5` vs `completeness-critic-78b5` naming, phase strip stuck on RESEARCH, stale `Reaping team` line after reap, and the lead id `lead-01a138` reused across omp sessions.
12. The deny message shows the symlink-resolved osprey path instead of the `~/.claude/plugins` path that SessionStart prints. Functionally equivalent, but inconsistent.

## Fixed since live-230

- spawn-team not denied by the inline-op gate. The lead used the absolute installed 12.3.1 paths, not repo source.
- The CC lead band shows the tmux team lanes (live-230 showed idle).
- The idle band after a clean wave is calm grey, not red "blocked".
- omp idle band shows after reap (live-230 showed nothing). omp reap now closes the channel (`channels_reaped: 1`).
- omp levels now low/medium (live-230 showed `off`). Team rows have model filled.
- Stop gate (p) was not raised.
- The denied card no longer shows a `sonnet·low` scope it never resolved.
