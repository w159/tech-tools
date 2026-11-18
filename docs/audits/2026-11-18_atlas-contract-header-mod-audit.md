# Atlas audit: operating-contract gates, status header, mods, feature tests

- Date: 2026-11-18
- Atlas version audited: 17.28.1 (source tree `plugins/atlas/`)
- Mode: read-only. No product code was changed.
- Method: 5 explorers + 1 completeness-critic (2 in-process, 4 as tmux team `t6d82af`),
  then one `atlas:verifier` pass over the 12 load-bearing claims. Verdicts are stamped in
  `.atlas/findings/2026-11-18_audit-c*.md`.
- Evidence labels: **V** = confirmed by the verifier or by a command run in this audit,
  **R** = read in code by one explorer, not independently re-checked,
  **U** = host behavior that repo code cannot show.

## 1. Short answers

| Question | Answer |
|---|---|
| Why do dispatches get denied? | Several gates require something the session cannot supply, and two documented rules contradict each other (sections 2.1, 2.2). |
| Why is the header not colored, labeled and branded per phase? | Color and brand exist only in the mod's TUI renderer. Outside an interactive TUI nothing styles the header, and even inside it six of eight phases share one color (section 3). |
| Are the mods disorganized? | Yes, measurably: 54 source files and 201 test files in one flat directory, a 1,720-line wiring file, two glyph tables that disagree, 31 call sites that bypass the theme entry point (section 4). |
| Does every feature work? | The suites are almost green (12,343 tests, 1 failure), but they do not prove skill behavior, four Stop-gate letters, or anything in a live host (section 5). |

## 2. Operating-contract gates

### 2.1 Denials: root causes

| ID | Sev | Evidence | Where | Root cause | Proposed fix |
|---|---|---|---|---|---|
| G1 | HIGH | V (audit-C1) + live | `hooks/dispatch_tripwire_core.py:488-495, 869` | The parallel-explorer exemption from the mux deny applies only when the dispatch carries an explicit haiku/sonnet `model` param. `CLAUDE.md` and the output style tell the lead never to pass `model`. The gate never reads the agent's own `model: haiku` pin (`agents/explorer.md:4`). Passing `model: "haiku"` would be accepted, because the override deny (`:1569`) fires only when the param differs from the pin, but the docs forbid it. A lead that follows the docs can never use the exemption. Live: three explorer dispatches in one message, no `model`; the 2nd was denied, the 1st and 3rd launched. | Exempt by role, reading the agent's pin, not the dispatch param. Then make the docs say one thing. |
| G2 | HIGH | live; cause is a hypothesis | `dispatch_tripwire_core.py:498-545, 831-851` | The same batch gave allow, deny, allow. Verifier's hypothesis, not reproduced: the PostToolUse for the denied 2nd call carries an unrecorded tool_use_id, falls into the `st["open"].pop(0)` branch (`:850`) and frees the 1st worker's slot, so the 3rd passes. If so, any denied dispatch silently releases a running worker's slot. | Pop only a slot whose id matches; add a replay test (PreToolUse x2, PostToolUse with unknown id, PreToolUse). |
| G3 | HIGH | R | `dispatch_tripwire_core.py:914-952, 884-901` | The toolkit deny demands a `TOOLS:` line naming `ToolSearch` and lean-ctx. It is the most frequent deny in local evidence (13 hits vs 1 for spec). lean-ctx was not installed in this session or in any worker; every worker fell back to native Grep/Read. The contract requires naming a tool that is absent. | Require the TOOLS block only when the tool is actually loadable; otherwise accept a native-tools line. |
| G4 | MED | R | `completion_gate_core.py:1244, 630-640` | Stop letters (c,d,e) require CHANGELOG, ROADMAP and README to exist. In a consumer repo without them, every non-docs run blocks. | Scope to repos that already have the file, or make advisory. |
| G5 | MED | R | `completion_gate_core.py:528, 567`; `.atlas/.run/findings.json` | 601 of 725 ledger rows are `verified`, 658 have an empty `verifier` field. Gate (b) rejects self-stamped rows, so legacy rows cannot be re-used as evidence. | Backfill or scope (b) to rows created in the current run and test it. |
| G6 | MED | live | inline-op gate | Reading worker results counted as inline ops: the lead got `STOP - 4 inline ops` and `5 inline ops` nudges while only collecting team output. The gate cannot tell investigation from collection. Each edit to this report under `docs/audits/` also counted, reaching `STOP - 12 inline ops` with nudges only; `CLAUDE.md` says the 7th inline op is denied, so docs and code disagree here too. | Do not count shell calls that only read `.atlas/.run/board/` or `briefs/`, or lead edits under `docs/`. Make the documented deny threshold match the code. |
| G7 | LOW | R | `CLAUDE.md` vs `dispatch_tripwire_core.py:1864-1867` | Docs say to pass a `name` argument on every dispatch. The Agent tool has no such parameter; the hook auto-names instead (this worked in this session). | Fix the docs. |

