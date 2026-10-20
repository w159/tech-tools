# Atlas feature audit and improvement plan
Date: 2026-10-20
Owner: docs-curator (synthesis of eight audit reports)
Goal: record what the 2026-10-20 audit found across atlas features and harnesses, and give the orchestrator a staged plan with one failable check per stage.

Source reports: `.atlas/.run/audit-2026-10-20/` (w1-style-contract, w1-skills-agents, w1-mux-tui, w1-colony-webui, claims, test-baseline, w2-planner-stage-map, w2-critic-gaps). All paths below are relative to `plugins/atlas/` unless stated. This is a read-only audit: nothing shipped, so CHANGELOG and ROADMAP are untouched.

## 1. Summary

Audited at HEAD 1ca3d15e (atlas 12.5.13) by four atlas:explorer agents (sonnet/low), one atlas:planner (sonnet/low), one atlas:completeness-critic (sonnet/low), plus a test-baseline run and a claims inventory. The critic's re-runs corrected several first-wave findings; this document uses the corrected values.

| Feature | Verdict |
|---|---|
| Output style | Works on Claude Code (CC). Length budget unenforced; gates (n) and (o) undocumented. omp receives it by runtime translation. |
| Operating contract | Three copies of the header string; omp has a divergent second contract. Real drift: gate (p) test fails. |
| Skills | 39 skills, 309,529 chars. Orchestrate loads about 46.5 KB per invocation despite its own load-on-trigger rule. |
| Agents | No tiering: all 14 are sonnet/low; docs promise haiku and medium. Model override hard-denied. |
| atlas-mux | No crash found in tmux paths. One ghost-member ordering risk in cmd_spawn. herdr and codex-worker paths unaudited. |
| atlas-tui | 0 of 7 prior defects fixed; 4 crash on a seat without a name. Test suite errors are order pollution. |
| atlas-colony | Docs contradict each other on what the colony is. Codex-binding bun tests need a live herdr; one possible regression. |
| Command center web UI | Dashboard serves and its suites pass (345 + 45). Client swallows fetch errors with no stale marker. |

| Harness | Verdict |
|---|---|
| Claude Code | Covered; gates enforce. Install cache not inspected. |
| omp | Partly covered. Doctor FAIL (omp 12.5.8 vs plugin 12.5.13) is install state. No omp test script wired. |
| codex | No style, contract, hooks, skills or agents. Gets telemetry ingest, TUI visibility, herdr rollout binding only. |

## 2. Dispatch-gate friction observed during this audit

1. Name gate denied unnamed dispatches without auto-naming. Source has autoname on by default (`hooks/dispatch_tripwire_core.py:1297` ATLAS_AUTONAME default "on", `_inject_name` :2079-2100); the deny at :1302-1310 should fire only when autoname is off. The denies still happened. Probable cause: the installed plugin cache predates the autoname block. [unverified; the cache is read-denied]. Also, autoname runs only after every other gate passes (`_PENDING_AUTONAME` :1300), so any other deny (toolkit, scope, model, spec) returns an unnamed deny and the retry repeats the gap. The Agent tool schema exposes no `name` argument, so a caller cannot satisfy an older hook.
2. Undocumented REPORT: block gate. `REQUIRED_SPEC_BLOCKS` (`hooks/dispatch_tripwire_core.py:69-76`) requires six labels: GOAL, DELIVERABLE(S), SUCCESS CRITERIA, OUT OF SCOPE, STOP CONDITIONS, REPORT. Body must be non-empty (:595-598), exactly one GOAL (:581-589). `DEFAULT_REPORT_LINE` (:747) is auto-injected only when REPORT is the single missing block and goal count is 1 or less (:1330-1336). Project `CLAUDE.md` "Session gates" lists only name, TOOLS and SCOPE. Which REPORT denies came from multiple missing blocks or a double GOAL is [unverified].

## 3. Findings by feature

Severity: high, med, low, info. Harness: CC = Claude Code.

### 3.1 Output style

