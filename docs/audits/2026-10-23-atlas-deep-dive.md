# Atlas deep dive: verifying an outside proposal, area by area

Date: 2026-10-23. Branch: `claude/atlas-audit-fixes`. Method: seven read-only explorers,
one per area, each told to adjudicate every claim in an outside model's improvement
proposal against the source (file:line or command output), then go past it. Line numbers
are from the branch head at the time of the audit and will drift.

## Scorecard

The outside proposal made 29 checkable claims.

| Verdict | Count | Notes |
|---|---|---|
| True | 6 | All six are "current state" descriptions (what a module does), not defects. |
| Partly true | 13 | A real symptom, but a wrong cause, location, or fix. |
| False | 10 | The feature already exists, the code does not say that, or the cost is wrong by 40x. |

Of its roughly 22 recommendations, none survived exactly as written. Ten survive in a
narrower or corrected form; twelve are rejected (already built, no-op, or unsafe). Two
are actively harmful: auto-editing `.claude/settings.json` from atlas-doctor, and
auto-loosening gates from telemetry.

The more important result: the explorers found defects the proposal missed entirely.
The top of that list is below; each area section has the rest.

## Priority list (new findings, not in the outside proposal)

| # | Sev | Area | Finding | Evidence |
|---|---|---|---|---|
| 1 | P1 | Doctor | Self-fix is on by default: every 30 min it launches autonomous code-editing workers and auto-commits their output, with no opt-in. | `scripts/atlas_selffix.py:55` `DEFAULT_PREFS = {"enabled": True, "interval_min": 30, ...}`; scheduler started from dashboard `serve()` (`:833-845`); auto-commit `:484-486` |
| 2 | P1 | Doctor | Self-fix verify runs worker-authored code. The new argv allowlist stops shell injection, but `pytest` or `npm test` in the worker's worktree still executes any `conftest.py` or `package.json` script the worker planted. | `atlas_selffix.py:493-497` |
| 3 | P1 | Channels | Other agents' note text is injected into the lead's context as "act on them", with no untrusted-data framing. Labels like HANDOFF and BLOCKED raise its apparent authority. Observed live in this session. | `hooks/worker_inbox.py:198`, `:201-216` |
| 4 | P1 | Command Center | The dashboard token is accepted in URLs (`?token=` on SSE and the terminal WebSocket) and the access log writes it in full. Anyone who can read `dashboard.log` can mint a shell ticket. Reproduced live. | `scripts/atlas_dashboard.py:2396-2407`, `:2459-2461`; `scripts/atlas_dash_term.py` ~`:419-424` |
| 5 | P1 | Doctor | Full transcripts, including model thinking, are stored unredacted in `~/.atlas/atlas.db`. Two redactors exist and disagree; neither covers SSNs, account or routing numbers. `messages` has no retention. | `scripts/session_ingest.py:796-813`, `:73-86`; `scripts/atlas_memory.py:62-80`; `scripts/atlas_doctor.py:109-117` |
| 6 | P1 | Colony | On a host without `ps` (Alpine, BusyBox, minimal images) a live lead is reaped at once, because "ps missing" and "pid gone" both return None. Reproduced. | `scripts/atlas_todo.py:1451-1462`, `:1252-1259` |
| 7 | P1 | Colony | If `rig ps` errors while herdr panes are live, routing picks rig and writes go to the wrong backend. `ATLAS_SEAT_BACKEND=off` makes `status`, `list_panes`, `ensure` raise. | `scripts/atlas_seats.py:47-57`, `:67-71` |
| 8 | P1 | Channels | Notes have no size cap and no retention, and every worker tool call rescans every note file under a lock (0.085 s at 20k notes, about 0.9 s at 200k). | `scripts/atlas_todo.py:815-870`; `hooks/worker_inbox.py:262-278` |
| 9 | P1 | Skills | The canonical dispatch template is denied by atlas's own tripwire: its tools block is not a line-anchored `TOOLS:` and it has no `SCOPE:` line. Proven by running the tripwire parsers on it. | `skills/atlas-orchestrate/references/subagent-kit.md:28`, `:40` |
| 10 | P1 | Doctor | User corrections are written to `MEMORY.md` and re-injected at every SessionStart as plain instructions; pasted web or email text can persist as a standing instruction. | `hooks/memory_capture.py:398`; `scripts/atlas_memory.py:345-360` |
| 11 | P1 | Hooks | The test suite is not hermetic: a live `ATLAS_LEAD_NAME` breaks 5 tests; one test fails under root; one test byte-compares source to the install cache and fails on every edit until reinstall. | `hooks/testenv.py:14-22`; `hooks/test_atlas_contract.py:610-661`, `:1138-1148` |
| 12 | P2 | Hooks | Gate (a) ignores the evidence layout the skills document (`.atlas/evidence/<date>-<slug>/`), so a run that saved proof correctly is blocked at Stop. | `hooks/completion_gate_core.py:173-192`; `skills/atlas-dogfood/references/route-and-report.md:76` |

