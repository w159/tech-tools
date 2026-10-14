# live-220: installed atlas 12.2.0 live verification (tmux atlv4-cc / atlv4-omp, plain claude / omp)

Start 2026-10-14T01:09:06Z (epoch 1791940146). Installed root /Users/jerry/.claude/plugins/cache/tech-tools/atlas/12.2.0 (symlinked into osprey/assets/plugins); installed dispatch_tripwire.py byte-identical to repo source (diff -q clean). Raw frames: live-220.ansi (cc-idle, v3a, v3b, v2, v4-panes, v5, v5-worker, v5b, plus CC and omp scrollback). Capture cadence 3 s. Driver: send-keys -l + C-m (CC needed a second C-m, as before).

## Verdicts

| claim | verdict | one-line reason |
|---|---|---|
| V1 CC Mission Control band | PASS | Framed 3-row idle panel; 6-7 row live panel with ATLAS chip, phase rail, one lane per worker (name, role, tool e.g. ctx_shell/Bash, target "sleep 6", bar, elapsed), channel ticker, todos/gates footer; reflows at 100x30. Minor: lane tool flickers to "-" between calls, rail shows "verify" during a research task. |
| V2 CC transcript cards | FAIL (partial) | Single dispatch renders a bordered card (name, role, tier sonnet-low, GOAL line, status). No result line after completion (card 1 stayed "idle"); the 2-agent batch rendered the stock "2 background agents launched" tree, no WAVE strip; no "refused" line seen. |
| V3 SCOPE gate | FAIL | Two unscoped atlas:explorer dispatches ran, no deny. Scoped dispatch (SCOPE: audit/low) ran fine. Root cause below. |
| V4 default tmux team flow | PASS on flow, FAIL on DB | Lead called atlas_resolve (audit/medium -> 2 explorer + 1 completeness-critic), spawn-team, wait, reap; atlas-peer-sync had 3 worker windows concurrently; panes show branded ATLAS header + live tool lines; 6 worker-to-worker notes; session gone after reap. But dispatches.wave_id set on 0 of 16 rows in the last hour, spawn-team returns wave_logged:false, team workers are not in dispatches at all. |
| V5 omp widget + atlas_team | FAIL (partial) | Widget renders framed (rail, lane, ticker, gates footer) for a task subagent, but was absent from all 45 frames while an atlas_team tmux team ran; lane shows no tool/target. atlas_team: audit/low gave 1 worker that hung after its work and was SIGHUP'd (exit 129, report "Working..."), reap then said "no team record"; audit/medium retry ran 3 omp workers clean (4 w2w notes, reaped). Lead channel reaped on exit: PASS. |
| V6 hook latency | PASS | Every event median at or below baseline-r2 except Read pre+post (190 -> 194, noise). SessionStart 223 -> 124, slowest hook 145 -> 84. |
| V7 faults | PASS | hook-faults.jsonl 667 lines at start and at end: 0 new rows, no 'channel-open failed'. |

## V1 Mission Control band (CC)
Idle (160x45), framed 3 rows: `╭─╮ / │ ATLAS  ◉ research ─ ○ ─ ○ ─ ○ ─ ○ ─ ○ idle │ / ╰─╯`. After a run: `ATLAS  ✓ ─ ✓ ─ ✓ ─ ✓ ─ ✓ ─ ◉ done blocked · last run: 4 workers, 7 min, ok · gates ✗1`.
Live frames (v2.ansi): 160 col rows 7 at T4-T8 (two lanes), 100x30 rows 7 then 6 when explorer-a324 finished, back to 3-row idle at T8. Lane age column advances 2,5,10,14,20,22,25,29,32,35 s. Lane tool cell values seen: Bash, ctx_shell, SubagentHan…, and "-" between calls. Lane names are autonames (explorer-a324, explorer-aac1), not the requested wave-a / wave-b.

