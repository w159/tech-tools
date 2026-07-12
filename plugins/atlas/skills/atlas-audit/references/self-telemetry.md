# Atlas self-telemetry (atlas-audit mode)

Atlas improves by measuring itself. Each run emits quantitative signals to the
global SQLite observability DB at `~/.atlas/atlas.db` (env `ATLAS_DB`). This
skill reads those signals, surfaces the run's health scores, and proposes
improvements that carry explicit baselines and targets -- no qualitative-only
entries accepted.

**Elicitation:** when invoked without a clear lens, ask ONE AskUserQuestion - run
health (recommended after an orchestration run), asset/context audit, session
forensics, or cross-run trends - instead of guessing or running all three at full
depth. When the asset audit proposes disabling/relocating assets, present the verdicts
as a multiSelect AskUserQuestion (keep/apply per asset) rather than applying anything
silently; the learn-from-restores rule depends on explicit user choices.

## Single source of truth

The global SQLite DB at `~/.atlas/atlas.db` (env `ATLAS_DB`), populated by the
hooks and read via `scripts/atlas_db.py`. Access it through the public functions
below -- never parse raw files or rely on memory alone.

The three lenses (run health, asset/context audit, session forensics) each own
distinct sources, drivers, and outputs. The per-lens `atlas_db.py` functions,
the transcript-mirror tables, the four forensic questions, and the nudge
capture format are documented in `references/lens-set.md`. Read it before
choosing a lens and when wiring a new read against the mirror.

Files are NOT the SSOT for run metrics. claude-mem is the narrative layer only:
use it to store a lesson that survived three or more runs, not as the primary
record.

Public functions in `atlas_db.py`:

- `connect(path=None)` -- open the DB (creates if absent)
- `init(conn)` -- create schema
- `register_project(conn, root_path, name=None, stack=None) -> int` -- upsert project row, returns project_id
- `start_run(conn, project_id, session_id, task_summary=None, model=None) -> int` -- open a run, returns run_id
- `current_run_id(conn, session_id) -> int | None` -- most recent OPEN run for this session (None once the Stop hook has finalized it)
- `latest_run_id(conn, session_id) -> int | None` -- most recent run for this session, open OR closed; use this when reading/deriving metrics after the run has been finalized
- `log_event(conn, run_id, tool, context, is_inline_op, path=None) -> int` -- append an event
- `log_dispatch(conn, run_id, agent_type, model=None, wave_id=None) -> int` -- record a dispatch
- `record_recall(conn, run_id, hit) -> None` -- increment `recall_hits` (hit=True) or `recall_misses` (hit=False) for the run; the engine Orient step calls this once per run via the `record-recall <session> hit|miss` CLI. Touches only the recall columns, so it survives `derive_run_metrics` refreshes.
- `inline_ops_since_last_dispatch(conn, run_id)` -- count inline ops since the last dispatch
- `finalize_run(conn, run_id, wall_clock_s=None) -> None` -- close the run
- `run_metrics(conn, run_id) -> dict` -- return the metrics row for a run
- `derive_run_metrics(conn, run_id, session_id) -> dict` -- compute the metrics no live hook can fill and write them onto the run's metrics row: `est_context_tokens`, `parallel_waves`, and `in_flight_peak` from the transcript mirror; `wall_clock_s` if not already set; `verifier_coverage` from the `dispatches` table (agent_type pairing -- see below -- NOT from `tool_calls` or the transcript mirror). The ingest hook now calls this automatically after every mirror refresh (Stop/SubagentStop/SessionEnd/PreCompact), so live runs populate on their own. Call it manually only for a session whose mirror you just backfilled. It deliberately does NOT touch recall_hits/recall_misses (those are recorded live by the engine Orient signal via `record_recall`), so a derive refresh never clobbers them.
- `unpaired_implementer_dispatches(conn, run_id) -> int` -- implementer-type dispatches beyond the verifier-type dispatches available to check them: `max(0, implementers - verifiers)`, using the same `dispatches`-table agent_type matching rule as `verifier_coverage`. The completion gate consumes this to flag shipping work that never got an independent verifier.
- `purge_observer_sessions(conn) -> dict` -- one-shot cleanup of synthetic observer-session mirror rows (deletes the `session_logs` row plus its child rows in `messages`/`tool_calls`/`user_prompts`/`signals` for any transcript matching a known synthetic-session marker); touches only mirror tables, never `runs`/`dispatches`/`events`/`metrics`/`improvements`/`asset_verdicts`. CLI: `python3 scripts/atlas_db.py purge-observer-sessions`.
- `record_improvement(conn, run_id, dimension, baseline, target, note) -> int` -- persist a proposed improvement
- `trends(conn, limit=20) -> list` -- cross-run/cross-project trend rows over the FULL metric set (run_id, root_path, inline_ops, dispatches, parallel_waves, in_flight_peak, est_context_tokens, recall_hits, recall_misses, verifier_coverage, wall_clock_s); most recent `limit` runs. Mirror-derived columns read NULL for any run whose session has no ingested transcript.

