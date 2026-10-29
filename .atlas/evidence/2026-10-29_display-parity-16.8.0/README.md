# Evidence: Atlas 16.8.0 display parity (Claude Code vs omp)

Same scenario on both harnesses, in tmux 200x55, project `demo` (git repo with `docs/`, `src/calc.py`):
a 5-item plan in phases research (1 done, 1 in progress), implement, verify, docs, then two background
subagents `explorer-calc` (explorer) and `docs-auditor-calc` (docs-auditor).

- Claude Code 2.1.312: `claude --plugin-dir plugins/atlas` with an isolated `CLAUDE_CONFIG_DIR`, real model.
- omp 18.14.0: `--extension plugins/atlas/omp`, isolated HOME and agent dir, a local scripted fake model
  (no model credentials in the container). The rig lives outside the repo; it replays the same plan and dispatch.

| File | What it shows |
| --- | --- |
| `omp-before-running.txt` | omp while both subagents run: omp's TODO tree, `Subagents · 2 running`, waiting line, Atlas mission control band |
| `omp-after-running.txt` / `.ansi` | the same after this change: only spinner frames and ages differ (omp code unchanged) |
| `cc-before-running.txt` | Claude Code 16.7.0: mission control band only. No TODO tree, no Subagents block; band rows ran under the docked pane |
| `cc-after-running.txt` / `.ansi` | Claude Code 16.8.0: TODO tree, `Subagents · 1 running` with model, name, role and task, full-tier mission control band |
| `cc-after-tasklist.txt` | Claude Code 16.8.0 while Claude Code draws its own task list (AbovePrompt gets 6 rows): compact TODO and Subagents kept, band shrinks to its title |

Measured AbovePrompt budget in the live TUI (docked 56-column Atlas pane): `viewport.columns=143`,
`bodyColumns=138`; `maxRows` 18 idle, 14-15 with agents running, 10 while the lead works, 6 while Claude Code's
task list is drawn.

Doctor, fresh `CLAUDE_CONFIG_DIR`:

```
WARN  display-todo-tools   CLAUDE_CODE_ENABLE_TODO_TOOLS is not 1: ...
PASS  display-mod          ../mod/register.ts registered; ATLAS_MOD/ATLAS_HUD not off
PASS  display-todo-mirror  PostToolUse covers ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'Agent', 'Task', 'Bash']
WARN  display-statusline   statusLine unset in .../settings.json; `atlas_doctor.py --fix` sets it ...
PASS  display-harness      claude-code
--fix:
FIX: display: set env.CLAUDE_CODE_ENABLE_TODO_TOOLS="1" in .../settings.json
FIX: display: set statusLine to python3 ".../scripts/atlas_statusline.py" in .../settings.json
re-check: all five display- rows PASS
```
