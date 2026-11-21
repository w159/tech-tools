# live-capture-fixes-17-34-1: four defects found by real Claude Code sessions for README screenshots

- id: live-capture-fixes-17-34-1
- status: verified (all four re-run live)
- evidence: `.atlas/evidence/2026-11-20_live-capture-phantom-rows/` (raw transcripts and full-screen frames, including the tmux colour captures named below, were not committed: they carry the owner's status line and local paths)

## Defects, observation, fix

1. Two rows for one in-process subagent. Seen in a live run: the host row (named from the Agent call) and the channel member (named by the dispatch hook) both showed. Fix: join by agent id, then name (`plugins/atlas/mod/data/herdr.ts` mergeSquad, `mod/data/live.ts` queuedMembers, `mod/data/channels.ts`, `mod/host/agents.ts`, `mod/contract.ts`). Re-run live: one row. 
2. A finished subagent stayed in its channel when its final message failed the report format check (the background agent never fires a second stop). Fix: `finish_member(p, settle_board=False)` before the block (`plugins/atlas/hooks/worker_report_gate_core.py:451`); the board item stays open. Re-run live: member stamped finished. Unit test: `test_blocked_stop_still_stamps_member_finished`.
3. Panel background navy (xterm 17) inside tmux: the host downgrades to 256 colours there and its hex-to-index formula maps `#181825` to 17. Fix: `colorMode()` returns `256` when `TMUX` is set (`plugins/atlas/mod/design/atlas-ui.ts:81`). That change alone did nothing live, because `lookOf()` in `plugins/atlas/mod/design/look.ts` did not read `TMUX`; the first unit test passed while a live tmux session still painted 17 (`tmux-256-after-fix.ansi`). After `look.ts` reads `TMUX`, a live tmux session paints backgrounds 234 and 235 and no 17 (`tmux-256-after-fix2.ansi`). Test: `mod/design/look-tmux.test.ts`.
4. A refused Agent call (the `ROUTE - this work goes to a tmux team` deny) left a provisional row that later read `done`. Fix: `isHookRefusal` drops the row (`plugins/atlas/mod/input/routing.ts:33`). Re-run live: `img/showcase/live-route-deny.png` shows no agent row.