## What it measures

`run_metrics` returns a dict with these columns. Each maps to a specific behavior
signal:

| Column | Meaning | Red-flag signal |
|---|---|---|
| `inline_ops` | Tool calls made in the orchestrator's own context | High value = drift; the dispatch rule is being violated ("too small to delegate") |
| `dispatches` | Total subagent dispatches this run | Low relative to task complexity = under-delegation |
| `parallel_waves` | Distinct concurrent dispatch waves | Low on a multi-stage task = sequential dispatch when fan-out was required |
| `in_flight_peak` | Max simultaneous agents in a single wave | Below 3 on a 3+-stage task = missed concurrency |
| `est_context_tokens` | Estimated orchestrator context consumption | High = the orchestrator is bulk-reading source instead of delegating discovery |
| `recall_hits` | Times a memory lookup returned a usable lesson | Low = memory not being queried at Orient |
| `recall_misses` | Times memory was queried and returned nothing useful | High miss rate on a mature project = lessons not being captured |
| `verifier_coverage` | Fraction of dispatched changes that received an independent verifier | Below 1.0 = unverified changes shipping |
| `wall_clock_s` | Elapsed seconds for the run | Baseline for tracking improvement over time |

How these are populated: `inline_ops` comes live from the PostToolUse tripwire
(`events` table) and is written by `finalize_run` on Stop, which also defaults
`wall_clock_s` to the run's elapsed time. `dispatches` is ALSO written by
`finalize_run` at Stop, but that value is a one-shot snapshot - dispatches landing
in later turns of the same session (via the `dispatch_tripwire` last-run fallback)
never reached it, so the column could read 0 even when the `dispatches` table had
rows for the run. `derive_run_metrics` now recomputes `dispatches` as a live
`COUNT(*) FROM dispatches WHERE run_id=?` on every call, so the stored value always
reflects every dispatch ingested by the time it runs (`plugins/atlas/scripts/atlas_db.py:380-397`).
`est_context_tokens`, `parallel_waves`, and `in_flight_peak` are computed from the
transcript mirror by `derive_run_metrics(conn, run_id, session_id)`, which the
ingest hook now runs automatically after each mirror refresh - so they fill on
their own for any session whose transcript is ingested. A run whose session was
never ingested still reads NULL for those three; backfill the transcript and call
`derive_run_metrics` to fill it. `verifier_coverage` is computed differently: it is
`min(1.0, verifiers/implementers)`, counting implementer-type vs verifier/validator-type
dispatches directly from the `dispatches` table by matching `agent_type` (recorded
live at dispatch time) - NOT from `tool_calls` or the transcript mirror, whose
`target` values suffer a ~99% key-mismatch against real agent names. This means
`verifier_coverage` does not require transcript ingestion, only the `dispatches`
rows for the run. A value of `0.0` means implementer dispatches shipped with zero
verifier dispatches to check them; `NULL` means there were zero implementer
dispatches this run - verification coverage is not applicable, a materially
different state from `0.0` and must not be conflated with it.
`unpaired_implementer_dispatches(conn, run_id)` exposes the same pairing as a raw
count (`max(0, implementers - verifiers)`) for the completion gate.
`recall_hits` / `recall_misses` are
**recorded live by the engine**: at Orient the engine queries memory and then calls
`record-recall <session> hit|miss` - hit when the lookup surfaced a usable lesson,
miss when it ran but returned nothing usable. This is a self-report by the agent that
did the lookup, not a blind count of memory tool calls. A run that never reached an
engine Orient step (e.g. a plain chat session) reads NULL here; treat NULL as "no
orchestration recall recorded", not zero. This skill may still refine the values by
reading the messages when it audits a run.

