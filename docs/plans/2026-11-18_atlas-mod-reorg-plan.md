# Atlas mod reorganization plan (audit section 4.3)

Date: 2026-11-18
Owner: planner-mod (atlas:planner) for lead-bbfaed, board item t49de0c54
Goal: move `plugins/atlas/mod` into the section 4.3 layout (host, data, design, view/{band,hud,panel,board,transcript}, motion, input), split `mod/register.ts` into modules under `mod/host/`, and give every round-named test a subject-based name, with `cd plugins/atlas && bun test mod` green after every commit.
Source audit: `docs/audits/2026-11-18_atlas-contract-header-mod-audit.md` sections 4.1, 4.2 (M3) and 4.3.
Status: plan only. Nothing in the repo was moved or edited except this file. Evidence marks used below: **[MEASURED]** run in this checkout today, **[DRY-RUN]** run on a scratch copy outside the repo (section 9), **[assumed]** not read or not run, **[UNVERIFIED]** no failable check exists yet.

Paths in the map and in section 6 are relative to `plugins/atlas/mod/` unless they start with `plugins/`, `docs/`, `scripts/`, `hooks/`, `omp/`, `contracts/` or `.`.

## 0. Answers in short

- **Entry point.** The host loads `plugins/atlas/mod/register.ts` because `plugins/atlas/hooks/hooks.json:159-160` lists `"../mod/register.ts"` under `"modules"`. Six other places pin the same path (section 5). The entry keeps its path and becomes a thin file that re-exports from `mod/host/`.
- **Files.** 357 files under `mod/` (352 tracked, 5 untracked): **184 moved, 84 renamed, 19 merged into another test file, 70 staying**. `mod/register.ts` is counted as renamed (to `host/hooks.ts`) and its path is re-created as the thin entry.
- **Stages.** S0 (prep, no moves), S1-S11 (one target folder per stage, tests move with their sources), S12 (register.ts split), S13 (docs, baselines, CHANGELOG sweep), plus optional S14 (panel-layout.ts split). That is 14 required stages. Stages S1-S6, S9 and S10 carry a second commit for their merges.
- **Dry run.** Stages S1-S11 were applied to a scratch copy with a TypeScript-API rewriter and a 357-file map. S1-S6 stayed green (4296 tests); S7-S11 failed only on tests that read a moved file by path (five readers of `register.ts`, `round-x`, the `theme` M4 scan) or compute a path (`consistency.test.ts`), plus the mod-gate script (section 9); every one is on the S0 or S7 hand-edit list. The 2,179 import edits and 167 path-literal edits needed no hand work.
- **Biggest hidden risks.** (1) Two scan tests turn into silent no-ops when moved, because they scan their own folder. (2) Six tests read `register.ts` as text and slice it by string anchors. (3) The 72 module-level `let` variables in `register.ts` are written from several future modules, so the split needs one shared state object, which also changes three source-text assertions. (4) The audio paths `mod/fx/*.wav` are plain strings, not imports.
- **No STOP condition fired.** The entry point is determined (hooks.json:159-160). No 4.3 target collides with an existing folder: `mod/data/` already exists and is a target; `mod/pane/` and `mod/fx/` move under new parents; `mod/design/`, `mod/host/`, `mod/input/`, `mod/motion/`, `mod/view/` do not exist yet.

## 1. Baselines [MEASURED 2026-11-18, dirty tree]

| What | Command (from `plugins/atlas` unless noted) | Result |
|---|---|---|
| mod tests | `bun test mod` | 4265 pass, 31 skip, 0 fail; `Ran 4296 tests across 247 files` (244 test files under `mod/` plus 3 outside it whose path contains the substring `mod`: `omp/resolve-model.test.ts`, `scripts/dashboard_ui/js/agents-store-model.test.js`, `scripts/dashboard_ui/js/model-picker.test.js`) |
| omp tests | `bun test omp` | 839 pass, 4 skip, 0 fail; 843 tests across 54 files |
| typecheck | `bunx tsc --noEmit -p tsconfig.json \| grep -c 'error TS'` | 892. By code: TS2307 377 (all `'claude-code'`), TS7006 309, TS6142 158, TS2591 22, TS2339 6, TS2305 6, TS2345 4, TS18046 4, TS2322 3, TS5083 1 (host types `.claude-plugin/types/tsconfig.json` are gitignored and absent). TS2307 on a relative specifier: **0** |
| host load gate | `python3 plugins/atlas/scripts/atlas_mod_gate.py --live --require-live` (repo root) | PASS, 4 checks, live `claude plugin test` probe 1 pass (`claude` is at `/opt/node22/bin/claude`) |
| python tests that name mod paths | `python3 -m pytest -q -p no:cacheprovider scripts/test_atlas_mod_gate.py scripts/test_analytics_contract.py scripts/test_atlas_doctor_display.py hooks/test_atlas_contract.py` | 237 passed, 4 skipped |

The raw tsc total is a weak check: breaking one relative import in the scratch copy left the total at 892 (one TS2307 gained, one other error lost) while the relative-TS2307 count went 0 to 1. Every stage therefore checks the filtered counts, not only the total.

## 2. Preconditions

- **P1, clean tree.** `git status --short plugins/atlas/mod` shows 20 modified files and 5 untracked files today (`data/datastate.ts`, `data/datastate.test.ts`, `data/tally.ts`, `data/tally.test.ts`, `look.test.ts`). `git mv` fails on untracked files, and move diffs must not mix with those fixes. The owner commits (or stashes) that work first; re-measure section 1 afterwards and use the new numbers as B0 below.
- **P2, commit identity.** Per `CLAUDE.md` rule 6: author `W159 <49504268+w159@users.noreply.github.com>`, no `Co-Authored-By: Claude` or `Claude-Session:` lines, and `python3 scripts/check_attribution.py origin/main..HEAD` before any push. This overrides the generic attribution reminder.
- **P3, one writer.** Stages rewrite the whole tree, so they run strictly one after another. `[CONCURRENT WITH: none]` for every stage.
- **P4, tool.** S0 commits `scripts/mod_reorg.mjs` (Node plus the TypeScript compiler API; `typescript` 6.0.2 resolves at `/opt/node22/lib/node_modules/typescript` [MEASURED]). Prototypes that did the dry run: `/tmp/claude-0/-home-user-tech-tools/bbfaed12-29e6-53ab-90ed-6bdf3a88b336/scratchpad/{mapgen.py,sim_apply.js,runstage.sh,regsplit2.py}` (scratch, may be cleared; section 8 specifies the behavior so they can be rebuilt).

## 3. (a) Move map

Layout that results (counts are files moved into each folder, tests included):

| Target | Sources that land there | Notes |
|---|---|---|
| `host/` | `discipline`, `hook-log`, `gates` (named in 4.3); `notify`, `usage`, `motion-feed` [placed, not named in 4.3]; 28 test files; at S12 `register.ts` becomes `hooks.ts` plus six new modules | |
| `data/` | `idle-health`, `metrics`, `history` (named); `pulse`, `snapshot` [placed]; 6 tests | `datastate`, `tally` already here |
| `design/` | `atlas-ui`, `theme`, `look` (named, as is); `paint`, `runs`, `vocab`, `roles`, `rail`, `chart`, `spark` [placed] | 4.3 names `tokens.ts`, `glyphs.ts`, `env.ts`, which do not exist; `atlas-ui.ts` moves whole, its split is the M1/M2/M5 work, not a move (open question 2) |
| `view/band/` | `band.tsx`, `band-frame`, `band-motion`, `mission-layout` (named); `core-row`, `slot` [placed] | |
| `view/hud/` | `hud`, `hud-surface`, `status-frame`, `card-frame` (named); `strip-frame` [placed] | |
| `view/panel/` | `panel-layout`, `tabs-frame`, `pane/` to `view/panel/pane/` (named) | `panel-layout` split is S14 |
| `view/board/` | `board-model` (named); `todo-panel.tsx` [placed] | |
| `view/transcript/` | `transcript/`, `restyle.tsx` | |
| `view/` (root) | 18 cross-surface tests (`consistency`, truth and critique files that span band, HUD, panel and cards) | no sources |
| `motion/` | `motion.ts`, `fx/` (named); `motion-demo.ts` [placed] | `motion-feed.ts` goes to `host/` so `motion/` does not import the views |
| `input/` | `intents`, `routing`, `clickable` | |

Naming rules applied to tests:
1. A subject-named test (`hud-bar`, `band-truth`, `panel-rows`) keeps its name and goes to its source's folder.
2. A round-named test is renamed for what its header comment says it covers. Names below come from each file's first comment lines and its imports; **test bodies were not read [assumed]**, so each name is a proposal the stage executor can correct when it opens the file.
3. A round-named test of at most 70 lines whose subject already has a test file in the same folder is merged into it (19 files). A merge is one second commit per stage ("N.b"). Mechanical merge: append the source file's body to the target inside `describe('<old round label>', () => { ... })` so top-level `const` names cannot collide, union the imports, and abort to a plain rename on any identifier clash. Test count must not change (B0). Merges were **not** dry-run [UNVERIFIED].
4. Cross-surface tests with no single source go to `view/`.
5. `register*.test.ts` keep their names: they drive `register()` end to end.

Entries marked `merge_into` carry the stage of their target folder. A destination that is another entry's `to` is a rename target; a destination that is an existing staying file (`data/core.test.ts`, `data/channels.test.ts`) is already in place. No two entries share a `to` (checked by the generator [MEASURED]); the 17 distinct `merge_into` targets resolve to a `to` or to a staying file (checked).

