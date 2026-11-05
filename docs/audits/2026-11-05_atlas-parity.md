# Atlas harness parity (2026-11-05, Atlas 17.1.0)

Atlas hooks fire on all five core events and block a force push of `main` on Claude Code 2.1.318, Codex
0.166.0 and omp 18.16.0, measured live with one real turn per harness. Before this release the doctor
printed a false "atlas plugin is unhealthy" warning on every Codex and omp session (4 warnings in the
run below); after the fix it prints none.

## How it was measured

`plugins/atlas/scripts/atlas_parity_rig.py` (stdlib only, 23 tests in `test_atlas_parity_rig.py`) runs
two scenarios per harness in a throwaway `HOME` with telemetry off:

- `write`: the model asks for `echo atlas-parity > parity.txt`. The file must exist afterwards.
- `force-push`: the model asks for `git push --force origin main`. An Atlas hook must deny it and the
  push must not run.

Codex and omp talk to a local fake model server (Responses API SSE for Codex, chat completions for omp)
that returns the tool call, so the run is deterministic and needs no OpenAI key. Claude Code runs a real
sonnet turn. The rig records which hook scripts ran (each hook appends to a log) and what the harness
itself reported.

```sh
cd plugins/atlas
python3 scripts/atlas_parity_rig.py                       # all harnesses, both scenarios
python3 scripts/atlas_parity_rig.py --harness omp --scenario force-push --keep
```

## Results

| harness | SessionStart | UserPromptSubmit | PreToolUse | PostToolUse | Stop | parity.txt written | force push denied, not run |
|---|---|---|---|---|---|---|---|
| Claude Code 2.1.318 | yes (2) | yes (1) | yes (2) | yes (1) | yes (2) | yes | yes (`event_dispatch.py`) |
| Codex 0.166.0 | yes (2) | yes (1) | yes (2) | yes (1) | yes (2) | yes | yes (`event_dispatch.py`) |
| omp 18.16.0 | yes (2) | yes (1) | yes (4) | yes (1) | yes (2) | yes | yes (`git_guard.py`) |

Counts are hook scripts that ran for the event. PostToolUse does not fire in the force-push scenario on
any harness, which is correct: the tool never ran. omp runs four PreToolUse scripts because its
extension calls `bash_advisor.py`, `dispatch_tripwire.py`, `fallow_gate.py` and `git_guard.py` directly
instead of one dispatcher. The deny reason is the same text on all three.

## Doctor fixes

The SessionStart doctor (`scripts/atlas_doctor.py --hook`) assumed Claude Code. Under Codex and omp it
reported two false failures:

| warning | cause | fix |
|---|---|---|
| `config-readable: cannot read plugin config ... installed_plugins.json` | Codex loads the plugin from `$CODEX_HOME/plugins/cache`, which has no Claude registry | `detect_load_source` returns `codex` for that path and the Claude registry checks are skipped |
| `gates-armed: enforcement disabled by env: ATLAS_MANDATES=off` | omp sets `ATLAS_MANDATES=off` for its own reasons; the extension enforces the gates itself | the env check is skipped under omp |

`_harness()` now resolves in this order: a valid `ATLAS_HARNESS`, then `CLAUDECODE`, then
`atlas_harness.detect_harness()`. The "then /reload-plugins" hint is printed only under Claude Code.
Six new tests in `scripts/test_atlas_doctor.py`; three of them fail on the old code.

| run | "ATLAS-DOCTOR WARNING" lines |
|---|---|
| before the fix | 4 (2 Codex, 2 omp) |
| after the fix | 0 |

## Status display

The status display differs by design: Claude Code has the mod (band and side pane), omp has its
extension panels, and Codex has no extension surface for a custom display.

- Claude Code mod: `claude plugin test .` from `plugins/atlas` runs every `*.test.ts` against the host
  kit: 460 pass. The sprite overflow test used to time out under the host kit (91,629 `expect` calls);
  it now collects problems into one assertion (5,520 calls, 330 ms to 197 ms under bun).
- A live interactive session (`claude --plugin-dir plugins/atlas`) drew the band with its
  route, team, channel, core and board tabs.
- `tsc` against the types Claude Code 2.1.318 generates now exits 0 for `mod/tsconfig.json` and the root
  `tsconfig.json`. The mod and the plugin types shared a snapshot block that had drifted; a contract test
  (`ModTypesContractSync.test_shared_snapshot_block_identical`) now fails if they differ again.
- Two mod rendering bugs were found by the new widget tests and fixed: a parked worker made the team
  pane throw (no `parked` entry in `STATE_LOOK`), and the core pane cut the verdict "needs evidence" to
  fit a fixed column.

## Not measured

- Codex and omp against a real OpenAI model. The fake server proves the hook wiring, not model behaviour.
- The Claude Code mod in the desktop app. The live check was the terminal UI.
