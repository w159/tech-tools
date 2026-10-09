# E2E2 verdict: atlas colony mux mode on source 10.4.3

**Overall: VERIFIED.** Checks A to F all PASS. Finding `colony-mux-e2e-10.4.3` (status `verified`) is recorded in `/Users/jerry/MEGA/Projects/Agentic/tech-tools/.atlas/.run/findings.json`.

## Run facts
- **Scratch repo:** `D=/Users/jerry/atlas-e2e-colony2`. It was created fresh: git init on `main`, README.md, an empty `calc/__init__.py`, and a CHANGELOG.md containing `# Changelog`. The repo is left in place.
- **Lead:** `claude -p --plugin-dir $SRC --settings '{"enabledPlugins":{"atlas@tech-tools":false}}' --model sonnet --permission-mode bypassPermissions --output-format stream-json --verbose "$(cat .lead-prompt.md)"`.
  - The run used `ATLAS_SCRIPTS=$SRC/scripts`.
  - The env was launched with `ATLAS_LEAD_NAME`, `ATLAS_CHANNEL`, `ATLAS_WORKER_NAME`, `CLAUDE_PLUGIN_ROOT` and `CLAUDECODE` unset. The parent shell had `CLAUDE_PLUGIN_ROOT` pointing at the omp 10.4.2 cache.
  - It ran from 15:19:29 to 15:23:58 EDT (4.5 min) and exited with rc=0.
  - Stream: `/tmp/atlas-verify/e2e2-lead.jsonl`. Transcript: `~/.claude/projects/-Users-jerry-atlas-e2e-colony2/9f59ed04-4b86-4a9f-aa48-45d89141b1d0.jsonl`.
- **Lead session_id:** `9f59ed04-4b86-4a9f-aa48-45d89141b1d0`, so **sid6 = `9f59ed`**.
- **Channel:** `atlas-e2e-colony2@main/lead-9f59ed`.
- **Worker sessions:** Alpha = `f635b4a1-52a6-471d-9731-15f77d8d16be`, Beta = `71f8e59b-22aa-40ce-8c07-312a082af2b2`. Both ran under `atlas:implementer`.
- **Worker argv:** taken from `.atlas/.run/logs/Alpha.log` line 1:
  `$ /bin/sh -c 'claude -p --plugin-dir /Users/jerry/MEGA/Projects/Agentic/tech-tools/plugins/atlas --settings '"'"'{"enabledPlugins":{"atlas@tech-tools":false}}'"'"' --agent atlas:implementer --model sonnet --effort low --permission-mode bypassPermissions "$(cat /Users/jerry/atlas-e2e-colony2/.briefs/Alpha.md)"'`
- **Aborted first launch:** I cancelled one earlier launch (session 22e0b721) a few seconds in, because the parent env leaked `CLAUDE_PLUGIN_ROOT` (omp 10.4.2). Before the real run I removed `D/.atlas` and `.serena` and emptied `.briefs/`. The same cleanup was done after the probe.

## Probe: only source atlas 10.4.3 loads (PASS)
Command:
`claude -p --plugin-dir $SRC --settings '{"enabledPlugins":{"atlas@tech-tools":false}}' --model haiku --output-format stream-json --verbose 'say ok'` → `/tmp/atlas-verify/e2e2-probe.jsonl`

Atlas entries in the init event's plugins list:
```
[{"name": "atlas", "path": "/Users/jerry/MEGA/Projects/Agentic/tech-tools/plugins/atlas", "source": "atlas@inline", "version": "10.4.3"}]
n_plugins 24
```
There was exactly one atlas plugin, loaded from source (`atlas@inline`) at 10.4.3. `atlas@tech-tools` from the cache was absent. The SessionStart hook reported `"systemMessage": "Atlas ready"`.

The lead's own init event shows the same single atlas entry (`/Users/jerry/MEGA/Projects/Agentic/tech-tools/plugins/atlas`, 10.4.3). Herdr was healthy: `python3 $SRC/scripts/atlas_herdr.py status` returned `"running": true, "healthy": true`.