## 1. Colony and seat backends

Files: `scripts/atlas_seats.py` (211 lines), `atlas_rig.py` (569), `atlas_herdr.py` (1244),
`atlas_launch.py` (295), `atlas_todo.py` (2144), `colony/herdr-web-ui/`.

### Claims

| Claim | Verdict | Evidence |
|---|---|---|
| Dual backends, OpenRig default, herdr fallback | True, with nuance | `atlas_seats.py:47-57`. Not a strict fallback: `_sources()` (`:92-103`) unions both when herdr is up. |
| OpenRig needs per-seat env in `specs/<rig>.yaml`; then retire herdr and herdr-web-ui (">15,000 lines") | Partly true; recommendation rejected | Seats are `builtin:terminal` with no env key (`atlas_rig.py:338-358`), but env already reaches seats via `exec env K=V ...` (`atlas_mux.py:1140-1145`). OpenRig 0.6.10's spec validator has no `env` key. herdr-web-ui is 83,008 TS/TSX lines (about 55k non-test), 5x the claim, and still carries the herdr peek path and the web UI. |
| `capture()` is not_supported on herdr; add `rpc("pane.read")` | Partly true | `/api/v2/herd/capture` does 501 on herdr (`atlas_seats.py:147-151`, `atlas_dash_herd.py:529-545`), but the `pane.read` call already exists in `_read_pane` (`atlas_dash_herd.py:459-485`). Only the route needs changing. |
| Ghost members linger; add a 2 h TTL and a `ps lstart` check | False, already built | TTL `atlas_todo.py:63` with env override `:1245-1248`; lstart check `:1451-1475`; automatic reap at boot, channel open, dashboard tick, mux and ingest. |

### What the proposal missed

- P1: live leads reaped on hosts without `ps` (priority item 6).
- P1: misrouting to rig when `rig ps` fails, and the facade raising under `off` (item 7).
- P2: SessionStart calls `backend()` synchronously and uncached: 1.56 s measured, mostly `rig ps --json` (`hooks/session_boot_core.py:161-175`).
- P2: `atlas_rig.create_pane` does list, write spec, `rig up` with no lock; concurrent launches can clobber the spec, and the 3 s `_ps` cache is not invalidated after create or close (`atlas_rig.py:45-71`, `:127-143`).
- P2: `close_pane` kills the tmux session directly, so rig keeps the member (`atlas_rig.py:400-409`).
- P2: seat-backed members are recorded with `pane_id` only and no pid, so liveness falls back to TTL and a quiet-but-alive team is archived after 2 h (`atlas_mux.py:1047`, `:1161-1163`).
- P2: herdr's web-ui mirror needs `rsync` and the install check does not test for it (`atlas_herdr.py:496`); this is the one failing herdr test here.

### Endorsed designs

| Design | Effort | Proving test |
|---|---|---|
| `pid_start` distinguishes "unavailable" from "gone"; on Linux read `/proc/<pid>/stat` | S | Patch `ps` away: a live lead is not reaped; a dead one is reaped after TTL |
| `backend()` returns herdr when `_rigs()` is None and herdr is up | S | New case; existing `test_atlas_seats.py:29-35` stays green |
| Null backend for `off` that returns contract shapes instead of raising | S | Call every public function under `ATLAS_SEAT_BACKEND=off`; nothing raises |
| Memoize `backend()` for 30 s; boot reads a cached status and refreshes detached | S-M | Mock a 1.5 s `_rigs`; `_boot_seats` returns in under 0.2 s |
| File lock around `create_pane`; clear `_ps` cache on create and close | S | Two threads, fake `rig`; both members present |
| `reap_channels` accepts a `pane_live` callback | S-M | `pane_live=True` past TTL: nothing reaped |
| Route `/herd/capture` through `_read_pane` | S | herdr backend, mocked rpc: 200 with text |

