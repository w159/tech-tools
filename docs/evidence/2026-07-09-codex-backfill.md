# Codex Session Backfill — Evidence Capture

Date: 2026-07-09
Operator: atlas:implementer (approved data-ingestion run, no code changes)
DB: `~/.atlas/atlas.db`
Script: `plugins/atlas/scripts/session_ingest.py --backfill-agent codex`
Source: `~/.codex/sessions` (~53MB of rollout-*.jsonl)

## Context

The codex ingest adapter (`codex_adapter` / `ingest_agent_session` / `backfill_agent`
in `plugins/atlas/scripts/session_ingest.py`) had already been independently
verified as idempotent, observer-excluded, and secret-scrubbed. The user
approved chronicling all coding agents' sessions. This run executes the real
backfill for the first time; prior to this run `session_logs` had zero
`agent='codex'` rows.

## Step 1 — BEFORE evidence (read-only)

```
$ sqlite3 ~/.atlas/atlas.db "SELECT COUNT(*) FROM session_logs;"
495

$ python3 -c "
import sqlite3
conn = sqlite3.connect('~/.atlas/atlas.db')
cols = [r[1] for r in conn.execute('PRAGMA table_info(session_logs)').fetchall()]
print('columns:', cols)
"
columns: ['id', 'session_id', 'project_id', 'transcript_path', 'cwd', 'git_branch', 'model',
'started_at', 'ended_at', 'message_count', 'user_prompt_count', 'tool_call_count', 'error_count',
'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'cursor_bytes',
'cursor_lines', 'file_size', 'file_mtime', 'last_ingest_at']
```

The live DB predates the `agent` column entirely (it is added by an idempotent
`ALTER TABLE ... ADD COLUMN agent TEXT DEFAULT 'claude'` migration inside
`atlas_db.init()`, additive-only, run automatically on the next connection).
Since the column had never been added and only the claude ingest path had ever
run, this is direct confirmation that the codex count was 0 before this run:
there was no mechanism by which a codex row could exist. Total row count
before: **495** (all implicitly claude, confirmed after migration below).

## Step 2 — Backup and DELETE/UPDATE audit of the codex path

Backup file confirmed present and untouched:

```
$ ls -la ~/.atlas/atlas.db ~/.atlas/atlas.db.bak-purge-20260709
-rw-r--r--@ 1 jerry  staff  803102720 Jul  9 13:48 /Users/jerry/.atlas/atlas.db
-rw-r--r--@ 1 jerry  staff  803102720 Jul  9 13:27 /Users/jerry/.atlas/atlas.db.bak-purge-20260709
```

Per the task instructions, no new backup was taken for this additive
INSERT-only operation; instead the codex ingest code path was audited for any
DELETE/UPDATE that could touch existing claude rows:

```
$ grep -n "backfill_agent\|def ingest_agent_session\|DELETE\|UPDATE" \
    plugins/atlas/scripts/session_ingest.py
596:def ingest_agent_session(path, adapter, conn=None, session_id=None):
830:def backfill_agent(agent, root=None, conn=None):
```

Zero DELETE or UPDATE literals in `session_ingest.py` itself. Followed the
call graph into `atlas_db.py`:

```
$ grep -n "\"UPDATE\|'UPDATE\|\"DELETE\|'DELETE" plugins/atlas/scripts/atlas_db.py
138:  UPDATE runs SET kind='worker' ...            (runs table, unrelated to session_logs)
147:  UPDATE runs SET kind='orchestrator' ...       (runs table, unrelated)
210:  UPDATE runs SET orchestrating=1 WHERE id=?     (runs table, unrelated)
321:  UPDATE runs SET ended_at=?, wall_clock_s=? ... (runs table, unrelated)
452:  UPDATE runs SET kind=? WHERE id=?              (runs table, unrelated)
536:  DELETE FROM asset_verdicts ...                 (asset_verdicts table, unrelated)
558:  UPDATE asset_verdicts SET applied=1 ...         (asset_verdicts table, unrelated)
567:  UPDATE asset_verdicts SET restored=1 ...        (asset_verdicts table, unrelated)
704:  UPDATE tool_calls SET is_error=?, result_bytes=? WHERE tool_use_id=?   <- used by codex path
745:  UPDATE session_logs SET ... WHERE session_id=:s                        <- used by codex path
764:  DELETE FROM {tbl} WHERE session_id=?           (reset_session_rows — cursor-reset utility,
                                                       NOT called by ingest_agent_session/backfill_agent)
803/807: DELETE FROM ... WHERE session_id IN (...)  (purge_observer_sessions — one-shot CLI cleanup,
                                                       NOT called by ingest_agent_session/backfill_agent)
```