## Measurable improvements

Every proposed improvement MUST carry an explicit `baseline -> target` and be
persisted via `record_improvement(conn, run_id, dimension, baseline, target, note)`.
No qualitative-only entries.

Example workflow:

```python
# requires plugins/atlas/scripts on sys.path (the hooks insert it; do the same here)
import atlas_db, os

conn = atlas_db.connect(os.environ.get("ATLAS_DB", os.path.expanduser("~/.atlas/atlas.db")))
session_id = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
# latest_run_id (not current_run_id) so this still resolves after Stop finalized the run
run_id = atlas_db.latest_run_id(conn, session_id)
metrics = atlas_db.run_metrics(conn, run_id)

# Example: verifier coverage was 0.6 this run
if metrics["verifier_coverage"] is not None and metrics["verifier_coverage"] < 1.0:
    atlas_db.record_improvement(
        conn, run_id,
        dimension="verifier_coverage",
        baseline=metrics["verifier_coverage"],
        target=1.0,
        note="Independent verifier dispatched on every shipping change, not just 'large' ones."
    )

# Example: inline_ops spiked
if metrics["inline_ops"] > 4:
    atlas_db.record_improvement(
        conn, run_id,
        dimension="inline_ops",
        baseline=metrics["inline_ops"],
        target=4,
        note="Dispatch tripwire threshold is 4; any excess means an orchestrator inline-op rule was bypassed."
    )
```

Dimension keys map directly to the metrics columns above. A note explains the
behavioral root cause and the concrete change to make. When in doubt, name the
law (1-7 in atlas-orchestrate) that the metric signals was violated.

## Asset/context audit (the context-cost lens)

Run health asks "is atlas behaving?". This lens asks "is the session carrying
weight it does not need here?". A fresh session pays for every globally-loaded
skill, agent, and enabled plugin whether or not it is relevant to the project.

Driver: `scripts/asset_audit.py [project_root] [--json] [--apply]`.

What it does:

1. **Inventory** every context-loaded asset (skills under `~/.claude/skills`,
   agents under `~/.claude/agents` - both may be symlinks; it follows them) and
   estimates each one's context cost (chars/4, surfaced as an estimate).
2. **Detect the project stack** from files and `package.json` deps (mcp,
   node-ts, python, dotnet, azure, frontend, terraform, ...).
3. **Score relevance**: an asset with no tech tag is universal (always kept);
   a tagged asset is kept if its tags meet the project, else flagged.
4. **Choose the LEVEL** - the part that matters:
   - off-stack here but on-stack for another known project -> `disable-here`
     (project `settings.local.json`), never a global cut.
   - off-stack everywhere -> `relocate-global` candidate.
5. **Tier by risk**: `AUTO` (novelty/off-stack-everywhere, safe to relocate)
   vs `CONFIRM` (everything else). `--apply` relocates only AUTO items, by
   moving (never deleting) into `~/.claude/{skills,agents}-disabled` with a
   restore manifest under `~/.claude/.context-cleanup-manifests/`.

**Learning loop.** Verdicts persist to `asset_verdicts` (see `atlas_db.py`).
When you restore a flagged asset, call `atlas_db.note_asset_restore(conn, kind,
key)` - that asset is then suppressed and never re-flagged. Track quality with
`atlas_db.asset_audit_summary(conn)` (`false_positive_rate`): a rising rate
means the taxonomy is over-flagging and needs tightening, not more applying.