## 2. tmux worker execution

Files: `scripts/atlas_mux.py`, `atlas_panefeed.py`, `atlas_launch.py`. Tests: mux 111 OK,
panefeed 29 OK, panefeed_omp 7 OK.

### Claims

| Claim | Verdict | Evidence |
|---|---|---|
| Headless workers in tiled panes of `atlas-<id>` | True | `atlas_mux.py:159-160`, `:906-920` |
| Stream output flickers; use the alternate screen and a 30 Hz throttle | Partly true | No throttle: `_add` repaints on every event (`atlas_panefeed.py:552-556`). Pane borders are drawn by tmux, not panefeed. The alternate screen is rejected: it erases the scrollback that post-exit review relies on (`atlas_mux.py:698`). |
| Panes inherit the tmux server's env; forward `ATLAS_MODE`, `ATLAS_SCOPE_GATE`, `ATLAS_FOOTPRINT_FILES` | False | Env is set explicitly per pane (`atlas_mux.py:338-347`). The two gate variables are read only by the lead-side tripwire, and forwarding a lead's `=off` would weaken worker gates. |
| Teams over 3 fall back to tiled below 70 columns; add tabbed windows | Partly true | 4 or more workers tile at any width (`atlas_mux.py:887-891`); there is no width fallback and no tabbed mode. A narrower fix is endorsed. |

### What the proposal missed

- P2: no team-size cap and no token ceiling enforced in `build_team` (`atlas_mux.py:1593-1600`); workers default to `--permission-mode acceptEdits` (`:1121`).
- P2: `wait` returns on timeout but leaves runaway workers running (`atlas_mux.py:1932-1960`, default 600 s at `:2194`).
- P2: finished panes stay open (`remain-on-exit`) with tmux's default scrollback, and tool arguments are printed unredacted, so secrets passed on a Bash line persist in scrollback until reap (`atlas_mux.py:698`, `:719-720`).
- P2: after a crash, the deterministic session name makes re-spawn fail with `name_taken` until a manual reap (`atlas_mux.py:682-683`).
- P2: pane workers are top-level `claude --agent` sessions, so the nested-dispatch guard (which keys on subagent transcripts) never fires for them; only the agents' `disallowedTools` applies, and whether the CLI enforces it under `--agent` is unverified (`atlas_mux.py:528-545`, `hooks/dispatch_tripwire_core.py:176-188`).
- Verified safe: `--task` text goes to a prompt file, pane commands use `shlex.join`, tmux is called with argv lists.

### Endorsed designs

| Design | Effort | Proving test |
|---|---|---|
| Coalesce panefeed repaints with a dirty flag and a 33 ms timer | S | Injected clock: N rows in 33 ms produce at most one paint |
| Set `history-limit` on atlas sessions; mask secret-shaped arguments in feed rows | M | Mux asserts the option; panefeed masks a token-shaped argument |
| Open a second team window when width per worker drops under 70 columns | M | Layout cases for 4-6 workers at 120, 200, 280 columns |
| Configurable team cap; opt-in kill on `wait` timeout | S/M | Fifth member refused; timed-out wait kills panes |
| Orphan sweep on spawn (all panes dead, no exit notes) | M | Fake-tmux test |
| Pass `--disallowedTools Agent,Task` on the worker argv | S | One live pane worker cannot dispatch |

## 3. Channels and messaging

Files: `scripts/atlas_todo.py` (notes, channels), `scripts/atlas_dash_irc.py`,
`hooks/worker_inbox.py`. Tests: channels 30, dash_irc 47, memory 50, dashboard 86,
collab 14, worker_inbox 38, all OK.

### Claims