## V2 transcript cards (CC)
Single dispatch card (cc-scroll, 160 col):
```
⏺ DISPATCH -> atlas:explorer (explore-bench · pinned tier) (list bench* scripts)
╭──────────...──╮
│ ◆ explorer-list-bench · explorer · sonnet·low ✓ running │
│ list files in plugins/atlas/scripts matching bench*     │
╰──────────...──╯
```
After the agent finished (7 s) the card read "✓ idle" (first) or "✓ completed" (second) with no result line. Second card's name cell was "explorer" not the autoname. Batch of two:
```
⏺ DISPATCH -> atlas:explorer (wave-a · pinned tier) (3x sleep 6, report date) + atlas:explorer (wave-b · pinned tier) (3x sleep 6, report date)
⏺ 2 background agents launched (↓ to manage)
   ├ wave-a
   └ wave-b
```
grep -c WAVE v2.ansi = 0; grep -c refused v3a.ansi = 0.

## V3 SCOPE gate (CC)
Test 1: GOAL+TOOLS only, no SCOPE -> allowed, only the first-offense unbounded advisory fired. Test 2: all six spec blocks, no SCOPE -> allowed, no hook output at all. Test 3: SCOPE: audit/low (wave batch) -> ran. No deny text exists to capture.
Root cause (traced against the installed hooks/dispatch_tripwire.py with sys.settrace):
1. Turn 1: the F11 first-offense branch (`_spec_advisory_claimed` -> `_advisory(...)`, then `return` at the end of the unbounded block, ~line 1229) returns before `_scope_gate` (line 1239), so an unbounded prompt skips SCOPE.
2. Later turns: `_pre_tool_use` returns at `run_id = atlas_db.current_run_id(...)`; `if run_id is None: return`. current_run_id requires `ended_at IS NULL`; run 2668 got ended_at 1791940205.58 at the first Stop and no new run opened, so the entire deny tier (SCOPE, spec, builtin-agent) is off for every later turn of the session. dispatches rows 6759-6761 still carry run_id 2668 (via latest_run_id), so logging and gating disagree about whether a run is live.
Direct call `_scope_problem({'subagent_type':'atlas:explorer','prompt':'GOAL: x...'})` returns the expected DENY text, so the matrix and message are fine; only the call path is unreachable.
Side effect of the probe: the synthetic hook calls (session ids atlv4-probe*) registered channel tech-tools@main/lead-atlv4- with 3 members in .atlas/.run/channels.json; left in place.

