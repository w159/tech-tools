#!/bin/bash
# validate-readonly-query.sh
# PreToolUse(Bash) guard for read-only audits. Blocks SQL writes, DDL, and privilege
# changes so audit subagents cannot mutate the database. Coarse and fail-safe: it errs
# toward blocking. Word boundaries keep it from tripping on column names like
# updated_at or create_time.
#
# Wire it into a subagent or session as a PreToolUse hook on the Bash matcher, e.g.:
#   "hooks": { "PreToolUse": [ { "matcher": "Bash",
#     "hooks": [ { "type": "command", "command": "<path>/validate-readonly-query.sh" } ] } ] }

# Fail closed: a missing dependency must block, never silently allow.
for dep in jq perl; do
  if ! command -v "$dep" > /dev/null 2>&1; then
    echo "Blocked: read-only guard cannot run because '$dep' is not installed. Install it (fail-closed)." >&2
    exit 2
  fi
done

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$COMMAND" ] && exit 0

# Keep the raw command: a `--` or `/*` inside a quoted SQL string is not a comment, so
# stripping can swallow real statements (psql -c 'SELECT 1 -- x'; DROP TABLE users).
# Write keywords are checked against BOTH the raw and the comment-stripped text.
RAW=$(printf '%s' "$COMMAND" | tr '\n' ' ')

# Strip SQL comments before matching so write verbs and object types cannot hide
# inside /* */ block comments (e.g. UPDATE/**/users/**/SET) or -- line comments.
# perl -0777 slurps the whole command so multi-line block comments are handled.
COMMAND=$(printf '%s' "$COMMAND" | perl -0777 -pe 's{/\*.*?\*/}{ }gs; s{--[^\n]*}{}g')
# Collapse newlines to spaces so grep's [[:space:]]+ can span former line
# breaks. Without this, splitting a pattern's own tokens across a newline
# (e.g. "UPDATE users\nSET ...") evades the line-based match below.
COMMAND=$(printf '%s' "$COMMAND" | tr '\n' ' ')