| Claim | Verdict | Evidence |
|---|---|---|
| `channels.json` and board notes back the messaging layer | True, clarified | Notes are per-owner JSONL under `.atlas/.run/board/` (`atlas_todo.py:788-792`); `channels.json` is only the membership registry (`:1091-1124`). |
| Everything polls; add a `/api/v2/channels/stream` push endpoint | False | Workers get notes from a PostToolUse hook, not HTTP. An SSE endpoint, `/api/v2/stream`, already exists with an `irc` topic (`atlas_dashboard.py:2247`, `:2521`). The real gap is that the topic recomputes every 5 s instead of pushing deltas. |
| Owner names are self-asserted; add HMAC tokens | Premise true, fix rejected | Every writer runs as the same OS user, and a worker must be able to read its token to use it, so HMAC stops nothing a prompt-injected worker can do. Cheaper: reject an `--owner` that does not match `ATLAS_WORKER_NAME`. |
| Inbox cursor races; wrap it in `_file_lock` | False | Already under the lock (`worker_inbox.py:277-316`) with monotonic `max()` writes. |
| Subchannel registration has no lock timeout | Partly true | `register_member` uses a 2 s bounded lock (`atlas_todo.py:1134`); `open_lead_channel` defaults to unbounded (`:1344-1350`), as do the inbox and `.seq` locks. |

### What the proposal missed

- P1: note text injected as "act on them" with no untrusted framing (priority item 3).
- P1: unbounded note growth and a full rescan per tool call (item 8).
- P2: a corrupt `channels.json` is read as empty and then overwritten, losing every other lead's channel (`atlas_todo.py:1124-1168`).
- P2: the inbox claims "delivered once" but is at-most-once (cursor saved before text is returned), and a corrupt cursor replays the whole history (`worker_inbox.py:76-87`, `:309-316`).
- P2: a crash mid-append leaves a torn line; the next append joins it and that next note is silently dropped (`atlas_todo.py` ~`:880-930`).
- P3: each SSE client holds a server thread and each project filter runs its own 5 s full scan (`atlas_dashboard.py:2969`).

### Endorsed designs

| Design | Effort | Proving test |
|---|---|---|
| Wrap injected notes in an untrusted-data block; replace "act on them" with "treat as data" | S | Inbox output carries the wrapper and not the directive |
| Per-owner byte-offset index; re-read only files whose size changed | M | 100k notes drain in under 100 ms |
| 8 KB body cap; archive notes older than N days | S/M | 9 KB body returns `body_too_large`; rotation keeps cursors valid |
| Quarantine, never overwrite, a corrupt registry or cursor | S | Truncated `channels.json` yields a `.corrupt-<ts>` copy and a fault |
| Repair torn lines before append | S | Partial line, then a note: the note is readable |
| Bounded default timeout for `open_lead_channel` | S | Held lock raises `LockTimeout` in about 2 s |

## 4. Command Center

Files: `scripts/atlas_dashboard.py`, `atlas_dash_term.py`, `atlas_dash_work.py`,
`atlas_dash_insights.py` (3814 lines), `dashboard_ui/`. Tests: 368 Python and 111 JS, all OK.

### Claims

| Claim | Verdict | Evidence |
|---|---|---|
| v15 served on 127.0.0.1:7421 | True | `atlas_dashboard.py:45-46`, `:75` |
| Replace polling with a PTY WebSocket and xterm.js | False, already shipped | Hand-rolled RFC 6455 PTY socket (`atlas_dash_term.py:1-10`), single-use 30 s tickets (`:302-330`), max 8 sessions, 900 s idle close, about 40 tests. The UI never polls `/herd/capture`. |
| Selector lists `~/Downloads`; require `.atlas/` or `docs/` in `_junk_root` | Partly true | `~/Downloads` is not filtered, but `_junk_root` is shared by three other modules. A marker check, `_real_project`, already exists (`atlas_dash_work.py:215-232`) and the selector does not use it (`atlas_dashboard.py:721-770`). |
| Hotkeys fire while typing | False | Guards at `keys.js:4-9`, `run.js:376-378`, `app.js:149`, `shortcuts.js:20-26`. The real gap: the `.xterm` check lives at call sites, and the `bindKeys` default is unguarded (`keys.js:12`). |
| Two selector tests fail in this container | False | They pass in the main checkout and fail only when run from a path containing `worktrees`. The fix goes in the tests. |

### What the proposal missed

