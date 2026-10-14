# live-121: installed atlas 12.1.1 live verification (tmux, plain claude / plain omp)

Baseline (re-measured): channels 32, members 544, unfinished 453, no archive dir.

## C1 CC band brand + phase + target + age: PARTIAL FAIL
Commands: tmux new-session -d -s atlv-cc -x 160 -y 45 claude; send prompt (claude-mem search, then atlas:explorer probe-live x 4 sleeps); capture-pane -p -e / -p every 4 s.
Band rows captured (plain):
 ATLAS ◎ research 0/0 ▱▱▱▱▱ · ◞ probe-live 3s · ▸ /atlas-cc
 ATLAS ◎ research 0/0 ▱▱▱▱▱ · ◞ probe-live mcp__lean-ctx__ctx_shell sleep 6 6s · ▸ /atlas-cc
 ATLAS ◎ research 0/0 ▱▱▱▱▱ · ◞ probe-live mcp__lean-ctx__ctx_shell sleep 6 13s · ▸ /atlas-cc
 ATLAS ◎ research 0/0 ▱▱▱▱▱ · ◞ probe-live mcp__lean-ctx__ctx_shell sleep 6 21s · ▸ /atlas-cc
 ATLAS ◎ research 0/0 ▱▱▱▱▱ · ◞ probe-live mcp__lean-ctx__ctx_shell sleep 6 31s · ▸ /atlas-cc
 ATLAS ◎ research 0/0 ▱▱▱▱▱ · ◞ probe-live 39s · ▸ /atlas-cc
Raw ANSI of the pill: `\x1b[1;7m\x1b[91m ATLAS \x1b[0;1m\x1b[91m◎ research 0/0 ... \x1b[94m◞ probe-live 3s` (inverse bold ' ATLAS ' pill present).
Findings: pill PASS; worker name PASS; tool+target (`mcp__lean-ctx__ctx_shell sleep 6`) PASS; age 3s,6s,6s,13s,16s,21s,27s,31s,31s,39s increases monotonically across tool calls PASS (never reset).
FAIL: the phase glyph stayed `◎` and the worker glyph stayed `◞` in all 10 working captures, so no changing spinner frame was observed between captures (band redraws are event-driven, e.g. 6s repeated in two captures).
Full frame (T7):
```
❯ First run one claude-mem search for 'atlas band' (mcp__plugin_claude-mem_mcp-search__search). Then dispatch ONE atlas:explorer named probe-live in the
  background with this exact task: run sleep 6 four separate times as four separate shell tool calls (use the lean-ctx ctx_shell tool if native Bash is
  denied), then reply DONE. TOOLS: ToolSearch lean-ctx (ctx_shell, ctx_read). GOAL: run sleeps. DELIVERABLE: the word DONE. SUCCESS CRITERIA: four sleeps ran.
  OUT OF SCOPE: everything else. STOP CONDITIONS: none. REPORT: DONE.

  Called plugin:claude-mem:mcp-search (ctrl+o to expand)

⏺ atlas:explorer(Run four sleeps)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)
 ATLAS | 🔍 research | probe-live is running in the background, waiting for it to finish
I ran the claude-mem search for "atlas band" and found 12 results (5 observations, 2 sessions, 5 prompts). The top observations:
- #37120 (Oct 12): atlas plugin install conflict, where the name clashed with a synced version.
- #28648 (Aug 11): the 5.7.0 CHANGELOG records a serena tool-routing defect and its fix.
- #28767 (Aug 11): the 5.7.1 CHANGELOG lists a serena KeyError:'languages' known issue.
- #34282 (Sep 15): a verified correctness finding was added to findings.json.
- #27535 (Aug 6): the AgentTierContract tests catch tier regressions.

None of the five is about the band rendering itself.

DISPATCH -> atlas:explorer (probe-live) (run sleep 6 four times as separate shell calls, then reply DONE). It runs in the background. I don't know yet whether
the four sleeps ran or whether it said DONE. I'll report when its completion notification comes in.

⏺ Ran 10 stop hooks (ctrl+o to expand)
  ⎿  Stop hook feedback: Atlas self-improvement check: if this turn produced a reusable decision, fix, or gotcha, capture it (claude-mem observation_add
  or a note under .agents/) so the next session starts ahead. If you changed behavior or structure, confirm docs/ still matches
  (CHANGELOG/ROADMAP/architecture).
 ATLAS | 🔍 research | Still waiting on probe-live, no change. Nothing from this turn needs saving, and no files changed.
▸ 18s · 1 workers · ctx 11% · $1.00
 ATLAS ◎ research 0/0 ▱▱▱▱▱ · ◞ probe-live mcp__lean-ctx__ctx_shell sleep 6 13s · ▸ /atlas-cc                                                               [-]

─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── claude-code-mods-redesign-demo ─
❯ did the band show probe-live's tool calls?
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  📁 tech-tools | 🤖 Opus 5.5 | 🧠 █░░░░░░░░░ 11% (106.7k/1M)                                                                                              /rc
  ⏱️  5h: ░░░░░░░░░░ 9% 1h33m left
  ⏱️  7d: ██████░░░░ 63% 1d5h left
  context-mode  ●  saves ~98% of context window
   fallow  impact  off
  ⏵⏵ auto mode on (shift+tab to cycle) · ← 3 agents

  ⏺ main
  ◯ atlas:explorer  Run four sleeps                                                                                                       16s · ↓ 76.9k tokens



```