# Match only real SQL write/DDL/privilege STRUCTURE, not bare verbs. This keeps
# ordinary shell usage from tripping the guard: find -delete, str.replace(),
# "create a file", git update-index, revoke_meeting_access, etc. all pass.
# Still case-insensitive and still errs toward blocking on genuine SQL.
SQL_WRITE='(\bDELETE[[:space:]]+FROM\b|\bINSERT[[:space:]]+INTO\b|\bREPLACE[[:space:]]+INTO\b|\bMERGE[[:space:]]+INTO\b|\bUPDATE[[:space:]]+(ONLY[[:space:]]+)?[]A-Za-z0-9_."`[]+([[:space:]]+(AS[[:space:]]+)?[A-Za-z0-9_]+)?[[:space:]]+SET\b|(^|[^-A-Za-z0-9_])DELETE[[:space:]]+(ONLY[[:space:]]+)?[]A-Za-z0-9_."`[]+([[:space:]]*;|[[:space:]]*$|[[:space:]]+(WHERE|USING|RETURNING)\b)|\bDROP[[:space:]]+(TYPE|OWNED|DOMAIN|PROCEDURE|ROUTINE|RULE|SERVER|TABLESPACE|OPERATOR|CAST|COLLATION|TRIGGER|LANGUAGE|STATISTICS)\b|\bCALL[[:space:]]+[A-Za-z0-9_."]+[[:space:]]*\(|\bVACUUM[[:space:]]+FULL\b|\bREINDEX[[:space:]]+(DATABASE|SYSTEM|SCHEMA|TABLE|INDEX)\b|\bEXEC(UTE)?[[:space:]]+(sp_|xp_)|\bTRUNCATE([[:space:]]+TABLE)?[[:space:]]|\b(DROP|CREATE|ALTER)[[:space:]]+((OR[[:space:]]+REPLACE|TEMP(ORARY)?|UNLOGGED|GLOBAL|LOCAL)[[:space:]]+)*(TABLE|DATABASE|SCHEMA|INDEX|VIEW|MATERIALIZED|SEQUENCE|TRIGGER|FUNCTION|ROLE|USER|EXTENSION|POLICY|PUBLICATION|AGGREGATE)\b|\b(GRANT|REVOKE)[[:space:]]+.+[[:space:]]+ON[[:space:]]+|\bCOPY[[:space:]]+[^;|]+[[:space:]]+(FROM|TO)\b)'
# State-changing statements the structural list above does not name: server-level config, anonymous
# code blocks, backend control, remote execution through dblink, session-privilege switches that could
# lift a read-only role, and the MySQL/SQLite file and global-setting writers. Functions are matched only
# as `name(` so a column called nextval_count or a log line mentioning set_config still passes.
STATE_FUNCS='pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_switch_wal|pg_switch_xlog|pg_create_restore_point|pg_promote|pg_drop_replication_slot|pg_create_(physical|logical)_replication_slot|pg_replication_slot_advance|pg_replication_origin_(create|drop|advance)|pg_logical_emit_message|pg_stat_reset[a-z_]*|pg_wal_replay_(pause|resume)|pg_(start|stop)_backup|pg_backup_(start|stop)|pg_file_write|pg_file_unlink|pg_file_rename|set_config|lo_(import|export|create|unlink|from_bytea|put)|lowrite|dblink[a-z_]*|nextval|setval'
SQL_STATE='(\bALTER[[:space:]]+(SYSTEM|TYPE|DEFAULT|SERVER|FOREIGN|EVENT|SUBSCRIPTION|OPERATOR|DOMAIN|RULE|TABLESPACE|COLLATION|LANGUAGE|PROCEDURE|ROUTINE|LARGE|STATISTICS|CONVERSION)\b|\b(CREATE|DROP)[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?(SUBSCRIPTION|FOREIGN|SERVER|EVENT|OPERATOR|TYPE|DOMAIN|TABLESPACE|COLLATION|LANGUAGE|PROCEDURE|ROUTINE|RULE|STATISTICS|TRANSFORM|CAST|CONVERSION)\b|\bDO[[:space:]]+(LANGUAGE\b|\\*\$[A-Za-z0-9_]*\\*\$|["'"'"'][[:space:]]*(DECLARE|BEGIN)\b)|\b('"$STATE_FUNCS"')[[:space:]]*\(|\bSELECT\b[^;|&]*[[:space:]]INTO[[:space:]]+[A-Za-z_"]|\bINTO[[:space:]]+(OUTFILE|DUMPFILE)\b|\bLOAD[[:space:]]+DATA\b|\bSET[[:space:]]+((SESSION|LOCAL)[[:space:]]+)?(ROLE|AUTHORIZATION|GLOBAL|PERSIST|PERSIST_ONLY|transaction_read_only|default_transaction_read_only)\b|\b(BEGIN|START[[:space:]]+TRANSACTION|SET[[:space:]]+TRANSACTION)[^;]*[[:space:]]READ[[:space:]]+WRITE\b|\bLOCK[[:space:]]+TABLE\b|\bCOMMENT[[:space:]]+ON[[:space:]]+(TABLE|COLUMN|SCHEMA|FUNCTION|INDEX|VIEW|DATABASE|ROLE|SEQUENCE|EXTENSION|TYPE|CONSTRAINT|TRIGGER)\b|\bSECURITY[[:space:]]+LABEL\b|\bREFRESH[[:space:]]+MATERIALIZED\b|\bIMPORT[[:space:]]+FOREIGN\b|\bATTACH[[:space:]]+DATABASE\b|\bPRAGMA[[:space:]]+[A-Za-z_.]+[[:space:]]*=|\bVACUUM[[:space:]]+INTO\b)'
if echo "$COMMAND" | grep -iE "$SQL_WRITE|$SQL_STATE" > /dev/null || echo "$RAW" | grep -iE "$SQL_WRITE|$SQL_STATE" > /dev/null; then
  echo "Blocked: read-only audit. SQL write, DDL, and privilege statements are not allowed." >&2
  exit 2
fi

exit 0