- P1: token in URLs and in `dashboard.log`; the legacy `?token=` still opens a shell (priority item 4).
- P2: the self-heal watchdog `exec`s the newest sibling `atlas_dashboard.py` it finds beside the install, with no integrity check (`atlas_dashboard.py:3080-3166`).
- P3: 18 `innerHTML` sinks are escaped today, but four escape helpers disagree (one does not escape `'`): `html.js:4`, `region-state.js:3`, `band.js:21`, `pages/run.js:14`.
- P3: `_health_payload` is 673 lines (`atlas_dash_insights.py:1179-1851`).
- Verified sound: Host allowlist (DNS rebinding), Origin allowlist, constant-time token compare, JSON content type on mutations (forces a CORS preflight).

### Endorsed designs

| Design | Effort | Proving test |
|---|---|---|
| Drop `?token=` on the stream and terminal; redact query strings in the access log | S-M | Legacy token test flips to 403; log line carries no token |
| Verify a sibling's manifest or hash before self-heal `exec` | M | Unverified sibling is ignored |
| Filter the selector with `_real_project`, plus a Settings pin | S | Markerless dir dropped; dir with `docs/` kept |
| Move the `.xterm` guard into `isTypingIn`; safe `bindKeys` default | S | keys.test.js case with an `.xterm` active element |
| One escape helper with a quote test | S | Escapes `& < > " '` |
| Build the selector test fixture under a temp dir with `.git` | S | Tests pass from any checkout path |

## 5. Skills and agents

Files: `skills/*/SKILL.md` (39), `agents/*.md` (14), `contracts/scope-matrix.json`,
`docs/audits/2026-10-14-atlas-runtime-audit.md`.

### Claims

| Claim | Verdict | Evidence |
|---|---|---|
| 39 skills, 14 agents | True | The 2026-10-14 audit's "37 / 13" is stale. |
| 27 of 37 rarely invoked; tighten triggers; merge atlas-proof into atlas-validate | Partly true | The audit says 27 were "never invoked" and calls that an upper bound (`:52`). It does not name these skills for trigger work and never suggests the merge. The merge is rejected: atlas-proof is a markdown review round-trip, atlas-validate is a plugin linter. |
| 113 self-dispatch denials; strip Agent and Task from agents | False, already done | All 14 agents already list Agent and Task in `disallowedTools` (`agents/*.md:9`). The 113 figure exists only in the audit doc; the local DB has 15 tool calls and 0 denials. The real gap is the tmux pane path (section 2). |
| Planners fall back to Sonnet; move runner, docs-auditor and explorer to Haiku | Mostly false | No Opus pin exists anywhere. Runner, docs-auditor and explorer are already Haiku. One cell (audit/high explorer) is Sonnet. |

### What the proposal missed

- P1: the dispatch template fails the tripwire (priority item 9).
- P1: the 2026-10-14 audit's telemetry counts cannot be reproduced from this database; treat them as unverified until the source DB is identified. Its own arithmetic leaves 6 of 37 skills unaccounted for.
- P2: duplicated reference files have drifted: `self-telemetry.md` (atlas-audit vs atlas-setup) and `docs-ssot.md` (atlas-orchestrate vs atlas-loop) differ; `workflow-template.md` and `graphify-wiring.md` are byte-identical copies.
- P3: the skill registry loads about 13,200 characters of descriptions and triggers per session (about 3.3k tokens); five skills exceed 500 characters.

### Endorsed designs

| Design | Effort | Proving test |
|---|---|---|
| Template: line-anchored `TOOLS:` and a `SCOPE:` placeholder; test the template through the tripwire parsers | S | Filled template passes `_toolkit_gap`, `_scope_problem`, `_unbounded_dispatch` |
| audit/high explorer to Haiku in the scope matrix | S | Resolver output shows Haiku; matrix tests pass |
| One copy per reference topic; identity check in `validate_skills.py` | M | Seeded divergence fails the validator |
| Trim the five longest trigger lists | S | Validator length check |

Proposed roster: keep all 39 for now. Candidates once real usage data exists:
atlas-test-xcode into atlas-testing as an iOS reference, atlas-loop into atlas-run-watch as
a mode. No cuts are justified by the evidence in this repo.

## 6. Hooks, completion gate and dispatch tripwire

