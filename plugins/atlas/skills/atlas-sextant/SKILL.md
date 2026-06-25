---
name: atlas-sextant
description: Use to measure atlas's own run health from the SQLite observability DB and propose metric-backed improvements to atlas's behavior. Emits RUN METRICS (wall-clock, inline-ops, dispatches, parallel waves, context, recall, verifier coverage) and MEASURABLE IMPROVEMENTS (baseline -> target). On no args, reports cross-run/cross-project trends. The atlas Stop/SubagentStop nudge hook points here.
---

# atlas-sextant

Atlas improves by measuring itself. Each run emits quantitative signals to the
global SQLite observability DB at `~/.atlas/atlas.db` (env `ATLAS_DB`). This
skill reads those signals, surfaces the run's health scores, and proposes
improvements that carry explicit baselines and targets -- no qualitative-only
entries accepted.

## Single source of truth

The global SQLite DB at `~/.atlas/atlas.db` (env `ATLAS_DB`), populated by the
hooks and read via `scripts/atlas_db.py`. Access it through the public functions
below -- never parse raw files or rely on memory alone.

Files are NOT the SSOT for run metrics. claude-mem is the narrative layer only:
use it to store a lesson that survived three or more runs, not as the primary
record.

Public functions in `atlas_db.py`:

- `connect(path)` -- open the DB (creates if absent)
- `init(conn)` -- create schema
- `register_project(conn, name, root)` -- upsert project row
- `start_run(conn, project_id, model, session_id)` -- open a run, returns run_id
- `current_run_id(conn)` -- most recent open run for this session
- `log_event(conn, run_id, kind, detail)` -- append an event
- `log_dispatch(conn, run_id, agent_type, wave, prompt_tokens)` -- record a dispatch
- `inline_ops_since_last_dispatch(conn, run_id)` -- count inline ops since the last dispatch
- `finalize_run(conn, run_id, status)` -- close the run
- `run_metrics(conn, run_id) -> dict` -- return the metrics row for a run
- `record_improvement(conn, run_id, dimension, baseline, target, note)` -- persist a proposed improvement
- `trends(conn, limit) -> list` -- cross-run/cross-project trend rows (most recent `limit` runs)

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

## Measurable improvements

Every proposed improvement MUST carry an explicit `baseline -> target` and be
persisted via `record_improvement(conn, run_id, dimension, baseline, target, note)`.
No qualitative-only entries.

Example workflow:

```python
# requires plugins/atlas/scripts on sys.path (the hooks insert it; do the same here)
import atlas_db, os

conn = atlas_db.connect(os.environ.get("ATLAS_DB", os.path.expanduser("~/.atlas/atlas.db")))
run_id = atlas_db.current_run_id(conn)
metrics = atlas_db.run_metrics(conn, run_id)

# Example: verifier coverage was 0.6 this run
if metrics["verifier_coverage"] < 1.0:
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
law (1-7 in atlas-engine) that the metric signals was violated.

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