```json
[
  {"from": "clickable.test.ts", "to": "input/clickable.test.ts", "stage": 1},
  {"from": "clickable.ts", "to": "input/clickable.ts", "stage": 1},
  {"from": "intents.test.ts", "to": "input/intents.test.ts", "stage": 1},
  {"from": "intents.ts", "to": "input/intents.ts", "stage": 1},
  {"from": "no-key-hints.test.ts", "to": "input/no-key-hints.test.ts", "stage": 1},
  {"from": "routing.test.ts", "to": "input/routing.test.ts", "stage": 1},
  {"from": "routing.ts", "to": "input/routing.ts", "stage": 1},
  {"from": "wave31-merge.test.ts", "merge_into": "input/no-key-hints.test.ts", "stage": 1},
  {"from": "restyle.test.tsx", "to": "view/transcript/restyle.test.tsx", "stage": 2},
  {"from": "restyle.tsx", "to": "view/transcript/restyle.tsx", "stage": 2},
  {"from": "transcript/cards-c3.test.tsx", "to": "view/transcript/cards-rail.test.tsx", "stage": 2},
  {"from": "transcript/cards.test.tsx", "to": "view/transcript/cards.test.tsx", "stage": 2},
  {"from": "transcript/cards.tsx", "to": "view/transcript/cards.tsx", "stage": 2},
  {"from": "transcript/header-brand.test.tsx", "to": "view/transcript/header-brand.test.tsx", "stage": 2},
  {"from": "transcript/leadheader.ts", "to": "view/transcript/leadheader.ts", "stage": 2},
  {"from": "transcript/outcome.test.tsx", "to": "view/transcript/outcome.test.tsx", "stage": 2},
  {"from": "transcript/outcome.ts", "to": "view/transcript/outcome.ts", "stage": 2},
  {"from": "transcript/placed.test.tsx", "to": "view/transcript/placed.test.tsx", "stage": 2},
  {"from": "transcript/placed.ts", "to": "view/transcript/placed.ts", "stage": 2},
  {"from": "transcript/rawheader-c23.test.tsx", "to": "view/transcript/header-raw.test.tsx", "stage": 2},
  {"from": "transcript/resume.test.tsx", "to": "view/transcript/resume.test.tsx", "stage": 2},
  {"from": "transcript/superseded.ts", "to": "view/transcript/superseded.ts", "stage": 2},
  {"from": "header-chip.test.ts", "merge_into": "view/transcript/header-brand.test.tsx", "stage": 2},
  {"from": "transcript/rawheader-c22.test.tsx", "merge_into": "view/transcript/header-raw.test.tsx", "stage": 2},
  {"from": "transcript/wave24-cards.test.tsx", "merge_into": "view/transcript/cards.test.tsx", "stage": 2},
  {"from": "board-settle.test.ts", "to": "data/board-settle.test.ts", "stage": 3},
  {"from": "data-fresh.test.ts", "to": "data/freshness.test.ts", "stage": 3},
  {"from": "history.ts", "to": "data/history.ts", "stage": 3},
  {"from": "idle-health.test.ts", "to": "data/idle-health.test.ts", "stage": 3},
  {"from": "idle-health.ts", "to": "data/idle-health.ts", "stage": 3},
  {"from": "metrics.ts", "to": "data/metrics.ts", "stage": 3},
  {"from": "pulse.test.ts", "to": "data/pulse.test.ts", "stage": 3},
  {"from": "pulse.ts", "to": "data/pulse.ts", "stage": 3},
  {"from": "runstate.test.ts", "to": "data/runstate.test.ts", "stage": 3},
  {"from": "snapshot.test.ts", "to": "data/snapshot.test.ts", "stage": 3},
  {"from": "snapshot.ts", "to": "data/snapshot.ts", "stage": 3},
  {"from": "core-seats.test.ts", "merge_into": "data/core.test.ts", "stage": 3},
  {"from": "live-channel.test.ts", "merge_into": "data/channels.test.ts", "stage": 3},
  {"from": "pulse-billing.test.ts", "merge_into": "data/pulse.test.ts", "stage": 3},
  {"from": "runstate-band.test.ts", "merge_into": "data/runstate.test.ts", "stage": 3},
  {"from": "truth-a.test.ts", "merge_into": "data/runstate.test.ts", "stage": 3},
  {"from": "fx/advance.wav", "to": "motion/fx/advance.wav", "stage": 4},
  {"from": "fx/done.wav", "to": "motion/fx/done.wav", "stage": 4},
  {"from": "fx/fail.wav", "to": "motion/fx/fail.wav", "stage": 4},
  {"from": "fx/make_fx.py", "to": "motion/fx/make_fx.py", "stage": 4},
  {"from": "fx/spawn.wav", "to": "motion/fx/spawn.wav", "stage": 4},
  {"from": "fx/test_make_fx.py", "to": "motion/fx/test_make_fx.py", "stage": 4},
  {"from": "motion-256.test.ts", "to": "motion/motion-256.test.ts", "stage": 4},
  {"from": "motion-c16.test.ts", "to": "motion/motion-256-glyph-fade.test.ts", "stage": 4},
  {"from": "motion-c18.test.ts", "to": "motion/motion-owner-column.test.ts", "stage": 4},
  {"from": "motion-demo.test.ts", "to": "motion/motion-demo.test.ts", "stage": 4},
  {"from": "motion-demo.ts", "to": "motion/motion-demo.ts", "stage": 4},
  {"from": "motion-surfaces.test.ts", "to": "motion/motion-surfaces.test.ts", "stage": 4},
  {"from": "motion.test.ts", "to": "motion/motion.test.ts", "stage": 4},
  {"from": "motion.ts", "to": "motion/motion.ts", "stage": 4},
  {"from": "motion-c19.test.ts", "merge_into": "motion/motion.test.ts", "stage": 4},
  {"from": "board-gantt39.test.ts", "to": "view/board/board-gantt.test.ts", "stage": 5},
  {"from": "board-model.mut.test.ts", "to": "view/board/board-model.mut.test.ts", "stage": 5},
  {"from": "board-model.ts", "to": "view/board/board-model.ts", "stage": 5},
  {"from": "board-truth.test.ts", "to": "view/board/board-truth.test.ts", "stage": 5},
  {"from": "board.test.ts", "to": "view/board/board.test.ts", "stage": 5},
  {"from": "board40.test.ts", "to": "view/board/board-blocked-failed.test.ts", "stage": 5},
  {"from": "open-work.test.ts", "to": "view/board/open-work.test.ts", "stage": 5},
  {"from": "todo-panel.edges.test.ts", "to": "view/board/todo-panel.edges.test.ts", "stage": 5},
  {"from": "todo-panel.test.ts", "to": "view/board/todo-panel.test.ts", "stage": 5},
  {"from": "todo-panel.tsx", "to": "view/board/todo-panel.tsx", "stage": 5},
  {"from": "wave38-board.test.ts", "to": "view/board/board-tab-density.test.ts", "stage": 5},
  {"from": "board-c11.test.ts", "merge_into": "view/board/board.test.ts", "stage": 5},
  {"from": "board-c19.test.ts", "merge_into": "view/board/board.test.ts", "stage": 5},
  {"from": "cards26.test.ts", "merge_into": "view/board/board-gantt.test.ts", "stage": 5},
  {"from": "board-key.test.ts", "to": "host/board-key.test.ts", "stage": 6},
  {"from": "board-wiring.test.ts", "to": "host/board-wiring.test.ts", "stage": 6},
  {"from": "discipline.test.ts", "to": "host/discipline.test.ts", "stage": 6},
  {"from": "discipline.ts", "to": "host/discipline.ts", "stage": 6},
  {"from": "gap-statusline.test.ts", "to": "host/statusline-gap.test.ts", "stage": 6},
  {"from": "gates.test.ts", "to": "host/gates.test.ts", "stage": 6},
  {"from": "gates.ts", "to": "host/gates.ts", "stage": 6},
  {"from": "hook-log.ts", "to": "host/hook-log.ts", "stage": 6},
  {"from": "motion-feed.test.ts", "to": "host/motion-feed.test.ts", "stage": 6},
  {"from": "motion-feed.ts", "to": "host/motion-feed.ts", "stage": 6},
  {"from": "notify.test.ts", "to": "host/notify.test.ts", "stage": 6},
  {"from": "notify.ts", "to": "host/notify.ts", "stage": 6},
  {"from": "parallel-attribution.test.ts", "to": "host/parallel-attribution.test.ts", "stage": 6},
  {"from": "register-agents.test.ts", "to": "host/register-agents.test.ts", "stage": 6},
  {"from": "register-blocked.test.ts", "to": "host/register-blocked.test.ts", "stage": 6},
  {"from": "register-card.test.ts", "to": "host/register-card.test.ts", "stage": 6},
  {"from": "register-clear.test.ts", "to": "host/register-clear.test.ts", "stage": 6},
  {"from": "register-core.test.ts", "to": "host/register-core.test.ts", "stage": 6},
  {"from": "register-edges.test.ts", "to": "host/register-edges.test.ts", "stage": 6},
  {"from": "register-faults.test.ts", "to": "host/register-faults.test.ts", "stage": 6},
  {"from": "register-fresh.test.ts", "to": "host/register-fresh.test.ts", "stage": 6},
  {"from": "register-gates-nowait.test.ts", "to": "host/register-gates-nowait.test.ts", "stage": 6},
  {"from": "register-hooks.test.ts", "to": "host/register-hooks.test.ts", "stage": 6},
  {"from": "register-live.test.ts", "to": "host/register-live.test.ts", "stage": 6},
  {"from": "register-look.test.ts", "to": "host/register-look.test.ts", "stage": 6},
  {"from": "register-open.test.ts", "to": "host/register-open.test.ts", "stage": 6},
  {"from": "register-sidebar.test.ts", "to": "host/register-sidebar.test.ts", "stage": 6},
  {"from": "register.test.ts", "to": "host/register.test.ts", "stage": 6},
  {"from": "usage.test.ts", "to": "host/usage.test.ts", "stage": 6},
  {"from": "usage.ts", "to": "host/usage.ts", "stage": 6},
  {"from": "wire-expert.test.ts", "to": "host/idle-breath-wiring.test.ts", "stage": 6},
  {"from": "worker-live.test.ts", "to": "host/agent-spawn-names.test.ts", "stage": 6},
  {"from": "working-signal.test.ts", "to": "host/working-signal.test.ts", "stage": 6},
  {"from": "y1-live.test.ts", "to": "host/pulse-wiring.test.ts", "stage": 6},
  {"from": "blocked-same-update.test.ts", "merge_into": "host/register-blocked.test.ts", "stage": 6},
  {"from": "band-controls.test.ts", "to": "view/band/band-controls.test.ts", "stage": 7},
  {"from": "band-core.test.ts", "to": "view/band/band-core.test.ts", "stage": 7},
  {"from": "band-design.test.ts", "to": "view/band/band-design.test.ts", "stage": 7},
  {"from": "band-dispatch.test.ts", "to": "view/band/band-dispatch.test.ts", "stage": 7},
  {"from": "band-expert.test.ts", "to": "view/band/band-layout.test.ts", "stage": 7},
  {"from": "band-frame.ts", "to": "view/band/band-frame.ts", "stage": 7},
  {"from": "band-golden.test.ts", "to": "view/band/band-golden.test.ts", "stage": 7},
  {"from": "band-honest.test.ts", "to": "view/band/band-honest.test.ts", "stage": 7},
  {"from": "band-motion.ts", "to": "view/band/band-motion.ts", "stage": 7},
  {"from": "band-polish.test.ts", "to": "view/band/band-polish.test.ts", "stage": 7},
  {"from": "band-states.test.ts", "to": "view/band/band-states.test.ts", "stage": 7},
  {"from": "band-truth.test.ts", "to": "view/band/band-truth.test.ts", "stage": 7},
  {"from": "band-workers.test.ts", "to": "view/band/band-workers.test.ts", "stage": 7},
  {"from": "band.mut.test.ts", "to": "view/band/band.mut.test.ts", "stage": 7},
  {"from": "band.test.ts", "to": "view/band/band.test.ts", "stage": 7},
  {"from": "band.tsx", "to": "view/band/band.tsx", "stage": 7},
  {"from": "core-row.test.ts", "to": "view/band/core-row.test.ts", "stage": 7},
  {"from": "core-row.ts", "to": "view/band/core-row.ts", "stage": 7},
  {"from": "layout28.test.ts", "to": "view/band/slot-layout.test.ts", "stage": 7},
  {"from": "merge40.test.ts", "to": "view/band/band-working-clock.test.ts", "stage": 7},
  {"from": "mission-layout.mut.test.ts", "to": "view/band/mission-layout.mut.test.ts", "stage": 7},
  {"from": "mission-layout.test.ts", "to": "view/band/mission-layout.test.ts", "stage": 7},
  {"from": "mission-layout.ts", "to": "view/band/mission-layout.ts", "stage": 7},
  {"from": "r2-band.test.ts", "to": "view/band/band-clock.test.ts", "stage": 7},
  {"from": "r3-band.test.ts", "to": "view/band/band-fill-segments.test.ts", "stage": 7},
  {"from": "round3-a.test.ts", "to": "view/band/band-leads.test.ts", "stage": 7},
  {"from": "slice-b10.test.ts", "to": "view/band/band-gates-truth.test.ts", "stage": 7},
  {"from": "slot.ts", "to": "view/band/slot.ts", "stage": 7},
  {"from": "truth40.test.ts", "to": "view/band/band-host-turn.test.ts", "stage": 7},
  {"from": "v1-band.test.ts", "to": "view/band/band-frames.test.ts", "stage": 7},
  {"from": "wave30-hud.test.ts", "to": "view/band/slot-run-shape.test.ts", "stage": 7},
  {"from": "wave31-hud.test.ts", "to": "view/band/slot-fixed-block.test.ts", "stage": 7},
  {"from": "wave32-hud.test.ts", "to": "view/band/slot-grid.test.ts", "stage": 7},
  {"from": "wave33-state.test.ts", "to": "view/band/slot-state-truth.test.ts", "stage": 7},
  {"from": "wave34-state.test.ts", "to": "view/band/slot-no-phantom-work.test.ts", "stage": 7},
  {"from": "wave35-band.test.ts", "to": "view/band/band-segments.test.ts", "stage": 7},
  {"from": "wave36-band.test.ts", "to": "view/band/band-state-colours.test.ts", "stage": 7},
  {"from": "wave37-band.test.ts", "to": "view/band/band-run-consistency.test.ts", "stage": 7},
  {"from": "card-expert.test.ts", "to": "view/hud/card-health.test.ts", "stage": 8},
  {"from": "card-frame.ts", "to": "view/hud/card-frame.ts", "stage": 8},
  {"from": "critique18-b.test.ts", "to": "view/hud/hud-todo-failure.test.ts", "stage": 8},
  {"from": "critique19-a.test.ts", "to": "view/hud/hud-todo-retry.test.ts", "stage": 8},
  {"from": "hud-bar.test.ts", "to": "view/hud/hud-bar.test.ts", "stage": 8},
  {"from": "hud-box.test.ts", "to": "view/hud/hud-box.test.ts", "stage": 8},
  {"from": "hud-c19.test.ts", "to": "view/hud/hud-agents-grid.test.ts", "stage": 8},
  {"from": "hud-critique23.test.ts", "to": "view/hud/hud-todo-rows.test.ts", "stage": 8},
  {"from": "hud-grid.test.ts", "to": "view/hud/hud-grid.test.ts", "stage": 8},
  {"from": "hud-header.test.ts", "to": "view/hud/hud-header.test.ts", "stage": 8},
  {"from": "hud-live17.test.ts", "to": "view/hud/hud-last-outcome.test.ts", "stage": 8},
  {"from": "hud-narrow.test.ts", "to": "view/hud/hud-narrow.test.ts", "stage": 8},
  {"from": "hud-outcome.test.ts", "to": "view/hud/hud-outcome.test.ts", "stage": 8},
  {"from": "hud-rev5.test.ts", "to": "view/hud/hud-titles-meter.test.ts", "stage": 8},
  {"from": "hud-shape.test.ts", "to": "view/hud/hud-shape.test.ts", "stage": 8},
  {"from": "hud-slot.test.ts", "to": "view/hud/hud-slot.test.ts", "stage": 8},
  {"from": "hud-surface.mut.test.ts", "to": "view/hud/hud-surface.mut.test.ts", "stage": 8},
  {"from": "hud-surface.test.ts", "to": "view/hud/hud-surface.test.ts", "stage": 8},
  {"from": "hud-surface.ts", "to": "view/hud/hud-surface.ts", "stage": 8},
  {"from": "hud.mut.test.ts", "to": "view/hud/hud.mut.test.ts", "stage": 8},
  {"from": "hud.test.ts", "to": "view/hud/hud.test.ts", "stage": 8},
  {"from": "hud.ts", "to": "view/hud/hud.ts", "stage": 8},
  {"from": "hud39.test.ts", "to": "view/hud/hud-overflow-row.test.ts", "stage": 8},
  {"from": "hud40.test.ts", "to": "view/hud/hud-summary-row.test.ts", "stage": 8},
  {"from": "idle-polish.test.ts", "to": "view/hud/idle-health-states.test.ts", "stage": 8},
  {"from": "idle-polish2.test.ts", "to": "view/hud/idle-empty-states.test.ts", "stage": 8},
  {"from": "idle-polish3.test.ts", "to": "view/hud/idle-panel-facts.test.ts", "stage": 8},
  {"from": "r2-data.test.ts", "to": "view/hud/health-data-rules.test.ts", "stage": 8},
  {"from": "role-colour.test.ts", "to": "view/hud/role-colour.test.ts", "stage": 8},
  {"from": "round-aa.test.ts", "to": "view/hud/health-metrics.test.ts", "stage": 8},
  {"from": "round-z.test.ts", "to": "view/hud/health-chart-scale.test.ts", "stage": 8},
  {"from": "status-frame.ts", "to": "view/hud/status-frame.ts", "stage": 8},
  {"from": "strip-frame.ts", "to": "view/hud/strip-frame.ts", "stage": 8},
  {"from": "v2-status.test.ts", "to": "view/hud/status-tab.test.ts", "stage": 8},
  {"from": "y1-data.test.ts", "to": "view/hud/health-frames.test.ts", "stage": 8},
  {"from": "channel-c19.test.ts", "to": "view/panel/panel-channel-failure.test.ts", "stage": 9},
  {"from": "pane/activity.ts", "to": "view/panel/pane/activity.ts", "stage": 9},
  {"from": "pane/band-kind.ts", "to": "view/panel/pane/band-kind.ts", "stage": 9},
  {"from": "pane/chrome.test.ts", "to": "view/panel/pane/chrome.test.ts", "stage": 9},
  {"from": "pane/chrome.tsx", "to": "view/panel/pane/chrome.tsx", "stage": 9},
  {"from": "pane/sidebar-board110.test.ts", "to": "view/panel/pane/sidebar-board110.test.ts", "stage": 9},
  {"from": "pane/sidebar-channel.tsx", "to": "view/panel/pane/sidebar-channel.tsx", "stage": 9},
  {"from": "pane/sidebar-core.tsx", "to": "view/panel/pane/sidebar-core.tsx", "stage": 9},
  {"from": "pane/sidebar-gates.tsx", "to": "view/panel/pane/sidebar-gates.tsx", "stage": 9},
  {"from": "pane/sidebar-live-truth.test.ts", "to": "view/panel/pane/sidebar-live-truth.test.ts", "stage": 9},
  {"from": "pane/sidebar-model.edges.test.ts", "to": "view/panel/pane/sidebar-model.edges.test.ts", "stage": 9},
  {"from": "pane/sidebar-model.mut.test.ts", "to": "view/panel/pane/sidebar-model.mut.test.ts", "stage": 9},
  {"from": "pane/sidebar-model.test.ts", "to": "view/panel/pane/sidebar-model.test.ts", "stage": 9},
  {"from": "pane/sidebar-model.ts", "to": "view/panel/pane/sidebar-model.ts", "stage": 9},
  {"from": "pane/sidebar-paint.tsx", "to": "view/panel/pane/sidebar-paint.tsx", "stage": 9},
  {"from": "pane/sidebar-roster.test.ts", "to": "view/panel/pane/sidebar-roster.test.ts", "stage": 9},
  {"from": "pane/sidebar-roster.ts", "to": "view/panel/pane/sidebar-roster.ts", "stage": 9},
  {"from": "pane/sidebar-route.tsx", "to": "view/panel/pane/sidebar-route.tsx", "stage": 9},
  {"from": "pane/sidebar-team.tsx", "to": "view/panel/pane/sidebar-team.tsx", "stage": 9},
  {"from": "pane/sidebar-types.ts", "to": "view/panel/pane/sidebar-types.ts", "stage": 9},
  {"from": "pane/sidebar.edges.test.ts", "to": "view/panel/pane/sidebar.edges.test.ts", "stage": 9},
  {"from": "pane/sidebar.golden-cases.ts", "to": "view/panel/pane/sidebar.golden-cases.ts", "stage": 9},
  {"from": "pane/sidebar.golden-fixture.ts", "to": "view/panel/pane/sidebar.golden-fixture.ts", "stage": 9},
  {"from": "pane/sidebar.golden.test.ts", "to": "view/panel/pane/sidebar.golden.test.ts", "stage": 9},
  {"from": "pane/sidebar.mut.test.ts", "to": "view/panel/pane/sidebar.mut.test.ts", "stage": 9},
  {"from": "pane/sidebar.test.ts", "to": "view/panel/pane/sidebar.test.ts", "stage": 9},
  {"from": "pane/sidebar.tsx", "to": "view/panel/pane/sidebar.tsx", "stage": 9},
  {"from": "panel-a4.test.ts", "to": "view/panel/panel-route-titles.test.ts", "stage": 9},
  {"from": "panel-c10.test.ts", "to": "view/panel/panel-narrow-tabs.test.ts", "stage": 9},
  {"from": "panel-c22.test.ts", "to": "view/panel/panel-vocabulary.test.ts", "stage": 9},
  {"from": "panel-expert.test.ts", "to": "view/panel/panel-grid.test.ts", "stage": 9},
  {"from": "panel-fill.test.ts", "to": "view/panel/panel-fill.test.ts", "stage": 9},
  {"from": "panel-finish.test.ts", "to": "view/panel/panel-finish.test.ts", "stage": 9},
  {"from": "panel-gates-c2.test.ts", "to": "view/panel/panel-gates.test.ts", "stage": 9},
  {"from": "panel-layout.edges.test.ts", "to": "view/panel/panel-layout.edges.test.ts", "stage": 9},
  {"from": "panel-layout.mut.test.ts", "to": "view/panel/panel-layout.mut.test.ts", "stage": 9},
  {"from": "panel-layout.test.ts", "to": "view/panel/panel-layout.test.ts", "stage": 9},
  {"from": "panel-layout.ts", "to": "view/panel/panel-layout.ts", "stage": 9},
  {"from": "panel-polish.test.ts", "to": "view/panel/panel-polish.test.ts", "stage": 9},
  {"from": "panel-rows.test.ts", "to": "view/panel/panel-rows.test.ts", "stage": 9},
  {"from": "panel-side.test.ts", "to": "view/panel/panel-side.test.ts", "stage": 9},
  {"from": "panel-strip-c1.test.ts", "to": "view/panel/panel-strip.test.ts", "stage": 9},
  {"from": "panel-tabs7.test.ts", "to": "view/panel/panel-tabs-foot.test.ts", "stage": 9},
  {"from": "r2-panel.test.ts", "to": "view/panel/panel-pinned-footer.test.ts", "stage": 9},
  {"from": "r3-panel.test.ts", "to": "view/panel/panel-status-instrument.test.ts", "stage": 9},
  {"from": "round-w2.test.ts", "to": "view/panel/chip-idiom-gates.test.ts", "stage": 9},
  {"from": "round-x.test.ts", "to": "view/panel/tab-widget-set.test.ts", "stage": 9},
  {"from": "tabs-frame.ts", "to": "view/panel/tabs-frame.ts", "stage": 9},
  {"from": "v3-tabs.test.ts", "to": "view/panel/tab-frames-golden.test.ts", "stage": 9},
  {"from": "wave24-slice-c.test.ts", "to": "view/panel/panel-tabs-cards.test.ts", "stage": 9},
  {"from": "wave30-panel.test.ts", "to": "view/panel/panel-team-channel-cards.test.ts", "stage": 9},
  {"from": "wave31-panel.test.ts", "to": "view/panel/panel-toasts-cards.test.ts", "stage": 9},
  {"from": "wave32-panel.test.ts", "to": "view/panel/panel-route-channel-team.test.ts", "stage": 9},
  {"from": "wave33-panel.test.ts", "to": "view/panel/panel-failure-word.test.ts", "stage": 9},
  {"from": "wave34-panel.test.ts", "to": "view/panel/panel-monitor-numbers.test.ts", "stage": 9},
  {"from": "wave35-panel.test.ts", "to": "view/panel/panel-band-agreement.test.ts", "stage": 9},
  {"from": "wave36-panel.test.ts", "to": "view/panel/panel-state-clock.test.ts", "stage": 9},
  {"from": "wave37-panel.test.ts", "to": "view/panel/panel-uniform-cards.test.ts", "stage": 9},
  {"from": "y2.test.ts", "to": "view/panel/tab-sections.test.ts", "stage": 9},
  {"from": "panel-c19.test.ts", "merge_into": "view/panel/panel-vocabulary.test.ts", "stage": 9},
  {"from": "panel-empty-c2.test.ts", "merge_into": "view/panel/panel-fill.test.ts", "stage": 9},
  {"from": "panel-strip-c18.test.ts", "merge_into": "view/panel/panel-strip.test.ts", "stage": 9},
  {"from": "wave38-follow.test.ts", "merge_into": "view/panel/panel-layout.test.ts", "stage": 9},
  {"from": "consistency.test.ts", "to": "view/consistency.test.ts", "stage": 10},
  {"from": "critique17-a.test.ts", "to": "view/blocked-row-truth.test.ts", "stage": 10},
  {"from": "critique18-a.test.ts", "to": "view/one-truth-tabs.test.ts", "stage": 10},
  {"from": "critique25.test.ts", "to": "view/killed-worker-word.test.ts", "stage": 10},
  {"from": "critique26.test.ts", "to": "view/surface-polish.test.ts", "stage": 10},
  {"from": "live-layout.test.ts", "to": "view/live-capture-layout.test.ts", "stage": 10},
  {"from": "phase-sync.test.ts", "to": "view/phase-sync.test.ts", "stage": 10},
  {"from": "render-states.test.ts", "to": "view/render-states.test.ts", "stage": 10},
  {"from": "slice-b.test.ts", "to": "view/blocker-identity.test.ts", "stage": 10},
  {"from": "slice-c14.test.ts", "to": "view/live-shapes-truth.test.ts", "stage": 10},
  {"from": "spinner-clock.test.ts", "to": "view/spinner-clock.test.ts", "stage": 10},
  {"from": "state38.test.ts", "to": "view/state-words.test.ts", "stage": 10},
  {"from": "todo-state.test.ts", "to": "view/todo-state.test.ts", "stage": 10},
  {"from": "truth29.test.ts", "to": "view/snapshot-truth.test.ts", "stage": 10},
  {"from": "truth39.test.ts", "to": "view/phase-row-truth.test.ts", "stage": 10},
  {"from": "truth41.test.ts", "to": "view/run-end-total.test.ts", "stage": 10},
  {"from": "wave17-a.test.ts", "to": "view/count-blocked-state.test.ts", "stage": 10},
  {"from": "wave36-calls.test.ts", "to": "view/calls-figure.test.ts", "stage": 10},
  {"from": "wave37-spinner.test.ts", "merge_into": "view/spinner-clock.test.ts", "stage": 10},
  {"from": "atlas-ui.edges.test.ts", "to": "design/atlas-ui.edges.test.ts", "stage": 11},
  {"from": "atlas-ui.mut.test.ts", "to": "design/atlas-ui.mut.test.ts", "stage": 11},
  {"from": "atlas-ui.test.ts", "to": "design/atlas-ui.test.ts", "stage": 11},
  {"from": "atlas-ui.ts", "to": "design/atlas-ui.ts", "stage": 11},
  {"from": "chart.ts", "to": "design/chart.ts", "stage": 11},
  {"from": "glyph-unique.test.ts", "to": "design/glyph-unique.test.ts", "stage": 11},
  {"from": "look.test.ts", "to": "design/look.test.ts", "stage": 11},
  {"from": "look.ts", "to": "design/look.ts", "stage": 11},
  {"from": "paint-256.test.ts", "to": "design/paint-256.test.ts", "stage": 11},
  {"from": "paint-cost.test.ts", "to": "design/paint-cost.test.ts", "stage": 11},
  {"from": "paint.test.ts", "to": "design/paint.test.ts", "stage": 11},
  {"from": "paint.ts", "to": "design/paint.ts", "stage": 11},
  {"from": "r3-charts.test.ts", "to": "design/chart.test.ts", "stage": 11},
  {"from": "rail.test.ts", "to": "design/rail.test.ts", "stage": 11},
  {"from": "rail.ts", "to": "design/rail.ts", "stage": 11},
  {"from": "roles.test.ts", "to": "design/roles.test.ts", "stage": 11},
  {"from": "roles.ts", "to": "design/roles.ts", "stage": 11},
  {"from": "runs.test.ts", "to": "design/runs.test.ts", "stage": 11},
  {"from": "runs.ts", "to": "design/runs.ts", "stage": 11},
  {"from": "spark.test.ts", "to": "design/spark.test.ts", "stage": 11},
  {"from": "spark.ts", "to": "design/spark.ts", "stage": 11},
  {"from": "theme.helpers.test.ts", "to": "design/theme.helpers.test.ts", "stage": 11},
  {"from": "theme.test.ts", "to": "design/theme.test.ts", "stage": 11},
  {"from": "theme.ts", "to": "design/theme.ts", "stage": 11},
  {"from": "vocab.test.ts", "to": "design/vocab.test.ts", "stage": 11},
  {"from": "vocab.ts", "to": "design/vocab.ts", "stage": 11},
  {"from": "register.ts", "to": "host/hooks.ts", "stage": 12}
]
```