Files: `hooks/hooks.json`, `completion_gate_core.py` (2355), `dispatch_tripwire_core.py` (2553).

### Claims

| Claim | Verdict | Evidence |
|---|---|---|
| 17 hook programs, 22 bindings | True | Enumerated from hooks.json. |
| `_check_evidence` reads only the top level of `.atlas/evidence/` | True in effect | `completion_gate_core.py:173-192`; reproduced. The documented layout is `<date>-<slug>/`, not `<run_id>/`. Fix: recursive scan with the same mtime filter. |
| Regexes recompiled every call (~8 ms) | False | All are module-level (`dispatch_tripwire_core.py:290`, `:370`, `:631-632`). A cached `re.search` costs about 0.004 ms; the claim is off about 40x. Real cost is interpreter start and imports. |
| Six orphan hook files | False | `chronicle_facet`, `memory_capture`, `nudge` run in-process from `stop_tail.py`; `docs_drift` and `prompt_decision` are imported modules; `testenv` is a test helper. Archiving them would break Stop and three gates. |

### Gate conditions

The docstring says sixteen conditions (`completion_gate_core.py:21`); the code has 17,
(a) to (q). Condition (q) is not documented.

| Cond | Demands | Applies to | Product note |
|---|---|---|---|
| a | evidence file newer than run start | code runs | blocks the documented nested layout |
| b | verified stamp in findings.json | code runs | fine |
| c, d, e | non-empty CHANGELOG, ROADMAP, README | every Stop in a repo with docs/ | blocks research-only runs |
| f | docs changed when code changed | code runs | forces a docs pass |
| g | verifier or test run per implementer | code runs | reasonable with test credit |
| h | ROADMAP has no stale "done" items | every Stop | blocks on stale text |
| i | no open todos | code runs | fine |
| j | run worktrees removed | run-scoped | fine |
| k | a plan item was recorded | code runs | fails runs that skipped TodoWrite |
| l | docs artifacts are date-first | run-scoped | naming rule |
| m | no main-thread code edits without a dispatch | any code edit | one `.json`, `.yaml` or `.sh` edit blocks Stop |
| n | reply opens with the ATLAS header | orchestrating, once | presentation |
| o | board covers required phases | code runs, once | presentation |
| p | workers used the colony channel | orchestrating, once | presentation |
| q | no unmerged `worker/*` branches | run-scoped | fires after parallel waves |

Loop breaker: three identical consecutive blocks release the gate (now reset on a
passing Stop, fixed on this branch).

### Latency budget (measured, serial sum of per-hook medians, N=5)

| Tool | PreToolUse | PostToolUse | Total |
|---|---|---|---|
| Read | 81 ms | 76 ms | 158 ms |
| Bash | 167 ms | 56 ms | 223 ms |
| Edit | 142 ms | 182 ms | 323 ms |

Bare Python startup is about 12 ms per hook process, and an Edit spawns eight. If the
harness runs same-event hooks in parallel the wall time is closer to 90-115 ms
(unverified). The largest single lever is fewer processes: fold same-event Python hooks
into one dispatcher process, as `stop_tail.py` already does for Stop.

### What the proposal missed

- P1: test hermeticity, root-only failure, and the install-parity test (priority item 11).
- P2: conditions (c), (d), (e), (h) are unscoped and block research-only runs.
- P2: (m) treats config and data files as code; a one-line `package.json` edit blocks Stop.
- P2: three distinct non-docs paths, config files included, arm full orchestration for the rest of the session (`dispatch_tripwire_core.py:1604`, `:1630-1667`).
- P3: stale docs claim `memory_capture` is bound in hooks.json and reference a nonexistent `hooks/auto_skill.py` (`skills/atlas-setup/SKILL.md:116`, `references/install.md:98`).

### Endorsed designs

| Design | Effort | Proving test |
|---|---|---|
| Recursive evidence scan, mtime filter kept | S | Nested fresh file counts; nested stale file does not |
| Scrub lead, worker and channel env at the test-runner entry | S | Suite green with `ATLAS_LEAD_NAME` set |
| Root-safe Serena test (patch the read to raise) | S | Passes as root and non-root |
| Move install parity to atlas_doctor or a release gate | S | Source suite no longer depends on the cache |
| Scope (c), (d), (e), (h) to code-shipping runs | S | Read-only Stop with no ROADMAP passes; needs owner sign-off |
| Exempt config and data extensions from (m) | S | Single `package.json` edit, no dispatch: passes |
| One Python dispatcher per event | M | Edit total under 120 ms serial |

