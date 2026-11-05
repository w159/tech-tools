# Atlas mutation testing (2026-11-05, Atlas 17.1.0)

Mutation testing changes one thing in a source file (a comparison, a constant, a return value) and runs
that file's tests. A test suite that still passes did not notice the fault. Measured on the same
mutants before and after this release:

| sample | before | after |
|---|---|---|
| TypeScript (mod, omp, contracts): 73 files, 1308 mutants | 845 killed (64.6%) | 1012 killed (77.4%) |
| Python (hooks and the harness, team and doctor scripts): 44 files, 432 mutants | 246 killed (56.9%) | 310 killed (71.8%) |

The "after" totals swap in the re-measured score for each file whose tests were hardened (tables below)
and keep the baseline score for every other file. Same tool, same seed (1105), same mutant sample per
file.

Hardening found two real bugs, both fixed: a parked worker made the team side pane throw (no `parked`
entry in `STATE_LOOK`), and the core pane cut the verdict "needs evidence" to fit a fixed column. It also
found tests that passed for the wrong reason: the delegation-prewarn subagent and `ATLAS_GATE=off`
cases used a path that never counted as code, so they would have passed with the check deleted.

## Tool

`plugins/atlas/scripts/atlas_mutate.py` (stdlib only; 19 tests in `test_atlas_mutate.py`):

- AST mutants for Python, TypeScript compiler API mutants for TS and TSX (comparison and boolean
  operators, constants, `return None` / early returns, negated conditions).
- Each mutant runs in a private copy of the tree; the original is never edited. A canary mutant checks
  that the tests can fail at all before a file is scored.
- A failing baseline is retried once (the record says `flaky_baseline`); a timeout is not retried.
  Fixture and golden files are skipped.
- `--context DIR` mirrors a parent directory (symlinks, plus a real copy of `--root`) for tests that read
  files above the plugin, such as `hooks/test_codex_parity.py` and `scripts/test_atlas_mux.py`. Without
  it those suites failed their baseline.

```sh
cd plugins/atlas
python3 scripts/atlas_mutate.py --root . --auto-plan /tmp/plan.json        # {target, tests} for every file
python3 scripts/atlas_mutate.py --root . --context ../.. --plan /tmp/plan.json --max 20 --seed 1105 --json /tmp/mut.json
python3 scripts/atlas_mutate.py --root . --target mod/routing.ts --tests mod/routing.test.ts --max 20 --seed 1105
```

## TypeScript, files hardened (max 20 mutants unless a file has fewer)

| file | before | after | remaining survivors |
|---|---|---|---|
| mod/pane/sidebar-team.tsx | 2/20 | 20/20 | none |
| mod/pane/sidebar-core.tsx | 5/20 | 20/20 | none |
| mod/pane/sidebar-route.tsx | 9/20 | 20/20 | none |
| mod/core-row.ts | 9/20 | 19/20 | 1, equivalent |
| mod/runs.ts | 2/6 | 5/6 | 1, equivalent |
| mod/notify.ts | 10/20 | 16/20 | 4, equivalent |
| mod/register.ts | 3/20 | 18/20 | 2, equivalent |
| mod/routing.ts | 9/20 | 20/20 | none |
| mod/data/orchestration.ts | 7/20 | 19/20 | 1, equivalent |
| mod/data/live.ts | 8/20 | 19/20 | 1, equivalent |
| mod/sprites/api.ts | 8/20 | 19/20 | 1, equivalent (unreachable fallback) |
| omp/core-command.ts | 1/12 | 12/12 | none |
| omp/proc.ts | 8/20 | 16/20 | 4, equivalent (`force: true` on a dir that exists; 1 ms timing constants) |
| omp/mission-panel.ts | 8/20 | 19/20 | 1, equivalent (8 s timeout constant) |
| omp/core-source.ts | 11/20 | 20/20 | none |
| omp/resolve.ts | 7/12 | 12/12 | none |

"Equivalent" means the mutant changes no observable behaviour, for example a sort rank raised on the
highest-ranked state or a default that is always overwritten before it is read. Each test file that
was added or extended was shown to fail on a seeded fault and to pass on the real code.

## Python, files hardened

| file | before | after (seed 1105) | after (seed 2211, max 20) |
|---|---|---|---|
| hooks/completion_gate_core.py | 14/20 | 20/20 | 20/20 |
| hooks/dispatch_tripwire_core.py | 7/10 | 10/10 | 20/20 |
| hooks/crew_worker.py | 2/20 | 20/20 | 19/20 |
| hooks/delegation_prewarn.py | 4/20 | 18/20 | 18/20 |
| hooks/docs_drift.py | 3/10 | 9/10 | 19/20 |
| hooks/stop_tail.py | 3/10 | 8/10 | 14/16 |
| hooks/session_boot_core.py | 4/10 | 10/10 | 8/20 |
| scripts/doctor_layout.py | 4/10 | 10/10 | 13/20 |
| scripts/atlas_prompt_judge.py | new | 91/98 (92.9%), all mutants | |

The remaining seed-1105 survivors in the first six rows are `sys.path.insert(0, ...)` changed to
`insert(1, ...)`, which is equivalent: no module name exists in both `hooks/` and `scripts/`. The
`crew_worker` and `delegation_prewarn` baselines used one test file each; with every test file that
imports them they start at 15/20 and 5/20.

The seed-2211 column is a second, independent sample. `session_boot_core.py` (8/20) and
`doctor_layout.py` (13/20) still have untested behaviour: numeric constants and early-return paths in
the update notice, colony gate and layout walk. They are the next files to harden.

## Weakest files still at baseline

From the 1105 sample, scores at or below 50% that this release did not touch: `hooks/docs_drift_watch.py`,
`hooks/ingest_session.py`, `hooks/memory_capture.py`, `hooks/recall_gate.py`,
`scripts/atlas_codex_contract.py`, `scripts/omp_runstate.py` (all 5/10). The full per-file list is the
JSON that the `--plan` command above writes.

## Limits

- The Python sample covers 44 of 124 source files (all hooks, then the harness, Codex, omp, mux, crew,
  todo, doctor and judge scripts), at 10 or 20 mutants each. The full plan of 104 files ran at about 10
  minutes per file on this 4-core machine, so it was cut to this sample.
- `hooks/test_atlas_contract.py` fails its baseline inside the mutation copy (it checks the whole repo
  layout), so no file is scored against it.
- `omp/hook-bridge.ts` failed its baseline twice under load and passed alone; it is not scored.
- The vendored `colony/herdr-web-ui` tree is upstream code with its own tests and is not sampled.
