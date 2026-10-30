# Evidence: Atlas 16.10.0 display parity (Claude Code vs omp)

Round 3 of the display parity work. 16.9.0 was checked on a user's first run; this round checks tight prompt slots
(24, 30 and 40 rows) and the omp TODO tree, before (16.9.0) and after (16.10.0).

Setup for every capture:

- Claude Code 2.1.314 in tmux, 200 columns, 24, 30 or 40 rows, model Fable 5.1 for the numbered runs. 120 frames at
  4 s, a fresh demo copy per run, the same prompt each time.
- Before is Atlas 16.9.0. After is Atlas 16.10.0 installed from a copy of the uncommitted working tree (see the two
  install files). No doctor fix, unless a file says otherwise.
- A frame counts as a violation when Claude Code's own agent list shows N >= 1 agents (`  ◯ name`) and Atlas does not
  show a `Subagents · N running` header with N agent rows (or `... N more` rows).
- omp frames come from a fake model with the extension from `plugins/atlas/omp`.
- The 24-row live run (`cc-24rows-*`) is a separate fresh install of the 16.10.0 tree in Claude Code 2.1.314, tmux
  200x24.

| File | What it shows |
| --- | --- |
| `cc-install-16.9.0.txt` / `cc-install-16.10.0.txt` | the two installs the before and after runs used |
| `cc-frame-analysis.txt` | violation counts per run (b24, a24, f24, b30, a30, n3, a40) and the frame ids; output of `analyze.py` |
| `analyze.py` | the violation rule as code |
| `cc-before-40-n3-044.txt` | 200x40, 16.9.0: Claude Code lists 2 agents, Atlas shows `Subagents · 2 running` with 1 row |
| `cc-before-30-017.txt` / `cc-before-30-042.txt` | 200x30, 16.9.0: two agents running, no Subagents block, only the band `2 working` |
| `cc-after-40-018.txt` | 200x40, 16.10.0: TODO, `Subagents · 3 running` with all 3 rows, band |
| `cc-after-tight-020.txt` | 200x24, 16.10.0 (no status line row): Claude Code lists the agent, the area above the prompt is empty |
| `cc-24rows-011.txt` | 200x24 live run, early frame, before any agent is running |
| `cc-24rows-013.txt` | 200x24, explorer wave: status line row `agents 1 running: explorer`, no Subagents block |
| `cc-24rows-016.txt` | 200x24, later frame of the explorer wave |
| `cc-24rows-028.txt` | 200x24, implementer wave: status line row `agents 1 running: implementer` |
| `cc-24rows-040.txt` | 200x24, verifier wave: Claude Code's own agent list row `◯ atlas:verifier  Rerun calc tests` is on screen |
| `cc-24rows-042.txt` | 200x24, same wave: `agents 2 running: verifier, verifier-a882` is there and the agent list row is below the screen edge |
| `cc-24rows-agents-running.json` | the file the mod writes for the status line, with `hudRowsShown` 0 (read after the run ended, so `running` is empty) |
| `omp-before-running.txt` / `omp-before-todo.txt` / `omp-before-done.txt` (and `.ansi`) | omp, 16.9.0 extension, board-only lead: Subagents but no TODO tree |
| `omp-after-running.txt` / `omp-after-todo.txt` / `omp-after-done.txt` (and `.ansi`) | omp, 16.10.0 tree: Subagents, then the TODO tree from the board; the tree stays when done |
| `omp-prior-*.txt` (and `.ansi`) | earlier omp captures, native `todo` path: one TODO tree, no duplicate |
| `omp-rig3-unpatched-after-*.txt` (and `.ansi`) | the original rig re-run unmodified: board root differs from omp's cwd, so Subagents show and no tree |
| `doctor-before-fix.txt` | 16.10.0 doctor: `WARN  display-todo-tools`, the rest PASS |
| `doctor-fix.txt` | `--fix` sets `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` and `CLAUDE_CODE_ENABLE_TASKS=0`; also the memory migration crash that 16.10.0 fixes |
| `doctor-recheck.txt` | all `display-*` checks PASS after the fix |

What the captures show:

- 200x40: all agents are listed. 2 violating frames in 120 against 11 before, both one-poll lag.
- 200x30: 3 violating frames against 8 before.
- 200x24: the Atlas HUD gets no rows above the prompt. No frame has a `Subagents` block. The status line row
  `agents N running: ...` appeared in every wave: explorers (frames 013-019), implementer (028-033), verifiers
  (041-045). `agents-running.json` is written from the mod render with `hudRowsShown` 0.
- Doctor `--fix` no longer crashes on memory migration. Before: `FIX: memory migration failed:
  migrate_global_to_projects() missing 2 required positional arguments: 'home' and 'db_path'`. After:
  `FIX: memory migration: {'moves': {}, 'stamps': [], 'left': [], 'applied': True}`. The fix is in
  `plugins/atlas/scripts/doctor_layout.py` (`fix_project_memory`), covered by
  `DoctorTest.test_fix_passes_home_and_db_path_to_real_migration`.

Left as they are, with the reason:

- At 24 rows the extra status line row pushes Claude Code's own agent list (`◯ atlas:verifier  Rerun calc tests`)
  below the screen edge (compare frame 040 with 042). Claude Code draws that list itself. A mod cannot place a row
  after it.
- The raw tmux frames (hundreds of `cc-*-NNN.txt` and `.ansi` files, the `.ansi` twins of the Claude Code frames) are
  not kept. The frames above are the ones the analysis cites.
- Not kept: `omp-rig-fake_model-patched.py` and `omp-rig-start-omp-patched.sh` (the omp rig with one board root),
  `doctor-cfg8-settings-after-fix.json` and `doctor-recheck-nonpass.txt`.
- Doctor `--fix` writes the display env to `$CLAUDE_CODE_CONFIG_DIR`-style `settings.json` when `CLAUDE_CONFIG_DIR` is
  set, not to `~/.claude`. Seen in the rig, not changed in 16.10.0.
