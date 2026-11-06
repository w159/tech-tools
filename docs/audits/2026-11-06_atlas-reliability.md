# Atlas reliability work (2026-11-06, Atlas 17.1.0 to 17.2.0)

Follows `2026-11-05_atlas-mutation.md`. That audit hardened a sample; this pass covered the files it
left at baseline, fixed the product bugs the new tests exposed, and removed the test-suite temp-dir leak.
Range audited: `8b0a18f` (atlas 17.1.0) to `c87838c`, 109 commits.

## Method

- Tool: `plugins/atlas/scripts/atlas_mutate.py` (see the mutation audit for how it works), run from
  `plugins/atlas` with `--root . --context ../.. --plan PLAN --json OUT`.
- Samples: Python "remaining" set = the files the 2026-11-05 sample did not score, 10 mutants per file,
  seed 1105. TS/JS "remaining" set, 10 mutants, seed 1105. TS/JS 69-file sample, 20 mutants, seed 1105.
- Bars used when raising a file: Python 8/10 at seed 1105 and 7/10 at seed 2211; TS/JS 16/20 and 14/20
  at max 20.
- Result files: `/home/claude/ev/mut/` (`rem-py.json` vs `after-rem-py.json`, `rem-ts.json` vs
  `after-rem-ts.json`, `before-ts.json` vs `after-ts20.json`). Only files with status `ok` and at least one
  sampled mutant in both runs are counted.
- Totals were re-summed from those JSON files (sum of `killed` / sum of `sampled`) when this audit was
  written; they match the figures below.

## Before and after

| sample | files | before | after |
|---|---|---|---|
| Python, remaining files (seed 1105, max 10) | 66 | 411/647 (63.5%) | 572/647 (88.4%) |
| TS/JS, remaining files (seed 1105, max 10) | 26 | 99/258 (38.4%) | 250/258 (96.9%) |
| TS/JS, 69-file sample (seed 1105, max 20) | 69 | 845/1308 (64.6%) | 1153/1308 (88.1%) |

Follow-up passes after the "after" runs above (commits are the evidence; not re-summed into the table):

- 11 Python files that had no tests: 99/105 after (11 files, 105 sampled mutants).
- 11 Python files at 7/10 were raised to 9-10/10 at both seeds (`e8107f9`: control, dash_term, finding,
  inventory, mutate, packs, panefeed, statusline, tui, discover_capabilities, probe_gates).
- 4 files could not be measured: their baseline failed inside the mutation mirror because a gitignore
  contract test broke under symlinks (fixed in `ffb2f52`). After the fix: `atlas_db` 9/10, `atlas_faults`,
  `atlas_memory`, `atlas_scope` 10/10.
- 12 TS/JS files below 16/20 were raised to 16-20/20 (`4bacf2c`, `ad9a94f`).

Test counts (run by the lead): pytest 8451 passed, 7 skipped, 0 failed (normal and CI-like serial); bun
3320 pass, 13 skip, 0 fail, also 0 fail under `--randomize` seeds 11, 77, 4242, 1, 2, 3; `tsc` 0 errors on
both tsconfigs. Earlier in this work: pytest 7043 and bun 1600; before 17.1.0: pytest 5297 and bun 979.

## Product bugs fixed

Each was found by a new or hardened test and fixed in the commit shown.

Python:

| bug | commit |
|---|---|
| `atlas_dashboard` `_cache_install_scripts` glob never matched the Claude plugin cache | `597b7a2` |
| `session_boot_core` language detection tie order was unstable; ties now rank by name | `4e69871` |
| `atlas_selffix` `_dirty_files` overlap parse and snapshot without a repo | `b34fccc` |
| `make_fx` `advance()` used a float frame index and crashed | `663af9a` |
| `plugin-health` crashed on an undecodable manifest | `3447807` |
| `plugin-health` counted boolean `skills` and `agents` values as numbers | `2c158ad` |
| `atlas_irc` log read failed on undecodable bytes; empty `_dir` raw value; `say`/`DONE` took the channel from `members()` (which invents `#team`) instead of the bus `members.json` | `f38065b` |
| `atlas_irc` `_early_check` treated any command containing "pytest" as pytest; now matches the command token | `cbcb758` |
| `atlas_dash_irc` name validation used `match`; now `fullmatch` | `2f0ca50` |
| `lint_docs_names` `_slugify` kept edge underscores | `06adfab` |
| `atlas_panefeed` did not initialise `dirty` and the clock, so the ticker could raise | `a6a18c8` |
| `atlas_security` version key ranked a pre-release above its release | `350b79e` |
| `worker_report_gate` `git_changed` kept empty `-z` fields (empty origin) | `c3c6bd6` |
| `probe_herd` did not skip blank `ps` lines | `345a49a` |
| `run_changed_paths` returns an empty list when the db read fails | `862dad2` |
| dispatch-wave window start not pinned after a long gap | `c87838c` |

JS/TS (dashboard, mod, omp):

| bug | commit |
|---|---|
| fleet agent menu and inspector replace/teardown fixes | `593afb1` |
| gateway pane port (`toHost`) | `fd4a9f5` |
| integrations cache treated a future-stamped entry as fresh; now stale | `5f2841d` |
| overview page `appendChild(null)` crash with no weekly KPIs | `582c51e` |
| late responses after page destroy threw: projects, health, activity, improve | `e5e5a63`, `d563c82`, `65f17dc`, `78018be` |
| channel lens dropped a second pick while a refresh was in flight | `d3fb761` |
| model picker threw on a null search | `4804754` |
| `presenceWord` read inherited object keys | `31f94ba` |
| agents list sorted channel-less agents first; now last | `ed3c8e7` |
| dead code removed (`tokenOf`, `WORD_FOR_RAW.partial`, herdr-actions `confirm`) | `084101e` |
| omp `proc.ts` kill timer used live globals and crashed under stubs | `ef40aec` |
| omp tests leaked hook children past their test | `7a6ad25` |
| improve page test timer stub now returns a Node-like handle | `dcc4a34` |

## Test hygiene

- pytest runs in one private `TMPDIR` removed at session end (`2eba5f4`); bun does the same (`e67076d`).
  Before this, about 159,000 leaked temp dirs (about 26G) filled the disk over 9 hours of runs.
- Tests made independent of order, real `HOME`, git identity and leaked env vars: `bc878f4`, `df63ebf`,
  `a3f2d6c`, `c480df1`, `ce80951`.
- `ffb2f52`: the gitignore secret contract probes a scratch repo, so it passes in a symlinked mutation
  mirror.

## Known limits

- Surviving mutants left are judged equivalent (no observable behaviour change); each file's survivor list
  is in its JSON record.
- Python coverage counts (`/home/claude/ev/zero-cov-py.json`, 198 functions with no test naming them at the
  baseline) are in-process only; subprocess-run code is not counted.
- Real omp, Claude Code and Codex runtime parity was not re-run for this pass; the last live run is
  `2026-11-05_atlas-parity.md`.
- TS/JS coverage baseline: `/home/claude/ev/cov-ts.log` (1298 pass, 13 skip, 0 fail across 108 files).