Findings:
- `update_tool_result` (line 704) is scoped by `WHERE tool_use_id=?`. Codex
  `tool_use_id` values are codex's own `call_id` (a distinct namespace from
  claude's `toolu_*` ids), so this cannot touch claude tool_call rows.
- `refresh_session_aggregates`'s `UPDATE session_logs` (line 745) is scoped by
  `WHERE session_id=:s` to the codex session being ingested; it cannot touch
  any other session's row.
- The two DELETE-bearing functions (`reset_session_rows`,
  `purge_observer_sessions`) are not reachable from `ingest_agent_session` or
  `backfill_agent` — confirmed by reading both call sites; they are invoked
  only by the claude cursor-reset path and a separate one-shot purge CLI.

**Result: no DELETE/UPDATE in the codex ingest path can touch existing claude
rows. Abort condition not triggered. Proceeded to run the backfill.**

## Step 3 — Backfill run

```
$ time python3 plugins/atlas/scripts/session_ingest.py --backfill-agent codex
  ...200 codex sessions
Backfilling codex sessions from ~/.codex/sessions ...
{
  "files": 238,
  "messages": 1981,
  "tools": 3264,
  "prompts": 296,
  "signals": 12,
  "agent": "codex",
  "seconds": 0.5
}
python3 --backfill-agent codex  0.28s user 0.08s system 68% cpu 0.532 total
```

## Step 4 — AFTER evidence

```
$ sqlite3 ~/.atlas/atlas.db "SELECT COUNT(*) FROM session_logs;"
665

$ sqlite3 ~/.atlas/atlas.db "SELECT agent, COUNT(*) FROM session_logs GROUP BY agent;"
claude|495
codex|170

$ sqlite3 ~/.atlas/atlas.db "SELECT COUNT(*) FROM session_logs WHERE agent='claude';"
495

$ sqlite3 ~/.atlas/atlas.db "SELECT COUNT(*) FROM session_logs WHERE agent='codex' AND
    (transcript_path LIKE '%.claude-mem/observer-sessions%' OR cwd LIKE '%.claude-mem/observer-sessions%');"
0
```

### Before / after by-agent table

| Agent  | Before | After | Delta |
|--------|-------:|------:|------:|
| claude |    495 |   495 |     0 |
| codex  |      0 |   170 |  +170 |
| Total  |    495 |   665 |  +170 |

Claude row count is byte-identical before/after: **495 = 495**. Codex rows
went from 0 to 170. Zero codex rows match the observer-session marker path.

### Reconciliation of files-processed (238) vs. rows-written (170)

The ingest JSON reports `"files": 238"` but only 170 codex `session_logs`
rows were written. Independently walked the raw `~/.codex/sessions` tree to
explain the gap:

```
$ python3 reconcile_codex_sids.py
total files: 238
distinct session_meta ids: 238
synthetic cwd matches: 68
session ids with >1 file: 0
```

238 distinct session ids, no duplicate files per session id, and exactly 68
of them carry a `.claude-mem/observer-sessions` cwd marker.
`238 - 68 = 170`, matching the actual row count exactly. This confirms the
codex path's observer-session exclusion is working correctly at the
per-session (not just per-file) level — `ingest_agent_session` returns
zeroed stats without writing a `session_logs` row when the cwd resolves to
an observer mirror, exactly as designed. Not an anomaly.

## Step 5 — Spot-check and secret scan

