# Atlas core mods: before and after evidence

Date: 2026-10-27. Branch `claude/atlas-mods-live-core` (local only). Plan: `docs/plans/2026-10-27_atlas-core-mods.md`.

Surface: a real Claude Code 2.1.311 session in tmux (170x50) started with
`claude --plugin-dir plugins/atlas` in a scratch repo that holds a real Atlas run (one `fix/low` team,
two `verify/low` teams, tmux transport). Captures are `tmux capture-pane -p` output.

## 1. Band never drew (before)

```
● atlas: ui.render hook skipped: threw HooksError: atlas: state.set: denied: it was made while ui.render is being dispatched, and drawing is pure (a render ...
❯
```

No band, no pane. Cause: the AbovePrompt render opened the docked pane and wrote `$.state`.

## 2. Band after the render fix, before the core work

```
 ◆ ATLAS  ·  idle                                                                gates ✖3   [-] │
  ◆ RESEARCH ▶ theory ▶ test ▶ implement ▶ verify ▶ done                                        │
 tasks                    0/0  r: route  t: team  c: channel  g: gates  o: board                │
```

It draws, but nothing shows verdicts, offload or routing.

## 3. After: band core row and status line (full width)

```
 ◆ ATLAS  ·  idle                                                                                                          gates ✖2   [-]
  ◆ RESEARCH ▶ theory ▶ test ▶ implement ▶ verify ▶ done
  CONTRACT  hdr - ev - ✖2   VERDICT  1 claim · ✔ 1 verified · ✖ 1 refuted · ? 0 open · ⚠ 0 unchecked   OFFLOAD  17.9k→608 30x   ROUTE  verify/low sonnet ✔ +2
...
  ⚠ atlas: atlas ✔1 ✖1 ⚠0 ⇆30x
```

With the pane docked (band narrower) the same row compacts:

```
  CONTRACT  hdr - ev - ✖2   VERDICT  ✔1 ✖1 ?0 ⚠0   OFFLOAD  17.9k→608 30x   ROUTE  verify/low sonnet ✔ +2
```

## 4. After: pane core view (hotkey g)

```
r: ◎ route │ t: ● team │ c: ✉ channel │ g: ◈ core ✗2 │ o: ▤ board
CONTRACT  the operating contract, live
  - header    - replies opened with the ATLAS header
  - evidence  - done items carry evidence
  - verified  - done items have a verified finding
  ✗ gates     2 open, listed under GATES

VERDICTS  1 claim, 1 verified, 1 refuted, 0 open, 0 unchecked
  ✓ mean-fix        verified   calc.mean fixed for [2,4,6],[],[1,2],[5]; …
  ✗ mean-iterable   REFUTED    calc.mean does not accept iterators; mean(…

OFFLOAD  17.9k kept in tmux, 608 returned, 30x
  implementer-0278  sonnet-5-5   58.8k held   7.0k kept   151 back  $0.16
  verifier-16de     sonnet-5-5   59.4k held   6.8k kept   251 back  $0.15
  verifier-b6e2     sonnet-5-5   59.1k held   4.1k kept   206 back  $0.17

ROUTE  decision model: class/effort -> seats -> model run
  verify/low  gencheck  shared, max 1
    → 1× verifier sonnet/medium  ran claude-sonnet-5-5 ✓
  verify/low  meancheck  shared, max 1
    → 1× verifier sonnet/medium  ran claude-sonnet-5-5 ✓
  fix/low  meanfix  shared, max 1
    → 1× implementer sonnet/medium  ran claude-sonnet-5-5 ✓

GATES  what the Stop gate will check
```

## 5. After: /atlas-core (works with no UI)

```
❯ /atlas-core
  ⎿  atlas: CONTRACT
       header    - replies opened with the ATLAS header
       evidence  - done items carry evidence
       verified  - done items have a verified finding
       gates     2 open
     VERDICTS  1 claim, 1 verified, 1 refuted, 0 open, 0 unchecked
       verified  mean-fix  calc.mean fixed for [2,4,6],[],[1,2],[5]; unittest passes
       REFUTED  mean-iterable  calc.mean does not accept iterators; mean(iter([1,2,3])) raises TypeError
     OFFLOAD  17.9k kept in tmux, 608 returned (30x)
       implementer-0278  claude-sonnet-5-5  peak 58.8k  kept 7.0k  returned 151  cost $0.16
       verifier-16de  claude-sonnet-5-5  peak 59.4k  kept 6.8k  returned 251  cost $0.15
       verifier-b6e2  claude-sonnet-5-5  peak 59.1k  kept 4.1k  returned 206  cost $0.17
     ROUTE
       fix/low  meanfix  shared, max 1
         1x implementer sonnet/medium  ran claude-sonnet-5-5
       verify/low  meancheck  shared, max 1
         1x verifier sonnet/medium  ran claude-sonnet-5-5
       verify/low  gencheck  shared, max 1
         1x verifier sonnet/medium  ran claude-sonnet-5-5
```

## 6. Tests

| Check | Before | After |
| --- | --- | --- |
| `claude plugin test plugins/atlas` | 331 pass, 178 fail | 375 pass, 178 fail (all 178 are the pre-existing omp/colony files that import bun:*) |
| `claude plugin validate plugins/atlas` | pass | pass |
| `bunx tsc --noEmit -p plugins/atlas/mod/tsconfig.json` | 26 errors | 26 errors, same list |

## 7. After: omp mission panel core row

omp is not installed in this container, so this is `renderPanel` from `omp/mission-panel.ts` on the same
real-run fixture, ANSI stripped (bun):

```
--- 160 cols ---
 ◆ ATLAS  ·  mission control  ·  demo@master  ·  wave 1                                              ◷ 00:00   1 live   ✔ gates
  ✓ research ▶ ✓ theory ▶ ✓ test ▶ ✓ implement ▶ ◆ VERIFY ▶ done
  CONTRACT  hdr - ev - ✖2   VERDICT  1 claim · ✔ 1 verified · ✖ 1 refuted · ? 0 open · ⚠ 0 unchecked   OFFLOAD  17.9k→608 30x   ROUTE  verify/low sonnet ✔ +2

  RUN   ◉_◉ verifier-b6e2           verifier     bash        python3 -m unittest          █████████▊        ▁▁▁▁▁▁▁▁▁▁▁▁     42s
--- 120 cols ---
  CONTRACT  hdr - ev - ✖2   VERDICT  ✔1 ✖1 ?0 ⚠0   OFFLOAD  17.9k→608 30x   ROUTE  verify/low → verifier sonnet ✔ +2
```

The row text matches `contracts/core-golden.ts` byte for byte (omp `core-row.test.ts` parity tests).

## 8. After the verifier's fixes

Live band after the fixes (button hint now names the core view):

```
  CONTRACT  hdr - ev - ✖2   VERDICT  ✔1 ✖1 ?0 ⚠0   OFFLOAD  17.9k→608 30x   ROUTE  verify/low sonnet ✔ +2
 tasks                    0/0  r: route  t: team  c: channel  g: core  o: board
  ⚠ atlas: atlas ✔1 ✖1 ⚠0 ⇆30x
```

| Check | Result |
| --- | --- |
| `claude plugin test plugins/atlas` | 382 pass, 179 fail (all "did not load" files under omp/ or colony/; the 179th is the new omp test, which needs bun) |
| `cd plugins/atlas/omp && bun test` | 500 pass, 4 skip, 0 fail (baseline 488), two runs |
| `claude plugin validate plugins/atlas` | pass |
