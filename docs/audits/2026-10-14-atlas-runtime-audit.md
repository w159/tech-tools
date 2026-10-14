# Atlas runtime audit (2026-10-14)

Scope: what the atlas plugin actually does in use, measured from telemetry and
logs over the last 14 days, plus a code and live-browser audit of the web
dashboard. Plugin source version at audit time: 12.4.2 (`plugins/atlas/.claude-plugin/plugin.json`);
the running dashboard and colony UI were served from the installed 12.4.1 copy.

Sources:

- Telemetry DB `~/.atlas/atlas.db` (14-day window: 47,530 tool calls, 2,255 denied, 5,310 errors).
- Hook fault log `~/.atlas/hook-faults.jsonl`, dashboard log `~/.atlas/dashboard.log`, `atlas_mux.log`.
- Plugin tree on disk: 37 skills, 13 agents, 22 hook bindings, 118 files in `scripts/`.
- Live browser pass of all 9 dashboard pages: screenshots in `.atlas/evidence/2026-10-14-dashboard-audit/`.

## Working

| Area | Evidence (14 days) |
|---|---|
| Subagent dispatch | atlas:* dispatches: implementer 551, explorer 310, verifier 106, docs-curator 33, ui-runtime-tester 30, runner 29, completeness-critic 20, db-prober 6, rls-privilege-audit 4, schema-inventory 1, naming-glossary-audit 1 |
| Dispatch tripwire | 82 denials (spec 36, toolkit 17, scope 13, name 12, steps 2, builtin_agent 1, multi_goal 1) against about 1,500 dispatches |
| lean-ctx routing | grep, glob and read-only bash are redirected to ctx_search, ctx_glob and ctx_shell as designed |
| Telemetry ingestion | tool_calls 109,210 rows, session_logs 2,853, dispatches 7,034, user_prompts 8,814 |
| Dashboard | 9 pages render, 0 console errors, 0 failed API requests on the live pass; version chip is data-driven |
| omp advisor gate | 1,233 advisor board items completed with evidence (fix for the per-session cap shipped this session, see CHANGELOG) |

## Not working

| Item | Evidence | Note |
|---|---|---|
| format_after_edit faults | 561 fault rows on 2026-10-12, 57 on 2026-10-13, 0 on 2026-10-14 | Legacy rows. The current hook writes friction only for `missing`/`parse` (`hooks/format_after_edit.py`, QUIET_REASONS). Installing prettier removes the remaining friction rows. |
| Colony channel open | 16 "channel-open produced no output", 6 "failed: exit 2" | Flaky; no retry or surfaced error |
| Completion gate noise | 145 blocks; (m) delegation mandate is about 70 of them | See Broken: several block causes are false positives |
| Policy-denial retries | 2,255 denied calls (Grep 961, Bash 650, Glob 221, Task 202) | The model repeats a call the redirect already refused |
| Worker self-dispatch | 113 "a subagent must never dispatch another subagent" denials | Workers still see Agent/Task in their tool list |
| Dashboard endpoints | 422 on POST /api/v2/improve/remeasure; 401 on /api/v2/stream and /api/v2/irc; 400 on /api/todo | 422 assigned for fix; 401s are token-guard behavior [unverified whether expected] |
| MCP connectors | plugin connectors called 1-2 times each, 6 errors in 10 calls | Effectively unused through the plugin |

## Broken

