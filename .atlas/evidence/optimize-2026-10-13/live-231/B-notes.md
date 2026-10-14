# live-231 B: orchestration-flow fixes (impl-polishB)

Session: tmux `atlv8-b` 160x45, `claude --plugin-dir plugins/atlas` in worktree agent-a2348084e76c3ab6d (lead session a5f76967, lead-a5f769, run 2755). Killed at the end; teams t7c341e and tef3d26 reaped by the lead. Scrollbacks: `B-scrollback-turn1.txt`, `B-scrollback.txt`.

## Turn 1 (fixes 1-4 committed, before the resolver and lean-ctx follow-ups)

SessionStart context, quoted verbatim by the lead:

```
Team flow (absolute paths, use verbatim): python3 "/Users/jerry/MEGA/Projects/Agentic/tech-tools/.claude/worktrees/agent-a2348084e76c3ab6d/plugins/atlas/scripts/atlas_resolve.py" <class> <effort> --paths a,b ; python3 ".../plugins/atlas/scripts/atlas_mux.py" spawn-team --class C --effort E --paths a,b --task "..." ; python3 ".../atlas_mux.py" wait --team T ; python3 ".../atlas_mux.py" reap --team T
```

6 counted `echo N > /tmp/...` calls, then:

- `atlas_resolve.py audit medium --paths /etc` -> `DENY - 6 inline ops since your last dispatch` (new gap, fixed below)
- `atlas_mux.py spawn-team ...` at the same count -> NOT denied: `{"ok": true, "team_id": "t7c341e", ..., "wave_logged": true, "run_id": 2755, "channel": "tech-tools@main/lead-a5f769", ...}`
- wait: `{"ok": true, "team_id": "t7c341e", ... all exit 0 "STATUS: DONE" ..., "notes_worker_to_worker": 6, "elapsed_s": 0.0}`
- reap: `{"ok": true, "team_id": "t7c341e", "record": "live", "already_reaped": false, ..., "killed": true, "session_left": false, "channels_reaped": 1, "prompts_removed": 3, "archived": ".../.atlas/.run/teams/archive/t7c341e.json"}`
- Stop: `Ran 10 stop hooks` -> only the self-improvement feedback, no Definition-of-done block, no (p). Direct check: `_colony_workers_dispatched=3`, `_colony_channel_used=True` while the lead-a5f769 channel is gone from the registry (reaped).
- dispatches for t7c341e: `atlas:completeness-critic sonnet x1`, `atlas:explorer sonnet x2` (3 rows, model set).

Found in turn 1: events showed spawn-team/wait/reap still logged as inline `Bash` on PostToolUse. Cause: lean-ctx's PreToolUse rewrites Bash to `/opt/homebrew/bin/lean-ctx -c '<cmd>'` (transcript `updatedInput`), so PostToolUse saw the wrapped command. Fixed: the classifier unwraps `lean-ctx -c`; `atlas_resolve.py` is non-counting too.

## Turn 2 (all fixes live)

- `echo 2 > ...` -> DENY (counter carried from turn 1); `atlas_resolve.py audit medium --paths /etc` under that active deny -> ran, JSON printed.
- spawn-team `tef3d26` ok, wait `notes_worker_to_worker: 6, elapsed_s: 13.3`, reap `channels_reaped: 1, archived .../tef3d26.json`.
- events after turn 1 (run 2755): `atlas:explorer 0, atlas:explorer 0, atlas:completeness-critic 0, atlas_mux:spawn-team 0`, then the 6 Bash echo/cat rows. No resolve/wait/reap rows.
- dispatches for tef3d26: `atlas:completeness-critic sonnet x1`, `atlas:explorer sonnet x2`.
- Stop: no stop-hook block or (p) in the scrollback.

## Not changed

- ctx_shell (lean-ctx MCP) is not matched by the tripwire hooks (matcher is `...|Bash|Agent|Task`), so it was neither a deny nor a fix target.
- The lead noted the inline-op counter carries across user turns; out of scope here.
