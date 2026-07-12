# The three lenses

atlas-argus is a measurement skill with three independent lenses. Each
lens reads a different source, answers a different question, and writes a
different output. Read this reference when you need to pick a lens, or to
remember which `atlas_db.py` functions and tables each one owns.

When invoked without a clear lens, ask ONE AskUserQuestion: run health,
asset/context audit, session forensics, or cross-run trends. Do not run
all three at full depth. When the asset audit proposes disabling or
relocating assets, present the verdicts as a multiSelect AskUserQuestion
(keep/apply per asset), never apply silently.

## Lens 1 - run health

Question: is atlas behaving this run?

Source: the observability DB at `~/.atlas/atlas.db` (env `ATLAS_DB`),
populated by the hooks. Access it through the public functions in
`scripts/atlas_db.py`, never by parsing raw files.

Driver: `atlas_db.run_metrics(conn, run_id)` and
`atlas_db.latest_run_id(conn, session_id)` (use `latest_run_id`, not
`current_run_id`, once the Stop hook has finalized the run).

Metrics each run produces:

| Column | Red-flag signal |
|---|---|
| `inline_ops` | High = drift; the dispatch rule is being violated |
| `dispatches` | Low relative to task complexity = under-delegation |
| `parallel_waves` | Low on a multi-stage task = sequential dispatch |
| `in_flight_peak` | Below 3 on a 3+-stage task = missed concurrency |
| `est_context_tokens` | High = bulk-reading source instead of delegating |
| `recall_hits` | Low = memory not queried at Orient |
| `recall_misses` | High miss rate on a mature project = lessons not captured |
| `verifier_coverage` | Below 1.0 = unverified changes shipping |
| `wall_clock_s` | Baseline for tracking improvement over time |

Output: a `record_improvement(conn, run_id, dimension, baseline, target,
note)` for every metric that regressed or missed its target. Every
improvement MUST carry an explicit `baseline -> target`. No
qualitative-only entries.

## Lens 2 - asset/context audit

Question: is the session carrying weight it does not need here?

Source: every context-loaded asset (skills under `~/.claude/skills`,
agents under `~/.claude/agents`, including symlinks) plus the project
stack detected from files and `package.json` deps.

Driver: `scripts/asset_audit.py [project_root] [--json] [--apply]`.

What it does:
1. Inventory every context-loaded asset and estimate its context cost
   (chars/4).
2. Detect the project stack (mcp, node-ts, python, dotnet, azure,
   frontend, terraform, ...).
3. Score relevance: an asset with no tech tag is universal (always
   kept); a tagged asset is kept if its tags meet the project, else
   flagged.
4. Choose the LEVEL: `disable-here` (off-stack here but on-stack for
   another known project, project `settings.local.json`) or
   `relocate-global` (off-stack everywhere).
5. Tier by risk: `AUTO` (safe to relocate) vs `CONFIRM` (present to the
   user first). `--apply` relocates only AUTO items by moving (never
   deleting) into `~/.claude/{skills,agents}-disabled` with a restore
   manifest.

Learning loop: verdicts persist to `asset_verdicts`. When you restore a
flagged asset, call `atlas_db.note_asset_restore(conn, kind, key)`; that
asset is then suppressed and never re-flagged. Track quality with
`atlas_db.asset_audit_summary(conn)` and its `false_positive_rate`: a
rising rate means the taxonomy is over-flagging and needs tightening,
not more applying.

Public functions for this lens: `record_asset_verdicts`,
`mark_asset_applied`, `note_asset_restore`, `suppressed_assets`,
`asset_audit_summary`.

Apply discipline: AUTO auto-applies under `--apply`; everything in
CONFIRM is presented to the user with its reason and level before any
move. Disabling at the project level is preferred over a global relocate
whenever the asset serves another project.

## Lens 3 - session forensics

Question: what actually happened across every session, and what should
change because of it?

Source: the on-disk session transcripts that `hooks/ingest_session.py`
and `scripts/session_ingest.py --backfill` land in the DB. The sparse
`events` table never held this; these mirror tables do.