## V4 default team flow (CC)
Lead calls (cc-final scrollback): `atlas_resolve.py audit medium --paths plugins/atlas` -> `{"effort":"medium","max_parallel":3,"task_class":"audit","team":[{"count":2,"role":"explorer",...},{"count":1,"role":"completeness-critic",...}]}`; `atlas_mux.py spawn-team --class audit --effort medium --paths plugins/atlas --team-id peer-sync` -> `{"ok":true,"team_id":"peer-sync","session":"atlas-peer-sync","transport":"tmux","wave_logged":false,"channel":"tech-tools@main/lead-a47cc5","max_parallel":3,"members":[explorer-4fdc, explorer-9eb2, completeness-critic-233b]}`; wait (ok, all 3 exit 0, STATUS: DONE, 6 notes); reap ok, session killed.
tmux at 1791940688: `atlas-peer-sync: 4 windows` = 1 lead zsh + explorer-4fdc Python + explorer-9eb2 Python + completeness-critic-233b Python. Session gone at 1791940735.
Board notes (.atlas/.run/board/*.jsonl): each worker sent start -> lead, peer-sync -> each of 2 siblings, report STATUS: DONE -> lead (6 worker-to-worker notes).
Worker panes are 80x24 (tmux default for the detached team session), so the header wraps.
sqlite3 -readonly ~/.atlas/atlas.db, dispatches with ts in the last hour: 16 rows, wave_id set on 0. The 3 team workers have no dispatches rows.
Side observation: the lead's Stop-gate fix posted two board notes from the same shell that landed on different channels (tech-tools@main/lead-a47cc5 vs tech-tools@main).

## V5 omp (160x45)
Fresh session via /new (omp auto-resumed a prior 428k-token session on launch). atlas_team spawn audit/low -> 1 worker (atlas_resolve audit low = 1 explorer, so a 2-worker team is not reachable at low). Worker explorer-0aa5 posted start and peer-sync by 1791940912, then hung; pane stuck on "Working..."; registry exit_code 129 at 1791941112 (250 s); wait JSON `{"ok":true,"members":[{"name":"explorer-0aa5","exit":129,"duration_s":250.1,"last_status":null}],"notes_worker_to_worker":0}`; reap `{"ok":false,"error":"no team record for t56f4ac"}`. Lead retried audit/medium t1bbe70: 3 omp workers (explorer-1c10, explorer-7f29, completeness-critic-90be), all exit 0, notes_worker_to_worker 4, explorer-1c10 last_status null; reap `{"ok":true,"killed":true,"session_left":false,"channels_reaped":1}`. Team workers post to channel "tech-tools@main/lead" (no session suffix).
Widget: grep -c ATLAS v5.ansi = 0 across 45 frames during the atlas_team run. With a task-tool subagent (v5b) the widget appears; ticker shows notes from other sessions' ProbeFix4 on "#lead".
Lead reap: registry 12 channels / 88 members / 45 unfinished with lead-01a137 present before /exit; 11 / 86 / 44, lead-01a137 absent after (1791941698).

## V6 hook latency (bench_hooks.py -n 15 --root <installed 12.2.0>)
| event | baseline-r2 median ms | 12.2.0 median ms | p90 |
|---|---|---|---|
| python3 floor | 30 | 30 | - |
| SessionStart | 223 | 124 | 165 |
| UserPromptSubmit | - | 67 | 92 |
| PreToolUse Bash | 178 | 148 | 190 |
| PreToolUse Edit | 130 | 119 | 154 |
| PreToolUse Agent | - | 124 | 136 |
| PostToolUse Edit | 202 | 190 | 197 |
| Read call (pre+post) | 190 | 194 (99+95) | - |
| Edit call (pre+post) | 330 | 309 (119+190) | - |
| Stop | 219 | 190 | 213 |
| slowest single hook | atlas_doctor 145 | dispatch_tripwire 84 (Agent) | - |
Baseline was 10 runs in a scratch dir; this is 15 runs; same machine.

## V7 faults
hook-faults.jsonl: 667 lines at 1791940146, 667 at end. 0 new rows; 0 'channel-open failed'.

## Before / after vs baseline-r2
| item | baseline-r2 (12.1.3) | live-220 (12.2.0) |
|---|---|---|
| CC band | 1 text row, no borders | framed panel: 3-row idle, 6-7 rows live with lanes, ticker, gates footer |
| omp widget | one header line + rows | framed panel with rail, lanes, ticker, footer (task subagents only; absent during atlas_team) |
| transcript restyle | none | bordered card per single dispatch; no WAVE strip for batches; no result line |
| tmux teams used | never | lead ran resolve -> spawn-team -> wait -> reap unprompted by name of CLI (CC), atlas_team tool (omp) |
| resolver calls | 0 | 1 by the CC lead (plus atlas_team resolves internally) |
| SCOPE enforcement | advisory, 8/166 runs | still not enforced live: deny path unreachable after first Stop and on first-offense advisory |
| dispatches.wave_id | 0 of 1899 | 0 of 16 (wave_logged:false) |
| worker-to-worker notes in a team | 246/712 (dev squads) | 6 (CC team), 4 (omp medium team), 0 (omp low team, worker hung) |
| SessionStart / Stop median | 223 / 219 ms | 124 / 190 ms |
| new hook faults | 63 per 24 h | 0 in this run |

## Key frames (ANSI stripped)
```
---V1-160
atlv4-cc T5 1791940557
▸ 13s · 2 workers · ctx 12% · $0.42
❯ Do one claude-mem search for "wave strip". Then in ONE message dispatch TWO atlas:explorer agents in parallel (two Agent calls in the same message). Each
  prompt has these line-start blocks: SCOPE: audit/low. GOAL: run sleep 6 three times with your shell tool, then report the date. TOOLS: ToolSearch lean-ctx
  (ctx_shell, ctx_read). DELIVERABLE: the date output. SUCCESS CRITERIA: three sleeps ran. OUT OF SCOPE: edits. STOP CONDITIONS: after the third sleep. REPORT:
  STATUS and date. Name them wave-a and wave-b. If any dispatch is denied, quote the deny text verbatim. Wait for both, then summarize in one line.
  Called plugin:claude-mem:mcp-search (ctrl+o to expand)
⏺ DISPATCH -> atlas:explorer (wave-a · pinned tier) (3x sleep 6, report date) + atlas:explorer (wave-b · pinned tier) (3x sleep 6, report date)
⏺ 2 background agents launched (↓ to manage)
   ├ wave-a
   └ wave-b
 ATLAS | ✅ verify | wave-a and wave-b both started; waiting for both to finish
Neither dispatch was denied. Both atlas:explorer agents (wave-a and wave-b, each with SCOPE: audit/low) were sent in the same message and are running in
parallel. The claude-mem search for "wave strip" returned 14 hits. The nearest are #39268 (the W2 transcript wave cards dispatch) and #39384 (the cards.tsx wave
helper refactor).
I'll give the one-line summary once both report back.
▸ 11s · 2 workers · ctx 12% · $0.42
╭─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮ [-]
│ ATLAS  ✓ research ─ ✓ theory ─ ✓ test ─ ✓ implement ─ ◒ verify ─ ○ done                                                             0/0 tasks · gates ✗1│
│▌ explorer-a324      explorer     ◒ Bash         sleep 6                  ▕▱▱▱▱▱▱▱▱▱▱▏   5s working                                                      │
│▌ explorer-aac1      explorer     ◒ ctx_shell    sleep 6                  ▕▱▱▱▱▱▱▱▱▱▱▏   5s working                                                      │
│#tech-tools@main  lead > explorer-aac1: wave-b · explorer-aac1 > all: joined                                                                             │
│todos ▱▱▱▱▱▱▱▱▱ 0/0 ✓ completion ✓ tripwire ✗ routing ✓ header                                                              /atlas-cc pane · r t c g tabs│
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── claude-code-mods-redesign-demo ─
❯
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  📁 tech-tools | 🤖 Opus 5.5 | 🧠 █░░░░░░░░░ 12% (120.6k/1M)                                                                   atlas: ▸ explorer-aac1 spawned
  ⏱️  5h: ░░░░░░░░░░ 2% 4h44m left                                                                                                                         /rc
  ⏱️  7d: ███████░░░ 70% 1d3h left
  context-mode  ●  saves ~98% of context window
   fallow  impact  off
  ⏵⏵ auto mode on (shift+tab to cycle) · ← 3 agents
---V1-100
atlv4-cc T3 1791940575
 ATLAS | ✅ verify | wave-a and wave-b both started; waiting for both to finish
Neither dispatch was denied. Both atlas:explorer agents (wave-a and wave-b, each with SCOPE:
audit/low) were sent in the same message and are running in parallel. The claude-mem search for
"wave strip" returned 14 hits. The nearest are #39268 (the W2 transcript wave cards dispatch) and
#39384 (the cards.tsx wave helper refactor).
I'll give the one-line summary once both report back.
▸ 11s · 2 workers · ctx 12% · $0.48
╭─────────────────────────────────────────────────────────────────────────────────────────────╮ [-]
│ ATLAS  ✓ ─ ✓ ─ ✓ ─ ✓ ─ ◒ verify ─ ○                                     0/0 tasks · gates ✗1│
│▌ explorer-a324      ◒ Bash         ▕▰▰▱▱▱▱▱▱▱▱▏  22s working                                │
│▌ explorer-aac1      ◒ ctx_shell    ▕▰▰▱▱▱▱▱▱▱▱▏  22s working                                │
│#tech-tools@main  lead > explorer-aac1: wave-b · explorer-aac1 > all: joined                 │
│todos ▱▱▱▱▱▱▱▱▱ 0/0 ✓ completion ✓ tripwire ✗ routing ✓ header  /atlas-cc pane · r t c g tabs│
╰─────────────────────────────────────────────────────────────────────────────────────────────╯
─────────────────────────────────────────────────────────────────── claude-code-mods-redesign-demo ─
❯
────────────────────────────────────────────────────────────────────────────────────────────────────
  📁 tech-tools | 🤖 Opus 5.5 | 🧠 █░░░░░░░░░ 12% (120.6k/1M)                                  /rc
  ⏱️  5h: ░░░░░░░░░░ 2% 4h44m left
  ⏱️  7d: ███████░░░ 70% 1d3h left
  context-mode  ●  saves ~98% of context window
   fallow  impact  off
  ⏵⏵ auto mode on (shift+tab to cycle) · ← 3 agents
  ⏺ main
  ◯ atlas:explorer  wave-a                                                    24s · ↓ 76.1k tokens
  ◯ atlas:explorer  wave-b                                                    24s · ↓ 77.1k tokens
---V4
atlas-peer-sync:2 1791940719
 ATLAS  explorer-4fdc  explorer  team tech-tools@main/lead-a47cc5  #tech-tools@m
ain/lead-a47cc5
goal You are explorer-4fdc (explorer), one of 3 parallel workers of team peer-sy
nc (audit/medium) on chan
⣾ Bash  S=/Users/jerry/MEGA/Projects/Agentic/osprey/assets/plugins/cache/tech-to
ols/atlas/12.2.0/s
⣾ Bash  python3 /Users/jerry/MEGA/Projects/Agentic/osprey/assets/plugins/cache/t
ech-tools/atlas/12
> Try owner as a global flag before the subcommand.
⣾ Bash  S=/Users/jerry/MEGA/Projects/Agentic/osprey/assets/plugins/cache/tech-to
ols/atlas/12.2.0/s
⣾ Read  /Users/jerry/MEGA/Projects/Agentic/osprey/assets/plugins/cache/tech-tool
s/atlas/12.2.0/scr
⣾ Bash  S=/Users/jerry/MEGA/Projects/Agentic/osprey/assets/plugins/cache/tech-to
ols/atlas/12.2.0/s
⣾ Bash  S=/Users/jerry/MEGA/Projects/Agentic/osprey/assets/plugins/cache/tech-to
ols/atlas/12.2.0/s
---V5
atlv4-omp T9 1791941556
 Do one claude-mem search for "omp widget". Then dispatch exactly one explorer subagent with the task tool (agent explorer, name ProbeOmp4) whose job is: run
 sleep 6 three times with the shell tool, then report the date. Wait for it and reply in one line. Do nothing else.
🔌 claude-mem:mcp-search/search
Found 11 result(s) matching "omp widget" (5 obs, 5 sessions, 1 prompts)
### Oct 13, 2026
… 27 more lines ⟦⌃O: Expand⟧
╭─── ⇶ Task 1 agent ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Goal                                                                                                                                                         │
│                                                                                                                                                              │
│ Probe only. No repository reads or edits.                                                                                                                    │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ • ◔ anthropic/claude-sonnet-5-5 ProbeOmp4 ⟦explorer⟧ SCOPE: audit/low GOAL: run three sleeps… · 2 🛠 · 1 req · 8.0%/1M · $0.29                                │
│   routed: atlas: explorer pinned to @atlas-worker                                                                                                            │
│   └ bash: Sleeping second                                                                                                                                    │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
 Subagents
  └─ • ◔ anthropic/claude-sonnet-5-5 ProbeOmp4 ⟦explorer⟧: Run three sleeps and report date
     └ bash: Sleeping second
  ⎋ Dispatching ProbeOmp4 explorer
 ╭────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
 │ ATLAS  ● research ─ ● theory ─ ● test ─ ⣟ implement ─ ○ verify ─ ○ done                                                                4/5 tasks · gates ✓ │
 │ ▌ ProbeOmp4    ⠴ ▕▰▱▱▱▱▱▱▱▱▱▏ 7s working                                                                                                                   │
 │ #lead  ProbeFix4 > ProbeFix: ProbeFix4: your '--help' note came th… · ProbeOmp4 > lead-01a137: starting: three sleeps then date                            │
 │ todos ▰▰▰▰▰▰▰▱▱ 4/5  ✓ completion ✓ tripwire ✓ routing                                                                                                     │
 ╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── 👥 1 ─
❯
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 📁  tech-tools   ···✦🐸····  0m04s · 1408 tok/s · tools 1     👾  Claude Fable 5.1  ·  low
 ​
 📚  ctx  15% ▅▁▁▁▁▁▁▁▁  147.6k / 1M         │  💰  session         plan     2.6M tok  cache 91%
 ⏳  5h    7% ▅▁▁▁▁▁▁▁▁  4h27m anthropic     │  🔌  anthropic       plan     2.6M tok  claude-fable-5-1
 📅  7d   71% ▅▅▅▅▅▅▁▁▁  1d3h anthropic      │
 ​
LSP Active: typescript, python                 ● 🐴 ponytail: ⚡ FULL     fallow impact  off
```

## Cleanup
Sessions created and killed: atlv4-cc, atlv4-omp. Team sessions atlas-peer-sync, atlas-t56f4ac, atlas-t1bbe70 were reaped by the leads (none left). atlasdemo, atlas-selffix, atlas-work untouched.
