# Atlas idle health summary, clickable controls, no key hints (17.23.0)

Shipped in atlas 17.23.0 (marketplace 5.28.0). Commits: `1969f892` (idle health), `0eea4af7` (no key hints, clickable), `9dab53f0` (idle polish), `4eb4e620` (idle and empty states at 110 and 150), `5dbacc36` (band drops its tab chips beside the side panel). Follow-up after critic round 3: `cad6fe65` (idle panel context gauge, live wait line, run facts once, readable recent events, chips without underline). Version stays 17.23.0; the follow-up and these docs are unpushed with the release.

## The ask

> I don't want to lose current visuals in the mods but I think there's a lot of room for improvement. For example, when there's no prompt out work yet the mods are looking like they're broken because it's all empty. There should be some health out performance type info. Just something small and dynamic so it always keeps what the users need to see right up front and clickable to expand and see more. The clickable elements should be visually distinguishable as being clickable. I don't want to see the keyboard keys because they don't work.

(Quoted as written; "no prompt out work" reads as "no prompt or work".) Reference video: `https://youtu.be/lDrAZ1wAyVs`.

## Before and after

Frames are Claude Code 2.1.325 in tmux, captured with `lc/tools/live_capture.py`. Before frames: `ui/before-150/idle-2.txt`, `ui/before-110/idle-2.txt`. After frames: `ui/h6-150/idle-2.txt`, `ui/h6-110/idle-2.txt` (release commit `70d7af1c`) and, for the final state at `cad6fe65`, `ui/h7-150/` and `ui/h7-110/` (`idle-*`, `work-*`, `click-*`). The panel blocks below are the h7 frames.

### 150 columns, side panel open

Before (band and the rows under it):

```
◖ ◆ ATLAS ◗ ○ idle ▌ todo - ▌ no agents                                                  [-]
 checks  ● completion  ● tripwire  ● routing  ● header  4/4 green
                r: status  t: team  c: channel  g: gates  k: core  o: board  ctrl+x tab
```

Panel status view before: `phase ○ idle`, `○ research › · · · ·`, `agents / no agents yet`, `events / no events yet`, `0 messages`, then blank rows and `r: status  t: team  c: channel  g: gates  k: core  o:…` on the last row.

After:

```
◖ ◆ ATLAS ◗ ○ idle ▌ ▸ health                                                            [-]
```

Panel status view after (`h7-150/idle-2.txt`, final):

```
 status   team   channel   gates   core   board
 phase  ○ idle
    ○ research › theory › test › implement › verify

    · waiting for first prompt

    health
      hooks    ● 1 event
    ▸ gates    ● 4/4 green · 11 checks pass

      session  up 0:11
      branch   master

      last run none this session

    recent
    11s ago  session started

    checks
    ● completion  1/1 pass
    ● tripwire    2/2 pass  Team mode: off
    ● routing     8/8 pass
    ● header      green
 ...
    ──────────────────────────────────────────────
    atlas 17.23.0 · hooks loaded
```

The footer reads 17.23.0: the h7 frames were captured from a plugin copy of the follow-up commit, after the version bump. (The release-commit frames h6 read 17.21.1 because they were captured before it.) The `·` before `waiting for first prompt` is the pulse's dim half; a frame at 13 seconds (`h7-150/work-00.txt`) shows `●`.

### 110 columns, no pane

Before:

```
◖ ◆ ATLAS ◗ ○ idle ▌ todo - ▌ no agents                                                                   [-]
 checks  ● completion  ● tripwire  ● routing  ● header  4/4 green
                                 r: status  t: team  c: channel  g: gates  k: core  o: board  ctrl+x tab
```

After:

```
◖ ◆ ATLAS ◗ ○ idle ▌ ● gates 4/4 ▌ up 0:09 ▌ ▸ health                                                     [-]
  last run none · 1 event
                                                              status  team  channel  gates  core  board
```

