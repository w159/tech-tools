# 2026-11-13 gap and status line, atlas 17.15.0 to 17.15.1

Owner report on 17.15.0: "the mods create a large empty space between the prompt window and bottom of the mod. It's also making the status-line disappear."

## Method

Real `claude` 2.1.323 in tmux, `--plugin-dir <tree>/plugins/atlas`, a scratch project outside the user's home config, `--settings` with a `statusLine` command (`atlas_statusline.py` as README documents, `refreshInterval 5`, and in a second run the control `echo STATUSLINE-OK`), `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `CLAUDE_CODE_ENABLE_TASKS=0`. Trees: atlas-v17.14.0 (4df72e1b), main 9da0e431 (17.15.0), and the fixed tree. Each run: idle after start, then the prompt "Use TodoWrite to make 3 todos, then run python3 -c 'import time; time.sleep(40)'", captured at 15 s (working) and at 65 s (done) with `tmux capture-pane -p`. Sizes 150x45 and 110x40 fullscreen (the host default), 150x45 inline (`CLAUDE_CODE_NO_FLICKER=0`) and 100x26.

Columns: `prompt` is the row of the prompt line, `last` the row of the last drawn content row above the prompt's top rule (the mod, or the host spinner when the mod is off), `blank` the count of blank rows between them (the side panel's border is not counted as content), `status` the status line rows under the prompt. One blank row is the host's own spacer: it is there with the mod off (control run, `ATLAS_MOD=off`: spinner row 39, blank row 40, rule 41) and on 17.14.0.

## Bisect (live, 150x45, working)

| commit | blank rows between the mod and the prompt |
|---|---|
| atlas-v17.14.0 | 1 (host spacer) |
| f8b5cf1e wave 30 | 1 |
| 0ed6e55b merge of wave 30 | 1 |
| 0a2fba13 wave 31 | 5 |
| 9da0e431 main (17.15.0) | 8 |

First bad commit for the gap: 0a2fba13 "wave 31 one HUD block", `plugins/atlas/mod/slot.ts` composeFixed, the line `const pad = Math.max(0, total - BAND_KEEP_ROWS - hud.length);` returned as `pad` and drawn by `register.ts` as a `Box({ height: plan.pad })` under the HUD (`atlasSlot`). In 0a2fba13 the pad is slot.ts:83 (`total - BAND_KEEP_ROWS - hud.length`, with the unused budget as `lead` rows above the band). Wave 32 (72a4f2bc) changed it to `budget - BAND_KEEP_ROWS - hud.length` and dropped `lead` (slot.ts:85, slot.ts:87 on main), which gave 8 blank rows at 150x45 (budget 13, HUD 5), 6 at 110x40 and 29 in the inline renderer (budget 34).

Status line: the `starved` flag (`register.ts` `hudStarvedAtFullLine` and `shownAt`, published to `.atlas/.run/hud-state.json`; `atlas_statusline.py` `hud_starved`) exists in atlas-v17.14.0 as well (8 and 2 mentions), so there is no single bad commit for the mechanism; what 17.15.0 changed is how often it fires. The HUD of 17.15.0 (SUBAGENTS table, fixed TODO columns) wants 13 to 15 rows with three to five agents; probe over the wave 32 harness at 110x40: three running, budget 11, wanted 13, shown 7, `starved=true`; five running, wanted 15, shown 7, `starved=true`. An ordinary orchestrated run therefore marked the status line starved and it printed one row instead of its grid (live: 100x26 working, `starved: true`, one status row, on 17.14.0 and 17.15.0 alike, because a bare three-row plan already wants more than that slot gives). I did not reproduce a status line that vanishes entirely; what reproduces is the collapse of the grid to one row. 17.15.1 stops publishing `starved` (always false), so the grid always prints.

## Before (17.15.0, main 9da0e431)

| capture | prompt | last | blank | status |
|---|---|---|---|---|
| 150x45 fullscreen, working | 39 | 29 | 8 | 4 rows |
| 110x40 fullscreen, working | 34 | 26 | 6 | 4 rows |
| 110x40 fullscreen, done | 34 | 26 | 6 | 4 rows |
| 150x45 control status line, working | 42 | 29 | 11 | 1 rows |
| 110x40 control status line, working | 37 | 26 | 9 | 1 rows |
| 150x45 inline, working | 38 | 7 | 29 | 4 rows |
| 100x26 fullscreen, working (status line starved) | 23 | 19 | 2 | 1 rows |

