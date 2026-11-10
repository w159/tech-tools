# Atlas terminal UI redesign (2026-11-10, Atlas 17.3.0 to 17.4.0)

Ask: the owner found the 17.3.0 terminal display confusing. Redesign the band, the omp mission panel, the sidebar,
toasts and the doctor report so each fact appears once, in plain words, with colour that means something. Spec:
`docs/specs/2026-11-10_atlas-terminal-ui.md`.

## 1. What was wrong in 17.3.0

Evidence is a live 17.3.0 Claude Code session in a 150x45 pane, listed in the spec's "What was wrong" section.

| # | Finding (live capture) | Why it hurt |
|---|---|---|
| 1 | Task progress shown three times: the TODO tree said 1/1, a `board` bar said 6/6 and a `tasks` bar said 6/6. | Three numbers for one fact, and the first disagreed with the other two. |
| 2 | Gate results shown three times: `g: core ✗4` in the sidebar, `gates ✖4` in the band title, `✖4` in the core row. | One failure read as three. |
| 3 | Jargon with no labels: `CONTRACT hdr 2/2 ev 7/7 ✖4   VERDICT ✔1 ✖0 ?0 ⚠0`. | A reader could not tell what `hdr`, `ev` or the four counts meant. |
| 4 | Decoration that carried no meaning: a violet-to-sky gradient title bar, a different hue per phase, character faces per worker (`◔_◔`), an elapsed bar that filled over two minutes, a sparkline with no axis or label. | Colour and motion did not map to state, so real state (a failed worker, a blocked run) did not stand out. |
| 5 | Two hand-synced renderers, `mod/band.tsx` and `omp/mission-panel.ts`, that had already drifted twice (the 17.3.0 rail fix was one of them). | Every layout change had to be made twice and could diverge. |

## 2. What changed, by surface

- **Layout (both harnesses).** One module, `mod/mission-layout.ts`, produces tone-tagged runs. `mod/band.tsx` and
  `omp/mission-panel.ts` are thin adapters that paint them. `contracts/band-golden.ts` asserts that both print the same
  text.
- **Band and omp panel rows.** Header with `N of M tasks` and a thin bar (elapsed clock while running); stepper
  `✓ ⠋ ○`; worker rows in plain words (`running`, `thinking`, `starting`, `waiting`, `failed`, `finished`) with failed
  and waiting first; the newest message on one row; a `checks` footer. Below 80 columns the band is one row.
- **Idle core row.** Labelled groups: `contract`, `verdicts`, `offload`, `route`. Evidence joins the contract group
  only when the row has room.
- **Removed.** Gradient title bar, per-phase hues, worker faces, unlabelled sparklines. Violet is the one accent; green,
  amber and red are always paired with a word.
- **Claude Code HUD.** The Subagents block is dropped; the band's worker rows show the same agents. omp draws its own
  block, which Atlas does not control.
- **Sidebar.** Tab bar with the active tab accented and the failing count on the gates tab; a vertical route list.
  The other views and the board panel use the Catppuccin Mocha tones, and the omp board panel matches the Claude Code
  one.
- **Toasts.** Plain sentences, still one per turn.
- **Doctor (`scripts/atlas_doctor.py`).** Failures and warnings with wrapped details, one line for passing checks, one
  for checks that do not apply, then a verdict line. Colour only on a TTY and only when `NO_COLOR` is unset.

## 3. Test evidence

Run from this tree on 2026-11-10:

| Suite | Command | Result |
|---|---|---|
| Bun (mod and omp) | `bun test mod omp`, from `plugins/atlas` | 1720 pass, 2 fail (the 2 `omp/gen-agents.test.ts` failures below) |
| Type check | `bunx tsc -p mod/tsconfig.json --noEmit` | exit 0 |
| Telemetry receiver | `node --test`, from `telemetry/server` | 38 pass, 0 fail |
| Version check | `python3 scripts/check_versions.py` | `version check: ok` |
| Attribution | `python3 scripts/check_attribution.py origin/main..HEAD` | `no Claude attribution found` |
| Python | `.venv.nosync.noindex/bin/python -m pytest -q -p no:cacheprovider -n 8` | 8464 passed, 0 failed |

Goldens that pin the layout: `contracts/band-golden.ts` (asserted by `mod/band-golden.test.ts` and
`omp/mission-panel-golden.test.ts`), `contracts/core-golden.ts` (`mod/core-row.test.ts`, `omp/core-row.test.ts`),
`mod/pane/sidebar.golden*.ts`. Doctor rendering is covered by `scripts/test_atlas_doctor.py`.

## 4. Known limits

- On the idle core row, evidence shows only from about 123 columns. Narrower rows drop it so the other groups stay
  whole.
- omp is verified through its renderer and the shared goldens only. It was not run in a live omp session.
- `omp/gen-agents.test.ts` has 2 bun failures (`Export named 'replaceTabs' not found in module '@oh-my-pi/pi-tui'`).
  The installed `@oh-my-pi/pi-tui` lacks that export; the same two failed in the 17.3.0 audit. It is an environment
  mismatch, not caused by this change.
- `scripts/test_atlas_mux.py::StatusKillTests::test_status_board_only_lists_this_runs_workers` had a timing race in the
  test: it called status before the fake harness wrote Alpha's board file. It now waits with `_wait_exit`.
  `atlas_mux.py` is unchanged from 17.3.0. `scripts/test_atlas_doctor_display.py` now asserts the new doctor format.

## 5. Live capture after the redesign

A second live Claude Code capture found four problems, now fixed:

| # | Finding | Fix |
|---|---|---|
| 1 | The newest message row read `explorer-a843 -> all joined`. | Band and omp message row skip presence messages (join, leave, exit, merge). |
| 2 | Dispatch-only boards showed no task count in the header while the HUD TODO tree showed 0/2; the sidebar route view said `nothing planned`. | Header counts board rows when the route total is 0; the route view lists unphased rows under the current phase; omp `todoSummary` uses the same `planCounts`. |
| 3 | A plain Agent call carries no name, so workers showed as `explorer`, `explorer-a843`. | A `<slug>: ` prefix of the Agent description names the worker; two same-role workers show task slugs. |
| 4 | The sidebar team summary ignored failed workers and showed zero counts. | It counts failed workers and drops zero counts. |