### 2.2 Worker and team path: live failures seen in this run

| ID | Sev | What happened | Proposed fix |
|---|---|---|---|
| T1 | HIGH | 2 of 4 tmux workers could not write their deliverable file. Explorers run with `--allowedTools ... Read,Grep,Glob` and only two `atlas_todo.py` shell patterns, so `Write`, heredocs and compound commands are refused. One worker spent four attempts on it. | Give read-only workers one sanctioned way to hand back long output (for example `atlas_todo.py report --file -`), and say so in the worker protocol. |
| T2 | HIGH | Board messages are truncated when shown to the lead (`[truncated 5297 bytes]`), and the truncation removes the start of the report. The lead had to parse `.atlas/.run/board/*.jsonl` by hand to read results. | Truncate from the end, and print the path of the full report. |
| T3 | MED | One worker posted "Waiting on the monitor event" as its final `report` while its test run was still going. `atlas_mux.py wait` then blocked past two 9-minute timeouts with no progress output. | Reject a report without `STATUS:`; make `wait` print per-member state on an interval and return on first all-reported. |
| T4 | LOW | R: test output shows `duration_s: 1794975365.8` for team members (an epoch value, not a duration). Not traced to source. | Find the start-time default of 0 in the team summary. |

### 2.3 Performance

| ID | Sev | Evidence | Finding | Fix |
|---|---|---|---|---|
| P1 | MED | V (audit-C7) | `hooks/event_dispatch.py` runs on every tool call (PreToolUse matcher `*`) and again on PostToolUse for read tools: 38-44 ms per run, measured three times. A Read costs about 80 ms of hook time. | Lazy-import gate cores per branch; skip PostToolUse for tools no binding handles. |
| P2 | LOW | V (audit-C7) | `dispatch_tripwire_core` imports `completion_gate_core` eagerly. Cost is 7-14 ms, not the 40 ms first reported. | Move the import into the functions that use it. |
| P3 | LOW | R | `fallow_gate.py` has a 300 s timeout on every Bash call; Stop allows 150 s + 60 s. Typical cost is 12-60 ms, so the timeouts only matter when something hangs, and then the user waits minutes. | Lower to the measured worst case plus margin. |
| P4 | MED | measured | Test wall time: hooks suite 5 m 10 s (3,302 tests), scripts suite 7 m 18 s (4,834 tests), mod suite 26 s (4,209 tests). A full local run is about 13 minutes, which is why workers stall on it (T3). | Split a fast tier; run the subprocess-heavy tests separately. |

### 2.4 Silent failures

| ID | Sev | Evidence | Where | Finding |
|---|---|---|---|---|
| S1 | MED | V (audit-C4) | `completion_gate_core.py` near 1006 and 863 | An unreadable todo board returns True ("fail open") with no log, and the open-todo count returns 0 on any exception. The gate then reports "no open items". |
| S2 | MED | R | `dispatch_tripwire_core.py:893-901, 146-163` | lean-ctx reachability probe and the verifier-baseline stash are wrapped in `contextlib.suppress(Exception)` with no fault record. |
| S3 | MED | U | host | In this cloud session the harness reported that atlas's `classic.SessionStart`, `classic.MessageDisplay` and `classic.Stop` handlers were skipped because another plugin (`cc-plugin-sec-default`) runs first. If `classic.Stop` covers the completion gate on this host, the gate did not run at all and nothing told the user. To verify: run a session with that plugin disabled and compare. |
| S4 | LOW | R | published telemetry | Block counters exist in code and schema (`contracts/analytics-schema.json:337`, `completion_gate_core.py:2307`), but `telemetry/reports/2026-W46.json` shows only `gate.pass`. Either no block was reported that week or the report drops the keys. Not resolved. Dispatch deny codes are not counted in analytics at all (V, audit-C6); they go only to local `atlas.db` friction rows, so denial frequency across installs is unmeasured. |

Rejected on verification and dropped: "completion gate import failure is invisible"
(it emits a visible systemMessage, `completion_gate.py:29-37`); "`_findings_count`
fallback lets the verdict check pass" (it makes the check fire, not pass);
"recall gate is dead code" (it is wired through `event_dispatch.py:62`).

### 2.5 Vulnerabilities

No HIGH finding. bandit is not installed, so this was a manual review.