hud-state.json at 100x26 working on 17.15.0: `{"maxRows":7,"wanted":5,"shown":5,"fullscreen":true,"starved":true}`, status line one row: `  📁  proj   ⏱ 0m41s    👾  Haiku 5.5  ·  medium · ctx 6%`.

17.15.0, 150x45 fullscreen, working, bottom of the pane (rows 24 to 45; the mod is rows 24 to 29, rows 30 to 37 are blank):

```
◖ ◆ ATLAS ◗ ⠧ working 0:20 ▌ todo 1/3 ▌ no agents                                        [-] │
╭─ ◖ ◆ ATLAS ◗ ▸ TODO  1/3 ▰▰▰▱▱▱▱▱ ───────────────────────────────────────────────────╮     │
  ● Create 3 todos                           done     lead                 -                 │
▸ ◓ Run python3 sleep(40) command            running  lead                 -                 │
  ◇ Report the result                        queued   -                    -                 │
╰─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS none running yet ───────────────────────────────────────────╯     │
                                                                                             │
                                                                                             │
                                                                                             │ r: status  t: team  c: 
                                                                                             │
                                                                                             │
                                                                                             │
                                                                                             │
                                                                                             │
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  📁  proj   ⏱ 1m06s    👾  Haiku 5.5  ·  medium
  📚  ctx   6% ▅▁▁▁▁▁▁▁▁▁▁▁▁▁  62.7k / 1M        │  💰  session       plan    63.0k tok  cache 99%
  ⏳  5h   --% ▁▁▁▁▁▁▁▁▁▁▁▁▁▁                    │  🔌  anthropic     plan    63.0k tok  claude-haiku-5…
  📅  7d   43% ▅▅▅▅▅▅▁▁▁▁▁▁▁▁  4d22h anthropic   │
  ⏵⏵ auto mode on (shift+tab to cycle)
```

17.15.0, 110x40 fullscreen, working, bottom of the pane:

```
◖ ◆ ATLAS ◗ ⠼ working 0:15 ▌ todo 0/3 ▌ no agents        [-] │
╭─ ◖ ◆ ATLAS ◗ ▸ TODO  0/3 ▱▱▱▱▱▱▱▱ ───────────────────╮     │
▸ ◑ Make 3 todos with Todo… running  lead             -      │
  ◇ Run python3 sleep(40)…  queued   -                -      │
  ◇ Report the bash comman… queued   -                -      │
╰─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS none running yet ───────────╯     │
                                                             │ r: status  t: team  c: channel  g: gates  k: …
                                                             │
                                                             │
                                                             │
                                                             │
                                                             │
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  📁  proj   ⏱ 0m41s    👾  Haiku 5.5  ·  medium
  📚  ctx   6% ▅▁▁▁▁▁▁▁▁▁▁▁▁▁  62.1k / 1M        │  💰  session       plan    62.4k tok  cache 99%
  ⏳  5h   --% ▁▁▁▁▁▁▁▁▁▁▁▁▁▁                    │  🔌  anthropic     plan    62.4k tok  claude-haiku-5…
  📅  7d   43% ▅▅▅▅▅▅▁▁▁▁▁▁▁▁  4d22h anthropic   │
  ⏵⏵ auto mode on (shift+tab to cycle)
```

17.15.0, 150x45 inline, working (the mod is rows 1 to 7 of the visible screen, 29 blank rows follow):

```
▸ ◒ Run the 40-second sleep command          running  lead                 -
  ◇ Report the sleep result                  queued   -                    -
╰─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS none running yet ──────────────────────────────────────────────────────────────────────────





























──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  📁  proj   ⏱ 0m40s    👾  Haiku 5.5  ·  medium
  📚  ctx   6% ▅▁▁▁▁▁▁▁▁▁▁▁▁▁  62.3k / 1M        │  💰  session       plan    62.4k tok  cache 99%
  ⏳  5h   --% ▁▁▁▁▁▁▁▁▁▁▁▁▁▁                    │  🔌  anthropic     plan    62.4k tok  claude-haiku-5…
  📅  7d   43% ▅▅▅▅▅▅▁▁▁▁▁▁▁▁  4d22h anthropic   │
  ⏵⏵ auto mode on (shift+tab to cycle)
```

