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
pane of one seat. Keys: arrows, Enter, Esc, `?` help, `:` command, `/` filter, `t` attach
the seat's pane (detach with `C-b d` to return), `q` quit.

## Run

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_tui.py" --launch
```

`--launch` opens the TUI in a new tmux window when `$TMUX` is set; otherwise it starts a
detached tmux session `atlas-tui` and prints `tmux attach -t atlas-tui`. It then prints a
one-frame snapshot (`--once`) so the chat shows the current colony state.

Report to the user: how to reach the TUI (new window or the attach command) and the
snapshot, trimmed to the seats that need attention (`blocked`/`dead`) if any.
Other forms: `--once --view topology|specs|projects|terminals|feed|system`, `--seat <name>`,
`--colony <id>`, `--all` (every project).