Public functions in `atlas_db.py` for this lens: `record_asset_verdicts`,
`mark_asset_applied`, `note_asset_restore`, `suppressed_assets`,
`asset_audit_summary`.

Apply discipline: AUTO auto-applies under `--apply`; everything in CONFIRM is
presented to the user with its reason and the level (disable-here vs
relocate-global) before any move. Disabling at the project level is preferred
over a global relocate whenever the asset serves another project.

## Session forensics (the transcript-mirror lens)

Run health asks "is atlas behaving?"; the asset audit asks "is the session
carrying dead weight?". This lens asks "what actually happened across every
session, and what should change because of it?". It reads the rich mirror of the
on-disk session transcripts that `hooks/ingest_session.py` and
`scripts/session_ingest.py --backfill` land in the DB. The sparse `events` table
never held this; these tables do.

### Tables

- `session_logs` - one row per transcript: project, cwd, model, token totals
  (input/output/cache_read/cache_creation), counts, error_count, and the ingest
  cursor. Token totals are recomputed from child rows, so they are correct
  regardless of re-ingest. Also carries an `agent` column ('claude' is the
  schema default; 'codex' is written explicitly by the codex adapter) - slice
  any of the read helpers below by joining on `session_logs.agent` to compare
  behavior across coding agents. Transcripts under a known synthetic-session
  marker (currently `.claude-mem/observer-sessions`, the per-session mirror
  claude-mem writes for its own observer) are excluded at ingest and never
  land a row here.
- `messages` - every user/assistant/system message: role, `is_sidechain`
  (subagent), `thinking`, `text`, per-message `usage` tokens, model.
- `tool_calls` - every tool invocation: `tool_name`, `kind`
  (builtin|skill|mcp|agent), `target` (tool name / skill / `server.tool` /
  subagent type), `server`, secret-scrubbed `input_summary`, `input_bytes`
  (true size = context cost proxy), `is_error`, `result_bytes`.
- `user_prompts` - the user's actual typed prompts (tool-result messages
  excluded), with a `norm` clustering key.
- `signals` - behavioral flags tagged at ingest: `assumption_admission`,
  `unverified_claim`, `user_correction`, each with a snippet and a message link.

### Read helpers in `atlas_db.py`

Use these; do not re-parse transcripts.

- `tool_usage(conn, kind=None, project_id=None)` - per-target rollup: calls,
  errors, sessions, input_bytes.
- `idle_assets(conn, kind, known_keys)` - of the assets present in this
  environment, which were NEVER invoked in any session (the unused set).
- `context_tool_health(conn)` - cache-hit ratio plus call/error counts for
  context-mode, claude-mem, and ponytail.
- `signal_counts(conn)` / `signal_rollup(conn, signal_type=None)` - the
  behavioral-issue rollup and the per-incident snippets.
- `repeated_prompts(conn, min_count=3)` - normalized prompts that recur across
  sessions (the repetitive-task signal).

### The four questions to answer, and the action each produces

1. **Which tools/skills/MCP/agents are used vs idle?** Compare
   `tool_usage(conn, kind=...)` against the installed inventory
   (`discover_capabilities.py` / `asset_audit.py`); feed the unused set to
   `idle_assets`. A skill/agent/MCP with zero calls across many sessions is a
   relocate-global or removal candidate (route through the asset-audit apply
   discipline). A high-error `target` is a description/schema bug - file an
   improvement against that tool, not the model.
2. **Is the context layer actually helping?** Read `context_tool_health`. A low
   `cache_hit_ratio`, or context-mode/claude-mem/ponytail with near-zero calls
   on large-output sessions, means the protection is configured but unused -
   propose a CLAUDE.md nudge or a hook, with the ratio as the baseline.
3. **What is being asked repeatedly?** `repeated_prompts` clusters re-typed
   requests. A cluster of 3+ is a workflow that should become a skill/command or
   a standing CLAUDE.md rule so the user stops re-asking.