| FINDING | SEVERITY | file:line | evidence | harness |
|---|---|---|---|---|
| 12-line length budget unenforced | med | output-styles/atlas-orchestrator.md "Length budget" | no check in completion_gate_core.py or stop_tail.py; text only | CC, omp, codex |
| Status header (n) enforced on final reply only | low | hooks/completion_gate_core.py:2108,2140; hooks/session_boot_core.py:379 | style says "every substantive reply"; gate checks the final reply's first line | CC, omp |
| Style body carries omp parentheticals | low | output-styles/atlas-orchestrator.md:124,138 | omp waives ToolSearch but receives the ToolSearch+serena rule | CC, omp |
| Header rule injected 2-3 times | low | hooks/session_boot_core.py:379,383; omp/style.ts:185-201 | style body plus boot plus omp fallback | CC, omp |
| Style reaches omp by runtime translation | info | omp/style.ts (registerStyle), kill switch :247 | before_agent_start appends stripped body to main prompt; runtime proof [unverified] | omp |
| Style cost 9,151 chars every turn | med | output-styles/atlas-orchestrator.md | 898 chars more on omp (omp/lead-addendum.md) | CC, omp |

### 3.2 Operating contract

| FINDING | SEVERITY | file:line | evidence | harness |
|---|---|---|---|---|
| Gates (n) and (o) undocumented | high | hooks/completion_gate_core.py:1246,2108,2163 | 0 hits in skills, output-styles, omp/lead-addendum.md, docs; (p) 5 files, (q) 2 | all |
| Gate (p) test fails deterministically: real gate or test drift | high | hooks/test_completion_gate.py:499 (_seed_report_notes) | test_implementer_dispatch_with_no_diff_does_not_block_condition_g fails in isolation; block reason "(p) Colony channel ... carried nothing"; which side is wrong unread | CC |
| omp lead addendum contradicts the CC TOOLS rule | high | omp/lead-addendum.md (loaded omp/style.ts:28) vs CLAUDE.md | omp: lean-ctx via xd://, no serena; CC: TOOLS line with ToolSearch and serena | CC vs omp |
| Header string built in 3 places | low | hooks/session_boot_core.py:379,383; hooks/completion_gate_core.py:2140; omp/style.ts:201 | contracts/operating-contract.json claimed SSOT (completion_gate_core.py:97) | CC, omp |
| Gate letters (f),(i),(j) exist only as inline comments | low | hooks/completion_gate_core.py:1171,1190 | no standalone definition | CC |
| Parity doc header stale | low | docs/atlas-harness-parity.md:3 | says atlas 10.4.3 / omp 18.8.6; source 12.5.13; Gate (q) omp marked [unverified] | omp |
| Doctor "mark_orchestrating" check wording names the shim | low | scripts/atlas_doctor.py:300-308 | call lives in hooks/dispatch_tripwire_core.py:1475 and hooks/prompt_optimizer_core.py:510; message fires only when the installed tree lacks it | CC, omp |
| Doctor omp version FAIL is install state | med | scripts/atlas_doctor.py:517-520 | omp runs 12.5.8, plugin 12.5.13 (.claude-plugin/plugin.json:3); fix is reinstall, not source | omp |
| Codex has no contract path | high | .codex/config.toml; .codex/environments/environment.toml | no hooks, instructions file or style injection | codex |
| LEDGER fallback only partly gated | low | output-styles/atlas-orchestrator.md:21,94-97; hooks/completion_gate_core.py:73 | style says fallback only | CC, omp |
| Completion gate re-checks at stop matches code | info | output-styles/atlas-orchestrator.md:64 | omp via stop-bridge (stop-bridge.test.ts:537) | CC, omp |

### 3.3 Skills