### Files that stay (70) and why

| Path | Reason |
|---|---|
| `contract-pattern.test.ts` | stays with its source; scans mod/ and ../omp by path (:36), so it cannot move without changing what it scans |
| `data/` (33 files: `channels.test.ts`, `core-billing.test.ts`, `core-scope.test.ts`, `core.test.ts`, `crew.test.ts`, `datastate.test.ts`, `herdr.test.ts`, `live.test.ts`, `mux.test.ts`, `orchestration.golden.test.ts`, `orchestration.test.ts`, `personas.test.ts`, `root.test.ts`, `runstate-pending.test.ts`, `tally.test.ts`, `todos-plan.test.ts`, `todos.test.ts`, `channels.ts`, `core.ts`, `crew.ts`, `datastate.ts`, `herdr.ts`, `lasttext.ts`, `live.ts`, `mux.ts`, `orchestration.golden-cases.ts`, `orchestration.golden-fixture.ts`, `orchestration.ts`, `personas.ts`, `root.ts`, `runstate.ts`, `tally.ts`, `todos.ts`) | data/ is already a 4.3 target; file is in place |
| `host-load-rules.test.ts` | cross-tree guard of the host load rules (ROOT = import.meta.dir/.., :11); starts from mod/register.ts (:260) |
| `live_fixture.test.ts` | stays with live_fixture.ts |
| `palette.test.ts` | cross-tree guard (scans mod and omp from ROOT = import.meta.dir/.., palette.test.ts:9); self-checks that the scan found the files (:36-38) |
| `sprites/` (12 files: `api.test.ts`, `art.test.ts`, `palette.test.ts`, `review.test.ts`, `sprites.golden.test.ts`, `api.ts`, `art.ts`, `palette.ts`, `review.ts`, `sprites.golden-cases.ts`, `sprites.golden-fixture.ts`, `test-env.d.ts`) | sprites/ is a self-contained subject folder with no 4.3 target (6 external refs would change for no gain) |
| `TESTING.md` | doc; CI comments (tests.yml:39-40) and README name it at mod/TESTING.md; rewritten in S13 |
| `bun-preload.d.ts` | ambient types for the bun test preload; tsconfig include "." picks it up wherever it is |
| `contract-pattern.ts` | shared kernel: the code copy of the header pattern and PHASE_TABLE; its own tests scan mod and omp by path (contract-pattern.test.ts:36) |
| `contract.ts` | shared kernel: 31 non-test importers; mirrored by types/index.d.ts and pinned by hooks/test_atlas_contract.py:2039-2041; imported by contracts/world-live.ts:5, omp/core-source.ts:9, omp/todo-fallback.ts:14 |
| `fixtures/` (8 files: `README.md`, `check_glyph_cmap.py`, `dejavu-sans-mono-glyphs.ts`, `run-state/.run/board/impl-auth.jsonl`, `run-state/.run/board/lead-01a122.jsonl`, `run-state/.run/board/verifier-ui.jsonl`, `run-state/.run/channels.json`, `run-state/.run/todos.json`) | test data folder; exempt from the host-load, hex and glyph scans by name |
| `golden-pad.ts` | test helper imported by omp/panel-view.test.ts:7 |
| `host-load-rules.d.ts` | ambient node:fs shim types for host-load-rules.test.ts, which stays |
| `live_fixture.ts` | shared test fixture: 82 importers; probed by atlas_mod_gate.py:215,223 (path fixed in S7) |
| `orchestra-types.ts` | shared kernel: 20 non-test importers, type-only; imports ../types (orchestra-types.ts:6) |
| `surface_indices.ts` | test helper (256-colour index walk of every surface); imported only by tests |
| `test-preload.ts` | preloaded by bunfig.toml:6 and named in .fallowrc.json:33 |
| `test-shim.ts` | preloaded by bunfig.toml:6 and named in .fallowrc.json:32; requires ./data/live at test-shim.ts:26 |
| `test_helpers.ts` | shared test fixtures: 36 test importers, plus contracts/world-live.ts:8 |
| `tsconfig.json` | mod/tsconfig.json: include "." covers all new folders; package.json "typecheck" uses ../tsconfig.json |

