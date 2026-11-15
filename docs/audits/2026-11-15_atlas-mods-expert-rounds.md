# Atlas mods: expert rounds and paired critic scores (2026-11-15)

Release: atlas 17.25.0. Scope: the Claude Code mods (band, side panel, HEALTH card, narrow idle strip). Changelog: `plugins/atlas/CHANGELOG.md`. Architecture: `docs/architecture/atlas-mod.md`.

## Result

The target was a panel mean of 8 for Atlas. It was not reached. Atlas moved from 4.97 (the 17.23.0 build) to 5.33 in a fresh session and to 5.75 in a session that has history from an earlier run in the same project. btop scored 7.75 in the same fresh run and 7.80 in the seeded run; btop itself averages 7.75 on this panel across all eight runs (7.55 to 7.85), so a mean of 8 would have meant beating btop. The best Atlas result is the seeded session, mean 5.75 (sonnet 6.3, fable 6.1, haiku 5.6, opus 5.0); the best single score is 6.3 from sonnet-5-5 on that run. All four models ranked btop first, htop second and Atlas third in every run, and every verdict was "atlas at or above btop: no".

## Method

- Paired critics. Four Claude models (claude-opus-5-5, claude-sonnet-5-5, claude-fable-5-2, claude-haiku-5-5) each get one prompt that contains three subjects and score them side by side on one scale: btop and htop (captured by the same harness, screenshots plus three plain-text frames a second apart at 150 and 110 columns) and Atlas (screenshots plus every plain-text frame: idle, working, expanded and clicked states). Pairing keeps the scores comparable; an unpaired score of Atlas alone drifts. Prompts: `run-pair.sh` (fresh session) and `run-pair-seed.sh` (seeded session, history from an earlier session in the same project), in the scratchpad `critics/` directory.
- Bar: a senior terminal-UI designer who has shipped work at the level of btop, lazygit, k9s, Charm/Lip Gloss, Textual and Ratatui showcases, told to be hostile and specific.
- Scoring dimensions, 1 to 10 each, where 9 to 10 means expert grade with nothing to fix: (1) information hierarchy, (2) alignment and spacing grid, (3) typography and density, (4) color restraint and semantic color, (5) liveness and motion, (6) data value (history, trends, rates, not just point values), (7) empty, idle and low-data state, (8) clickable affordance and one consistent control idiom, (9) consistency across views (band, panel, card) and between 150 and 110 widths, (10) overall expert grade.
- Out of scope for the critics (host-drawn): Claude Code's prompt box and spinner line, transcript text, tmux notices, the weekly-limit line, the cwd path, the pane's close mark, the `[-]` right of the band, the pane's left border. Atlas limits told to the critics: text cells only, no images, no Nerd Font icons, clicks through buttons, frame tick of 100 ms or less; owner rules: keep the visual identity, no printed key hints, clickable things look clickable, idle is never empty.
- Each critic output ends with `PAIR: atlas n.n btop n.n htop n.n`, `RANK:` and `VERDICT:`. The table below is computed from those PAIR lines, not retyped.
- Rounds before the paired runs (r1 and r2, unpaired, Atlas alone: means 4.33 and 4.25, against a baseline of 3.78) used a different protocol and are not in the table.

## Scores by round

Each model's cell is its own average of the ten dimensions for Atlas. The three right-hand columns are the means over the four models. Round labels are the critic run names: p0 is the 17.23.0 build (before this release), v3 is the tabs and health card (rounds V), w2 round W, x round X, y2 round Y, z round Z, aa round AA in a fresh session, aas the same build in a seeded session.

| round | opus-5-5 | sonnet-5-5 | fable-5-2 | haiku-5-5 | atlas mean | btop mean | htop mean |
|---|---|---|---|---|---|---|---|
| p0 17.23.0 baseline | 4.6 | 4.7 | 5.4 | 5.2 | 4.97 | 7.82 | 6.70 |
| v3 v3 tabs | 4.3 | 5.2 | 5.3 | 5.0 | 4.95 | 7.78 | 6.53 |
| w2 W2 band | 4.8 | 5.3 | 5.2 | 5.1 | 5.10 | 7.85 | 6.53 |
| x X one widget set | 4.8 | 5.7 | 5.3 | 5.7 | 5.38 | 7.70 | 6.53 |
| y2 Y2 layout | 4.9 | 5.4 | 5.8 | 5.3 | 5.35 | 7.78 | 6.62 |
| z Z polish | 4.7 | 5.5 | 5.5 | 5.7 | 5.35 | 7.55 | 6.65 |
| aa AA fresh session | 5.2 | 5.4 | 5.3 | 5.4 | 5.33 | 7.75 | 6.53 |
| aas AA seeded session | 5.0 | 6.3 | 6.1 | 5.6 | 5.75 | 7.80 | 6.40 |