| FINDING | SEVERITY | file:line | evidence | harness |
|---|---|---|---|---|
| Orchestrate loads about 34 KB of references unconditionally | high | skills/atlas-orchestrate/SKILL.md:56,62,68 | laws-and-gates 9,948 B, the-loop 17,029 B, squad-and-tiers 6,847 B, contradicting :43 "load on trigger"; with SKILL.md 12,730 B about 46.5 KB per invocation | CC |
| Skill corpus size | med | skills/*/SKILL.md | 39 skills, 309,529 chars; atlas-setup 13,176, atlas-doctor 12,821, atlas-compound 12,767; orchestrate references 293,847 across 29 files | CC |
| Eight skills show no script or hook reference | low | atlas-autopilot, atlas-debug, atlas-explain, atlas-frontend, atlas-loop, atlas-prompt, atlas-readme, atlas-refactor | heuristic; may be prompt-only; promise-vs-implementation unchecked | CC |
| omp skill loading untraced | info | n/a | not read in any report [unverified] | omp |

### 3.4 Agents

| FINDING | SEVERITY | file:line | evidence | harness |
|---|---|---|---|---|
| Every agent is sonnet/low | high | agents/*.md:4-6 | 14 of 14; implementer included, though squad-and-tiers.md:76 says medium | CC |
| Docs promise haiku, files say sonnet | high | skills/atlas-orchestrate/references/squad-and-tiers.md:16,47 vs agents/runner.md:4 | runner, schema-inventory, docs-auditor, naming-glossary-audit | CC |
| Model override hard-denied, no escape hatch | high | hooks/dispatch_tripwire_core.py:1047-1075, deny :1312-1323 | only exact pin, role alias or parent model accepted; non-atlas subagent_type exempt (:1056-1057) | CC, omp via bridge |
| Doc names an override the gate denies | med | squad-and-tiers.md:16 vs hooks/dispatch_tripwire_core.py:1061 | `Agent(model:"haiku")` shown | CC |
| Resolver effort changes neither model nor thinking | high | contracts/scope-matrix.json:2; scripts/atlas_resolve.py:25-42 | resolver echoes the matrix cell; effort pinned to frontmatter | CC, omp |
| Matrix and docs disagree on implementer effort | med | contracts/scope-matrix.json (implement/medium) vs squad-and-tiers.md:76 | matrix lists implementer effort "low" | CC |
| audit/high spawns a DB seat for any audit | med | contracts/scope-matrix.json audit/high; class_aliases :4 | review, research, explore, investigate alias to audit and inherit rls-privilege-audit | CC, omp |
| CLAUDE.md under-documents the dispatch contract | med | CLAUDE.md "Session gates" | tripwire also enforces six spec blocks, single GOAL, runner STEPS: (subagent-kit.md:22), model_override, builtin_agent block (~:1285), channel step | CC |
| omp thinking union closed to off or low | med | omp/atlas-agents.ts:32; omp/agents/*.md:6-7 | no medium or high; model fallback lists per role | omp |
| Nested dispatch guard present | info | hooks/dispatch_tripwire_core.py:176,2006,2245,2313-2315 | _in_subagent skips inline-op deny tier | CC |
| No agent or skill mirror for codex | med | .codex/ | config.toml and environments/ only [unverified that no gate fires] | codex |

### 3.5 atlas-mux

| FINDING | SEVERITY | file:line | evidence | harness |
|---|---|---|---|---|
| cmd_spawn registers a member before the tmux step | med | scripts/atlas_mux.py:1070 (register_member) before failure check ~:1150-1153 | an exception between leaves a ghost member; leave() runs only on handled failure | tmux |
| Broad `except Exception` swallows | low | scripts/atlas_mux.py:250,1414,1433,1695 | unreachable backend becomes silent fallback | tmux |
| tmux missing handled in mux | info | scripts/atlas_mux.py:213-232, :260 | rc 127 "tmux not found on PATH"; transport falls back to claude-bg | tmux |
| cmd_kill on missing session | info | scripts/atlas_mux.py:1505+ | ok:true, killed:false | tmux |
| Not covered: herdr transport, cmd_run_worker past ~:1235, _open_window, atlas_seats.close_run | info | n/a | no report read them [unverified] | herdr, codex |

### 3.6 atlas-tui

Tests: the 6 `test_atlas_tui` errors and 1 failure in the baseline are order pollution, not hard failures. Isolated runs pass (Render.test_topology_tree; FirstPaint plus Effects, 7 tests OK). The curses "loaded only once" cause is unproven. `test_sweep_state` fails on `import pytest` (:13), an environment gap (no pytest on Python 3.15.0).

| FINDING | SEVERITY | file:line | evidence | harness |
|---|---|---|---|---|
| Seat without "name" crashes hitmap | high | scripts/atlas_tui.py:1006 | probe KeyError | tui |
| Seat without "name" crashes _seat_target, click open, _table health | high | scripts/atlas_tui.py:1213,1118,405 | probe KeyError; attach and once use .get (:1487,:1907) | tui |
| None name, description, channels, session crash list views | med | scripts/atlas_tui.py:767,784,807 | TypeError on width format specs | tui |
| Unknown tab KeyError | med | scripts/atlas_tui.py:871-878 | argparse limits --tab, ui state is not limited | tui |
| render vs hitmap body-height mismatch | med | scripts/atlas_tui.py:933 (height-5) vs :967 (height-6) | click rows drift one line | tui |
| "term" attach branch has no try | med | scripts/atlas_tui.py:1769 vs :1775-1778 | a raise from attach_argv kills curses after endwin() | tui |
| Mid-loop capture() | low | scripts/atlas_tui.py:1666 | downgraded: capture() returns "" on rc!=0 and _tmux catches OSError and SubprocessError (scripts/atlas_colony_model.py:79-86,:103-106); non-tmux raise paths unread | tui |
| Seat attach ignores exit code | low | scripts/atlas_tui.py:1503,1507 | status says "returned from X" even if tmux failed (:1771,1780) | tui |
| OSC 7717 field injection | low | scripts/atlas_tui.py:1150 | unescaped cid and seat; only when ATLAS_TUI_BRIDGE=1 (:1157) | tui |
| Per-seat wall capture unguarded | low | scripts/atlas_tui.py:713 | no per-seat guard in refresh_wall | tui |
| Compact-layout "60x18" claim consistent | info | scripts/atlas_tui.py:33,1670; CHANGELOG.md:112 | MIN_W, MIN_H = 60, 18 | tui |
| Prior-defect re-check | high | see rows above | 0 of 7 prior (Oct 19) defects fully fixed; file grew 1282 to 1958 lines | tui |

### 3.7 atlas-colony

| FINDING | SEVERITY | file:line | evidence | harness |
|---|---|---|---|---|
| Docs contradict on what the colony is | high | skills/atlas-orchestrate/references/dashboard-api.md:144 vs docs/atlas-colony.md:68, CHANGELOG.md:8 | "colony is herdr" vs "tmux is the default transport" | CC, omp |
| Codex-binding bun tests fail; live-herdr dependent | high | colony/herdr-web-ui/server/codex-binding.contract.test.ts:7,16-17,66-73,90-95 | opens real herdr workspaces, polls pane text 100x100 ms; 10 s timeouts are environmental (the critic's isolated run touched the live daemon) | codex, herdr |
| One possible logic regression in codex binding | med | colony/herdr-web-ui/server/codex-binding.contract.test.ts:274 | Expected "scrollback", Received "codex-transcript"; may be real or interference from other live codex panes (comment :232); needs a rendering herdr to settle | codex, herdr |
| Two more red herdr tests | med | herdr-web-ui tests | "WebSocket observer-first attach > sizes a PTY ..." (expect toBe); Windows paste test 15.9 s timeout; causes unverified | herdr |
| Red-test count disagrees across reports | low | test-baseline.md vs w1-colony-webui.md | 9 failing (5 codex) vs 10 (8 codex); one is wrong | herdr |
| CHANGELOG 12.5.12 states wrong predicate | med | CHANGELOG.md:14 vs scripts/atlas_todo.py:1142-1149 | "board or git repo" vs `not_a_project_root(base) and is_project(base)` | CC, omp |
| Env opt-outs asymmetric in docs | low | hooks/session_boot_core.py:221,930; docs/atlas-colony.md:70 | ATLAS_COLONY=off undocumented | CC |
| Session-start channel predicate shared | info | hooks/session_boot_core.py:944; scripts/atlas_todo.py:2071 | same function on Claude and omp | CC, omp |

### 3.8 Command center web UI

| FINDING | SEVERITY | file:line | evidence | harness |
|---|---|---|---|---|
| Fetch errors swallowed, no stale marker | high | scripts/dashboard_ui/js/pages/agents.js:27-29; supervision-lens.js:49; terminal.js:267,343-346; overview.js:54 | lead shows zero todos indistinguishable from "no work" | web |
| Reaper PermissionError is log-only | med | dashboard log "reap_tick ... PermissionError(1, 'Operation not permitted')" | reap_tick line unverified; no UI surface | web |
| /api/v2/health body vs docs | low | skills/atlas-orchestrate/references/dashboard-api.md:176 | silent_failures and successes not seen in first 500 bytes [unverified] | web |
| Colony endpoint path confusion | low | scripts/atlas_dash_colony.py:956-962 | /api/colony 404; real routes /api/v2/colony (token-guarded), /api/v2/herd/colony | web |
| Plan file names never shipped | low | docs/plans/2026-10-13-atlas-command-center-redesign.md:113+ vs mod/pane/* | shipped under renamed files (mod/pane/sidebar-team.tsx:147, sidebar-channel.tsx:45, sidebar-route.tsx:34) | omp |
| Dashboard suites pass | info | scripts/test_atlas_dash*.py, test_atlas_colony*.py | 345 and 45 tests OK; /api/health 200 version 12.5.13 | web |
| No headless or screenshot check of the UI | med | n/a | not covered by any report | web |

## 4. Root causes

- T1 No cost tiering. Agents all sonnet/low (`agents/*.md:4-6`); docs promise haiku and medium; tripwire denies any override (`hooks/dispatch_tripwire_core.py:1047-1075`); resolver never maps effort to model (`scripts/atlas_resolve.py:25-42`).
- T2 Docs and style claim what code does not do. Length budget, gates (n)/(o), parity header, colony definition, CHANGELOG.md:14, CLAUDE.md gate list.
- T3 Three contracts for three harnesses. omp addendum diverges; header built three times; codex has none.
- T4 Context bloat. Style 9,151 chars per turn; header rule 2-3 times; orchestrate loads about 46.5 KB per invocation (not the planner's "load on trigger" assumption); session_boot floor 2,534 chars in an empty cwd, project figure unknown.
- T5 TUI robustness debt. 0 of 7 prior defects fixed. Corrected: the capture() item is moot, and the suite errors are order pollution that hides nothing about crashes but also proves nothing about them (the new probe test in B1 does).
- T6 Web UI and colony failures are silent. Client swallows errors; reaper failures log-only. Corrected: the codex-binding reds are live-herdr dependent, with one possible logic regression at `:274`.
- T7 Verification gaps and install drift. omp has no wired test script (stop-bridge.test.ts exists); doctor FAIL is install state; hooks suite has one real failure (gate (p) drift); `test_sweep_state` needs pytest.

Refuted or downgraded by the critic: TUI curses errors are not hard failures; `atlas_tui.py:1666` drops to low; doctor "never calls mark_orchestrating" is false for source.

## 5. Improvement plan

Per stage: role, tier, effort, why this tier, the one failable check, deps, status. Waves A-D; A runs concurrently on disjoint files.

### Wave A (concurrent)

| Stage | Work | Role | Tier / effort | Why this tier | Check | Deps | Status |
|---|---|---|---|---|---|---|---|
| A1 | Green the hooks baseline: resolve gate (p) channel-silent drift in `test_implementer_dispatch_with_no_diff_does_not_block_condition_g` (fix the fixture or the gate, after reading which is wrong); fix `test_sweep_state` pytest import | implementer | sonnet / medium | gate semantics need judgment | `python3 -m unittest discover -s plugins/atlas/hooks -p 'test_*.py'` exits 0; `test_sweep_state` imports | none | drift PROVEN; which side wrong ASSUMED |
| A2 | Fix test order pollution in `test_atlas_tui` (isolation passes: add module-import isolation so curses loads once, and make `Render.test_topology_tree` order-independent) | implementer | sonnet / medium | pollution cause is unproven | `python3 -m unittest test_atlas_tui` in the full scripts discover run reports 0 errors, 0 failures | none; before B1 | PROVEN symptom; cause ASSUMED |
| A3 | Triage herdr-web-ui reds on a rendering herdr: classify each as live-dependency timeout or regression; the candidate regression is `codex-binding.contract.test.ts:274` scrollback vs codex-transcript. Needs a herdr that renders panes; do not run against the user's live daemon without approval | runner | haiku / none | mechanical rerun with STEPS block | table of the failing tests with isolated pass/fail written to .atlas/.run, diffed against baseline | none | timeouts ASSUMED; :274 open |
| A4 | Wire an omp `test` script in `omp/package.json` | implementer | sonnet / low | one-line config, tests exist | `bun test` in plugins/atlas/omp runs more than 0 tests | none | PROVEN |
| A5 | Reconcile docs: colony definition, CHANGELOG.md:14 predicate, parity header, gates (n)/(o), CLAUDE.md dispatch-gate list (name, TOOLS, SCOPE, six spec blocks, REPORT) | docs-curator | sonnet / low | prose edits, evidence in hand | `python3 -m unittest test_atlas_contract`; grep shows "Gate (n)" and "Gate (o)" each in at least one doc | none | PROVEN |
| A6 | Doctor wording: point message at `_core`, handle shim (`scripts/atlas_doctor.py:300-308`) | implementer | haiku / low (sonnet/low until C lands) | narrow single-site edit | new `test_atlas_doctor` case with the call in core only asserts no false FAIL | none | PROVEN |

### Wave B (after A2 unless noted)

| Stage | Work | Role | Tier / effort | Why this tier | Check | Deps | Status |
|---|---|---|---|---|---|---|---|
| B1 | Fix TUI defects: `.get("name")` with fallback, None-safe formats, one body-height constant, try around `:1769`, check attach exit code, escape OSC fields, tolerate unknown tab; `:1666` guard optional | implementer | sonnet / medium | many call sites | new test class replays the audit probe (nameless seat, None fields, bogus tab) with no exception | A2 | PROVEN by probe |
| B2 | Web UI error visibility: shared stale/error banner replacing swallowed catches | implementer | sonnet / medium | cross-page UI work | ui-runtime-tester loads each page with the endpoint returning 500 and asserts the banner (DOM plus screenshot) | A5 if banner copy documented | PROVEN |
| B3 | Surface reaper failures via /api/v2/health | implementer | sonnet / medium | touches dashboard API | dashboard test raises PermissionError in reap_tick and sees it in the health JSON | none | silent_failures field ASSUMED |
| B4 | Enforce or drop the 12-line budget (decision 2) | implementer | sonnet / medium | gate change | hooks unit test: 13-prose-line final reply yields a warning | A1 | PROVEN unenforced |
| B5 | Single header builder in `contracts/operating-contract.json` | implementer | sonnet / medium | three call sites incl. TypeScript | contract test: the literal template appears 0 times outside the JSON | A1, A4 | PROVEN |
| B6 | Reorder cmd_spawn so a failed spawn cannot leave a ghost member | implementer | sonnet / medium | ordering in a long function | test that raises between register and tmux and asserts no member remains | none | ASSUMED; needs a read of `:1064-1153` |

### Wave C (tiering, sequential, after A1)

| Stage | Work | Role | Tier / effort | Why this tier | Check | Deps | Status |
|---|---|---|---|---|---|---|---|
| C1 | Design the tier map and sanctioned override (section 6) | planner | opus / high (via override once C3 exists; sonnet/low until then) | design decision with security impact | stage doc reviewed by completeness-critic, no open blocker in findings.json | decision 1 | ASSUMED |
| C2 | Retier agent frontmatter and matrix | implementer | sonnet / medium | broad mechanical edit | `test_atlas_contract` extended: matrix role effort equals frontmatter; the haiku roles in squad-and-tiers.md are haiku | C1 | PROVEN need |
| C3 | Tripwire sanctioned tier override | implementer | sonnet / high | security-sensitive gate | tests: haiku on a role whose tier_allow includes it passes; opus on explorer denied; unlisted values keep the old deny text | C1, C2 | ASSUMED |
| C4 | omp tier parity; extend thinking union only if C1 needs medium | runner | haiku / none | follows C1 verdict | A4 test command or `bunx tsc -p plugins/atlas/omp --noEmit` passes | A4, C2 | ASSUMED |
| C5 | Fix doc lie at squad-and-tiers.md:16,:76 | docs-curator | haiku / low | text matches C2 | test_atlas_contract grep: no doc names an override the tripwire denies | C3 | PROVEN |

### Wave D (context cuts, after C so the style is edited once)

| Stage | Work | Role | Tier / effort | Why this tier | Check | Deps | Status |
|---|---|---|---|---|---|---|---|
| D1 | Cut injected context (section 7) | implementer | sonnet / medium | multi-file | unit test asserts `wc -c` of assembled style plus session_boot additionalContext under a stated budget | B5, C5 | sizes partly UNMEASURED |
| D2 | Align omp lead addendum with the CC TOOLS rule | implementer | sonnet / low | small text edit once authority is known | contract test: both give the same TOOLS rule text | B5, decision 3 | ASSUMED |
| D3 | Codex path: generated `.codex` instructions from operating-contract.json | implementer | sonnet / medium | new generator | generated file exists and a test compares its hash to generator output | B5, D1, decision 4 | gate parity UNVERIFIED (no codex hooks) |

## 6. Tiering design

Until wave C lands, every atlas:* dispatch runs sonnet/low, because the tripwire denies any model override on atlas subagent types (`hooks/dispatch_tripwire_core.py:1312-1323`). Haiku-class work must go to a non-atlas generic agent (the override exemption is `:1056-1057`). Note that the builtin_agent block (~:1285) reportedly blocks general-purpose and Explore, so the usable generic type is [unverified]; check before relying on it.

- haiku, effort none or low: runner, schema-inventory, docs-auditor, naming-glossary-audit (already promised at squad-and-tiers.md:16,47), explorer (read-only mapping), and scan, read and run-tests dispatches. Explorer on haiku is ASSUMED; prove by rerunning this audit's four explorer reports on haiku and diffing findings.
- sonnet, low to medium: implementer (medium, matching squad-and-tiers.md:76 and omp ATLAS_THINKING_LEVELS), verifier and completeness-critic (medium), db-prober, ui-runtime-tester, docs-curator.
- opus, high: only planner and synthesis, only through the sanctioned override. squad-and-tiers.md:9-12 says opus is main-thread only; C1 decides whether to reverse that (decision 1).
- Expression: `tier_allow: [haiku, sonnet]` and `tier_max_effort` per role in agent frontmatter; a `model` hint per cell in scope-matrix.json (schema role, count, effort, tools_profile at :10-13). The resolver (`scripts/atlas_resolve.py:25-42`) emits the model with the team so the orchestrator copies it into `model:`. Matrix role effort must still equal frontmatter (scope-matrix.json:2).
- Tripwire: `_model_override` (:1047-1075) gains a fourth accept: the given model is in the role's tier_allow and matches the model the resolver emitted for the same SCOPE line. Everything else keeps the deny at :1312-1323. It keys on the SCOPE line already required, so no new caller-trusted field.
- omp: thinkingLevel is a closed union off|low (`omp/atlas-agents.ts:32`). Map resolver effort none or low to off, medium to low; extend only if a role needs more (ASSUMED, proven when C4 passes). The hook bridge already runs the tripwire on omp, so C3 applies unchanged.
- Codex: no contract path. A generated instructions file (D3) can state the tier table but cannot enforce it; enforcement UNVERIFIED.

## 7. Context budget cuts

1. Orchestrate references total 293,847 chars. SKILL.md:56, :62, :68 load laws-and-gates (9,948 B), the-loop (17,029 B) and squad-and-tiers (6,847 B) unconditionally: about 34 KB, or 46.5 KB per invocation with SKILL.md (12,730 B), before any dispatch. Make those three load on trigger as :43 says; split hooks-automation.md (19,666), the-loop.md (17,029), prompt-optimization.md (16,552).
2. Output style 9,151 chars every turn on CC: remove omp parentheticals (`:124,138`) and the duplicated header rule.
3. Header rule injected 2-3 times (`hooks/session_boot_core.py:379/383`, style, `omp/style.ts:185-201`): inject once.
4. session_boot additionalContext is re-appended to every omp main prompt (parity doc:66): move to session start only. Measured floor 2,534 chars in an empty non-atlas cwd; the project-directory size is UNKNOWN, so D1 measures first.
5. SKILL.md bodies total 309,529 chars across 39 skills: move rarely used mode text to references. prompt_optimizer_core.py per-prompt output is UNMEASURED.

## 8. Terminal and web UI/UX improvements

Terminal (atlas-tui, atlas-mux):
- A nameless seat crashes before the good "no seat X" and "no seat selected" messages are reached (`scripts/atlas_tui.py:1183,1216`; crash sites :1006,:1213).
- tmux absent: TUI `launch()` calls `_run_tmux` with no pre-check (`scripts/atlas_tui.py:1855-1873`) and has no fallback, unlike mux (`scripts/atlas_mux.py:260`); `_run_tmux` FileNotFoundError handling at :1832-1834 is [unverified].
- Stale snapshot: loader failure shows a full-pane error (`:1643`) and retries every 2 s (`:1658`), but the header has only a last-update clock, no explicit stale marker.
- Terminal too small: single-line message (`:1669-1670`) while keyboard input is still processed behind it.
- Attach status says "returned from X" even when tmux failed (`:1771,1780`).

Browser (`scripts/dashboard_ui/js/pages/`):
- `agents.js:27-29`: channels fetch error sets `S.chans=[]`; fleet silently falls back to folder names.
- `supervision-lens.js:49`: failed board load deletes the board; lead shows zero todos.
- `terminal.js:343-346` sets `st.err` and only redraws the footer; `:267` swallows the tick error; stale cards carry no marker.
- `colony.js:63-65` stores `st.error` but keeps last-success data; render behavior [unverified].
- `colony.js` ~:70-72 renders a long STATES legend as dim prose.
- `colony.js` ~:106 kill confirm says "closes its pane" for every member kind, while docs/atlas-colony.md says lead and in-process subagents cannot be stopped from outside; whether Kill is hidden for them is [unverified].
- `overview.js:54` `.catch(() => null)` on /api/v2/health; `app.js:825` swallows the xterm preload failure.

## 9. Not covered, next audit wave

- Runtime size of additionalContext from session_boot (project directory) and prompt_optimizer.
- Whether the eight skills' descriptions promise unimplemented workflows.
- Mux: herdr transport, codex worker spawn, cmd_run_worker past ~:1235, `_open_window`, `atlas_seats.close_run`; also atlas_launch, atlas_remote, atlas_rig, atlas_herdr, atlas_control.
- omp: style/agent injection runtime proof, skill loading, `omp/delegation.ts`, `agent-guard.ts`, `gen-agents.ts`, `contracts.ts`, `mandates.ts`, `hook-bridge.ts`; `hooks/worker_report_gate_core.py`.
- herdr-web-ui client `src/` and the root cause of the 10 s codex-binding timeouts and the two other red tests.
- Any headless or screenshot check of the command center web UI.
- Live install cache version and autoname behavior (cache is read-denied; the user must reinstall).
- Claims 1-174 inventoried in claims.md, not verdict-checked.
- Gate letter-to-doc mapping for (a)-(m); omp registry values; codex seats in TUI.
- Test-baseline failure classes re-derived (done here for hooks and scripts; herdr count still disputed).

## 10. Decisions needed from the user

1. Is opus allowed for planner and synthesis subagents, or does it stay main-thread only? Recommended default: allow opus only for planner and synthesis through the sanctioned override (C3), nothing else.
2. Enforce the 12-line length budget, or delete the claim? Recommended default: enforce as a soft Stop-gate warning (B4), not a block.
3. Is omp/lead-addendum.md or the CC TOOLS rule the authority for dispatch TOOLS lines? Recommended default: the CC TOOLS rule (it is what the tripwire enforces); rewrite the omp addendum to match (D2).
4. Is codex in scope for enforcement, or only for generated instructions? Recommended default: generated instructions only (D3); codex has no hooks, so enforcement is unprovable.

## Assumptions vs proven

- Explorer works on haiku -> proven by rerunning this audit's explorer reports on haiku.
- Codex-binding timeouts are environmental -> proven by A3 on a rendering herdr; `:274` stays open until then.
- Which side of the gate (p) drift is wrong -> proven by A1 reading `hooks/test_completion_gate.py:499` and the gate.
- Install cache lacks autoname -> proven only by user reinstall.