| ID | Sev | Evidence | Where | Finding | Fix |
|---|---|---|---|---|---|
| X1 | LOW | V (audit-C12) | `hooks/bash_advisor.py:485` `_match_git_commit` | The matcher misses `g=git; $g commit`, `echo git commit \| sh`, `find -exec git commit`, and `python3 -c "os.system('git commit')"`. Its only confirmed caller is a once-per-session review nudge (`:505`), so the confirmed impact is a skipped nudge. Whether `git_guard.py` (which imports `bash_advisor` at `:207`) has the same blind spots for protected-branch commits and pushes was not checked. | Check `git_guard.py` with the same four commands; if it misses them, enforce in real git pre-commit/pre-push hooks. |
| X2 | MED | R | `scripts/atlas_dashboard.py:2526-2584`, `scripts/atlas_dash_term.py:449-453` | The dashboard token is embedded in `GET /` and only Host/Origin are checked. Another local user on a shared host can read it and open the pty shell as the owner. Not reproduced. | Unix socket or 0600 token file, or check peer uid. |
| X3 | MED | R | `colony/herdr-web-ui/server/access.ts:93` | A loopback request with no proxy headers gets full access with no token. Same local-user exposure. | Require a token by default. |
| X4 | MED | R | 43 `additionalContext` emitters in `hooks/` | Only three files fence injected text as untrusted. Recalled prompts (`session_boot_core.py:688-704`) and peer notes reach the lead's context. | Wrap all recalled and peer text in a data-not-instructions block. |
| X5 | LOW | R | `hooks/prompt_optimizer_core.py:240-270` | Posts the user prompt to `ATLAS_OLLAMA_URL`/`OLLAMA_HOST` with no loopback check; `prompt_decision.py` has the check. | Reuse `_is_loopback`. |
| X6 | LOW | R | `hooks/validate-readonly-query.sh:44` | Keyword denylist; `ALTER SYSTEM`, `DO` blocks, `pg_terminate_backend`, `dblink_exec` look unmatched. Not run. | Run DB audits under a read-only role. |
| X7 | LOW | R | `atlas_todo.py:1120`, `session_boot_core.py:528-531, 565` | Note files 0644; session id used in a path unsanitized in one place. | 0600; reuse the existing sanitizer. |

## 3. Status header

### 3.1 Why it shows as plain text

1. **Only the mod draws the chip (R, verifier partial).** The output style
   (`output-styles/atlas-orchestrator.md:14`) and the session-boot hook
   (`hooks/session_boot_core.py:352-414`) ask the model for the plain line
   `ATLAS | <glyph> <phase> | <state>`. The completion gate (n)
   (`completion_gate_core.py:3150`) only blocks a reply whose first line does not match. Color,
   the ATLAS brand mark and the phase label come only from `mod/restyle.tsx:254` ->
   `mod/transcript/leadheader.ts:79`, registered through `ui.render AssistantMessage`
   (`restyle.tsx:358`).
2. **That renderer depends on the host firing `ui.render` (U).** The verifier corrected an
   earlier reading: `registerRestyle` (`mod/register.ts:1396`) is not gated on an interactive
   surface in repo code. Whether `ui.render AssistantMessage` fires in cloud, web, SDK or
   headless sessions is a host property this audit could not test. When it does not fire, or
   there is no snapshot, the handler passes through and the header stays as the model typed
   it. There is no markdown fallback. To verify: an `atlas:ui-runtime-tester` or headless run.
3. **There is no per-phase color even when the mod runs (V).** `leadheader.ts:63` `leadTone`
   has three tones: done, blocked, and one accent shared by research, theory, test, validate,
   implement and verify.
4. **The streaming rewrite is plain by design (R).** `classic.MessageDisplay`
   (`restyle.tsx:445` -> `leadheader.ts:44`) rewrites the line without color
   (`leadheader.ts:42`), and on this host it was skipped anyway (S3).
5. **Grammar drift (V, audit-C9).** The gate takes the first non-empty line, stripped; the
   mod takes the literal first line, unstripped. A leading blank line or space passes the
   gate and gets no chip. The contract regex (`contracts/operating-contract.json:14`)
   requires a glyph; `leadheader.ts:25` makes it optional. All patterns are case-sensitive.
6. **Three copies of the phase glyph table (R).** `operating-contract.json:4-11` is the
   source; `leadheader.ts:21` and `session_boot_core.py:353` hold inline copies, and the
   session-boot text prints `phase glyph` while the template says `<glyph> <phase>`.

### 3.2 Fixes, in order

