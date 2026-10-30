# Evidence: Atlas 16.9.0 display parity audit (Claude Code vs omp)

Round 2 of the display parity work. 16.8.0 was checked in a rig Atlas already had set up; this round checks a
user's first run instead.

Setup for every capture:

- Claude Code 2.1.314 in tmux at 200x50, default model (Sonnet 5.5 or Fable 5.1, whichever the account picked).
- Atlas installed the way a user does it: `claude plugin marketplace add <clone>` then
  `claude plugin install atlas@tech-tools`, into an empty `CLAUDE_CONFIG_DIR`.
- A small git project (`src/calc.py`, `README.md`, `docs/CHANGELOG.md`).
- The same scenario as the omp reference screenshot: an 11-item plan in `[research]` x2, `[implement]` x4,
  `[verify]` x4, `[docs]` x1, with 2 items done and 1 in progress. After that, two background subagents run at once:
  `verifier-eval` (atlas:verifier) and `docs-curator-gate` (atlas:docs-auditor).

| File | What it shows |
| --- | --- |
| `cc-before-fresh-running.txt` / `.ansi` | 16.8.0, fresh install, no doctor fix: TODO tree has `IV. Other · 1/3` (the `[docs]` item plus 2 dispatch rows), board 3/13 vs tasks 2/10, board keeps `[research]`, model `sonnet`, preview `Bash: python3 "/tmp/...` cut at 40 cells, no blank rows, title carries `audit/low` and `ctx 6%`, tasks row carries `✔ header` and key hints, channel `#demo@master` / `→ lead` |
| `cc-before-fresh-idle.txt` / `.ansi` | the same session when idle |
| `cc-before-tasktools-squeeze.txt` / `.ansi` | 16.8.0 after `atlas_doctor.py --fix` (sets only `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`): the lead uses TaskCreate/TaskUpdate, Claude Code draws its own 7-row checklist above the prompt, the Atlas TODO tree is cut to 3 rows and Subagents is gone |
| `cc-after-running.txt` / `.ansi` | 16.9.0, fresh install, after `--fix`: TODO `IV. Docs · 0/1`, `Subagents · 2 running` with `anthropic/sonnet` / `anthropic/haiku`, `└ ✓ read: Read README.md` previews, waiting line, band board 2/11 and tasks 2/11, prefix-free board row, blank rows in the band, `#lead-<sid6>` channel; no Claude Code checklist in any frame |
| `cc-after-idle.txt` / `.ansi` | 16.9.0 when idle |
| `doctor-16.8.0-fresh.txt` | 16.8.0 doctor on the fresh install: only `display-todo-tools` and `display-statusline` warn; none of the visual gaps or the squeeze cause is flagged |
| `doctor-16.9.0-fresh-then-fix.txt` | 16.9.0 doctor: `display-todo-tools` warns that both `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` and `CLAUDE_CODE_ENABLE_TASKS=0` are missing, `--fix` writes both, and the re-check passes |

Why the squeeze happens: Claude Code's TaskCreate and TaskUpdate both set the checklist view to expanded on every
call, without checking any setting (binary strings `set_expanded_view` / `expandedView:"tasks"`). Ctrl+T hides it
only until the next update. The legacy TodoWrite tool (`CLAUDE_CODE_ENABLE_TASKS=0`) does not draw the checklist,
and the Atlas board mirror already reads it.

Left as they are, with the reason:

- The docked Atlas pane opens on its own when the terminal is wide enough. The design docs ask for this
  (`docs/plans/2026-10-13_atlas-command-center-redesign.md`, `docs/plans/2026-10-12_atlas-mod-native-sidebar.md`),
  and `register-open.test.ts` covers it.
- The waiting line uses `⏳`. In omp it is omp's own animated loader, with a moving highlight.
- A subagent pinned to another model family shows only its alias (`anthropic/haiku`). Claude Code gives the mod no
  full model id for it, so no version number is made up.
- Blank rows between the HUD sections are the first thing dropped when Claude Code gives the area above the prompt
  fewer rows than omp's layout needs.
- Claude Code's own agent list below the status line (`● main ◯ verifier-eval ...`) is drawn by Claude Code itself.
  A mod cannot hook it.
