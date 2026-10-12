# 2026-10-12: atlas mod keyboard focus + tripwire subagent misfire (repro, not fixed)

## Mod: Command Center takes no keyboard input
- Host: Claude Code 2.1.296, `tmux new-session -x 200 -y 55 "claude --plugin-dir plugins/atlas --debug-file /tmp/atlasmod-debug.log"`
- `/atlas-cc` -> debug: `ui.open atlas atlas (asked, 200 columns): placed`; pane draws 5 tabs.
- `C-x Tab` sent 3 times, then `3`: the prompt shows `❯ 3`; the pane stays on Colony. No focus change logged.
- Every band/pane is a `Client` surface module (plugins/atlas/mod/register.ts:536-568). ClientSurface.onKey is
  "reached while a click has given it the focus" (.claude-plugin/types/claude-code/index.d.ts:1600).
- Inferred, not proven: a native-vs-Client probe (.scratch/probe-mod) was blocked by the gate below.

## Gate: atlas:implementer and atlas:runner writes denied as "orchestrator"
- Both subagents' Write of .scratch/probe-mod/hooks/register.tsx returned
  `DENY - atlas orchestrators never edit target code inline` (dispatch_tripwire.py:1104).
- Subagent detection: dispatch_tripwire.py:168 `_in_subagent` checks only `/subagents/` in transcript_path.
  The 2.1.296 hook input documents `agent_id` as the subagent marker (index.d.ts:842).
  recall_gate.py:234 and completion_gate.py:2009 already check agent_id; worker_inbox.py:355 and
  delegation_prewarn.py:36 do not.
- Status: unverified hypothesis; no code changed.