## After (17.15.1)

| capture | prompt | last | blank | status |
|---|---|---|---|---|
| 150x45 fullscreen, idle | 39 | 37 | 0 | 4 rows |
| 150x45 fullscreen, working | 39 | 36 | 1 | 4 rows |
| 150x45 fullscreen, done | 39 | 36 | 1 | 4 rows |
| 110x40 fullscreen, idle | 34 | 32 | 0 | 4 rows |
| 110x40 fullscreen, working | 34 | 31 | 1 | 4 rows |
| 110x40 fullscreen, done | 34 | 31 | 1 | 4 rows |
| 150x45 control status line, working | 42 | 39 | 1 | 1 rows |
| 110x40 control status line, working | 37 | 34 | 1 | 1 rows |
| 150x45 inline, working | 24 | 21 | 1 | 4 rows |
| 150x45 inline, done | 28 | 25 | 1 | 4 rows |
| 100x26 fullscreen, working | 20 | 17 | 1 | 4 rows |

Every `blank` of 1 is the host spacer (same count on 17.14.0 and with the mod off); idle shows 0 because the band's own hint row sits there. The status line text is present in every capture: the Atlas grid (`ctx`, `5h`, `7d` rows) with the Atlas script, `STATUSLINE-OK` with the control. hud-state.json after the fix: 150x45 `{"maxRows":13,"wanted":5,"shown":5,"fullscreen":true,"starved":false}`; 100x26 `{"maxRows":4,"wanted":5,"shown":3,"fullscreen":true,"starved":false}` (the HUD folds to three rows, the status line keeps its four).

17.15.1, 150x45 fullscreen, working:

```
                                                                                             │
✶ Creating (15s · ↓ 578 tokens)                                                              │
◖ ◆ ATLAS ◗ ⠼ working 0:15 ▌ todo 1/3 ▌ no agents                                        [-] │
╭─ ◖ ◆ ATLAS ◗ ▸ TODO  1/3 ▰▰▰▱▱▱▱▱ ───────────────────────────────────────────────────╮     │ r: status  t: team  c: 
  ● Create 3 todos for the sleep task        done     lead                 -                 │
▸ ◑ Run the 40-second sleep command          running  lead                 -                 │
  ◇ Report the sleep result                  queued   -                    -                 │
╰─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS none running yet ───────────────────────────────────────────╯     │
                                                                                             │
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  📁  proj   ⏱ 0m41s    👾  Haiku 5.5  ·  medium
  📚  ctx   6% ▅▁▁▁▁▁▁▁▁▁▁▁▁▁  62.4k / 1M        │  💰  session       plan    62.5k tok  cache 100%
  ⏳  5h   --% ▁▁▁▁▁▁▁▁▁▁▁▁▁▁                    │  🔌  anthropic     plan    62.5k tok  claude-haiku-5…
  📅  7d   43% ▅▅▅▅▅▅▁▁▁▁▁▁▁▁  4d21h anthropic   │
  ⏵⏵ auto mode on (shift+tab to cycle)
```

17.15.1, 110x40 fullscreen, working:

```
◖ ◆ ATLAS ◗ ⠼ working 0:15 ▌ todo 1/3 ▌ no agents        [-] │
╭─ ◖ ◆ ATLAS ◗ ▸ TODO  1/3 ▰▰▰▱▱▱▱▱ ───────────────────╮     │ r: status  t: team  c: channel  g: gates  k: …
  ● Create 3 todos for the… done     lead             -      │
▸ ◑ Run python3 sleep(40)…  running  lead             -      │
  ◇ Report the result of t… queued   -                -      │
╰─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS none running yet ───────────╯     │
                                                             │
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  📁  proj   ⏱ 0m41s    👾  Haiku 5.5  ·  medium
  📚  ctx   6% ▅▁▁▁▁▁▁▁▁▁▁▁▁▁  62.1k / 1M        │  💰  session       plan    62.4k tok  cache 99%
  ⏳  5h   --% ▁▁▁▁▁▁▁▁▁▁▁▁▁▁                    │  🔌  anthropic     plan    62.4k tok  claude-haiku-5…
  📅  7d   43% ▅▅▅▅▅▅▁▁▁▁▁▁▁▁  4d21h anthropic   │
  ⏵⏵ auto mode on (shift+tab to cycle)
```