PNGs: `plugins/atlas/img/showcase/cc-idle-health-150.png`, `cc-idle-health-110.png`, `cc-health-open.png`, rendered with `ansi2png.py` from `h7-150/idle-2.ansi`, `h7-110/idle-2.ansi` and `h7-150/click-1-health.ansi`, so they show the final panel (waiting line, `checks` section, chips with a gap, no underline, footer `17.23.0`) and the band without tab chips beside the open panel. The release commit's `cc-health-open.png` came from before 5dbacc36 and showed those chips; this is recorded as done in `docs/ROADMAP.md`.

## Live click evidence

Real SGR mouse clicks sent into tmux against Claude Code 2.1.325 (not the mod test kit). Logs: `ui/h5-150-click.log`, `ui/h5-110-click.log`; frames `ui/h2-150/click-*`, `ui/h5-150/click-*`, `ui/h5-110/click-*`.

| Click | Result (from the logs) |
| --- | --- |
| `▸ health` on the band (150, with pane) | `▾ health` and a HEALTH card (`╭─ HEALTH ──╮`) drawn: True |
| `▾ health` again | `▸ health` back, card gone: True |
| `team` chip in the pane strip | team body shown with `no workers yet`, rule under `team`: True (150); rule under `team`: False at 110 |
| `gates` chip on the band | pane switched to the gates view (`4/4`, Completion gate, Dispatch tripwire ...): True |
| `▸ gates` row in the status view | `▾ gates  ● 4/4 green · 11 checks pass` with four detail lines (completion 1/1, tripwire 2/2, routing 8/8, header): True |
| `▸ session` row | row opened: True |
| `▸ health` on the 110 band | HEALTH card drawn, second click closes it: True |
| band `team` chip at 110 | pane opened on the team view: True |

At 110 columns the pane strip row was not found by the click script's row finder (`pane strip row: []`) and the rule under the lit tab was False; the click still switched the view. The 110 pane strip draws its names with single spaces, which the finder did not match.

## Context figure

The host's `session.measure` event carries `e.context.tokens`, `e.context.percent` and `e.context.window`. `register.ts` stores them as the usage figures. They describe the last response, not the session: tokens are the input side of the last response, percent is that count over the model window. Example from the test fixture: `63,000 tokens / 1,000,000 window = 6.3%`, shown as `context 6%`. In the final panel the figure is its own gauge row once the host has measured it (`h7-150/work-09.txt`: `context ▕█░░░░░░░░░▏ 6%` over `64k of 1M tokens`; the live run measured 64k, the fixture 63k). The session detail row says `measured on the last response, not a session total` (`mod/idle-health.ts:146`), so the percent is never read as cumulative use.

## Tests added

Counts are `bun test <file>` run on 2026-11-14 at the release commit (pass / fail):

| File | Covers | Result |
| --- | --- | --- |
| `mod/idle-health.test.ts` | idle band, HEALTH card and side panel health rows | 24 pass, 0 fail |
| `mod/no-key-hints.test.ts` | no key hints on the printed surfaces | 48 pass, 0 fail |
| `mod/idle-polish.test.ts` | one fact once, real expand detail, fitted rows, one clickable idiom | 37 pass, 0 fail |
| `mod/idle-polish2.test.ts` | idle and empty states, panel sized to content, band without chips beside the panel | 36 pass, 0 fail |
| `mod/idle-polish3.test.ts` (added in `cad6fe65`) | the follow-up fixes below | 17 tests; 15 of 16 failed against the pre-fix tree |

The four rows above are the counts at the release commit. Full suite at the release commit (`COLORTERM=truecolor bun test mod omp` in `plugins/atlas`): 4280 pass, 33 skip, 0 fail, 4313 tests across 265 files. At `cad6fe65`: 4297 pass, 33 skip, 0 fail in three colour modes; `tsc` clean; `pytest` 144 passed. Golden and layout tests that printed the old key rows were updated in `0eea4af7` (see `git show --stat 0eea4af7`).

## Critic rounds

Hostile design critics scored screenshots of the before and after frames against the ask.

