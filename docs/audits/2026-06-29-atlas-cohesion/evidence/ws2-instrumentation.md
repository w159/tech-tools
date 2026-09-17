# WS2 evidence - instrumentation wiring

Date: 2026-06-30. Branch: atlas-ws2-instrumentation. DB: `~/.atlas/atlas.db`.

## Headline: most of WS2 was already shipped (spec predates v2.2.3 + WS1)

The program-spec WS2 list described a system where `dispatches=0`, builtins were misclassified,
and metrics were unfilled. None of that is still true. Verified against the live DB and code; the
only net-new work is the recall signal.

## Live-DB snapshot (proves the instrumentation already works)

```
dispatches rows: 28                       # dispatch logging works (spec claimed 0)
tool kind dist: agent=45, builtin=6866, mcp=1125, skill=97   # classifier correct
metrics rows: 45 | wall_clock_s non-null: 40                 # derive + finalize populate
Bash (builtin) errors: 252 / 3435 (7.3%)                     # real is_error flags, not all-1
```

Read/Bash/Edit/Write are all `kind='builtin'` with realistic error rates - the spec's
"builtins tagged `kind='skill'`/`is_error=1`" bug does not exist in the current code.

## Existing test coverage maps to every WS2 acceptance claim (no new tests needed - DRY)

| WS2 claim | Existing test |
|---|---|
| dispatch logged for Agent/Task | `hooks/test_dispatch_tripwire.py::test_dispatch_logged_after_run_finalized`, `::test_hooks_json_matcher_includes_dispatch_tools` |
| builtins classified `kind='builtin'` | `scripts/test_session_ingest.py::test_tool_classification` (asserts `tc_bash -> 'builtin'`) |
| `is_error` from the real result | `scripts/test_session_ingest.py::test_result_join_marks_error` |
| dispatch resets inline counter | `hooks/test_dispatch_tripwire.py::test_dispatch_resets` |

The spec said to add `hooks/test_dispatch_logging.py` and a classifier unit test; both behaviors are
already covered, so adding new files would duplicate existing coverage (violates the repo's
no-redundant-tests rule). Coverage was confirmed, not re-created.

## Net-new: the recall signal (the one real gap)

`recall_hits`/`recall_misses` were never populated (0/45 rows) and were deliberately left underived
("usable" is a judgment). WS2 fills them via an honest engine self-report at Orient.

- `atlas_db.record_recall(conn, run_id, hit)` increments the recall column; CLI verb
  `record-recall <session> hit|miss`.
- `plugins/atlas/scripts/test_atlas_db.py::test_record_recall_increments_and_survives_derive`:
  2 hits + 1 miss -> `recall_hits=2, recall_misses=1`, and a `derive_run_metrics` refresh leaves
  them UNCHANGED (the derive upsert omits the recall columns).
- CLI end-to-end (temp DB):
  ```
  $ atlas_db.py mark-orchestrating sid-x /tmp/x   -> orchestrating run 1 for session sid-x
  $ atlas_db.py record-recall sid-x hit           -> recorded recall hit for run 1
  $ atlas_db.py record-recall sid-x miss          -> recorded recall miss for run 1
  metrics: {'recall_hits': 1, 'recall_misses': 1}
  ```
- `atlas-engine/SKILL.md` Orient step now calls `record-recall "${CLAUDE_CODE_SESSION_ID}" hit|miss`
  after its memory lookup (same env-var lesson as WS1).

## Corrections to the spec (honest reconciliation)

- "Add a new hook -> count becomes 9": NO new hook needed (dispatch logging already rides
  `dispatch_tripwire`). Hook count stays 8. Fixed `plugins/atlas/README.md:33` which miscounted the
  `hooks/` dir as "9 hooks" (it is 8 auto-loaded + the `validate-readonly-query.sh` guard script).
- "recall ... intentionally NOT derived": updated `atlas-sextant/SKILL.md` to describe recall as
  recorded live by the engine Orient signal (still refinable by sextant on review).

## Suites
`python3 -m unittest discover -s scripts` -> 28 OK; `-s hooks` -> 19 OK.

## Note
Mid-WS2 the repo's `.git` was reverted by Google Drive sync (working tree + refs). All commit
objects survived; `main` was repointed to `cc6e9ac`, tagged `ws-recovery`, and PUSHED to origin so
the work is durable. Drive sync was paused before WS2 resumed.