Three codex `session_logs` rows (most recent by `started_at`):

| session_id | model | message_count | tool_call_count | started_at | ended_at |
|---|---|---|---|---|---|
| 019f26d4-12e3-77a3-ac3f-cbcc5706d5bf | gpt-5.5 | 2 | 1 | 1783062860.515 | 1783062867.329 |
| 019f26b7-9db9-7d02-a0cb-6ccaea38cd39 | gpt-5.5 | 2 | 0 | 1783060995.513 | 1783061000.153 |
| 019f26b6-1937-7721-844c-5eb8cc285f8d | gpt-5.5 | 2 | 0 | 1783060896.055 | 1783060900.696 |

Values are plausible: real codex model id, non-zero/consistent message and
tool-call counts, monotonically ordered timestamps a few seconds apart. No
invented-looking data.

Secret-pattern scan:

```
$ sqlite3 ~/.atlas/atlas.db "
SELECT COUNT(*) FROM tool_calls tc
JOIN session_logs sl ON tc.session_id = sl.session_id
WHERE sl.agent='codex'
  AND (tc.input_summary LIKE '%AKIA%' OR tc.input_summary LIKE '%Bearer %');
"
3
```

**Anomaly: 3 rows matched, not the expected 0.** Inspected all three:

```
session_id: 019e025f-cc54-7900-9c46-a4142e0998dc
tool_name: exec_command
excerpt: {"cmd": "TOKEN=\"$(gcloud auth print-access-token)\"; curl -fsS -H
  \"Authorization: Bearer ${TOKEN}\" \"https://identitytoolkit.googleapis.com/
  admin/v2/projects/first-responders-project/config\", ...}
```

All three are `exec_command` tool calls containing the literal shell template
`Bearer ${TOKEN}` — an unresolved shell variable reference, not an
interpolated credential value. `input_summary` captures the command text as
written in the codex transcript (pre-execution argument text); no runtime
substitution occurred in the stored summary, so the actual OAuth token value
was never captured or stored. **Determination: false positive on the LIKE
pattern, not a leaked secret.** No remediation needed; recorded here for
transparency since the task's expected result (0 rows) was not literally
met.

## Step 6 — Idempotency proof

```
$ time python3 plugins/atlas/scripts/session_ingest.py --backfill-agent codex
  ...200 codex sessions
Backfilling codex sessions from ~/.codex/sessions ...
{
  "files": 238,
  "messages": 1981,
  "tools": 3264,
  "prompts": 296,
  "signals": 12,
  "agent": "codex",
  "seconds": 0.3
}
python3 --backfill-agent codex  0.26s user 0.04s system 97% cpu 0.308 total

$ sqlite3 ~/.atlas/atlas.db "SELECT agent, COUNT(*) FROM session_logs GROUP BY agent;"
claude|495
codex|170
```

Identical JSON summary and identical by-agent counts on re-run.
**Idempotency confirmed.**

## Summary

- BEFORE: 495 total rows, 0 codex rows (column didn't exist, no codex ingest
  had ever run).
- Ingest path audited: zero DELETE/UPDATE in `session_ingest.py`'s codex
  path; the two UPDATEs it does invoke in `atlas_db.py` are scoped by the
  codex session's own `session_id`/`tool_use_id` and cannot touch claude
  rows; the DELETE-bearing functions are not on the codex call path.
- Backfill run: 238 codex rollout files processed, 170 `session_logs` rows
  written (68 correctly excluded as observer-session mirrors — reconciled
  exactly), 1981 messages, 3264 tool calls, 296 prompts, 12 signals, 0.5s.
- AFTER: 665 total rows = 495 claude (unchanged) + 170 codex. 0 codex rows
  under the observer-sessions path.
- Spot-check: 3 codex rows have plausible non-invented values (real model
  id, consistent counts, ordered timestamps).
- Secret scan: 3 rows matched the LIKE pattern; all confirmed false
  positives (`Bearer ${TOKEN}` shell template, no literal credential).
- Re-run: identical summary and counts. Idempotent.