| # | Change | Owner file |
|---|---|---|
| H1 | Add a phase table (glyph, label, tone) to `operating-contract.json` and generate every copy from it. | `contracts/operating-contract.json`, `mod/contract-pattern.ts` |
| H2 | Give each of the eight phases its own tone in `leadTone`, from H1. | `mod/transcript/leadheader.ts` |
| H3 | Markdown fallback for surfaces without a TUI: have the output style ask for a bold `**ATLAS**` mark and a fixed-case phase label, and accept that form in the gate. Markdown cannot carry color; brand and label can still be consistent. | `output-styles/atlas-orchestrator.md`, `completion_gate_core.py` |
| H4 | One header parser shared by gate and mod (same strip and blank-line rule), pinned by a shared corpus test in Python and TypeScript. | `hooks/test_atlas_contract.py`, `mod/contract-pattern.test.ts` |
| H5 | At session start, say once when the mod is inactive and why (no TUI, handler skipped, plugin not registered). | `hooks/session_boot_core.py`, `scripts/atlas_doctor.py` |

## 4. Mods

### 4.1 Measured state

- 352 files under `plugins/atlas/mod`; 257 in the root directory. 93 non-test sources
  (54 flat), 244 test files, 57,723 lines.
- God files: `register.ts` 1,720 lines / 62 functions / 44 imports; `panel-layout.ts`
  1,650 / 57 exports; `hud-surface.ts` 941; `mission-layout.ts` 827.
- Test files are named after review rounds, not subjects: `critique17-a`, `idle-polish2`,
  `idle-polish3`, `wave35-panel`, `r2-panel`, `hud39`, `hud40`, `board40`, `layout28`,
  `cards26`, `truth29`, `y1-data`, `merge40`.
- `mod/TESTING.md:22-48` says 605 tests in 49 files at atlas 17.1.0. Measured: 4,209 tests
  in 244 files (4,178 pass, 31 skip, 0 fail, 26 s).

### 4.2 Design findings

| ID | Sev | Evidence | Where | Finding |
|---|---|---|---|---|
| M1 | HIGH | V (audit-C10) | `mod/atlas-ui.ts:272` vs `:426` | Two state-glyph tables disagree: done is `●` in one and `✓` in the other, queued `◇` vs `○`. The same state looks different on band, HUD and board. |
| M2 | HIGH | V (audit-C10) | `mod/look.ts:1-3` | It says every surface takes its theme from one read. 31 call sites call `uiFromEnv` directly (band.tsx, transcript/cards.tsx, todo-panel.tsx, mission-layout.ts, motion.ts, core-row.ts), nearly all as `x ?? uiFromEnv()` fallbacks or default parameters. NO_COLOR and ASCII handling can differ per surface whenever a caller omits the argument. |
| M3 | HIGH | R | `mod/register.ts` | One file holds atoms, the poll loop, agent parsing, toast glue and hook registration. It is the second most-changed file in the plugin (17 commits in 180 days). |
| M4 | MED | V (audit-C11) | `mod/band-frame.ts:14` <-> `mod/status-frame.ts:11` | Runtime import cycle (value imports both ways). The uses seen are inside functions, so it loads today, but a top-level use would break it. The gates/sidebar/runstate loop has one type-only edge and no runtime cycle. |
| M5 | MED | R | `theme.ts:176, 236-237`, `mission-layout.ts:27`, `motion.ts:354`, `board-model.ts:309, 495` | Hex colors defined outside the token file, some duplicating existing tokens. `theme.ts:2` says it draws no color. |
| M6 | MED | R | `discipline.ts:64`, `tabs-frame.ts:334`, `notify.ts:92`, `status-frame.ts:349` | Missing data prints `unknown` or a dash with no stale marker. |
| M7 | MED | R | `mission-layout.ts`, `panel-layout.ts`, `hud-surface.ts` | Worker and phase tallies are computed three times. |
| M8 | LOW | R | `band.tsx:318-320` | A blank key row is kept under 80 columns. |

Not established: whether 256-color terminals get correct colors (`theme.ts:241-242`
maps x256 to truecolor hex; `paintAnsi` at `atlas-ui.ts:225` was not read), and where
sounds and slash commands are registered.

### 4.3 Proposed layout

No file was moved. Moves need the owner's go-ahead because of the file-sync risk.