`mod/register.ts` is the one path that is both moved and re-created: S12 does `git mv register.ts host/hooks.ts` and writes a new thin `register.ts`.

### New files the plan creates (not in the map above)

| File | Stage | Purpose |
|---|---|---|
| `scripts/mod_reorg.mjs` | S0 | the rewriter and checker described in section 8 |
| `mod/fixtures/source-tree.ts` | S0 | test support: `pluginRoot()`, `readMod(basename)` (finds the unique file under `mod/`), `readHostEntry()` (concatenates `register.ts` and, after S12, `host/{atoms,agents,poll,core-tick,handlers,frame,hooks}.ts` in that order, skipping absent files). Lives in `fixtures/` because `host-load-rules.test.ts:207-213` skips that folder and `theme.test.ts:137` exempts it from the hex scan [assumed to be safe for the live gate; S0 check proves it] |
| `mod/tree-guards.test.ts` | S0 | the whole-tree scans extracted from `theme.test.ts:94-143` (M4 at 129-134, M5 at 136-143) and `register-look.test.ts:118-139` (M2; the second M2 test at 141-152 stays), keyed by basename, each with a floor on the number of files scanned |
| `host/atoms.ts`, `agents.ts`, `poll.ts`, `core-tick.ts`, `handlers.ts`, `frame.ts` | S12 | see section 7 |
| `register.ts` (thin) | S12 | entry, section 5 |

## 4. (b) References outside the moved files that name mod paths

Found by three sweeps over the repo: a regex for relative import specifiers that end in `mod/...`, a regex for `mod/<path>` literals, and a grep of `readFileSync`/`import.meta`/`readdirSync` inside `mod/` for path-based access [MEASURED]. Historical records are left alone on purpose: `plugins/atlas/CHANGELOG.md`, `docs/archive/**`, `docs/audits/**`, dated files in `docs/plans/**`, `.atlas/**` (evidence and findings), all of which quote old paths as history.

