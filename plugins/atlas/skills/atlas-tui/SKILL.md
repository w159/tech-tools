---
name: atlas-tui
description: "Opens the Atlas Command Center, a live terminal UI over the colony's tmux workers (topology, seats, feed, system). Use to watch or attach to running colony workers."
when_to_use: "atlas tui, command center, colony terminal, watch workers, attach to worker pane"
allowed-tools: Bash
disable-model-invocation: true
---

# `atlas-tui`

Opens the **Atlas Command Center**: a curses TUI over the real colony (omp / claude / codex
workers in `atlas-<run>` tmux sessions). Left explorer (topology, specs, projects,
terminals, feed, system); right pane shows a seat table, graph, health, or the live tmux
pane of one seat. One click acts: rows and the bracketed buttons (`[ msg ]`, `[ view ]`,
`[ term ]`, `[ stop ]`, `[ msg all ]`, `[ refresh ]`, `[ ? help ]`, `[ q quit ]`) fire on a
single click, and the mouse wheel scrolls. Keys: arrows, Enter, Esc, `?` help, `:` command,
`/` filter, `m` msg a seat, `v` view it, `t` attach the seat's pane (detach with `C-b d` to
return), `x` stop a pane seat (y/n confirm), `q` quit.

## Run

```bash
python3 "<skill base directory>/../../scripts/atlas_tui.py" --launch
```

Replace `<skill base directory>` with the absolute skill directory your harness gave you
(omp, Claude Code and Codex all provide it). Do not run the relative path from the project
cwd. Under omp, the user can type `/atlas-tui` to open the TUI inside the omp session.
Under Claude Code or Codex, `--launch` opens it in a new terminal window.

`--launch` opens the TUI in a new tmux window when `$TMUX` is set; otherwise it reuses (or
creates) the detached tmux session `atlas-tui` and tries to open a visible terminal window
attached to it, falling back to printing `tmux attach -t atlas-tui`. It then prints a
one-frame snapshot (`--once`) so the chat shows the current colony state.

Report to the user: how to reach the TUI (new window or the attach command) and the
snapshot, trimmed to the seats that need attention (`blocked`/`dead`) if any.
Other forms: `--once --view topology|specs|projects|terminals|feed|system`, `--seat <name>`,
`--colony <id>`, `--all` (every project).