17.15.1, 150x45 control status line (`echo STATUSLINE-OK`), working:

```
◖ ◆ ATLAS ◗ ⠼ working 0:15 ▌ todo 1/3 ▌ no agents                                        [-] │
╭─ ◖ ◆ ATLAS ◗ ▸ TODO  1/3 ▰▰▰▱▱▱▱▱ ───────────────────────────────────────────────────╮     │ r: status  t: team  c: 
  ● Create 3 todos with TodoWrite            done     lead                 -                 │
▸ ◑ Run python3 sleep(40) command            running  lead                 -                 │
  ◇ Report the sleep result to the user      queued   -                    -                 │
╰─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS none running yet ───────────────────────────────────────────╯     │
                                                                                             │
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  STATUSLINE-OK
  ⏵⏵ auto mode on (shift+tab to cycle)
```

17.15.1, 150x45 inline, working:

```
╭─ ◖ ◆ ATLAS ◗ ▸ TODO  0/3 ▱▱▱▱▱▱▱▱ ──────────────────────────────────────────────────────────────────────────────────
▸ ◑ Run the 40-second sleep command          running  lead                 -
  ◇ Confirm the sleep command exited cleanly queued   -                    -
  ◇ Report the result to the user            queued   -                    -
╰─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS none running yet ──────────────────────────────────────────────────────────────────────────

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  📁  proj   ⏱ 0m40s    👾  Haiku 5.5  ·  medium
  📚  ctx   6% ▅▁▁▁▁▁▁▁▁▁▁▁▁▁  62.0k / 1M        │  💰  session       plan    62.4k tok  cache 99%
  ⏳  5h   --% ▁▁▁▁▁▁▁▁▁▁▁▁▁▁                    │  🔌  anthropic     plan    62.4k tok  claude-haiku-5…
  📅  7d   43% ▅▅▅▅▅▅▁▁▁▁▁▁▁▁  4d21h anthropic   │
  ⏵⏵ auto mode on (shift+tab to cycle)
```

17.15.1, 100x26 fullscreen, working (status line in full, HUD folded):

```
◖ ◆ ATLAS ◗ ⠴ working 0:15 ▌ todo 1/3 ▌ no agents                                               [-]
╭─ ◖ ◆ ATLAS ◗ ▸ TODO  1/3 ▰▰▰▱▱▱▱▱ ──────────────────────────────────────────────────────────╮
  ● 1 done  ◇ 1 queued  ⠴ 1 more running
╰─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS none running yet ──────────────────────────────────────────────────╯

────────────────────────────────────────────────────────────────────────────────────────────────────
❯
────────────────────────────────────────────────────────────────────────────────────────────────────
  📁  proj   ⏱ 0m41s    👾  Haiku 5.5  ·  medium
  📚  ctx   6% ▅▁▁▁▁▁▁▁▁▁▁▁▁▁  62.2k / 1M        │  💰  session       plan    62.5k tok  cache 99%
  ⏳  5h   --% ▁▁▁▁▁▁▁▁▁▁▁▁▁▁                    │  🔌  anthropic     plan    62.5k tok  claude-h…
  📅  7d   43% ▅▅▅▅▅▅▁▁▁▁▁▁▁▁  4d21h anthropic   │
  ⏵⏵ auto mode on (shift+tab to cycle)
```

## Regression tests

`mod/gap-statusline.test.ts` (10 tests). On 9da0e431's `slot.ts` and `register.ts` all 10 fail (pad 4 to 10 rows under the HUD at 145, 105, 93 and 56 cells; the status test reads `starved: true`); on the fix all 10 pass. The tests render the whole slot through idle, working, blocked and done, with five agents folded, at 150x45 and 110x40 (with and without the docked pane).
