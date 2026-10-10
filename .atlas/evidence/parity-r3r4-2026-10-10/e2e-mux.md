# E2E surface evidence — atlas_mux live run (2026-10-10, lead)

## S1: spawn → status → kill through the real atlas_mux CLI
- `ATLAS_MUX=tmux python3 plugins/atlas/scripts/atlas_mux.py spawn --run parity-e2e --name e2e-s1 --harness claude --agent runner --effort low --prompt-file /tmp/e2e-s1-prompt.txt`
  → `{"ok": true, "session": "atlas-parity-e2e", "name": "e2e-s1", "harness": "claude", "agent": "runner", "model": "haiku", "level": "low", "agent_id": "e8281551", "transport": "claude-bg", "board": ".atlas/.run/board/e2e-s1.jsonl"}`
  (transport field = claude-bg; board path created.)
- `atlas_mux.py status --run parity-e2e` → `{"ok":true,...,"transport":"claude-bg","workers":[{"name":"e2e-s1","pid":"e8281551","state":"blocked",...}]}` — state polling works live (worker hit a plugin permission prompt: claude-mem allow dialog; blocked-state surfaced, tail captured).
- Cleanup: `claude stop e8281551` → `stopped e8281551`; `atlas_mux.py kill --run parity-e2e` → `{"ok": true, "session_name": "atlas-parity-e2e", "transport": "claude-bg", "killed": false}` (row already stopped by the direct stop — kill reports honestly rather than claiming a kill).
- Gate: spawn without `ATLAS_MUX=tmux` → `{"ok": false, "error": "mux mode is opt-in: set ATLAS_MUX=tmux"}` — opt-in gate works.
- Args contract: spawn requires `--run/--name/--harness/--agent/--prompt-file`; `agent` must match `[A-Za-z0-9_-]` (atlas: prefix rejected with a clear usage error).

## S5/TaskCreate availability probe (the honesty gap)
- Live worker spawn with env: `ATLAS_TASKS_MIRROR=1 ATLAS_LEAD_AGENT=lead-e2e ... spawn --run parity-e2e2 --name e2e-s5 ...` → ok (agent_id 76ac77cd); `claude logs e2e-s5 | grep -icE "taskcreate|task_?list"` → 1 occurrence seen in logs.
- Direct headless probe: `claude -p --agent runner "which task-list tools (TaskCreate/TaskUpdate/TaskList) are available?"` → **NONE**.
- Conclusion recorded honestly: on plain `claude --bg` workers the native task-list tools are NOT in the toolset (NONE). `ATLAS_TASKS_MIRROR` therefore applies only where the toolset includes them (agent-teams / teammate sessions). The env-gated paragraph is inert in this environment — exactly the behavior the env gate promises (unset=byte-identical; set=safe no-op when tools absent).
- Cleanup: `claude stop 76ac77cd` → stopped; `atlas_mux.py kill --run parity-e2e2` → ok.

## Notes
- The worker's blocked state during e2e-s1 was a FIRST-RUN permission dialog for the claude-mem plugin (atlas hooks active in worker sessions on this machine). Not an atlas_mux defect: status surfaced it; kill cleaned it. Future headless runs on a broken-in machine won't hit it.
- S2 native wake / S6 endpoint / R3/R4 messaging+agents-json evidence: see probes.md in this directory (headless -p SendMessage success:true; /api/v2/herd/agents bg-row probe; agents --json row shape).