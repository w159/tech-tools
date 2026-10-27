---
name: atlas-tui
description: "Opens the Atlas Command Center, a live terminal UI over the colony's tmux workers (topology, seats, feed, system). Use when watching or attaching to running colony workers."
when_to_use: "atlas tui, command center, colony terminal, watch workers, attach to worker pane"
allowed-tools: Bash
disable-model-invocation: true
---

# `atlas-tui`

Opens the **Atlas Colony workspace**: a curses TUI over the real colony (omp / claude /
codex workers in `atlas-<run>` tmux sessions). It lands on the colony view; inspired by
OpenRig's team workspace. Regions:

- SESSIONS (left): colonies and their seats with state (`working`, `idle`, `blocked`, `held`).
- CHANNEL: the colony channel feed; a NEEDS line lists blocked seats.
- PEEK: the selected seat's live pane (`t` attach, `v` view).
- STEER: the input line plus `[ msg all ] [ @all ] [ @lead ]`.

In-process colonies: lead channels in `.atlas/.run/channels.json` with no `lead_pid` and activity within `ATLAS_COLONY_LIVE_WINDOW` seconds (default 1800) are listed with transport `in-proc` (Claude Code subagents, no pane). Seat state comes from the latest board note (done/handback finished, blocked, note under 120 s working, else idle). SESSIONS shows at most 30 seats per colony plus a `+N more` row. PEEK reads `no pane (in-process subagent)` and `t` does nothing for them; steer and hold work (board operations).

Layout is side by side at 100+ columns and stacked below that; minimum size is 60x18
(CHANNEL keeps 4+ rows, PEEK shrinks first).

## Keys

Colony workspace:
- 1/2/3 focus SESSIONS/CHANNEL/STEER
- Tab cycle the three regions
- Up/Down/PgUp/PgDn move the SESSIONS row, scroll CHANNEL
- Enter open the selected SESSIONS row
- Home/End jump CHANNEL to the oldest/newest row
- i or m type a message to the selected seat (or the lead)
- b type a broadcast (@all)
- l type a message to the lead (@lead)
- h hold or release the selected seat
- f filter CHANNEL to the selected seat (again clears)
- v open the selected seat's view
- Left/Right unused in the workspace

STEER typing:
- Enter send (an @seat, @all or @lead prefix retargets)
- Esc leave STEER and drop the text
- Backspace erase one character

Everywhere:
- W return to the colony workspace
- t attach the selected seat's pane
- x stop the selected seat (y/n confirm)
- r re-read the snapshot
- a toggle all projects
- q quit
- ? this help
- : command bar
- / filter the current view
- Esc go back one level

Other sections (explorer):
- Up/Down/PgUp/PgDn move in the focused pane
- Left/Right switch pane focus
- Enter open the row
- Tab next right-pane tab
- m message the selected seat
- v open the selected seat's view

Mouse: a click on a row or a bracketed button (`[ msg ]`, `[ view ]`, `[ term ]`,
`[ stop ]`, `[ hold ]`, `[ release ]`, `[ @all ]`, `[ @lead ]`, `[ msg all ]`,
`[ refresh ]`, `[ ? help ]`, `[ q quit ]`) fires it; the wheel scrolls CHANNEL and moves
the SESSIONS selection.

Steering: a message is a board note (kind `steer`, owner `tui`). The lead is not
interrupted: STEER shows "lead reads the board at its next turn". Hold is soft: a held
seat refuses sends from STEER, its work continues, `h` releases it.

## Run

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_tui.py" --launch
```

omp rewrites `${CLAUDE_PLUGIN_ROOT}` to the live install at call time. If it is unset (Codex),
substitute the plugin root: two directories above the skill directory your harness gave you,
never a path relative to the project cwd. Under omp, the user can type `/atlas-tui` to
open the TUI inside the omp session. Under Claude Code or Codex, `--launch` opens it in a new
terminal window.

`--launch` opens the TUI in a new tmux window when `$TMUX` is set; otherwise it restarts
the detached tmux session `atlas-tui` in place with the current script and project
(respawn-window -k, creating the window if it is missing; a session left by an older
install is never reused), and tries to open a visible terminal window attached to it,
falling back to printing `tmux attach -t atlas-tui`. It then prints a
one-frame snapshot (`--once`) so the chat shows the current colony state.

Report to the user: how to reach the TUI (new window or the attach command) and the
snapshot, trimmed to the seats that need attention (`blocked`/`dead`) if any.
Other forms: `--once --view topology|specs|projects|terminals|feed|system`, `--seat <name>`,
`--colony <id>`, `--all` (every project).

Frames: `--once --fixture <snap.json> --width 100 --height 30` prints one frame without a
terminal. Goldens live in `scripts/fixtures/golden/`; after an intentional TUI change run
`ATLAS_GOLDEN_UPDATE=1 python3 -m unittest test_colony_golden` in `plugins/atlas/scripts`
and review the diff.
