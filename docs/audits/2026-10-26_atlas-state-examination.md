# Atlas state examination, 2026-10-26

Read-only examination of what atlas writes on disk, measured against the intended design:

- `~/.atlas/` is a cross-project chronicle: logs, performance, errors and scoring across every transcript, so atlas improves over time.
- `<project>/.atlas/` holds project-scoped memories, activities, todos, evidence, findings and channels for later retrieval.
- `<project>/docs/` is the project SSOT with dated records in subfolders.

All numbers below were measured on this machine on 2026-10-26.

## 1. Project `.atlas/` folders

| Measure | Value |
|---|---|
| `.atlas` dirs under `~/MEGA/Projects` (depth 4) | 50 |
| Stray: inside a git subdirectory (`frontend/`, `backend/`, `docs/`, `admin-webapp/`, `app/`) | 6 |
| Nested `.atlas/.run/.atlas/.run/` | 1 project + 9 omp worktrees |
| `~/MEGA/Projects/.atlas` (container folder of all projects) | present, holds channels/board/inbox |
| `~/.atlas/.run/` holding project-scope `channels.json`, `todos.json`, `board/`, `findings.json` | present |

Subfolder use across the 44 root-level `.atlas` dirs:

| Subfolder | Present | Non-empty |
|---|---|---|
| `.run` (ephemeral) | 44 | 44 |
| `evidence` | 12 | 12 |
| `findings` | 8 | 8 |
| `memory` | 4 | 0 |
| `self-improvement` | 4 | 0 |
| `understand-anything` | 4 | 0 |
| `graphify` | 4 | 0 |
| `nudge` | 3 | 0 |

Root cause: six independent root walkers (`atlas_todo.find_root`, `atlas_db._project_root_for_sentinel`, `docs_drift.find_root`, `atlas_finding.find_root`, `session_boot_core._find_structure_root`, `worker_inbox._candidate_roots`) each treat `.atlas` and/or `docs` as a root marker with a 7-level cap. A stray `.atlas` then marks its own folder as a root forever, any subpackage with a `docs/` folder becomes a root, `$HOME` (which has `~/.atlas`) becomes the root for any non-git cwd under home, and `mark_orchestrating` registers the raw cwd.

Durable project data does not reach the project folder: nothing writes `<project>/.atlas/memory/`. Project memories are written to the global `~/.atlas/memory/PROJECT.md` (568 bytes, all dashboard remeasure stamps). Findings live in `.atlas/.run/findings.json` (ephemeral by name; 546 entries in this repo) and are distilled into `.atlas/findings/` in only 8 projects.

## 2. Global `~/.atlas/` chronicle

`atlas.db` is 673 MB.

| Table | Rows | MB | Note |
|---|---|---|---|
| messages | 494,141 | 368 | full transcript mirror, no retention |
| tool_calls | 294,515 | 136 | |
| user_prompts | 10,185 | 40 | |
| turn_scores | 10,868 | 1.7 | stopped 2026-10-23, see 2.2 |
| facets | 3,461 | 0.5 | 1,047 enriched (30%) |
| improvements | 108 | - | 39 improved, 13 no change, 12 regressed, 39 never re-measured |
| findings | 103 | - | the 546 project findings in this repo never reach it |
| projects | 611 | - | see 2.1 |

### 2.1 Project identity is fragmented

Of 611 `projects` rows: 38 are git roots, 38 are subdirectories of a git repo, 2 are inside `.atlas/.run`, 105 are worktree or temp paths, 211 no longer exist on disk (iCloud and Google Drive copies from before the move to MEGA), and 217 are non-git folders. Per-project trends and scores are split across these rows, so cross-session improvement per project cannot be read reliably.

### 2.2 Scoring outage, 2026-10-22 to 2026-10-26

From `turn_scores` rows with `kind='error'`:

- 2026-10-22 08:40: `400 POST https://api.typesafe.ai/v1/systemone: Unknown model: tev1:4b`. The model setting had been changed to a local Ollama tag while the URL stayed hosted.
- 2026-10-22 19:12: the URL setting was changed to the full `.../v1/systemone` path. The client appends `/v1/systemone`, so from 2026-10-23 every call was `404 POST .../v1/systemone/v1/systemone`.

The base URL was never the problem. The Settings text did not say the path is appended, and the 400 did not point at the model. The URL is now `http://127.0.0.1:11434` (local Ollama, nothing leaves the machine), and a local run on 2026-10-26 wrote 6 scored rows.

Compliance note: with a hosted URL and `TYPESAFE_API_KEY` set, scoring sends scrubbed prompt excerpts to a third party. Sessions can contain client NPI from the Dynamics MCP, so the hosted path is a GLBA / Reg S-P vendor-disclosure question.

### 2.3 Error signal is mostly noise

`hook-faults.jsonl` has 752 rows. About 650 are `format_after_edit: formatter skipped: missing`. `friction_events` has 741 `formatter_skipped:missing` rows, the largest category, ahead of real signals like `gate_block` (356) and `user_correction` (192).

### 2.4 Memory quality

`~/.atlas/memory/MEMORY.md` mixes durable user corrections with counters such as "Tool 'Edit' errored 1x in agent-a0fb11bca10885725". Subagent transcripts are attributed to the agent id instead of the project.

## 3. `docs/` naming and routing

`lint_docs_names.py` enforces `<YYYY-MM-DD>-<slug>` only on changed files at Stop (condition l). `atlas_doctor` never runs it. Loose files at the `docs/` root are not covered by any rule. A read-only `--all` run on gwh-firstrespondersapp found 17 date-last names; its `docs/` root also holds files like `MEETING_NOTES_9.3.26.md`, `MEETING_TRANSCRIPT.md` and `TODO_LIST.md`.

Decision (user, 2026-10-26): dated records use an underscore, `YYYY-MM-DD_name-goes-here.md`. Existing hyphen-dated names are migrated. Canonical root files and living docs keep bare names. The doctor repairs `.atlas` layout automatically at session start and renames docs only on `atlas_doctor --fix`.

## 4. Fixes in flight (this session)

1. One project-root resolver (`scripts/atlas_paths.py`) used by every caller.
2. Docs naming: underscore rule, migration, docs-root routing.
3. Scoring URL accepts base or full form; model/endpoint mismatch is refused with a clear message; missing-formatter skips leave the error and friction logs.
4. `atlas_doctor`: `.atlas` layout check with auto-repair, docs naming report with `--fix`, scoring endpoint check, projects-table hygiene.

## 5. Open, not in this session's scope

- Write project memories and distilled findings into `<project>/.atlas/` (memory, findings) and feed project findings into the global `findings` table.
- Retention for `messages` and `tool_calls` (504 MB of the 673 MB DB) given `~/.claude/projects` already keeps the transcripts.
- Attribute subagent transcripts to their parent project; drop per-agent error counters from `MEMORY.md`.
- Re-measure the 39 improvements that were never re-measured; facet enrichment covers 30% of sessions.