### 4.1 Manifests, loaders, entry
| Where | Line | What |
|---|---|---|
| `plugins/atlas/hooks/hooks.json` | 159-160 | `"modules": ["../mod/register.ts"]`, the only host registration |
| `plugins/atlas/.claude-plugin/plugin.json` | none | no mod path; `types` at `./types/index.d.ts` only |
| `plugins/atlas/package.json` | none | `"test": "bun test omp mod"`, `"typecheck": "tsc --noEmit -p tsconfig.json"`, `omp.extensions` is `./omp/index.ts`; no mod file named |
| `plugins/atlas/tsconfig.json` | include | `"mod"` (recursive, covers new folders); `mod/tsconfig.json` `include: ["."]` |
| `plugins/atlas/bunfig.toml` | 6 | preloads `./mod/test-preload.ts` and `./mod/test-shim.ts` (both stay) |
| `plugins/atlas/scripts/atlas_mod_gate.py` | 121, 214-215, 222-223 | `HOST_COPY` copies `mod` whole (ok); `need = [moddir/"band.tsx", moddir/"live_fixture.ts", moddir/"data"/"live.ts"]` and the probe imports `band`, `live_fixture`, `data/live` relative to the entry: **breaks at S7** (band moves), edit in the same commit |
| `plugins/atlas/scripts/test_atlas_mod_gate.py` | 95, 251-262, 253-258 | removes `mod/register.ts` for a fault case (ok); builds `mod2/` re-exporting `../mod/band` and `../mod/live_fixture` (**breaks at S7**), `../../mod/data/live` (ok), `modules = ["../mod/register.ts","../mod2/register.ts"]` |
| `plugins/atlas/scripts/atlas_doctor.py` | 988, 1279, 1282 (comments 1175, 1287) | `DISPLAY_MOD_MODULE = "../mod/register.ts"`, `m.endswith("mod/register.ts")`, existence check |
| `plugins/atlas/scripts/test_atlas_doctor_display.py` | 23, 191, 194 | copies and removes `mod/register.ts` |
| `plugins/atlas/scripts/test_atlas_doctor_hardening.py` | 211 | copies only `mod/register.ts` into a temp plugin (thin entry is enough; it never executes it [assumed]) |
| `plugins/atlas/hooks/test_atlas_contract.py` | 2009 | `assertIn("../mod/register.ts", hooks["modules"])` |
| `plugins/atlas/hooks/test_atlas_contract.py` | 1917-1918 | `HeaderSsotTests.ALLOWED` lists `mod/discipline.ts` (**moves at S6**, literal rewrite handles it) and `mod/register.ts` (path survives) |
| `plugins/atlas/hooks/test_atlas_contract.py` | 2012-2022 | `rglob` over `mod` for `$` stores: recursive, no change |
| `plugins/atlas/hooks/test_atlas_contract.py` | 2039-2041 | mirrors `mod/contract.ts` against `types/index.d.ts` (contract.ts stays, which is why it stays) |
| `plugins/atlas/scripts/test_analytics_contract.py` | 53-55 | reads `mod/usage.ts` for `'mod.open.dock'`, `'mod.command.atlas-cc'`, `'mod.error.rebuild'` (**moves at S6**, literal rewrite handles it [DRY-RUN passed]) |
| `plugins/atlas/scripts/atlas_inventory.py` | 187-189 | `mod.rglob("*")`, recursive, no change |
| `plugins/atlas/scripts/sprite_review.ts`, `sprite_review.test.ts` | 4-5, 7 | import `../mod/sprites/api` and `/review`; sprites stay, no change |
| `.github/workflows/tests.yml` | 39-42, 52, 58-69, 73-85 | comments naming `mod/test-shim.ts` and `mod/TESTING.md` (both stay); `bun test omp mod`; `atlas_mod_gate.py --live --require-live`. No tsc step (comment at 41-42) |
| `.github/workflows/release.yml` | 43-47 | runs the same gate, names no mod file |
| `.fallowrc.json` | 14-18, 32-33 | `entry` patterns `plugins/atlas/mod/register.ts` (stays), `.../band.tsx` (S7), `.../pane/*.tsx` (**a glob, S9, hand edit**), `.../**/*.test.ts` (ok), `test-shim.ts` and `test-preload.ts` (stay) |
| `fallow-baselines/health.json` | 902, 907, 921, 926, 940, 948, 953, 958, 969, 974, 985, 993, 1004, 1012, 1017, 1025, 1039, 1044, 1055, 1063, 1074, 1085, 1090, 1098, 1106, 1111, 1841, 1848, 1854, 1855, 1858, 1859, 1871, 1873, 1874, 1881, 1886, 1893, 1895, 1897, 1909, 1917, 1926, 1934 | 44 keys of the form `plugins/atlas/mod/<file>[:finding]`; the literal rewrite re-keys moved files; the `register.ts` keys (1039, 1044, 1874) need regeneration at S12 |
| `fallow-baselines/dupes.json` | 44, 112 | `mod/contract.ts:64-100\|types/...` (stays), `mod/theme.ts:142-159\|omp/channel-view.ts:83-96` (S11) |

### 4.2 TypeScript importers outside `mod/` (relative imports into mod)
| File | Lines (target) |
|---|---|
| `contracts/world-live.ts` | 5 `contract`, 6 `orchestra-types`, 7 `pane/sidebar-types` (S9), 8 `test_helpers` |
| `contracts/band-world.ts` | 10 `atlas-ui` (S11), 11 `mission-layout` (S7) |
| `contracts/panel-world.ts` | 3 `atlas-ui` (S11), 4 `panel-layout` (S9) |
| `contracts/board-golden.ts` | 5 `atlas-ui` (S11), 6 `board-model` (S5) |
| `contracts/hud-world.ts` | 4 `hud` (S8) |
| `omp/channel-view.ts` | 24 `motion`, 25 `atlas-ui`, 31 `gates`, 32 `data/core`, 33 `data/runstate`, 34 `data/todos` |
| `omp/mission-panel.ts` | 9 `motion`, 10 `core-row`, 11 `data/core`, 12 `gates`, 13 `data/runstate`, 14 `atlas-ui`, 15 `mission-layout`, 16 `pane/sidebar`, 17 `board-model`, 18 `data/live`, 19 `data/todos`, 20 `rail` |
| `omp/core-command.ts` | 8 `core-row`, 9 `data/core`, 10 `gates` |
| `omp/core-source.ts` | 8 `data/core`, 9 `contract` |
| `omp/hud-paint.ts` | 7 `atlas-ui`, 8 `hud` |
| `omp/panel-view.ts` | 9 `atlas-ui`, 10 `panel-layout` |
| `omp/panel-paint.ts` | 2 `atlas-ui` |
| `omp/todo-panel.ts` | 7 `atlas-ui`, 8 `board-model`, 9 `motion` |
| `omp/todo-fallback.ts` | 12 `hud`, 13 `motion`, 14 `contract` |
| omp tests | `channel-todos.test.ts` 8-9; `channel-view.test.ts` 9-10; `core-command.test.ts` 8-9; `core-row.test.ts` 7-8; `done-glyph.test.ts` 5; `hud-paint.test.ts` 8-9; `live-channel-roster.test.ts` 11-12 (`snapshot`); `mission-panel-golden.test.ts` 10; `mission-panel.edges.test.ts` 5; `motion.test.ts` 9-12; `paint-256.test.ts` 3; `panel-strip.test.ts` 8-13; `panel-view.test.ts` 7, 9-13 (`golden-pad`, `pane/sidebar.golden-cases`); `rail.test.ts` 6; `todo-panel.edges.test.ts` 5; `todo-panel.test.ts` 5-6 |

All 84 import lines are specifiers the TypeScript-API rewriter resolves [DRY-RUN: `bun test omp` 839 pass in the rewritten copy].

### 4.3 Tests that scan `mod/` by path or glob, or read a source as text
| Test | Lines | Behavior | Move hazard |
|---|---|---|---|
| `theme.test.ts` | 94-143 (helpers 97-127, M4 at 129-134, M5 at 136-143; OWN_PALETTE at 137) | `MOD_ROOT = new URL('.', import.meta.url)`; hex-literal scan with `OWN_PALETTE` allow-list of bare relative names (`atlas-ui.ts`, `contract.ts`, `data/personas.ts`, `sprites/`, `fixtures/`); M4 asserts the files `band-frame.ts`, `status-frame.ts` exist | moves to `design/` at S11 and then scans only `design/`: **silent no-op** for M5; M4 fails at S7 (names no longer at root) [DRY-RUN] |
| `register-look.test.ts` | 118-139 | `MOD_DIR` scan for `uiFromEnv` outside `look.ts` and `atlas-ui.ts` (M2) | moves to `host/` at S6 and then scans only `host/`: **silent no-op** [reasoned; dry run did not flag it because it passes vacuously] |
| `palette.test.ts` | 9, 16-21, 23-30, 36-39, 47 | `ROOT = resolve(import.meta.dir, '..')`, scans `mod` and `omp` for hex and 24-bit escapes; exempt `mod/contract.ts`, `mod/data/personas.ts`, `mod/sprites/`; `SPRITE_TILE` exemption names `mod/atlas-ui.ts`; self-check asserts the scan sees `mod/atlas-ui.ts`, `mod/mission-layout.ts`, `mod/panel-layout.ts`, `mod/board-model.ts`, `mod/transcript/cards.tsx`, `mod/restyle.tsx` | stays at root; its `mod/<path>` literals are rewritten per stage [DRY-RUN green] |
| `host-load-rules.test.ts` | 11, 171, 207-213, 252-285 | `ROOT = resolve(import.meta.dir,'..')`; walks `mod` recursively (`sources()` at 207 skips `fixtures`, `node_modules`), `reachable(mod/register.ts)` at 260; 5 host rules | stays at root; recursion covers new folders |
| `contract-pattern.test.ts` | 25-45 (roots loop at 36) | scans `.` and `../omp` for a phase glyph table, skipping `/mod/contract-pattern.ts` and `/live_fixture.ts` by suffix | stays at root with its source |
| `omp/glyph-guard.test.ts` | 11-45 | walks `mod` and `omp` (skips dirs named `fx`, `node_modules`); `OWNED` and `DEBT` hold 23 literal `mod/<path>` keys | literals rewritten per stage [DRY-RUN: all 23 resolve afterwards] |
| `truth39.test.ts` | 4, 119-122 | `readFileSync(\`${import.meta.dir}/register.ts\`)`, slices at `noteRunFinal(finalNow)` | breaks the stage it moves (S10) |
| `blocked-same-update.test.ts` | 5, 43-50 | reads `register.ts`, slices `async function frameBeat` to `let verdictBusy` | breaks at S6 (merge) |
| `truth41.test.ts` | 3, 20; asserts at 63, 117-118, 168-170, 218-219 | module-level `src` of `register.ts` | breaks at S10 |
| `wave30-hud.test.ts` | 5, 179-185 | reads `register.ts`, slices from `on('classic.Stop'` | breaks at S7 |
| `merge40.test.ts` | 3, 24-31 | reads `register.ts` at describe level; asserts `const hudView = {`, `restSecsOf(runClock, i.clockNow)`, the `runBandModel({...})` call | breaks at S7; line 30 also changes with the S12 state object |
| `idle-polish.test.ts` | 4, 130-135 | reads `register.ts`, slices from `on('session.measure'` | breaks at S8 |
| `round-x.test.ts` | 3, 47-48, 209 | `join(import.meta.dir, f)` for `status-frame.ts`, `tabs-frame.ts`, `card-frame.ts`; `band-motion.ts` at 209; dynamic `import('./band')` and `import('./live_fixture')` at 238-239 (the TS rewriter handles those two) | breaks at S7/S8/S9 |
| `role-colour.test.ts` | 14 | `join(import.meta.dir, '..', 'agents')` | wrong depth once it moves (S8) |
| `consistency.test.ts` | 24-26 | `const ompAt = '../omp/'; import(ompAt + m)`: a computed path no rewriter can see | breaks at S10 (`Cannot find module '../omp/hud-paint'` [DRY-RUN]) |
| `test-shim.ts` | 26 | `require("./data/live")` | `data/live.ts` stays; the rewriter handles `require` anyway |
| `host-load-rules.test.ts` | 218-235, 279, 281 | seed source strings such as `"import { lookOf } from './look';..."` and `await import('./x')` inside strings | must **not** be rewritten: the TS-API rewriter ignores string content; a regex rewriter would corrupt them |