## C2 CC idle row: PASS
After worker finished and turn ended: ` ATLAS ⚑ idle · 0 open` (no stale `done` phase in the band; `ATLAS | 🏁 done` appears only in the reply text, line 24 of the T14 frame).

## C3 CC pane default tab: PASS
`/atlas-cc` opened pane: tab row `r: ◎ route │ t: ● team │ c: ✉ channel │ g: ✓ gates`, body is the route phase strip (`◎ research ○ ─ ◇ theory ... ✓ verify`, `nothing planned`). Closed with Ctrl+X x (tab row gone, grep count 0), reopened: same route view. Caveat: tab highlight not distinguishable in plain text; verified by body content.

## C4 CC subagent finish via agent_id mapping: FAIL
Dispatch finished (`Agent "Run four sleeps" finished · 39s`, band back to idle). channels.json member after finish, also after /exit:
`{"name": "explorer-4fc0", "role": "subagent", "parent": "lead-4abfc9", "joined": 1791934008.29}` (no exit_code, no ended_at). Compare omp's member: `"exit_code": 0, "ended_at": 1791934250.36`.

## C5 reaper on real data: PASS (caveat)
Before: channels 32 / members 544 / unfinished 453, no archive. After CC session opened lead-4abfc9: channels 7 / members 71 / unfinished 33. `.atlas/.run/archive/channels-202610.jsonl` exists with 26 lines (32 + 1 new - 7 kept). Live-pid check over archived members: 0 with a live pid and no exit_code. Caveat: lead/subagent members record no pid, so liveness could only be checked where a pid existed (0 members have one); 3 sibling sessions' channels (selffix etc.) remained.

## C6 omp widget header: FAIL
omp 18.10.3 plain, prompt sent, 14 captures every 4 s while ProbeOmp ran. No line starting `ATLAS ` with phase glyph and `<n> live` in any frame. What did render: native omp panels (`⇶ Task 1 agent`, `└─ ⣷ ⟦task⟧ ProbeOmp · 3.2s` spinner changing ⣷ ⣾ ⢿ ⣟ ⣾) and the editor border `👥 1`. The spinner is omp's own, not the atlas widget.
Frame (T12) shows no ATLAS widget line (see live-121.ansi).

## C7 omp header contract: PASS
Reply began `ATLAS | 🏁 done | confirmed from the transcript: three separate sleep 6 shell calls, then DONE`.

## C8 omp reap on shutdown + faults: PARTIAL FAIL
/exit; session gone. channels.json before exit: 8/73/35, after: 8/73/34. Lead channel tech-tools@main/lead-01a137 NOT reaped: member `lead-01a137` has no exit_code (ProbeOmp has exit_code 0, ended_at set). Channel count grew by 1 (the channel this test opened), within allowance. ~/.atlas/hook-faults.jsonl: 0 rows with ts >= start, 0 `channel-open failed`: PASS.

## C9 deterministic resolver: PASS
`python3 plugins/atlas/scripts/atlas_resolve.py implement medium --paths b.py,a.py` x2: byte-identical. `bun -e "import {resolve} from './resolve.ts'; ..."` x2: byte-identical. Python vs TS: same JSON object after parsing (file_scope sorted [a.py,b.py], same team), key order differs so not byte-equal across runtimes.
Python: {"effort": "medium", "file_scope": ["a.py", "b.py"], "isolation": "worktree", "max_parallel": 3, "task_class": "implement", "team": [...]}

## Side notes
- Permission prompts: none appeared in either session.
- omp printed a warning that the resumed session was open in another omp process and forked to a new session file.
- Only atlv-cc and atlv-omp were created and are gone; other tmux sessions untouched.
