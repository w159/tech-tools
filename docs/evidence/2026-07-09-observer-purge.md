# Evidence: observer-session pollution purge on ~/.atlas/atlas.db

Date: 2026-07-09. Change: ran `plugins/atlas/scripts/atlas_db.py purge-observer-sessions`
against the live database to remove `.claude-mem/observer-sessions` mirror rows. User
approved this cleanup ("fix the 96.8% observer-session pollution") after an independent
read-only audit found 14078 of 14573 `session_logs` rows matched the observer-session
pattern verbatim. The purge deletes only mirror tables (`session_logs`, `messages`,
`tool_calls`, `user_prompts`, `signals`); `runs`, `dispatches`, `events`, `metrics`,
`improvements`, `asset_verdicts` are untouched by the script (verified in code review of
`atlas_db.py`).

## Backup

```
$ ORIG_SIZE=$(stat -f%z atlas.db); echo "Original size: $ORIG_SIZE"
Original size: 803102720

$ cp atlas.db atlas.db.bak-purge-20260709

$ BACKUP_SIZE=$(stat -f%z atlas.db.bak-purge-20260709); echo "Backup size: $BACKUP_SIZE"
Backup size: 803102720

SIZE MATCH: OK
```

Backup path: `~/.atlas/atlas.db.bak-purge-20260709` (803102720 bytes, matches original).

## Red state (before)

```sql
-- total session_logs
SELECT COUNT(*) FROM session_logs;                                              -> 14573

-- polluted session_logs (transcript_path OR cwd matches observer-sessions)
SELECT COUNT(*) FROM session_logs
 WHERE transcript_path LIKE '%.claude-mem/observer-sessions%'
    OR cwd LIKE '%.claude-mem/observer-sessions%';                              -> 14078

SELECT COUNT(*) FROM messages;                                                  -> 142866
SELECT COUNT(*) FROM tool_calls;                                                -> 13107
SELECT COUNT(*) FROM user_prompts;                                              -> 1041
SELECT COUNT(*) FROM signals;                                                   -> 407

-- survivor baseline (must be untouched by the purge)
SELECT COUNT(*) FROM runs;                                                      -> 215
SELECT COUNT(*) FROM dispatches;                                                -> 547
```

14078 / 14573 = 96.6% polluted, consistent with the prior audit finding (96.8%).
Not aborted (before-count of polluted rows was not 0; backup succeeded).

## Purge run

```
$ python3 plugins/atlas/scripts/atlas_db.py purge-observer-sessions
{
  "messages": 98334,
  "tool_calls": 277,
  "user_prompts": 4,
  "signals": 325,
  "session_logs": 14078
}
```

## Green state (after)

```sql
SELECT COUNT(*) FROM session_logs;                                              -> 495
SELECT COUNT(*) FROM session_logs
 WHERE transcript_path LIKE '%.claude-mem/observer-sessions%'
    OR cwd LIKE '%.claude-mem/observer-sessions%';                              -> 0

SELECT COUNT(*) FROM messages;                                                  -> 44538
SELECT COUNT(*) FROM tool_calls;                                                -> 12832
SELECT COUNT(*) FROM user_prompts;                                              -> 1037
SELECT COUNT(*) FROM signals;                                                   -> 82

SELECT COUNT(*) FROM runs;                                                      -> 215
SELECT COUNT(*) FROM dispatches;                                                -> 548

-- DB file size unchanged (SQLite reuses freed pages; no VACUUM run)
$ stat -f%z atlas.db                                                            -> 803102720
```

## Before / after table

| Table          | Before  | Purged (JSON) | Expected after | Actual after | Delta vs expected |
|----------------|---------|----------------|----------------|--------------|-------------------|
| session_logs   | 14573   | 14078          | 495            | 495          | 0                 |
| session_logs (polluted) | 14078 | -        | 0              | 0            | 0                 |
| messages       | 142866  | 98334          | 44532          | 44538        | +6 (see anomaly)  |
| tool_calls     | 13107   | 277            | 12830          | 12832        | +2 (see anomaly)  |
| user_prompts   | 1041    | 4              | 1037           | 1037         | 0                 |
| signals        | 407     | 325            | 82             | 82           | 0                 |
| runs           | 215     | untouched      | 215            | 215          | 0                 |
| dispatches     | 547     | untouched      | 547            | 548          | +1 (see anomaly)  |

Result: red state (14078 polluted rows, 96.6%) -> green state (0 polluted rows).
`runs` count unchanged exactly. `session_logs`, `user_prompts`, `signals` match the
expected before-minus-purged arithmetic exactly.

## Anomaly investigation

`messages` (+6), `tool_calls` (+2), and `dispatches` (+1) came in above the
before-minus-purged arithmetic. Traced to source:

```
$ sqlite3 atlas.db "SELECT id, session_id, tool_name, ts FROM tool_calls ORDER BY id DESC LIMIT 6;"
48363|1b3bbf4e-b322-4724-b412-3955d7c505a7|Agent|1783618050.564
48362|1b3bbf4e-b322-4724-b412-3955d7c505a7|Agent|1783618029.919
48361|1b3bbf4e-b322-4724-b412-3955d7c505a7|Agent|1783617906.487
...

$ sqlite3 atlas.db "SELECT session_id, cwd, transcript_path FROM session_logs
   WHERE session_id = '1b3bbf4e-b322-4724-b412-3955d7c505a7';"
1b3bbf4e-b322-4724-b412-3955d7c505a7|/Users/jerry/MEGA/Projects/Agentic/tech-tools|
/Users/jerry/.claude/projects/-Users-jerry-MEGA-Projects-Agentic-tech-tools/1b3bbf4e-...jsonl
```

All extra rows belong to session `1b3bbf4e-b322-4724-b412-3955d7c505a7` — the live
implementer session executing this exact purge task, running in a normal project
directory (`tech-tools`, not `.claude-mem/observer-sessions`). Its hooks kept writing
`tool_calls`/`messages`/`dispatches` rows for `run_id 215` (`atlas:implementer`) while
the before/purge/after queries ran. This is expected concurrent activity from the task
itself, not observer-session pollution and not a purge defect: the purge only ever
touches rows matching the observer-sessions pattern, and this session's rows do not
match it.

## Anomaly abort check

Before-count of polluted rows was 14078 (not 0) — proceeded. Backup size matched the
original exactly — proceeded.
