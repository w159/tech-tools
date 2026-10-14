# live-230 verdicts: installed atlas 12.3.0, Claude Code + omp, 2026-10-13

Sessions: atlv7-cc (CC lead, lead-e9d647), atlv7-cc2 (fresh CC lead for the team, lead-66906b), atlv7-omp (omp lead, lead-01a138). All killed at the end; team sessions atlas-t9678cf and atlas-t330623 were reaped by the leads.

| Capture | Verdict | What the frame shows |
|---|---|---|
| cc-header.png | PASS | `ATLAS` + `DONE` pill header above a completed reply; idle band and phase strip all checked below it. |
| cc-band-running.png | PASS | Mission-control band with `wave 1 · audit/low`, timer, `2 live`, cost, two RUN rows (explorer-banda, explorer-bandb) with tool, detail, progress bar and sparkline, plus a channel ticker and a gate pill row. |
| cc-band-idle.png | PASS (with defect) | After both workers ended the band reads `blocked · gates ✖5` on a red bar with `last wave: 2 workers · 49s · ✔ ok`. A red "blocked" bar after a clean read-only wave is alarming and contradicts the green `ok`. |
| cc-card.png | PASS | Live worker card for explorer-cardc (`explorer · sonnet·low`, goal, now `ctx_read · 8s · 3 tools`), updating in place; band row for the same worker. |
| cc-card-done.png | PASS | Same card flipped in place to `✔ explorer-cardc`, `done STATUS: DONE · 35s`, plus the trailing done line and the worker report bubble `#atlas explorer-cardc › lead`. |
| cc-scope-deny.png | PASS | Red `✗ explorer` card with `fail Error: ... DENY - this dispatch to atlas:explorer has no SCOPE: <class>/<effort> line` and the full deny text quoted by the lead under a `BLOCKED` pill. |
| cc-team.png (panes 1-3) | PASS | Composed atlas-t9678cf window: three styled panes (explorer-8147, completeness-critic-8b41, explorer-ccd5) with gradient header, goal, channel + peers line, tool chips (Bash/peer/ToolSearch/ctx_read/Read) and a sticky `working` footer. Peer-sync notes to both siblings are visible. |
| cc-team-lead.png | FAIL | Lead band at the same moment reads `ATLAS · idle`, phase strip on RESEARCH. The band does not show a tmux team that is running 3 workers. |
| cc-team-gate-deny.png | FAIL (gate) | First attempt in atlv7-cc: the inline-op gate denied `atlas_mux.py spawn-team` itself ("6 inline ops since your last dispatch"), so the documented default team flow cannot start from a lead that has done earlier inline work. |
| omp-widget.png | PASS (with defects) | omp widget mid-run: `mission control · audit/medium`, `3 live`, `✖ 1 gates`, RUN/THINK rows with bars and sparklines. Phase strip stuck on RESEARCH; tool column says `write` while detail shows `mcp__claude_mem_mcp_search_sear…`; `completeness-cri…` truncated. |
| omp-widget-idle.png | FAIL | After reap the widget is gone entirely. No idle band or last-wave summary (CC shows one). |

## Team JSON (verbatim)

CC (atlv7-cc2): see `cc-team-lead-reply.txt`. spawn-team `{"ok": true, "team_id": "t9678cf", "session": "atlas-t9678cf", "transport": "tmux", ..., "run_id": 2738, "max_parallel": 3, members explorer-8147 (sonnet/low), explorer-ccd5 (sonnet/low), completeness-critic-8b41 (sonnet/medium)}`; wait `{"ok": true, ..., all exit 0, "last_status": "STATUS: DONE", "notes_worker_to_worker": 6, "elapsed_s": 25.7}`; reap `{"ok": true, ..., "killed": true, "session_left": false, "channels_reaped": 1, "prompts_removed": 3, ...}`.

omp (atlv7-omp): see `omp-lead-scrollback.txt`. spawn run_id 2743, members `"harness": "omp"`, `"level": "off"`; wait all exit 0, `notes_worker_to_worker: 6`, `elapsed_s: 69.6`; reap `"channels_reaped": 0`.

## Defects seen

1. Inline-op gate denies `atlas_mux.py spawn-team` (cc-team-gate-deny.png). The sanctioned team launcher counts as "inline work".
2. The cc2 lead started the team through lean-ctx `ctx_shell`, which the Bash inline-op gate does not see. It worked, but that is a gate bypass.
3. `CLAUDE_PLUGIN_ROOT` is unset in the lead's Bash, so both leads ran `plugins/atlas/scripts/*` from the repo source, not the installed 12.3.0 scripts. The team run is only partly a test of the install.
4. The CC band does not reflect a running tmux team (cc-team-lead.png: idle while 3 workers run). omp's widget does.
5. Stop-hook completion gate (p) false positive in cc2: it claimed "no worker board note" while `.atlas/.run/board/*.jsonl` held 12 notes (6 peer-to-peer, 6 to lead).
6. omp reap leaves the team channel open (`channels_reaped: 0`, lead-01a138 still in channels.json); CC reap closes it (`1`).
7. omp spawn reports `"level": "off"` for every member; CC reports low/medium.
8. On omp, the claude-mem recall gate denied a worker's first board note (completeness-critic-f08e).
9. Denied Agent dispatches in CC render as "2 atlas:explorer agents finished ... 0 tool uses ... Done" before the lead explains they were denied (top of cc-band-running.png). Misleading.
10. Denied card (cc-scope-deny.png) shows `sonnet·low` for a dispatch that never resolved a scope, and its `goal` row swallows the whole single-line prompt including TOOLS/DELIVERABLE.
11. Band `last wave: 3 workers` after wave 2 had one worker (cumulative count labelled as last wave).
12. Phase strip goes all grey (no active phase) after the BLOCKED reply (cc-scope-deny.png).
13. Team pane tool count `2 tools` and `21 tok`/`33 tok` look wrong for workers that ran 4+ chips; bottom pane header bar stops short of the 200-col pane edge; 3-pane layout is two half panes over one full-width pane.
14. dispatches table: Agent-tool waves log wave_id NULL; team rows store model NULL; wave_id (INTEGER column) holds text.
15. Repo `CHANGELOG.md` does not exist at the repo root (only `plugins/atlas/CHANGELOG.md`); cardC's read failed on it.
16. Renderer artifact, not a product bug: an OSC 8 hyperlink fragment (`]8;id=...`) shows at the right of the statusline row in every CC PNG.
17. lean-ctx refuses `/etc` paths ("path escapes project root"), so bandA/bandB fell back to `wc -l`.