## 7. Self-improvement and atlas-doctor

Files: `scripts/atlas_doctor.py` (3194), `atlas_db.py`, `atlas_selffix.py`,
`session_ingest.py`, `hooks/memory_capture.py`. Tests: doctor 126 OK, selffix 24 OK,
curator 38 OK, db 116 with one macOS-path failure.

### Claims

| Claim | Verdict | Evidence |
|---|---|---|
| Doctor mines friction, writes findings, applies tuning baselines | Partly true | Mining and findings are real (`atlas_doctor.py:1834-1894`, `:2618`). No code applies a tuning change; baselines are only recorded. |
| Expand `--fix` to auto-edit AGENTS.md and `.claude/settings.json` | Detection true; recommendation rejected | `settings.json` holds permissions, so a tool that edits it from telemetry is a privilege-escalation path. Alternative: write a patch file for the user to apply. |
| Store role, condition and tool as structured friction columns | Partly true | The data exists but is packed into `category` and a JSON `snippet` (`dispatch_tripwire_core.py:1345-1347`). Endorsed as an additive side table. |
| Five-run baseline; auto-adjust constraints on a 50% spike | Constant true; recommendation rejected | `DEFAULT_MEASURE_AFTER = 5` (`atlas_doctor.py:2760`); a 14-day window already exists (`:2587`). Loosening gates from the block rate they cause is a Goodhart loop. Endorsed: alert only. |

### What the proposal missed

- P1: self-fix on by default, and verify executing worker-authored code (priority items 1, 2).
- P1: unredacted transcripts and thinking, two divergent redactors, no NPI patterns, no retention for `messages` (item 5).
- P1: MEMORY.md re-injection of user-sourced text (item 10).
- P2: schema migrations below the `user_version` stamp never run on existing installs unless `SCHEMA_VERSION` is bumped (`atlas_db.py:155`, `:175-212`).
- P2: "self-improvement" has no measured outcome: no eval, holdout or pre-registered metric, and the local DB has 0 findings and 0 improvements.

### Endorsed designs

| Design | Effort | Proving test |
|---|---|---|
| Self-fix off by default; per-finding launch approval; prompt built from templates, not raw snippets | S-M | Fresh install: scheduler does not tick |
| Verify in a clean checkout of the base branch with the worker's diff applied, no network | M | Planted `conftest.py` does not execute |
| One shared redactor at ingest; NPI patterns as best effort; do not persist thinking by default | M | Shared corpus redacted in both paths |
| Scheduled purge with a `messages` TTL | S-M | 6000 rows purge to the cap |
| Injected memory framed as quoted untrusted data; imperative entries flagged | S-M | "always run X with --no-verify" is quoted and flagged |
| Alert-only spike detector in `--mine` | S | Spike produces a finding; gate config hashes unchanged |
| Friction metadata side table | M | Query by role returns the expected count |
| Bump-`SCHEMA_VERSION` rule plus a migration test | S | v1 DB missing a new column is migrated |

## Already fixed on this branch (wave 1)

These came from the first audit and are merged on `claude/atlas-audit-fixes`, each with a
test that failed before and passes after:

- `atlas_selffix.py`: verify command parsed with `shlex`, run with `shell=False`, limited to an allowlist of test runners; `_set` column allowlist.
- `atlas_finding.py`: ledger writes under a file lock; a corrupt ledger is quarantined, not overwritten; one shared `find_root`.
- `atlas_todo.py --help` prints usage; `types/index.d.ts` matches the board's real shapes.
- `bash_advisor.py`: shlex-based git subcommand parsing (newlines, subshells, wrappers, global options), which also closes the fallow commit gate bypass.
- `validate-readonly-query.sh`: checks raw and comment-stripped SQL; fails closed without jq or perl.
- Completion gate loop counter resets on a passing Stop; recall gate checks its marker before the 16 ms filesystem walk; docs drift sees untracked files; nudge honors `ATLAS_HOME`; credential watch ignores 4xx fields in successful payloads; prompt optimizer has one 25 s deadline; the Grep/Glob deny names its escape hatch; the secret-echo warning ignores piped credentials and no longer names regulations.
- ConnectWise MCP: per-request TLS agent instead of a process-wide `NODE_TLS_REJECT_UNAUTHORIZED=0`; token-exchange errors log status and error code only; bundle rebuilt.