| Round | Average | Lowest axis |
| --- | --- | --- |
| 1 | 6.7 | polish 5 |
| 2 | 6.7 | not recorded here |
| 3 | about 7.2 | polish 6.5 |

The fixes made after rounds 1 and 2 are the commits `9dab53f0`, `4eb4e620` and `5dbacc36`; the fixes after round 3 are `cad6fe65`. Scores are the critics' own; they are a design-quality signal, not a test.

### Round 3

Scored on `5dbacc36` (before `cad6fe65`), 1 to 10, before the fixes in this commit range and after them:

| Axis | Before | After |
| --- | --- | --- |
| Idle never looks empty | 3 | 7 at 150, 6 at 110 |
| Health info is useful | 2 | 7 |
| Dynamic | 2 | 6 |
| Clickables obvious | 3 | 7 |
| No key hints | 2 | 10 |
| Current visuals kept | 10 | 8 |
| Polish | 3 | 6.5 |

Average about 7.2 (rounds 1 and 2: 6.7). Verdict: fit to ship. The two top remaining defects were the blank middle of the 150-column panel and run facts repeated three times; both are addressed in `cad6fe65`. The after scores are the critic's reading of the final frames, a design signal and not a test.

## Follow-up fixes (cad6fe65)

Each row quotes before (`h6`, the release commit) and after (`h7`, final) from the captured frames. Tests are in `mod/idle-polish3.test.ts`.

| Fix | Test group | Before | After |
| --- | --- | --- | --- |
| A tall idle panel is not a slab of empty rows: a `waiting for first prompt` line, a `checks` section and a gauge fill the middle; 10 blank rows above the footer at 150 by 45 (counted from `idle-2.txt`) | 1 | 19 blank rows; `0 messages` then blanks | 10 blank rows; `· waiting for first prompt`, `checks` rows |
| The waiting line pulses with the idle redraw (about 1 Hz) and is gone once a run has ended | 2 | none | `· waiting for first prompt` / `● waiting for first prompt` |
| Run duration said once | 4 | `phase  ○ idle 0:02`, `last run 0:02 · ended 11:46 PM`, chat card `▸ run 0:02` | live `phase  ◒ working 0:03`; finished `phase  ● done` and `last run 0:05 · ended 12s ago` |
| The wall-clock `ended 11:46 PM` has no zone, so it reads as a relative age | 10 | `ended 11:46 PM` | `ended 0s ago` ... `ended 10s ago` |
| `recent` reads in words, same-second events collapse, at most 3 rows | 5 | `session.measure`, `turn.complete`, `classic.Stop`, `prompt.submit`, `session.start` (five rows) | `turn finished · 3 events`, `tool call Bash`, `prompt sent` |
| A narrow pane names the stage and `n/5` | 6 | `◓ research 0:01 › thy › test › impl › ver` | `◑ research 1/5` |
| No orphan `0 messages` row | 7 | `0 messages` | no row; with messages the count folds into the session row |
| HEALTH card: one row schema at both widths, note on its own line, version always shown | 8 | note glued on (`tripwire green 2/2 pass · Team mode: off`) | `tripwire green 2/2 pass`, `Team mode: off` on the next line, `atlas 17.23.0` |
| Context gauge as its own row once measured | 1 | `up 0:22 · context 6%` in the session row | `context ▕█░░░░░░░░░▏ 6%` over `64k of 1M tokens` |
| Every tab is a chip; one cell between chips; no underline rule; band footer chips spaced the same | 9 | ` status  team  channel ...` over `━━━━━━` | ` status   team   channel   gates   core   board`, no `━` row |

Click frames for the final tree are `h7-150/click-*` and `h7-110/click-*`.


## Not done

- The chat card `▸ run 0:05` and the band `done 0:05` still repeat the panel's run duration.
- The idle pulse is about 1 Hz; a faster pulse needs a timing change in `register.ts`.
- The `ATLAS` pill is unchanged on purpose.
- tmux PgUp/PgDn and the weekly-limit line are drawn by the host.
