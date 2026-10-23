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
| `/api/v2/channels` hang (fixed) | `scripts/atlas_rig.py` `_rig` / `_rigs` / `_nodes` | The channels handler ran `build_colony` once per project root; each call spawned an uncached `rig ps --json` (node) with a 10 s timeout. Stack: `h_channels_get -> _roster -> build_colony -> _herdr -> atlas_seats.agents -> atlas_rig._rigs -> _rig -> subprocess`. 3 timed requests: no response in 20 s. Fixed with a 3 s cached `_ps()` probe and a 3 s timeout: 200 in 0.4-0.8 s (fixer), 1.3-2.9 s (browser check). Test: `test_atlas_rig.RigHangTests` |

## Unused

- Skills: 4 of 37 invoked in 14 days (atlas-orchestrate 7, atlas-explain 5, atlas-audit 1, atlas-prompt 1). 27 were never invoked in the whole DB history: atlas-autopilot, bakeoff, brainstorm, compound, db-audit, doctor, dogfood, harden, loop, optimize, plan, proof, prototype, pulse, refactor, resolve-pr-feedback, review, run-watch, setup, ship, simplify, status, sweep, test-xcode, ux-test, wiki, worktree. Caveat: counts come from Skill tool calls and slash prompts; a skill whose body is read another way is not counted, so treat this as an upper bound on disuse.
- Agents: docs-auditor and planner had 0 dispatches.
- Scripts with no reference from hooks, skills, agents, omp or other scripts: `atlas_health_collect.py`, `typesafe_client.py`. (The first pass also listed `atlas_rig.py`; that was wrong: `atlas_seats.py` imports it, and the channels hang below ran through it.)

## Dashboard

Static audit: the UI version chip reads `/api/health`, which reads `plugin.json`; every UI API call resolves to a server route; no dead JS modules; no hardcoded counts. Live audit defects and their status after this run. "Fixed, verified" means a unit test passes and a browser check on the source build (port 7433/7434, screenshots in `.atlas/evidence/2026-10-14-dashboard-final/`) confirmed it. The installed dashboard on :7421 still runs the 12.4.1 cache copy until the plugin is reinstalled.

| ID | Page | Defect | Fix status |
|---|---|---|---|
| F1 | Sidebar (all pages) | Workspace group with a null label: blank header, "Actions for workspace null" | Fixed, verified |
| F2 | Settings > Agents | "No registered projects yet" while the API returns projects | Fixed, verified (server recency filter plus client error/Retry state) |
| F3 | Overview (390px) | Four empty, unlabeled agent hexagons (they were idle agents with a hidden label) | Fixed, unverified: no live agents during the browser check |
| F4 | Nav | Terminal page exists but is not in the nav; saved aliases to it are dropped | Fixed, verified |
| F5 | Routing | Legacy colony link opens Terminal; the `c` shortcut opens Colony | Fixed, verified |
| S1 | Projects | tech-tools card shows 0 agents; Agents page shows 3; sidebar shows 2 | Fixed (live agents by root); count match unverified with live agents |
| S2 | Overview vs Health | "Silent failures 691" vs "Silent failures (21)" | Fixed, verified (both labeled: occurrences vs "N distinct, M occurrences") |
| S3 | Channels | Test and stale channels listed (atlas-demo, T, .claude, jerry, e2e); duplicate tech-tools leads | Fixed, verified |
| S4 | Activity, Improve | Project groups named "(none)", "m" and a dash | Fixed, verified; Improve still names non-project folders such as Downloads (open) |
| S5 | HTTP header | `Server: AtlasDashboard/1.2` hardcoded | Fixed, verified (`AtlasDashboard/12.4.2`) |
| S6 | Improve | POST remeasure returns 422 | Fixed (not_reproduced returns 200), unit test only |
| R4 | Sidebar projects | Non-project folders listed (Downloads, Staff, plugins) | Fixed, verified |
| R1 | Channels | Page showed "Something went wrong" | Fixed, verified (cause: `/api/v2/channels` hang, see Broken) |
| D2 | docs/atlas-workboard.md | 10.4.x sections read as current behavior | Open |
| W1 | Colony UI :7317 | Embedded iframe has both allow-scripts and allow-same-origin (browser sandbox-escape warning) | Open |

## Improvements (ranked)

1. Fix the three completion-gate false positives (evidence recursion, ledger example, run-scoped delegation paths). They cause most of the stop-gate friction users see.
2. Cut denial retries: name the lean-ctx replacements in the SessionStart context and remove Agent/Task from worker tool lists.
3. Triage the 27 never-used skills: rewrite trigger descriptions for the ones worth keeping, merge or retire the rest.
4. Bind, import or delete the six orphan hook files and three unreferenced scripts.
5. Retry and surface colony channel-open failures.
6. Fix the docs-curator output schema.
7. Record per-hook fire counts and latency; today only faults are recorded, so a silent hook cannot be told from a dead one.
8. Review the colony UI iframe sandbox (W1) under the Safeguards Rule access-control lens.

## Correction notes (2026-10-23)

The text above is unchanged. Each figure below was re-measured on 2026-10-23.

- Skills on disk: 39 SKILL.md files (`find plugins/atlas/skills -name SKILL.md | wc -l`), not 37. Agents on disk: 14 (`ls plugins/atlas/agents/*.md | wc -l`), not 13. The audit's own skill-usage figures ("4 of 37 invoked in 14 days", "27 never invoked in the whole DB history") are the audit's numbers from 2026-10-14 and were not re-queried. A later proposal quoted them as "rarely invoked".
- Hook scripts: `plugins/atlas/hooks/hooks.json` binds 17 distinct hook scripts across 22 bindings. The "six orphan hook files" claim does not hold. `memory_capture.py` and `nudge.py` are run by `hooks/stop_tail.py` (`TAIL` at :22, `__import__(name).main()` in `_run`), and `stop_tail.py` is bound at `hooks.json:154`. `chronicle_facet.py` also runs from `stop_tail.py`. `docs_drift.py` and `prompt_decision.py` are imported by other hook modules. The one hook file with no runtime referrer is `hooks/testenv.py` (imported only by `test_session_boot.py` and `test_memory_capture.py`). Decision: all files stay in place, no moves or deletes.
- Self-dispatch denials: read-only query on `~/.atlas/atlas.db` for `tool_calls` rows with `error_snippet` starting "DENY - a subagent must never dispatch another subagent" returns 113 rows with `is_sidechain=0` and 37 with `is_sidechain=1`. The 113 figure reproduces. All 14 `plugins/atlas/agents/*.md` already list `Agent` and `Task` in `disallowedTools` (for example `explorer.md:9`), so removing them from worker tool lists was already done. The deny is the backstop in `hooks/dispatch_tripwire_core.py` (`_in_subagent` at :176, the check near :2364). `tool_calls` has no role column, so denials cannot be grouped by role.
- `colony/herdr-web-ui` size: 83,008 TS and TSX lines (`find plugins/atlas/colony/herdr-web-ui -name '*.ts' -o -name '*.tsx' | grep -v node_modules | xargs wc -l | tail -1`).