## A. One lead channel holding both workers and the dispatch (PASS)
`cat D/.atlas/.run/channels.json` (abridged):
```
"atlas-e2e-colony2@main":              kind main, members [lead-9f59ed]
"atlas-e2e-colony2@main/lead-9f59ed":  kind lead, lead "lead-9f59ed", members:
   lead-9f59ed (lead)
   briefs          (subagent, parent lead-9f59ed)           <- Task dispatch atlas:implementer
   Alpha           (subagent, parent lead-9f59ed, pane_id wP:p5, pid 33786, exit_code 0)
   Beta            (subagent, parent lead-9f59ed, pane_id wP:p7, pid 33798, exit_code 0)
   docs-changelog  (subagent, parent lead-9f59ed)           <- Task dispatch atlas:docs-curator
```
- Only two channels exist, and neither is `atlas-e2e-colony2@main/lead`.
- The `briefs` dispatch and both mux workers share one channel.
- **Baseline (10.4.2, `~/atlas-e2e-colony`):** the Task dispatch `implementer-briefs` was in `@main/lead-16ed98`, but Alpha and Beta were split off into a separate `atlas-e2e-colony@main/lead` channel. A stray `lead` member also appeared in `@main`.

## B. Worker↔worker and worker→lead notes on the channel (PASS)
Command: `python3 $SRC/scripts/atlas_todo.py notes --root D --channel atlas-e2e-colony2@main/lead-9f59ed`. Raw output is in `/tmp/atlas-verify/e2e2-notes.json`.
```
1 lead-9f59ed -> all    'Team acknowledged: Alpha builds calc/ops.py and announces the API to Beta; ...'
2 Alpha -> Beta         'calc/ops.py: add(a, b), sub(a, b), mul(a, b), div(a, b); div raises ZeroDivisionError when b == 0'
3 Beta -> Alpha         'ack: tests/test_ops.py written, 5 passed'
4 Beta -> lead-9f59ed   kind=report 'STATUS: DONE\nSTEPS: 6/6\nFILES_CHANGED: tests/test_ops.py ...'
5 Alpha -> lead-9f59ed  kind=report 'STATUS: DONE\nSTEPS: 5/5\nFILES_CHANGED: calc/ops.py; calc/__init__.py ...'
```
Both reports are addressed to `lead-9f59ed`, not `lead`.

## C. Worker reports reach the lead's hook inbox (PASS, via PostToolUse additionalContext)
Stream-json does not surface PostToolUse hook output, so the evidence comes from the lead's session transcript.

Command: `grep -o "\[atlas\] [0-9]* message..." 9f59ed04-….jsonl`, then a JSON parse of the matching line 191.
```
191 attachment hook_additional_context PostToolUse:Bash 2026-10-08T19:23:23.239Z
["[atlas] 2 messages for you from the board (answer or act on them; they are delivered once):
- from Beta: STATUS: DONE\nSTEPS: 6/6\nFILES_CHANGED: tests/test_ops.py ...
- from Alpha: STATUS: DONE ..."]
```
Line 190 holds the matching `hook_success PostToolUse:Bash` stdout, `{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "[atlas] 2 messages ..."}}`.

The cursor also advanced past both report seqs (4 and 5):
```
$ cat D/.atlas/.run/inbox/lead-9f59ed.json
{"ts": 1791487298.471283, "seq": 5}
```
The inbox cursors for the other members are Alpha.json seq 3 and Beta.json seq 2.

## D. Todo board: no orphan or carried duplicates (PASS)
Command: `python3 $SRC/scripts/atlas_todo.py list --root D`
```
td131fdfd completed session 9f59ed04-… Alpha Alpha: calc/ops.py + note to Beta
t6c92a4f7 completed session 9f59ed04-… Beta  Beta: tests/test_ops.py + ack to Alpha
te108bfa8 completed session 9f59ed04-… None  Write briefs via atlas:implementer
tf8db28c1 completed session 9f59ed04-… None  Spawn Alpha and Beta via mux
tfd70cb61 completed session 9f59ed04-… None  Supervise channel until workers exit
tfeabc5bc completed session 9f59ed04-… None  verify
ta0f16790 completed session 9f59ed04-… None  docs
```
The raw `todos.json` also holds exactly these 7 items, none archived.

| Count | Result | Expected |
|---|---|---|
| Items with origin=carried | 0 | 0 |
| Items with session_id = Alpha (f635b4a1) or Beta (71f8e59b) | 0 | 0 |
| Items not completed | 0 | 0 |

All 7 items carry the lead's session_id.

**Baseline (10.4.2):** 12 items. 5 had `origin=carried` and were left `pending` under session `f7715a77-…`: tb595b842, t44c30b8f, t22459d51, td59911c0 and t8798dae5. Each was an orphan copy of the lead's live list.