4. **Where did atlas mislead the user?** `signal_counts` /
   `signal_rollup('assumption_admission')` surface the exact class of issue that
   motivated this lens: a claim made without testing, a callback "wired" only in
   a plan, a "should work" with no evidence. Each confirmed incident becomes a
   `record_improvement` AND, when it recurs across 3+ sessions, a concrete
   CLAUDE.md / rules edit (e.g. strengthen the verification-protocol clause the
   incident violated). Quote the snippet and cite the session as evidence.

Every output of this lens still obeys the measurable-improvement rule: persist a
`record_improvement(conn, run_id, dimension, baseline, target, note)` with a
real baseline (the count, the ratio, the error rate) and a target. Signals are
candidate findings, not proof - confirm against the linked message text before
proposing a rule change, the same way a human would re-read the transcript.

### Refresh + backfill

The ingest hook keeps the mirror current for claude sessions. To (re)index
history on demand: `python3 scripts/session_ingest.py --backfill
[~/.claude/projects]` (idempotent), or one session: `python3
scripts/session_ingest.py <transcript.jsonl>`.

Codex sessions are never picked up by the claude Stop/SessionEnd hook path -
backfill them explicitly: `python3 scripts/session_ingest.py --backfill-agent
codex [root]` (root defaults to `~/.codex/sessions`). Caveat when comparing
agents: codex's `token_count` events are per-event deltas that sum to
`total_token_usage`, but codex emits far more of these events than assistant
messages, and the adapter persists only the one nearest each stored message -
so codex session totals systematically undercount what codex itself reports.
Treat cross-agent token comparisons as directional, not exact, and note that
`context_tool_health()` aggregates across all agents with no agent filter, so
its totals blend regimes once codex rows exist.

A backlog of pre-exclusion observer-session rows was purged from the live DB
on 2026-07-09 after an audit found 96.6% of `session_logs` rows were this
pollution; see `purge_observer_sessions(conn)` above and evidence at
`.atlas/docs/evidence/2026-07-09-observer-purge.md`.

## Trends (no-arg)

Pass the open DB connection: `trends(conn, limit=20)`. It is called the no-arg path because the user supplies no arguments and no run_id is needed, not because `conn` is optional.

When called with no run context, run `trends(conn, limit=20)` and summarize
cross-run and cross-project direction:

- Which dimensions are improving (falling inline_ops, rising verifier_coverage)?
- Which are regressing or stuck?
- Are any projects persistently underperforming a specific dimension?

Return a compact table: dimension, recent-mean, prior-mean, direction (+/-/flat),
and one sentence of interpretation. Flag any dimension where the target set in a
prior `record_improvement` call has not been reached after three or more
subsequent runs -- that improvement is stalled and needs a different approach.

## The nudge

The `nudge.py` hook (`hooks/nudge.py`) fires on `Stop` and `SubagentStop`, at
most once per 15-minute window. It asks: did this turn produce a reusable lesson?
If yes, use `record_improvement` to persist a metric-backed entry AND capture a
claude-mem lesson only when the pattern has repeated at least 3 times and is not
already in memory.

When to capture a claude-mem lesson:
- The user corrects or rejects the work ("no, it should be...", "I prefer X",
  "stop doing Y") -- and the correction applies across projects.
- A command, API, or build step fails in a non-obvious way and the failure is
  likely to recur.
- A pattern has occurred 3+ times in different sessions.

Do not capture:
- One-time instructions or file-specific context.
- Hypotheticals.
- Lessons already present in memory (check first with `memory_search`).
- Inferences from silence -- wait for explicit correction or repeated evidence.

Capture format for claude-mem:

```
TYPE:    Decision | Pattern | Error | Constraint | Preference
CONTEXT: project / feature / library@version
LESSON:  one or two sentences -- what to do differently next time
SOURCE:  file:line or command + observed result
```

Cite the source of any memory-derived action. Keep new lessons tentative until
they repeat; promoting too fast pollutes the hot set.
