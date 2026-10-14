# live-123: installed atlas 12.1.3 live verification (tmux atlv3-omp / atlv3-cc, plain omp / claude)
Start registry: channels 9, members 77, unfinished 38. hook-faults.jsonl 657 lines. Raw frames (omp T1-T40 every 3 s, CC T1-T30 every 2 s): live-123.ansi.
Method caveat: CC needed a second C-m to submit (as in 122).

## T1 omp worker finish at end: PASS
Prompt: recall search, 2 todos (A in progress), one explorer task item ProbeOmp3 (sleep 5 x2). Frames:
 T12 (1791936856) ATLAS 🔍 research 0/2 ░░░░░░░░ · 1 live | ⠋ ProbeOmp3 0s | members: 1 working, 0 finished
 T15 ... 1 live | ⠦ ProbeOmp3 9s     T17 ... 1 live | ⠋ ProbeOmp3 15s
 T18 (1791936874) omp panel row "⟦task⟧ ProbeOmp3 · 15.5s" done; widget: ATLAS 🔍 research 0/2 ░░░░░░░░ · 0 live | members: 0 working, 1 finished ; ProbeOmp3 row gone
channels.json: ProbeOmp3 {"exit_code":0,"ended_at":1791936871.56} while lead-01a137 member still had no exit_code (lead still running). Panel-done to widget 0 live: <= 3 s (one capture interval). 12.1.2 stayed "1 live" until lead exit.
Full omp frame during T1 and after finish are in live-123.ansi (=== OMP T14 and T18/T19).
## T2 omp header scoping: PASS
Exact header text: `ATLAS 🔍 research 0/2 ░░░░░░░░ · 1 live` (then `· 0 live`). 0/2 = this session's two todos, not 839/870. No "gates" string in any of 40 frames' widget header.
## T3 omp lead reap: PASS
/exit at 1791936979; first poll 1 s later registry back to 9/77/38, lead-01a137 key absent; archive line lead {"exit_code":0,"ended_at":1791936979.496}, ProbeOmp3 exit_code 0 ended_at 1791936871.56.
## T4 CC regression: PASS
Band (2 s cadence): ATLAS pill present on every row.
 T10 ATLAS ◎ research 0/0 ▱▱▱▱▱ · ◝ explorer 1s · ▸ /atlas-cc
 T11 ◡ explorer Bash sleep 5 2s ; T12 ◜ ...2s ; T13 ◞ ...7s ; T14 ◡ explorer 8s ; T15 ◠ 10s ; T16 ◞ 13s ; T17 ◟ 13s ; T18 ◠ 17s ; T21 ◠ explorer 23s ; T22 ATLAS ⚑ idle · research 0/0 · 0 open
Distinct glyphs 6 (◝ ◡ ◜ ◞ ◠ ◟); ages 1,2,2,7,8,10,13,13,17,17,17,23 monotonic; target "Bash sleep 5". Member explorer-07b1 subagent exit_code 0 after finish. /exit + 9 s: lead-ae039d channel gone (registry 9/77/38), archive line has lead exit_code 0 ended_at 1791937066.9.
## T5 faults: PASS
hook-faults.jsonl 657 lines before and after; 0 new rows; the 6 total 'channel-open failed' rows are pre-existing (line count unchanged).
## T6 registry net: PASS
Start 9/77/38; end 9/77/38; net 0. atlv3-* sessions killed; atlas-selffix/atlas-work/atlasdemo untouched.
Side note (not a claim): omp widget disappears from the screen about 15 s after finish (T24+), which is fine.