Arithmetic (the script reads the last `PAIR:` line of each of the 32 critic files and averages per round):

```python
import re,sys
S="<scratchpad>/critics"
models=["claude-opus-5-5","claude-sonnet-5-5","claude-fable-5-2","claude-haiku-5-5"]
rows=[("p0","17.23.0 baseline"),("v3","v3 tabs"),("w2","W2 band"),("x","X one widget set"),("y2","Y2 layout"),("z","Z polish"),("aa","AA fresh session"),("aas","AA seeded session")]
print("| round | opus-5-5 | sonnet-5-5 | fable-5-2 | haiku-5-5 | atlas mean | btop mean | htop mean |")
print("|---|---|---|---|---|---|---|---|")
for k,name in rows:
    a=[];b=[];h=[]
    for m in models:
        t=open(f"{S}/{k}-pair-{m}.md").read().strip().splitlines()
        p=[l for l in t if l.startswith("PAIR:")][-1]
        x=re.match(r"PAIR: atlas ([\d.]+) btop ([\d.]+) htop ([\d.]+)",p)
        a.append(float(x[1]));b.append(float(x[2]));h.append(float(x[3]))
    f=lambda v:f"{sum(v)/len(v):.2f}"
    print(f"| {k} {name} | "+" | ".join(f"{v:.1f}" for v in a)+f" | {f(a)} | {f(b)} | {f(h)} |")
```

Reading the table: Atlas rose 0.36 from p0 to aa (fresh) and 0.78 to aas (seeded). Fresh-session scores were flat from round X (5.38) to AA (5.33); the five rounds after X moved nothing the critics could measure on a fresh session. btop and htop did not move (7.55 to 7.85 and 6.40 to 6.70), which is the check that the scale held still.

## Before and after

Before is the 17.23.0 build (`ui/h12-150`, `ui/h12-110`); after is 17.25.0 captures (`ui/aa-150`, `ui/aa-110`; seeded: `ui/aas-150`, `ui/aas-110`). Excerpts trimmed to the Atlas columns.

Band at idle, 150 columns:

```
before  ◖ ◆ ATLAS ◗ ○ idle                   ▌ ● gates ok   ▌ ▁▁▁▁▁▁▃▁ 1/5m   ▌        ▸ health  [-]
after   ◖ ◆ ATLAS ◗ ◌ idle up 0:13    │  ○ gates armed › │ ▁▁▁▁▅▁▁▁ peak 1 / 5s                  [-]
```

Band when the run is done, 150 columns (after):

```
after   ◖ ◆ ATLAS ◗ ● done 6/6        │  ● gates ok ›    │ ▁▁▆█▁▁▁▁ peak 3 / 5s                  [-]
```

Band at idle, 110 columns, no pane (before) and pane docked at rest (after):

```
before  ◖ ◆ ATLAS ◗ ○ idle                   ▌ ● gates ok   ▌ ▁▁▁▁▁▁▃▁ 1/5m   ▌  · session started      ▸ health  [-]
after   ◖ ◆ ATLAS ◗ ◌ idle      │  ○ gates armed › │ ▁▁▁▁▁▅▁▁    [-]
```

Side panel at idle, 150 columns:

```
before                                           after
── PHASE ───────────────────────────             ── NOW ─────────────────────────────────
   ○ research ○ theory ○ test ...                    ◌ idle · no prompt yet
── ACTIVITY ─────────────── 1 in 5m ──              armed: 4 gates · 6 hooks · team off
        4                                         ── ACTIVITY ──────────────── 1 ev · peak 1 / 5s
        0 ⣀⣀⣀⣀⣀⣿⣿⣿⣿⣿⣀⣀                             2┤                                ▄
          -2m           now                         0┤·········──────────────────────█───
          1 event · 1.0/min · peak 1                                 -2m       -1m        now
── CONTEXT ───────────────────────────            ── GATES ──────────────────────────────
        ████████████ —                               ○ 4 gates armed · 0 checks yet
── RUNS ──────────────────────────────            ── HOOKS ──────────────────────────────
        ▁▁▁▁▁▁▁▁▁▁▁▁  no runs yet                    ○ 6 hooks wired · last session.start 13s
```