## E. `atlas_mux status` lists no herdr Sidebar panes as workers (PASS)
- **Live, while the workers ran:** `/tmp/atlas-verify/e2e2-status-watch.log` holds 14 snapshots, captured every 20 s with `ATLAS_MUX=tmux python3 $SRC/scripts/atlas_mux.py status --run e2e --root D`. `grep -c Sidebar` returned **0**. A sample snapshot:
  `"transport": "herdr", "workers": [{"name": "Alpha", "dead": 0, "pid": "wP:p5"}, {"name": "Beta", "dead": 0, "pid": "wP:p7"}]`
- **After the workers exited (10.4.3):** `"workers": []`.
- **Control, the old 10.4.2 script against the same herdr state:** `~/.claude/plugins/cache/tech-tools/atlas/10.4.2/scripts/atlas_mux.py status --run e2e --root D` returned
  `"workers": [{"name": "Sidebar", "dead": 0, "pid": "wP:p2"}, {"name": "Sidebar", ..."wP:p4"}, {"name": "Sidebar", ..."wP:p6"}, {"name": "Sidebar", ..."wP:p8"}]`.
  So the fix filters 4 real Sidebar panes that the old build reports as workers.

## F. Gates (PASS: enforced live, final Stop let through by the gate)
Sources: the lead transcript (tool_result `is_error`, Stop attachments, `stop_hook_summary`) and `~/.atlas/atlas.db` (`friction_events` and `facets` rows for this session).

| Gate | When (UTC) | Reason | What the lead did next |
|---|---|---|---|
| PreToolUse:Skill deny | 19:19:38 | `[atlas gate] REQUIRED once per session: your first tool call must be one claude-mem recall ...` | Ran the recall, then continued |
| PreToolUse:Agent deny | 19:20:03 | `DENY - this Agent dispatch is missing the code-nav TOOLS block ...` (friction `dispatch_denied:toolkit`) | Re-dispatched |
| PreToolUse:Agent deny | 19:20:10 | `DENY - this Agent dispatch to atlas:implementer is unbounded: missing REPORT: ...` (friction `dispatch_denied:spec`) | The 19:20:19 dispatch `briefs` was allowed |

- **Stop events:** there were 4, at 19:20:21, 19:20:23, 19:23:35 and 19:23:55. Every `stop_hook_summary` shows `preventedContinuation: false`, `hookErrors: []`, `level: suggestion`, so no Stop block occurred.
  - The first three stops happened while a Task dispatch was in flight (`briefs`, then `docs-changelog`). The completion gate stays silent by design in that case: see `completion_gate.py:15-17` and `_has_in_flight_dispatch` at :582.
- **Completion-gate outcome:** the final Stop at 19:23:55 was allowed, so the session ended through a gate-satisfied Stop.
  - At that point all 7 board items were completed, the lead had run `python3 -m pytest -q` (`5 passed`) and the CHANGELOG had one new line.
  - The result event reports `subtype=success`, `is_error=false`, `stop_reason=end_turn`.
  - `facets` for the session shows `gate_block_count=0`, `dispatch_count=2`, `outcome=success`.

## G. Finding recorded
PASS. Command: `python3 $SRC/scripts/atlas_finding.py --root /Users/jerry/MEGA/Projects/Agentic/tech-tools --id colony-mux-e2e-10.4.3 --status verified --title ... --evidence ... --reproduction ... --surface plugins/atlas --by rerun-colony-e2e`

Output: `wrote /Users/jerry/MEGA/Projects/Agentic/tech-tools/.atlas/.run/findings.json -> {"id": "colony-mux-e2e-10.4.3", "surface": "plugins/atlas", ...}`

Grep check: `grep -n colony-mux-e2e-10.4.3 .atlas/.run/findings.json` returned `4099:    "id": "colony-mux-e2e-10.4.3",`

## Side observations (not failures)
- The `runs` row for the lead (id 2275) has `ended_at=1791487221`, which is the first in-flight Stop (19:20:21), not the real end (19:23:55). `completion_gate._finalize_db` appears to finalize on a Stop that the in-flight rule silenced. This is telemetry only. [INFERENCE from the timestamps]
- The lead skipped the prompt's explicit `atlas_todo.py add` step. TodoWrite had already mirrored the items to the board, so no items were missing.
- The lead's `atlas_todo.py add --help` call created a stray `--help` item. The lead removed it, and it is not in `todos.json`.
- `findings.json` in D has no `verified` row, because the lead used pytest as its verification. The completion gate accepted this.
- Herdr Sidebar panes wP:p2/p4/p6/p8 are still alive. They are not workers, and new-build status reports `workers: []`, so `atlas_mux kill` was not needed.