Tables:
- `session_logs` - one row per transcript: project, cwd, model, token
  totals, counts, `error_count`, ingest cursor. Carries an `agent`
  column ('claude' default, 'codex' written by the codex adapter).
  Transcripts under `.claude-mem/observer-sessions` are excluded at
  ingest.
- `messages` - every user/assistant/system message: role,
  `is_sidechain`, `thinking`, `text`, per-message `usage` tokens, model.
- `tool_calls` - every tool invocation: `tool_name`, `kind`
  (builtin|skill|mcp|agent), `target`, `server`, scrubbed
  `input_summary`, `input_bytes`, `is_error`, `result_bytes`.
- `user_prompts` - the user's actual typed prompts (tool-result messages
  excluded), with a `norm` clustering key.
- `signals` - behavioral flags tagged at ingest:
  `assumption_admission`, `unverified_claim`, `user_correction`, each
  with a snippet and a message link.

Read helpers (use these; do not re-parse transcripts):
- `tool_usage(conn, kind=None, project_id=None)` - per-target rollup.
- `idle_assets(conn, kind, known_keys)` - assets never invoked.
- `context_tool_health(conn)` - cache-hit ratio plus call/error counts
  for context-mode, claude-mem, ponytail.
- `signal_counts(conn)` / `signal_rollup(conn, signal_type=None)` -
  behavioral-issue rollup and per-incident snippets.
- `repeated_prompts(conn, min_count=3)` - normalized prompts that
  recur across sessions.

The four questions, and the action each produces:
1. Which tools/skills/MCP/agents are used vs idle? Compare `tool_usage`
   against the installed inventory; feed the unused set to `idle_assets`.
   A zero-call asset is a relocate-global or removal candidate. A
   high-error `target` is a description/schema bug, file an improvement
   against that tool.
2. Is the context layer actually helping? Read `context_tool_health`. A
   low `cache_hit_ratio`, or context-mode/claude-mem/ponytail with
   near-zero calls on large-output sessions, means the protection is
   configured but unused. Propose a CLAUDE.md nudge or a hook, with the
   ratio as the baseline.
3. What is being asked repeatedly? `repeated_prompts` clusters re-typed
   requests. A cluster of 3+ is a workflow that should become a
   skill/command or a standing CLAUDE.md rule.
4. Where did atlas mislead the user? `signal_counts` /
   `signal_rollup('assumption_admission')` surface the exact class of
   issue: a claim made without testing, a callback wired only in a
   plan, a "should work" with no evidence. Each confirmed incident
   becomes a `record_improvement` AND, when it recurs across 3+
   sessions, a concrete CLAUDE.md / rules edit. Quote the snippet and
   cite the session as evidence.

Every output still obeys the measurable-improvement rule: persist a
`record_improvement(conn, run_id, dimension, baseline, target, note)`
with a real baseline (the count, the ratio, the error rate) and a
target. Signals are candidate findings, not proof. Confirm against the
linked message text before proposing a rule change.

## Trends (the no-arg path)

When called with no run context, run `trends(conn, limit=20)` and
summarize cross-run and cross-project direction: which dimensions are
improving, which are regressing or stuck, which projects persistently
underperform. Flag any dimension where a prior `record_improvement`
target has not been reached after three or more subsequent runs: that
improvement is stalled and needs a different approach.

## The nudge hook

`hooks/nudge.py` fires on `Stop` and `SubagentStop`, at most once per
15-minute window. It asks whether the turn produced a reusable lesson.
If yes, persist a `record_improvement` AND capture a claude-mem lesson
only when the pattern has repeated at least 3 times and is not already
in memory. Capture format:

```
TYPE:    Decision | Pattern | Error | Constraint | Preference
CONTEXT: project / feature / library@version
LESSON:  one or two sentences -- what to do differently next time
SOURCE:  file:line or command + observed result
```

Cite the source of any memory-derived action. Keep new lessons tentative
until they repeat; promoting too fast pollutes the hot set.