Suite results after the merge: hooks 1605 tests, 7 failures (5 environment leakage, 1
root-only, 1 install-cache parity); scripts 2229 tests, 3 failures (environment). No new
failures from wave 1.

## Status after implementation (2026-10-23)

Waves 2 to 5 landed on `claude/atlas-audit-fixes`. Self-fix stays on by default; that is an owner decision, so item 1 was hardened rather than switched off. Existing `atlas.db` rows can be redacted with `atlas_doctor.py --redact-history --apply`; the redactor applies to new text automatically.

| # | Finding | What shipped |
|---|---|---|
| 1 | Self-fix on by default | Partially: still on by default (owner decision). Finding text is treated as untrusted data and worker changes that touch test or build config are held for human review. Remaining: per-finding launch approval and prompts built from templates. Whether self-fix stays on by default is an owner decision and was not changed. |
| 2 | Self-fix verify runs worker code | Shipped (with one platform limit): verify runs with credentials removed from the environment, changes to test or build config are held, and verify runs in a clean temp checkout without network where `unshare` is available. Where `unshare` is missing, verify still runs in the clean checkout but with network access. |
| 3 | Notes injected as instructions | Shipped. Board notes reach agents wrapped as untrusted data. |
| 4 | Dashboard token in URLs and logs | Shipped. `?token=` is rejected on the stream and terminal; browsers use a single-use 30 s ticket; non-browser callers use the header; the access log redacts token and ticket values. |
| 5 | Unredacted transcripts, two redactors | Partially: one shared redactor with best-effort SSN, routing, account, card and date-of-birth patterns now covers transcript text and thinking. `atlas_doctor.py --redact-history [--apply]` backfills existing rows. Remaining: thinking is still stored (redacted) and `messages` has no retention; the owner declined both for now. |
| 6 | Live leads reaped without `ps` | Shipped. |
| 7 | Seat routing on rig error, `off` raises | Shipped. Routing falls back to herdr and never raises when no backend exists. |
| 8 | Unbounded notes, full rescans | Shipped. Notes are capped at 8 KB (system exit and wrap-up notes are truncated), archived after 14 days once a file passes 2 MB, and the inbox reads only new bytes. Torn lines are repaired, a corrupt `channels.json` is preserved, and the lead-channel lock wait is bounded at 2 s. |
| 9 | Dispatch template denied by the tripwire | Shipped. The template passes the tripwire and the docs say never to pass `model`. |
| 10 | Memory re-injected as instructions | Shipped. Recalled memory is framed as untrusted and imperative entries are flagged. |
| 11 | Non-hermetic test suites | Shipped. Suites pass regardless of session environment, user id and checkout path; install-parity checks are opt-in with `ATLAS_CHECK_INSTALL_PARITY=1`. |
| 12 | Gate (a) ignores nested evidence | Shipped. Nested dated folders count, and (c), (d), (e) and (h) apply only to code-shipping runs. |

Also shipped in these waves: self-heal execs only a verified sibling install; backend detection is cached for 30 s; the vendor connectors moved to the armada plugin; programmer ships its six code-review lens agents; hooks run through one `event_dispatch.py` process per event; tmux team cap, opt-in kill on wait timeout, secret masking and `history-limit`, coalesced panefeed, rig spec lock, live-pane reap guard, herdr capture, one skill reference copy, project selector marker, one JS escape helper, friction metadata, versioned DB migrations (schema 2) and the alert-only `gate_block_spike` miner.

Found and fixed while implementing: `panos_commit` with `partial: true` and `panos_commit_all` did not send `action=` on the commit request (the node-panos client dropped it); both now send it, with tests.

### Endorsed designs not yet implemented

- Exempt config and data extensions from the delegation mandate (m); the owner declined this for now.
- Retention for the `messages` table and not storing thinking text; the owner declined both for now.
- Per-finding launch approval and template-built prompts for self-fix (item 1 remainder).