| Item | Location | Evidence |
|---|---|---|
| Evidence check ignores subfolders | `hooks/completion_gate_core.py` `_check_evidence` (iterdir, top level only) | This session: evidence saved in `.atlas/evidence/<run>/` did not satisfy (a) until a copy was placed at the top level |
| Ledger fallback reads the style example | `hooks/completion_gate_core.py` `_ledger_open_todos`; example line in `output-styles/atlas-orchestrator.md` | This session: (i) reported 2 open todos with an empty board; 5 - 3 = 2 matches the `LEDGER | 3/5` example |
| Delegation mandate counts files the run did not write | `hooks/completion_gate_core.py` (m) path collection plus `_shell_dirty_edits` | This session: (m) named a scratchpad script and `scripts/test_atlas_doctor.py`, which another session had modified |
| Orphan hook files | `hooks/`: chronicle_facet.py, docs_drift.py, memory_capture.py, nudge.py, prompt_decision.py, testenv.py (no hooks.json binding, no import) | worker_inbox.py is imported by dispatch_tripwire_core.py and is fine |
| docs-curator output schema | `agents/docs-curator.md` | 4 faults: "custom outputSchema for docs-curator is not an object schema" |
| Dashboard data defects | see the Dashboard section | Found on the live pass |

## Unused

- Skills: 4 of 37 invoked in 14 days (atlas-orchestrate 7, atlas-explain 5, atlas-audit 1, atlas-prompt 1). 27 were never invoked in the whole DB history: atlas-autopilot, bakeoff, brainstorm, compound, db-audit, doctor, dogfood, harden, loop, optimize, plan, proof, prototype, pulse, refactor, resolve-pr-feedback, review, run-watch, setup, ship, simplify, status, sweep, test-xcode, ux-test, wiki, worktree. Caveat: counts come from Skill tool calls and slash prompts; a skill whose body is read another way is not counted, so treat this as an upper bound on disuse.
- Agents: docs-auditor and planner had 0 dispatches.
- Scripts with no reference from hooks, skills, agents, omp or other scripts: `atlas_health_collect.py`, `atlas_rig.py`, `typesafe_client.py`. (`atlas_rig.py` is new work from the OpenRig wave and may not be wired yet.)

## Dashboard

Static audit: the UI version chip reads `/api/health`, which reads `plugin.json`; every UI API call resolves to a server route; no dead JS modules; no hardcoded counts. Live audit defects, all assigned for fixing in this run:

| ID | Page | Defect |
|---|---|---|
| F1 | Sidebar (all pages) | Workspace group with a null label: blank header, "Actions for workspace null" |
| F2 | Settings > Agents | "No registered projects yet" while the API returns projects |
| F3 | Overview (390px) | Four empty, unlabeled agent hexagons |
| F4 | Nav | Terminal page exists but is not in the nav; saved aliases to it are dropped |
| F5 | Routing | Legacy colony link opens Terminal; the `c` shortcut opens Colony |
| S1 | Projects | tech-tools card shows 0 agents; Agents page shows 3; sidebar shows 2 |
| S2 | Overview vs Health | "Silent failures 691" vs "Silent failures (21)" |
| S3 | Channels | Test and stale channels listed (atlas-demo, T, .claude, jerry, e2e); duplicate tech-tools leads |
| S4 | Activity, Improve | Project groups named "(none)", "m" and a dash |
| S5 | HTTP header | `Server: AtlasDashboard/1.2` hardcoded |
| S6 | Improve | POST remeasure returns 422 |
| D2 | docs/atlas-workboard.md | 10.4.x sections read as current behavior |
| W1 | Colony UI :7317 | Embedded iframe has both allow-scripts and allow-same-origin (browser sandbox-escape warning) |

## Improvements (ranked)

1. Fix the three completion-gate false positives (evidence recursion, ledger example, run-scoped delegation paths). They cause most of the stop-gate friction users see.
2. Cut denial retries: name the lean-ctx replacements in the SessionStart context and remove Agent/Task from worker tool lists.
3. Triage the 27 never-used skills: rewrite trigger descriptions for the ones worth keeping, merge or retire the rest.
4. Bind, import or delete the six orphan hook files and three unreferenced scripts.
5. Retry and surface colony channel-open failures.
6. Fix the docs-curator output schema.
7. Record per-hook fire counts and latency; today only faults are recorded, so a silent hook cannot be told from a dead one.
8. Review the colony UI iframe sandbox (W1) under the Safeguards Rule access-control lens.