| Target | Contents |
|---|---|
| `mod/host/` | `register.ts` split into atoms, poll loop, agent parsing, hook registration; `discipline.ts`, `hook-log.ts`, `gates.ts` |
| `mod/data/` | existing readers plus `idle-health.ts`, `metrics.ts`, `history.ts`; one shared tally module (fixes M7) |
| `mod/design/` | `tokens.ts` (all colors), `glyphs.ts` (one state table, phase table generated from the contract), `env.ts`, `look.ts` as the only entry point |
| `mod/view/band/` | `band.tsx`, `band-frame.ts`, `band-motion.ts`, `mission-layout.ts` |
| `mod/view/hud/` | `hud.ts`, `hud-surface.ts`, `status-frame.ts`, `card-frame.ts` |
| `mod/view/panel/` | `pane/`, `panel-layout.ts` split into tabs, cards/toasts, body rows; `tabs-frame.ts` |
| `mod/view/board/` | `board-model.ts` |
| `mod/view/transcript/` | `transcript/`, `restyle.tsx` |
| `mod/motion/`, `mod/input/` | `motion.ts`, `fx/`; `intents.ts`, `routing.ts`, `clickable.ts` |
| tests | beside their source, named for the subject; round-named files merged into them |

### 4.4 UX changes ranked by user impact

1. One glyph per state everywhere (M1).
2. Per-phase color and label from one table, shared by header, band, HUD and tabs (H1, H2).
3. One theme read, so NO_COLOR and ASCII behave the same on every surface (M2).
4. A shared empty, error and stale state for band, HUD and panel in place of `unknown` and dashes (M6).
5. One tally source so band, HUD and panel never disagree on worker counts (M7).
6. A visible "mod inactive" line when the surface cannot render (H5).
7. Verify and fix 256-color mapping.
8. Remove the dead narrow-width row (M8).
9. Check emoji phase glyph width at 80 columns.
10. Rewrite `mod/TESTING.md` from measured numbers and add a CI typecheck (`CHANGELOG.md:8-9` records 82 tsc errors at an earlier baseline with no CI check).

## 5. Feature and test status

| Suite | Command | Result |
|---|---|---|
| hooks | `python3 -m unittest discover -s plugins/atlas/hooks -p 'test_*.py'` | 3,302 run, OK, 4 skipped, 310 s |
| scripts | `python3 -m unittest discover -s plugins/atlas/scripts -p 'test_*.py'` | 4,834 run, **1 failure**, 1 skipped, 438 s |
| mod | `cd plugins/atlas && bun test mod` | 4,209 run, 4,178 pass, 31 skip, 0 fail, 26 s |
| doctor | `python3 plugins/atlas/scripts/atlas_doctor.py` | 29 pass, 6 warnings, 0 failures |
| skills | `validate_skills.py`, `atlas_skillgraph.py check` | 40/40 pass; 0 ungated remote steps |
| team resolve | `atlas_resolve.py` for 9 classes x 3 efforts | 27/27 return a non-empty team |

Failing test: `test_tmp_hygiene.TmpHygieneTests.test_product_marker_dirs_default_under_it`
(`plugins/atlas/scripts/test_tmp_hygiene.py:43`): `CONTRACT_GATE_MARKER_DIR` is not under
the session temp directory. Cause not traced; it may depend on this environment.

What the green suites do not prove (completeness-critic, 68 README and docs claims checked):

| Gap | Detail |
|---|---|
| Skill behavior | 40 skills are checked for structure and names only. Nothing tests what any skill does. |
| Stop-gate letters o, p, q, s | No direct block-path test. (s) is the tmux-routing guarantee. |
| Agents | 11 agents share one conformance test; none has its own. |
| Live host | Mod load rules are tested against a shim; clicks are "checked in a real session" per `mod/TESTING.md:93-94`. omp live parity and `claude --bg` provider env are self-declared unverified. |
| Published numbers | Crew benchmarks, hook latency (289 -> 174 ms), verifier catch rates and the 84/86 router score have no pinning test. The router currently scores 84/86. |
| Docs | `mod/TESTING.md` is 27 minor versions stale. |
| Not examined in this audit | `colony/` internals, `omp/`, `scripts/dashboard_ui`, per-skill reference links, lock races, `atlas_finding.py` id paths. |

## 6. Suggested order of work

1. G1, G2, G3: make the dispatch gates satisfiable and deterministic. These cause most denials.
2. T1, T2, T3: fix the worker hand-back path. Every team run pays for these.
3. H1-H5: header phase table, per-phase tone, markdown fallback, shared parser.
4. M1, M2: one glyph table, one theme read. Small, visible, low risk.
5. S1, S2, X4: log the fail-open paths; fence injected text. Check `git_guard.py` (X1) and count dispatch denies in analytics (S4).
6. Mod reorganization (4.3) in small moves, one directory per change, tests moved with sources.
7. Tests for gate letters o, p, q, s and at least a smoke test per skill; fix `test_tmp_hygiene`.