### 4.4 Runtime path strings and path-reading scripts
| Where | Line | What | Stage |
|---|---|---|---|
| `mod/notify.ts` | 161 | `$.audio.play({ asset: 'mod/fx/advance.wav' })` | S4: plain string, failure is swallowed by `.catch(() => {})` |
| `mod/register.ts` | 1047 | `$.audio.play({ asset: 'mod/fx/fail.wav' })` | S4 |
| `mod/register-core.test.ts` | 99 | expects `['mod/fx/fail.wav']` | S4 |
| `mod/notify.test.ts` | 373 | expects `[{ asset: 'mod/fx/advance.wav' }]` | S4 |
| `mod/fixtures/check_glyph_cmap.py` | 6, 24, 33 | reads `HERE.parent / "atlas-ui.ts"` and writes a header naming `mod/atlas-ui.ts` | S11, **hand edit of line 24** to `HERE.parent / "design" / "atlas-ui.ts"`; the script needs `fontTools` and could not be run here [UNVERIFIED] |
| `mod/atlas-ui.ts` | 259-260 | comment naming `mod/fixtures/check_glyph_cmap.py` (fixtures stays) | none |
| `mod/motion-demo.ts` | 3, 92 | usage text `bun mod/motion-demo.ts --out <dir>` | S4 literal rewrite to `mod/motion/motion-demo.ts` |
| `mod/register.ts` | 1-7 | header comment says `"modules": ["./mod/register.ts"]`; hooks.json has `../mod/register.ts` (already stale) | S13 comment fix |
| `plugins/atlas/types/index.d.ts` | 1, 6, 44, 95, 125, 131, 139, 161 | comments naming `mod/register.ts`, `contract.ts`, `orchestra-types.ts`, `data/*` (stay), `restyle.tsx` (S2, literal rewrite); line 95 names `register.ts rebuild()` | S13 for 1 and 95 |
| `plugins/atlas/scripts/atlas_panefeed.py` | 421 | comment `mod/roles.ts (roles.test.ts keeps the two equal)` | S11 literal |
| `plugins/atlas/scripts/atlas_db.py` | 557 | comment `mod/band.tsx WAVE_GAP_MS` | S7 literal |
| `contracts/*.ts` | comments at hud-golden 1,4; world-live 2-4,20; band-fixture 1,6; band-golden 4-5; board-golden 3; panel-golden 11,26; panel-world 2,7; core-golden 3; band-world-golden 4 | comments naming `mod/hud-surface.ts`, `mod/band.tsx`, `mod/mission-layout.ts`, `mod/clickable.ts`, `mod/panel-layout.ts`, `mod/rail.ts`, `mod/consistency.test.ts` | literal rewrite per stage |
| `plugins/atlas/skills/atlas-doctor/references/display-checks.md` | 8, 13, 23 | `../mod/register.ts` (survives), `reportFailure in mod/register.ts` (line 23, S12 to `mod/host/atoms.ts`) | S12 |

