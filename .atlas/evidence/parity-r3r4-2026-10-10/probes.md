# Parity live-probe evidence — 2026-10-10 (lead run)

## R3: unattended cross-session SendMessage (sender side verified)
Command: `claude -p "Use the SendMessage tool to message session name 'parity-probe' with exactly: PROBE-R3-PING..."` (background session created first with `claude --bg --name parity-probe "Say 'ready' and nothing else."` → `backgrounded · 78019f94 · parity-probe`)

Raw tool result (verbatim):
```json
{"success":true,"message":"“probe ping to parity-probe” → parity-probe (another Claude session on this machine; in that session's inbox, not yet read by its Claude — a [Cross-session delivery notice] follows if that session holds it (usually a different permission mode) or refuses it)","msg_id":"8485b6d7-36c1-4f19-b7bf-b1eb106a9240"}
```
Note: result schema is `{success, message, msg_id}` — no `isDelivered` on the TOOL (that pair belongs to the mods API `$.session.send`). Receiver-side acceptance (hold/refuse under different permission modes) NOT verified; S2 spawns workers with `--settings {"crossSessionInbound":"accept"}` to remove the dependency. `claude stop 78019f94` → `stopped 78019f94` (probe cleaned up).

## R4: `claude agents --json` row shape (live, 2026-10-10)
```json
[{"pid":74742,"id":"78019f94","cwd":"/Users/jerry/MEGA/Projects/Agentic/tech-tools","kind":"background","startedAt":1791608473423,"sessionId":"78019f94-7d48-4f4c-a6c5-3dda7477d55c","name":"parity-probe","status":"idle","state":"done"},
 {"pid":76125,"cwd":"...","kind":"interactive","startedAt":...,"sessionId":"...","name":"35584-cc","status":"idle"}]
```
Field list: pid, id, cwd, kind, startedAt, sessionId, name, status, state (done rows show state; waiting rows add waitingFor per docs).

## S1 probe facts (atlas_mux claude-bg transport, S1-BgDispatch)
- `claude --bg --name mux-s1-probe --agent atlas:explorer --model haiku --effort low --permission-mode acceptEdits "Say ok"` → `backgrounded · bffcaa86 · mux-s1-probe` (all flags accepted).
- `claude stop` succeeds on busy AND done rows; 6 probe agents stopped, 0 rows left.

## S6 probe fact (dash endpoint)
- bg row surfaced in `/api/v2/herd/agents` as `{pane_id:"bg:001a03a7", source:"claude-bg", bg_state:"done", dead:1}`, counts.done=1; probe stopped after.