The same idle panel in the seeded session (history from an earlier session):

```
── NOW ─────────────────────────────────────
    ◌ idle · no prompt yet · prev run 0:04 ok
── RUNS ────────────────────────────────────
    █▅▆  3 runs · med 0:04
── GATES ───────────────────────────  pass deny last
    ○ completion                          1    0 prev
    ○ tripwire                            1    0 prev
```

A tab (gates, 150 columns, after a run):

```
── GATES ───────────────────────────  pass deny last
 ▾ ● completion                          1    0  26s
     ├ ● Code changes delegated                    —
     └ ● Last Stop allowed                        ok
── HOOKS ──────────── p50 8ms · amber>100ms red>500ms
    hook · last 64 calls                 n   p50 last
    session.start                        1     —  40s
    tool.call                            1  22ms  29s
```

Showcase images (`plugins/atlas/img/showcase/`): `cc-idle-health-150.png`, `cc-idle-health-110.png` and `cc-health-open.png` are the after frames (`aa-150/idle-2`, `aa-110/idle-2`, `aa-150/c-5-health-card`), and `cc-seeded-idle-150.png` is `aas-150/idle-2`. They were recaptured at 17.25.0, so their footers read `atlas 17.25.0`.

## Click tests

Real SGR mouse presses sent to a tmux session running Claude Code 2.1.325 with the mod loaded (`aaclick.py`; captures `ui/aac-150` and `ui/aac-110`). The per-step log file of the final capture was not kept; the results below were read back from the saved frames (`c-*.txt`). The previous round's logs (`z/click-150.txt`, `z/click-110.txt`) and `aa/click-110.log` have the coordinates.

| Step | 150 columns | 110 columns |
|---|---|---|
| tabs team, channel, gates, core, board, status | each click changes the header (`SIDEPANEL · <tab>`) and the body | same; all six chips on one row, `channel` shown as `chan`, no `more ›` or `‹ back` chip |
| band `● gates ok ›` | opens the gates tab | opens the gates tab |
| host close mark | pane closes | pane closes |
| band `▸ health` (pane closed) | card opens, `▾ HEALTH` title and `▾ health` chip | card opens |
| card title | collapses the card, `▸ health` chip returns | not verified: the click on `+N more ›` opened the status panel instead, so the card state after it is not a collapse test |
| band `▸ health` again, then band `▾ health` | card reopens, then closes, chip returns | not run |

The z logs of the earlier round show the same 150 result and, at 110, `more ›` and `‹ back` chips on the strip that no longer exist in the final build.

## ROADMAP checks made for this release

- Run duration printed once per view: `aa-150/work-12.txt` has `█ 0:06 ok` once and the band `● done 6/6`; `aa-150/c-5-health-card.txt` has `█ 0:05 ok` once; the 110-column frames match.
- Idle animation: `mod/band-motion.ts` `idleRamp` is a 24-phase, 2.4 second triangle; the three 256-colour idle frames show the pill fill at xterm 97, 135 and 55.

## Gate commands

From `plugins/atlas`:

```
COLORTERM=truecolor bun test mod omp                 4975 pass, 33 skip, 0 fail (5008 tests, 290 files)
env -u COLORTERM bun test mod omp                    4975 pass, 33 skip, 0 fail (5008 tests, 290 files)
env -u COLORTERM TERM=dumb bun test mod omp          4975 pass, 33 skip, 0 fail (5008 tests, 290 files)
bunx tsc -p mod/tsconfig.json --noEmit               exit 0, no output
python -m pytest -q hooks/test_atlas_contract.py hooks/test_nudge.py     144 passed, 3 skipped, 142 subtests passed
python3 scripts/atlas_mod_gate.py --live --require-live                 mod gate: PASS (4 pass, 0 fail, 0 skip), live claude plugin test 1 pass
```

From the repository root: `python3 scripts/check_versions.py`, `python3 scripts/check_attribution.py origin/main..HEAD`, and the fast CI jobs that run on push to main (`.github/workflows/tests.yml`: tests, telemetry-server, atlas-bun, atlas-mod-gate, attribution; `version-check.yml`). The `full` job (whole root pytest plus `bun test`) and `atlas-mod-gate-latest` (non-blocking, needs the newest published CLI) were not run.