### 4.5 Docs that describe the layout
`plugins/atlas/README.md` lines 901, 914, 919, 932, 943, 957, 961, 969, 976, 1019, 1035, 1039, 1077, 1080, 1188, 1201, 1225, 1239, 1291, 1309, 1311, 1313, 1325, 1329, 1332, 1333, 1339, 1345, 1346, 1350-1359, 1579; `docs/architecture/atlas-mod.md` lines 3, 12, 14, 20, 26-36, 40, 49, 59, 63, 71, 73, 75, 77-79, 82, 84, 86, 93, 95, 97, 100, 115, 117, 132, 134, 170 (the layout tree, 170-205), 179, 205, 210-213, 219, 235-236, 245-252, 260, 262, 265 (many cite `register.ts:<line>` that goes stale at S12); `docs/specs/2026-11-10_atlas-terminal-ui.md` lines 40, 83, 104-106, 109, 111-114, 117, 119, 120, 122, 124-126; `docs/ROADMAP.md` lines 74, 100, 110, 244, 265-267, 340; `docs/architecture/atlas-harness-parity.md:115`; `plugins/atlas/mod/TESTING.md` lines 7, 17, 20, 41-43, 75-76, 92, 100 (rewrite from measured numbers is audit item 4.4 #10, separate). Literal rewriting fixes the path text per stage; S13 redoes the layout tree, the stale `register.ts:<line>` citations and the stale counts by hand.

## 5. (c) Entry-point constraint

- **What the host loads.** `plugins/atlas/hooks/hooks.json:159-160`: `"modules": ["../mod/register.ts"]`. The host resolves that string from `hooks/`; `docs/architecture/atlas-mod.md:12` says the same, and `atlas_mod_gate.py` reads the list (`module_entries`) and requires an exported `register(on, options)` (`atlas_mod_gate.py:68`).
- **It could move only if six other places move with it:** `scripts/atlas_doctor.py:988,1279,1282`, `hooks/test_atlas_contract.py:2009`, `scripts/test_atlas_doctor_display.py:23,191,194`, `scripts/test_atlas_doctor_hardening.py:211`, `mod/host-load-rules.test.ts:260` (the reachable-file walk starts there), and `skills/atlas-doctor/references/display-checks.md:8`. The lead's brief says the entry stays; this plan keeps it.
- **Decision.** `mod/register.ts` stays at that path. After S12 it is a thin file that (1) `export { register } from './host/hooks'` and (2) re-exports, by explicit name list, the 30 other names the tests import from `./register` (table in section 7), including the existing `export { fitHudToBand, ... } from './slot'` at register.ts:437. It declares no atom, no `let` and no function of its own. Explicit named re-exports are used because the file already does that and `host-load-rules.test.ts:171` follows `export ... from` declarations; `export *` is not used.
- **Host rules the split must keep** (all enforced by `host-load-rules.test.ts` and by the live gate): `$` is passed only to a top-level function of the same file or to one imported from the mod's own files; `$` is never assigned, stored, returned or spread (so the shared state object never holds `$`); `$.env.get/set` take a string literal; `$.noun.event` members are called where spelled; no `.json` import and no dynamic `import()` in anything reachable from the entry; every `on(event)` is registered once, inside `register()`.
- **Nested imports work in the real host today** [MEASURED]: the live gate passes with the entry already importing `./data/*`, `./pane/*` and `./transcript/*`.

## 6. (d) Stages and checks

**Common check, run after every commit** (from `plugins/atlas`; B0 is the test count measured after S0, 4296 today plus whatever S0 adds):

```
C1  bun test mod 2>&1 | tail -6          # 0 fail, "Ran <B0> tests across <247 + S0 files - merged so far> files"
C2  bun test omp 2>&1 | tail -5          # 0 fail, 843 tests across 54 files
C3  bunx tsc --noEmit -p tsconfig.json > /tmp/tsc.txt 2>&1
    grep -c 'error TS' /tmp/tsc.txt                         # <= 892
    grep TS2307 /tmp/tsc.txt | grep -c "'\.\.\?/"           # == 0
    grep -c 'TS2305\|TS2724\|TS2614' /tmp/tsc.txt            # <= 6 (missing exports; the split can add them)
C4  (cd ../.. && python3 plugins/atlas/scripts/atlas_mod_gate.py --live --require-live)   # exit 0, 4 PASS
C5  python3 -m pytest -q -p no:cacheprovider scripts/test_atlas_mod_gate.py scripts/test_analytics_contract.py scripts/test_atlas_doctor_display.py hooks/test_atlas_contract.py   # 237 passed, 4 skipped
```

Each stage also has one **stage check**: `node scripts/mod_reorg.mjs check --stage N`, which asserts for every map entry of stage N that `to` exists and `from` is gone (for `merge_into`: `from` gone and the target exists and the test count is unchanged), that no live file still contains an old path of that stage (`rg` over `plugins/`, `docs/` minus the historical set in section 4, `.fallowrc.json`, `fallow-baselines/`, `.github/`), and that the scan of unresolved relative-looking string literals reports only the known two (`consistency.test.ts:25`, `contract-pattern.test.ts:36`). The stage passes only when the stage check and C1-C5 all pass. A failure in any of them blocks the commit.

Commit message form: `atlas mod: move <folder> (S<N>)`; merges: `atlas mod: merge round-named tests in <folder> (S<N>.b)`.

| Stage | Folder | Entries | Hand edits beyond the script | Extra check (failable) |
|---|---|---|---|---|
| **S0** | prep, no moves | 0 | (1) P1 commit. (2) Add `scripts/mod_reorg.mjs` and `mod/fixtures/source-tree.ts`. (3) Convert the 6 register readers to `readHostEntry()`: `truth39.test.ts:119`, `blocked-same-update.test.ts:43`, `truth41.test.ts:20`, `wave30-hud.test.ts:179`, `merge40.test.ts:24`, `idle-polish.test.ts:130`. (4) `round-x.test.ts:48` and `:209` to `readMod(<name>)`; `role-colour.test.ts:14` to `join(pluginRoot(), 'agents')`; `consistency.test.ts:25` to `pluginRoot() + '/omp/'`. (5) Extract `theme.test.ts:94-143` (M4 at 129-134, M5 at 136-143) and `register-look.test.ts:118-139` (M2; the second M2 test at 141-152 stays) into `tree-guards.test.ts`, allow-lists by basename and suffix, with floors: at least 90 non-test sources scanned and the named files present. | (a) `bun test mod` count equals the baseline plus the new floor tests and 0 fail; record it as B0. (b) Seed a stray `export const X = '#123456';` into `chart.ts`: `bun test mod/tree-guards.test.ts` must fail naming `chart.ts`; revert. (c) `rg -n "readFileSync\\(.*(register\|band-motion\|status-frame\|tabs-frame\|card-frame)\\.ts" plugins/atlas/mod --glob '*.test.ts*'` returns nothing. (d) C4 passes with the new helper present in the live probe's copy of `mod/` [proves the `fixtures/` placement]. **[UNVERIFIED until run]** |
| **S1** | `input/` | 7 (+1 merge) | none | `ls plugins/atlas/mod/{intents,routing,clickable}*` finds nothing at root. [DRY-RUN green, 34 spec edits, 5 literals] |
| **S2** | `view/transcript/` | 14 (+3 merges) | none | `ls plugins/atlas/mod/transcript plugins/atlas/mod/restyle*` fails. [DRY-RUN green, 132 spec edits] |
| **S3** | `data/` additions | 11 (+5 merges) | none | `idle-health`, `metrics`, `history`, `pulse`, `snapshot` and their tests absent from root. [DRY-RUN green] |
| **S4** | `motion/` (with `fx/`) | 14 (+1 merge) | none beyond the script's 21 literals | audio paths resolve: `for f in $(rg -oh "mod/motion/fx/[a-z]+\\.wav" plugins/atlas --glob '!**/CHANGELOG.md' \| sort -u); do test -f "$f" \|\| echo MISSING $f; done` prints nothing, and `rg -n "mod/fx/" plugins --glob '!**/CHANGELOG.md'` finds nothing. [DRY-RUN green; the 4 literal sites in section 4.4 were rewritten] |
| **S5** | `view/board/` | 11 (+3 merges) | none | `contracts/board-golden.ts` imports resolve: C2. [DRY-RUN green] |
| **S6** | `host/` (non-register) | 34 (+1 merge) | none | `rg -n "'mod/discipline.ts'" plugins/atlas/hooks/test_atlas_contract.py` finds nothing and `HeaderSsotTests` passes (C5). [DRY-RUN green; pytest subset passed in the copy] |
| **S7** | `view/band/` (with `slot`, `core-row`) | 38 | `scripts/atlas_mod_gate.py:215,222-223` (`band.tsx`, `live_fixture.ts`, `data/live.ts` paths: the first becomes `view/band/band.tsx`); `scripts/test_atlas_mod_gate.py:253-258` (`mod2` re-exports). | offline `python3 plugins/atlas/scripts/atlas_mod_gate.py` prints `PASS smoke load+render register.ts` (fails with `band fixtures missing` until the edit, as seen in the dry run). Band↔hud folder cycle is expected (section 10, Q6). |
| **S8** | `view/hud/` | 35 | none after S0 | `bun test mod/view/hud` 0 fail (confirms `idle-polish` and `round-x` no longer read stale paths) |
| **S9** | `view/panel/` (with `pane/`) | 63 (+4 merges) | `.fallowrc.json:16` glob `plugins/atlas/mod/pane/*.tsx` to `plugins/atlas/mod/view/panel/pane/*.tsx` | `glyph-guard` (`omp/glyph-guard.test.ts`) 0 fail and its `OWNED` keys all exist: `bun test omp/glyph-guard.test.ts` |
| **S10** | `view/` root, cross-surface tests | 18 (+1 merge) | none after S0 | `bun test mod/view` 0 fail and the test count of the folder equals the sum of its former files (compare `bun test <old files> \| grep Ran` taken before the move) |
| **S11** | `design/` (largest: 232 importer files) | 26 | `mod/fixtures/check_glyph_cmap.py:24` | `tree-guards.test.ts` and `palette.test.ts` pass **and** `rg -n "design/atlas-ui.ts" plugins/atlas/mod/fixtures/check_glyph_cmap.py` hits; with `pip install fonttools` also run `python3 plugins/atlas/mod/fixtures/check_glyph_cmap.py` (exit 0) **[UNVERIFIED here]** |
| **S12** | `register.ts` split into `host/` | `register.ts` to `host/hooks.ts` plus 6 new modules | see section 7: introduce the state object; edit 3 source-text assertions (`truth41.test.ts:63` and `:218`, `view/band/band-working-clock.test.ts:30`); update `skills/atlas-doctor/references/display-checks.md:23` | C1-C5 plus: `bun test mod/host/register-hooks.test.ts mod/host-load-rules.test.ts` 0 fail; `wc -l plugins/atlas/mod/register.ts` is at most 60 and no `host/*.ts` exceeds 600 lines; C4 (the live host gate) passes. **[UNVERIFIED until run: analysis only, not executed]** |
| **S13** | docs, baselines, CHANGELOG | 0 | `docs/architecture/atlas-mod.md` layout tree and `register.ts:<line>` citations; `plugins/atlas/README.md` lines in 4.5; `mod/TESTING.md`; `plugins/atlas/types/index.d.ts:1,95`; `register.ts` header comment; re-generate `fallow-baselines/health.json` register keys [assumed command: the repo's fallow baseline update]; `plugins/atlas/CHANGELOG.md` entry ("mod/ reorganized into host/data/design/view/motion/input; no behavior change") and `docs/ROADMAP.md`; delete `scripts/mod_reorg.mjs` | `node scripts/mod_reorg.mjs stale-paths` (before deleting it) exits 0, and C1-C5 pass. No version bump unless the owner ships: `ReleaseVersionContractTests` needs plugin.json, marketplace.json and CHANGELOG to move together |
| **S14** (optional) | `panel-layout.ts` split | 1 file into 4-6 | `view/panel/panel-layout.ts` stays as a barrel (`export * from`) so omp and contracts importers (4.2) are untouched | C1-C5; first cut in section 7.4, **no cycle analysis done [UNVERIFIED]** |

Loop-back rules:
- If S12 renames or drops any export that a test imports from `./register`, re-run C1 for every test that imports `../register` (24 files import `register`; more import `resetCore`, `hudSlotCap` and the other re-exported names).
- If any stage edits a guard (`tree-guards`, `palette`, `host-load-rules`, `glyph-guard`), re-run S0's seeded-fault check (b).
- If S11 touches the text of `atlas-ui.ts` (it must not), re-run `palette.test.ts` and `tree-guards.test.ts`.
- A merge commit (S<N>.b) only edits test files: re-run C1 and C2 only, but compare the test count to B0.

Stage order rationale (distinct importer files that must be rewritten per stage [MEASURED from the import graph]): `input` 19, `view/transcript` 40, `data` 40, `motion` 43, `view/board` 44, `host` 59, `view/band` 88, `view/hud` 94, `view/panel` 112, `design` 232. Leaves with the fewest importers go first; `design/` goes last because everything imports `atlas-ui` (44 source and 169 test importers). The scripted rewrite makes the order a risk choice, not a correctness one.

## 7. (e) `register.ts` split

### 7.1 Facts [MEASURED]
`register.ts` is 1,720 lines: 46 import statements (8-53; the audit counted 44), 21 `atom(...)` declarations, 72 module-level `let` variables, 62 functions, and one 361-line `register()` (1360-1720). A top-level `let` cannot be assigned by an importing module, and 50 of the 72 are used from two or more of the future modules (the rest are private to one). `register()` alone writes 30 of them. So the split needs **one exported mutable object** `S` in `host/atoms.ts` holding those 50 variables (`S.runClock`, `S.hostWorking`, ...), with `x = v` becoming `S.x = v`. `S` never holds `$` (host rule 3). The other 22 `let`s stay as local `let`s in their owning module (listed below).

### 7.2 Target modules (current line ranges; "decl" means the whole top-level declaration)
| Module | Role | Contents by name [current lines] | Imports from |
|---|---|---|---|
| `host/atoms.ts` | atoms, shared constants, shared `$` adapters, state object | 21 atoms and `flipsOf`: `isModOn` .. `flipState` [114-131], `BAND_SHOWN_MS`, `spinnerTickState` .. `headerTallyState` [141-149]; `PANE_ID`, `PANE_DOCK`, `PANE_ON_DEMAND`, `BOARD_ID`, `PANE_BOARD` [61-70]; `DOCK_ASKED_MIN_COLUMNS`, `DOCK_MIN_COLUMNS`, `shouldDockRest`, `shouldDockAsked` [76-85]; `toastUnplaced`, `shownFailures`, `MAX_FAILURE_CHARS`, `reportFailure` [86-105]; `engineFs` [386-398], `statSig` [399-406], `rootOf` [518-524]; `S` = `beatFrame, sessionStartMs, pluginVersion, branchName, tmuxHere, usageWindow, healthOpenNow, bandDrawnMs, beatN` [132-140], `builder, wtAt, wtRows, lastRailPhase, muxStdout, muxAgents, muxFirstSeen, muxCalls, sessionUuid, nameMemo, gatesBusy, gatesSig, gatesDirty, gatesUrgent, verdictSig, gatesRunAt, lastViewport, dockWanted, dockedAtRest, soundOn, tickTimer, easeTimer` [156, 162-177, 179, 181-182, 191-194], `motion` [217], `slotHeld` [439], `hostWorking, stopSeen, hostKnown, armedAt, runClock, resumedAt, clockHeld, runOrigin, lastBeatMs, frameTimer, idleFlipped` [1081-1101, 1113-1115], `stopRefused, blockedStreak, blockedAllow, kindHold, heldKind, shownKind` [1124-1131] | `claude-code`, `contract`, `usage`, `orchestra-types`, `data/orchestration` (for `EMPTY_ORCH`); **no sibling host module** |
| `host/agents.ts` | agent parsing | `SPAWN_GRACE_MS` [236-240], `folderOf` [241-245], `headerPhaseOf` re-export [248-251], `headerTallyOf` [252-258], `LIST_STATE` [259-269], `HOST_DONE` [270-272], `typeLabel`, `slugOf`, `ListedRow`, `mapListed` [284-318], `listedLabel`, `firstText`, `GENERIC_PERSONAS`, `recordedPersona`, `personaOf`, `teammateName`, `baseLabel`, `syncAgentsFromList` [358-385] (pure, no `$`, no state) | `contract`, `data/orchestration`, `view/transcript/restyle` (for `headerPhaseOf`) |
| `host/poll.ts` | poll loop | `POLL_MS`, `WT_MS`, `MUX_MS`, `HERDR_MS`, `GATES_MS`, `GATES_MIN_MS` [55-60]; local `let`s `herdrStdout, lastFingerprint, rebuildRun, rebuildFollow, rebuildSeq` [157-161]; `dataFingerprint` [475-506], `worktrees` [507-517], `rebuild` [525-540], `noteNotified` [541-547], `rebuildOnce` [549-614], `dockTick` [615-625], `gatesSigOf` [626-637], `withStopVerdict` [638-653], `verdictPoll` [654-671], `gatesPoll` [672-683], `rebuildTick` [684-694], `herdrTick` [695-706], `muxTick` [707-722], `muxStatus`, `muxRuns`, `paneCalls`, `withPaneTools` [723-766], `gitBranch` [767-778], `probeTmux` [779-788], `groupsFromRun` [789-798], `runGates` [799-818] | `atoms`, `agents` |
| `host/core-tick.ts` | the Atlas core poll | local `let`s `coreSeen, coreFinished, coreFiles, coreTouched, coreFindingsOk` [186-190]; `resetCore` [942-957], `readCached` [958-969], `parses`, `readGrown`, `namesIn` [971-986], `reportsOf` [987-998], `leadMessages` [999-1008], `buildCore` [1009-1042], `coreToasts` [1043-1051] (holds the `mod/fx/fail.wav` literal at 1047), `coreTick` [1052-1069], `gateGroups` [1070-1072] | `atoms`, `poll` (`MUX_MS`, `rebuild`) |
| `host/handlers.ts` | slot, HUD state and UI handlers | `HudState`, `StatuslineRows`, `STATUSLINE_ROWS_FRESH_MS`, `readStatuslineRows` [408-431], `atlasSlot` [432-435], the `./slot` re-export [437-438] (retargeted to `../view/band/slot`), `resetSlotHold`, `resetSessionStart` [440-444], `inlineBelowRows`, `effectiveRows` [445-453], local `lastHudSig` [454], `resetHudStateSig`, `publishHudState` [456-474]; `noteContext` [819-821], `noteArgv` [822-829], `sendNote` [830-849], `guardedBy` [850-854], `sidebarHandlers` [855-879], `openBoard` [880-896], `healthInOf` [897-920], `bandHandlers` [922-941] | `atoms`, `poll` (`rebuild`), `core-tick` |
| `host/frame.ts` | run clock, frame beat, blocked flip, motion ticks | `STOP_SETTLE_MS`, `TICK_MS`, `EASE_STEP_MS` [71-73]; `easeTick` [195-212], local `motionDriver` [218], `motionTick` [219-235]; `turnEnded`, `hostTurnRunning` [1085-1088]; `originOf`, `resumedNow`, `heldWork`, `heldFinal` [1102-1112]; local `blockedDrawn` [1121]; `resetBlockedDebounce`, `resetBlockedMark` [1132-1135], `observeBlocked` [1136-1148], `isWorkingNow` [1149-1158], `runBandModel` [1159-1177], `syncHistory` [1178-1185], `frameBeat` [1186-1222], local `verdictBusy` [1223] (must stay in the same file as `frameBeat`: `blocked-same-update.test.ts:44` slices between them), `armFrameLoop`, `ensureFrameLoop` [1225-1239], `verdictFast` [1240-1243] | `atoms`, `poll` (`gatesPoll`, `runGates`, `verdictPoll`), `core-tick` (`gateGroups`) |
| `host/hooks.ts` | boot and hook registration | local `let`s `pendingDrift, paneChecked, promptDockDone, paneClosedByPerson, modOnNow, booted, hostFlag, wired` [178, 180, 183-185, 1079, 1091, 1244]; `boot` [1245-1345], `dockOnPrompt` [1346-1358], `register` [1360-1720] (kept whole: every `on(event)` stays here so `register-hooks.test.ts` rule 1 and the source-text anchors keep holding) | all of the above plus `discipline`, `restyle`, `notify`, `routing` |
| `register.ts` (thin) | entry | re-exports only | `host/*`, `view/band/slot` |

### 7.3 Import direction and the cycles to avoid
Allowed order: `atoms` and `agents` (leaves) < `poll` < `core-tick` < `handlers` and `frame` < `hooks` < `register.ts`. Rules:
1. `atoms.ts` imports no sibling host module. Nothing imports `hooks.ts` or `register.ts`.
2. **`dockTick` lives in `poll.ts`, not `handlers.ts`.** `rebuildTick` (poll, 684) calls `dockTick` (615) while the handlers call `rebuild` (poll); placing `dockTick` in `handlers.ts` creates a poll/handlers cycle. This is the one real cycle the analysis found [MEASURED: edge graph of the 1,720-line file under the proposed assignment].
3. `engineFs`, `statSig` and `rootOf` live in `atoms.ts` (used by poll, handlers and hooks).
4. `resetCore` (942-957) resets `gates*`, `verdictSig`, `wt*` as well as `core*`: it stays in `core-tick.ts` and writes the `S` fields. Do not give `poll.ts` a `resetPoll` that `core-tick.ts` imports back.
5. The name `core.ts` is avoided on purpose (`data/core.ts` exists): `core-tick.ts`.
6. A guard test in S12 asserts file-level acyclicity of `host/` (the existing M4 check covers band-frame and status-frame only; extend `tree-guards.test.ts` with a generic runtime-import cycle check over all of `mod/`, reusing the `runtimeEdges` walker from `theme.test.ts:111-123`).
Three false edges (`atoms`, `poll`, `handlers` to `hooks`) showed up in the analysis because the words `boot` and `register` occur in comments; the real compile check (C3 filtered counts) settles it.

Export map for the thin entry (names that tests import from `./register` today [MEASURED: 30 names]):
| Name | New home |
|---|---|
| `register` | `host/hooks` |
| `resetCore`, `buildCore`, `coreTick` | `host/core-tick` |
| `rebuild`, `rebuildTick`, `dockTick`, `withStopVerdict` | `host/poll` |
| `hostTurnRunning`, `turnEnded`, `isWorkingNow`, `resetBlockedDebounce`, `resetBlockedMark`, `STOP_SETTLE_MS` | `host/frame` |
| `atlasSlot`, `readStatuslineRows`, `publishHudState`, `effectiveRows`, `inlineBelowRows`, `resetSlotHold`, `resetSessionStart`, `resetHudStateSig`, `openBoard`, types `HudState`, `StatuslineRows` | `host/handlers` |
| `fitHudToBand`, `hudGapRows`, `hudSlotCap`, `slotHold` | `view/band/slot` (re-exported as at register.ts:437) |
| `headerPhaseOf` | `view/transcript/restyle` (re-exported as at register.ts:248) |
| `headerTallyOf`, `mapListed`, `syncAgentsFromList` | `host/agents` |
| `BOARD_ID`, `shouldDockRest`, `shouldDockAsked` | `host/atoms` |

Source-text assertions that change because `x` becomes `S.x`: `truth41.test.ts:63` (`readRun(clockHeld, runClock`), `truth41.test.ts:218` (`beatDue({ working, shown: shownKind,`), `merge40` / `view/band/band-working-clock.test.ts:30` (`restSecsOf(runClock, i.clockNow)`). `truth41.test.ts:219` (`shownKind = kStep.shown;`) still matches as a substring. Better, but out of scope: replace those with behavior assertions.

### 7.4 `panel-layout.ts` first cut (S14, optional) [UNVERIFIED]
4.3 asks for "tabs, cards/toasts, body rows". 57 exports, 1,653 lines. Proposed modules in `view/panel/`: `tabs.ts` (strip and ribbon, 27-92 and 240-300: `PANEL_TABS`, `STRIP_*`, `stripRows`, `stripLayout`, `ribbonRow`, `tabRows`, `headerRows`), `cards.ts` (cards and toasts, 1576-1653: `CardModel`, `cardLines`, `toastRuns`, `toastText`, `noteToastRuns`), `rows.ts` (shared line primitives 93-239), and per-tab bodies: `body-status.ts` (617-770), `body-team.ts` (792-970), `body-channel.ts` (971-1250), `body-gates-core.ts` (1228-1500), `body-route.ts` (481-616), with `panel-layout.ts` left as a barrel (`export *`) and `panelLines`, `panelText`, `bodyLines`, `fillRows` (1531-1575) as the composer. Not analysed for cycles; the module-level state is only the `stamps` map (989-992). 10 omp importers and 4 contracts files import `panel-layout`, which is why the barrel stays.

## 8. How import paths are rewritten and how a miss is proven

**Rewriter** (`scripts/mod_reorg.mjs apply --stage N`, driven only by the JSON block in section 3):
1. For each stage, build `from -> to` for that stage's entries. Parse every `.ts`/`.tsx` file under `plugins/atlas/{mod,omp,contracts,scripts,hooks,types}` with the TypeScript compiler API. Visit `ImportDeclaration`, `ExportDeclaration`, dynamic `import("...")`, `require("...")` and `import("...")` type nodes whose specifier is a relative string literal. Resolve each against the file's **old** directory (`.ts`, `.tsx`, `/index.ts`, `/index.tsx`, or exact for `.json`); if it resolves to a file that moves, or the importing file itself moves, write the new relative specifier computed from the importer's **new** directory. Specifiers that do not resolve (the seed strings in `host-load-rules.test.ts`, `./x`) are left alone, and string contents and comments are never matched [this is why a TypeScript parser is used instead of a regex].
2. Literal path rewrite in text files (`.ts .tsx .py .md .json .toml .js .yml`): replace `mod/<old-path>` and `plugins/atlas/mod/<old-path>` with the new path, longest match first, only when not preceded by `[\\w./-]` and not followed by `[\\w-]`. This covers `omp/glyph-guard.test.ts` keys, `palette.test.ts` keys, `test_atlas_contract.py:1917`, `test_analytics_contract.py:53-55`, `fallow-baselines/*.json` keys, audio asset strings, doc text. Excludes `CHANGELOG.md`, `docs/archive`, `docs/audits`, dated `docs/plans`, `.atlas`.
3. Report-only scan for relative-looking string literals outside import positions that resolve to a file or folder under `mod/` (finds `consistency.test.ts:25` and `contract-pattern.test.ts:36`); a human reviews that list each stage.
4. Move files with `git mv` in the same commit (one folder per commit), then `git add -A`.
Merges: `apply --merge --stage N` (second commit) as in section 3, rule 3.

**Proof that no import was missed** (all in C1-C5 and the stage check):
- `bun test mod` and `bun test omp` load every moved file: a missed specifier is a load error (`Cannot find module`, seen in the dry run for `consistency.test.ts` at S10).
- `tsc` relative-specifier TS2307 count must be exactly 0, and TS2305/TS2724/TS2614 (missing export) must not exceed 6. The total `error TS` count must not exceed 892, but the total alone is not trusted (section 1).
- The offline and live mod gate load the bundle from the entry (the live probe goes through `claude plugin test`).
- Test count equality with B0 proves no test file was dropped by a failed load or by a merge.
- `rg` stale-path scan from the stage check.

## 9. Dry-run evidence [DRY-RUN, scratch copy of plugins/atlas without colony, outside the repo]

Rewriter and map applied stage by stage to a copy; `bun test mod` after each (baseline 4296 tests, 247 files):

| Stage | Spec edits | Literal edits | Files rewritten | Result |
|---|---|---|---|---|
| S1 | 34 | 5 | 25 | 4265 pass, 0 fail, 4296 tests |
| S2 | 132 | 6 | 45 | green, 4296 |
| S3 | 97 | 1 | 47 | green, 4296 |
| S4 | 64 | 21 | 59 | green, 4296 |
| S5 | 97 | 10 | 54 | green, 4296 |
| S6 | 135 | 10 | 59 | green, 4296 |
| S7 | 350 | 23 | 109 | 3 fail: `wave30-hud` register read, `theme` M4 scan, `round-x` X6 (band-motion read) |
| S8 | 287 | 15 | 103 | 6 fail: the 3 above plus `idle-polish` register read, `round-x` X1 (status-frame read) |
| S9 | 410 | 45 | 129 | same 6 |
| S10 | 206 | 1 | 19 | 9 fail, 4230 tests ran: adds `truth39` register read and load errors for `truth41`, `merge40`, `consistency` (computed `'../omp/'`) |
| S11 | 367 | 30 | 261 | same 9 |

Also in the final copy: `bun test omp` 839 pass 0 fail (identical to baseline); filtered tsc 892 total and 0 relative TS2307; `pytest` of `test_analytics_contract.py` (42 passed, 2 skipped), `test_atlas_doctor_display.py` (49), `test_atlas_doctor_hardening.py` (28), `test_atlas_contract.py -k "HeaderSsot ..."` (7) passed; **`atlas_mod_gate.py` offline FAIL `band fixtures missing .../mod/band.tsx` and `test_atlas_mod_gate.py` FileNotFoundError**, which the S7 hand edit fixes; `check_glyph_cmap.py` needs `fontTools` (not installed). Not dry-run: S0, merges, S12, S13, S14.

Total across S1-S11: 2,179 import-specifier edits and 167 path-literal edits, zero by hand. Every failure came from a test that reads the tree by path or computes a path, which is exactly the S0 list.

## 10. Open questions and assumptions

Open questions for the owner or lead (the plan proceeds on the stated default):
1. **Uncommitted work.** 20 modified and 5 untracked files under `mod/` must be committed before S0 (P1). Who commits them, The audit measured 4,209 tests and today's tree runs 4,296 (87 more, at least 13 of them in the three untracked test files); is the rest in the 20 modified files?
2. **`design/` contents.** 4.3 names `tokens.ts`, `glyphs.ts`, `env.ts`, `look.ts`. Only `look.ts` exists. Default: move `atlas-ui.ts` and `theme.ts` unchanged and treat the token/glyph/env split as the M1, M2, M5 work. Also decide the placement of the other design primitives `paint`, `runs`, `vocab`, `roles`, `rail`, `chart`, `spark` (default: `design/`).
3. **Shared kernel stays at the root:** `contract.ts`, `contract-pattern.ts`, `orchestra-types.ts` (reasons in the stays table). Alternative: `contract-pattern.ts` to `design/` and the other two to `data/`; cost is 31+20 importer files and the `types/index.d.ts` and `test_atlas_contract.py:2039` mirrors.
4. **Not named in 4.3, placed by import direction:** `sprites/` stays; `strip-frame` to hud; `slot` and `core-row` to band; `snapshot` and `pulse` to data; `motion-feed`, `notify`, `usage` to host; `restyle` to transcript; `todo-panel` to board; `motion-demo` to motion. Confirm or redirect.
5. **Test names.** The 84 renames and 19 merges are proposals from header comments and imports; bodies were not read. `wire-expert.test.ts` and `y1-live.test.ts` share the same header sentence and may be duplicates (diff them before renaming to `host/idle-breath-wiring` and `host/pulse-wiring`). Merging is optional per file; a merge that clashes falls back to a rename.
6. **Folder-level import cycles are unavoidable under 4.3** [MEASURED, source files only]: `data` and `host` (4 edges one way, 7 the other: `history`, `idle-health`, `pulse` import `hook-log`; `data/runstate` imports `gates`), `data` and `view/panel` (1 and 19), `view/band` and `view/hud` (3 and 1), `view/band` and `view/panel` (2 and 2), `view/board` and `view/panel` (1 and 3), `view/panel` and `view/transcript` (2 and 2), `host` and `view/hud`, `motion` and `view/hud`. The plan gates on file-level acyclicity only. Moving `hook-log.ts` and `gates.ts` to `data/` would remove the largest one but contradicts 4.3 (`host/` lists both).
7. **Fallow baselines.** `fallow-baselines/health.json` has 44 `mod` keys. The literal rewrite re-keys moved files; the `register.ts` keys need regeneration at S12. The fallow command is not run in any workflow (`grep fallow .github/workflows/*.yml` is empty) [assumed: `fallow audit`]. Is regenerating them in scope?
8. **S14** (`panel-layout.ts` split) is in 4.3 but only a first cut is given. Do it in this effort or defer?
9. **Version bump.** None planned (no behavior change). A bump needs plugin.json, marketplace.json and CHANGELOG together.
10. **`mod/TESTING.md`** gets only path fixes here; the measured-numbers rewrite (audit 4.4 #10) is separate.

Assumed, not read or not run:
- Test bodies (only headers and imports were read) [assumed]; so the subject names may need correction.
- That the real host ignores unreferenced files in `mod/` such as `fixtures/source-tree.ts` [assumed; S0 check (d) tests it with the live gate].
- Merge mechanics and the S12 split were analysed on the import graph and a declaration table, never executed.
- `check_glyph_cmap.py` (needs `fontTools`); `fallow` regeneration; the 3 extra files in the `bun test mod` filter count.
