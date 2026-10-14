# live-122: installed atlas 12.1.2 live verification (tmux, plain claude / plain omp)

Start registry (own measure): channels 9, members 77, unfinished 38 (matches lead). Keys: tech-tools@main, @main/selffix, lead-01a130, lead-50b61b, lead-384c2a, lead-ec38fa, lead-4abfc9, lead-bf36fe, lead-65f1b1. hook-faults.jsonl 657 lines at start (ts 1791935376).
Method: tmux new-session atlv2-cc / atlv2-omp, plain claude / omp. Caveat: first Enter after a long send-keys did not submit in CC; a second C-m did. Raw frames: live-122.ansi (CC captures then OMP captures, 2-3 s cadence).

## R1 CC spinner animates: PASS (one caveat)
Band rows, every 2 s (probe agent autonamed "explorer"; Agent tool has no name field, so "probe2" was only in the dispatch line):
 T2  ATLAS ◎ research 0/0 ▱▱▱▱▱ · ◝ explorer 0s · ▸ /atlas-cc
 T3  ... ◡ explorer 1s
 T4  ... ◠ explorer Bash sleep 6 4s
 T5  ... ◞ explorer Bash sleep 6 4s
 T6  ATLAS ✓ verify ... ◕ explorer Bash sleep 6 7s
 T7  ... ◐ explorer 10s
 T8  ... ◑ explorer Bash sleep 6 12s
 T9  ... ◔ explorer Bash sleep 6 12s
 T10 ... ◐ ... 15s   T11 ◑ 18s   T12 ◕ 19s   T13 ATLAS ⚑ idle · verify 0/0 · 0 open
Distinct worker glyphs: 7+ (◝ ◡ ◠ ◞ ◕ ◐ ◑ ◔). Age 0,1,4,4,7,10,12,12,15,18,19 monotonic non-decreasing. Pill ' ATLAS ', tool (Bash) and target (sleep 6) present.
Caveats: (a) the explorer ran 4 of the 5 sleeps in parallel, so the worker was live ~22 s, less than the 30 s window asked; 12 consecutive captures while working is plenty for the glyph criterion. (b) Tool shows "Bash" not mcp__lean-ctx__ctx_shell (native Bash allowed this time). (c) Phase flipped research -> verify while the worker ran (not a claimed item).

## R2 CC subagent member finished: PASS
channels.json after run: {"name": "explorer-f96f", "role": "subagent", "parent": "lead-b01fc8", "agent_id": "a27d250d0d74a38ad", "exit_code": 0, "ended_at": 1791935496.118805}. Finished at 1791935496 = capture T12/T13, i.e. at worker end.

## R3 CC lead finished + reaped on exit: PASS
Lead channel key tech-tools@main/lead-b01fc8 (opened at session start in channels.json, count 10). After /exit + 7 s: channels 9/77/38, key absent. Archive .atlas/.run/archive/channels-202610.jsonl has the line; lead member {"name":"lead-b01fc8","exit_code":0,"ended_at":1791935558.167} and explorer-f96f exit_code 0.

## R4 CC idle row + pane default tab: PASS
Idle row on startup and after finish: ` ATLAS ⚑ idle · research 0/0 · 0 open` then ` ATLAS ⚑ idle · 0 open`. /atlas-cc frame: `│ r: ◎ route │ t: ● team │ c: ✉ channel │ g: ✓ gates`, body `◎ research ○ ─ ◇ theory ... ✓ verify ○` + `nothing planned` (route tab).

## R5 omp widget live: PASS (with a stale-live defect)
omp 18.x plain; first tool claude-mem search; ProbeOmp2 dispatched via task. Captures every 3 s. Widget block (T12):
 atlas channel tech-tools@main/lead-01a137
 ATLAS 🔍 research 839/870 ████████ · 1 live · 31 gates
 ⠼ ProbeOmp2 6s
 <6 message lines>
 members: 1 working, 0 finished
Header line starts with `ATLAS `, has phase glyph 🔍 and `1 live` in captures T10-T30 (21 of 30 frames; T1-T9 before the task registered showed none, as expected). Worker row ProbeOmp2 spinner changed across captures: ⠼ (6s), ... ⠼ 51s, ⠦ 54s, ⠇ 57s, ⠋ 1m. Max widget block height 10 lines (channel title + header + worker + 6 msg + members); `widget truncated` text count 0.
DEFECT (not in the claim, observed): ProbeOmp2 replied DONE at ~T19 (ATLAS | 🏁 done reply) and omp's own panel showed it finished, but the atlas widget kept `1 live`, `⠋ ProbeOmp2 1m`, `members: 1 working, 0 finished` through T30 (>=30 s after completion). channels.json member ProbeOmp2 had no exit_code until /exit (ended_at 1791935697, same time as the lead). So omp subagent members are only finished at shutdown, and the live count is stale after the worker ends. Also the header phase stays "research 839/870" (looks like a cumulative count, unchanged).
Note: the omp channel key lead-01a137 is the same key the 12.1.1 omp used (omp resumes/derives the lead id from the session), and the widget message lines show ProbeFix* posts from that earlier run, i.e. the channel board carried prior-run messages.

## R6 omp lead reaped on exit: PASS
Lead key tech-tools@main/lead-01a137 in channels.json during run (count 10). After /exit + 8 s: 9/77/38, key absent. Archive last matching line: lead {"exit_code":0,"ended_at":1791935697.739} and ProbeOmp2 {"exit_code":0,"ended_at":1791935697.640}. (Archive holds two lines for this key: the 12.1.1 run and this one.)

## R7 faults: PASS
hook-faults.jsonl 657 lines before and after; 0 rows ts >= 1791935376; 0 `channel-open failed`; no new fault text.

## R8 net registry: PASS
Start 9/77/38; end 9/77/38 (net change 0 channels, 0 members, 0 unfinished). Other tmux sessions atlas-selffix, atlas-work, atlasdemo untouched; atlv2-cc and atlv2-omp killed (already gone after /exit).
