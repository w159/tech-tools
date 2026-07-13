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

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$COMMAND" ] && exit 0

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
SQL_WRITE='(\bDELETE[[:space:]]+FROM\b|\bINSERT[[:space:]]+INTO\b|\bREPLACE[[:space:]]+INTO\b|\bMERGE[[:space:]]+INTO\b|\bUPDATE[[:space:]]+[A-Za-z0-9_."`]+[[:space:]]+SET\b|\bTRUNCATE([[:space:]]+TABLE)?[[:space:]]|\b(DROP|CREATE|ALTER)[[:space:]]+((OR[[:space:]]+REPLACE|TEMP(ORARY)?|UNLOGGED|GLOBAL|LOCAL)[[:space:]]+)*(TABLE|DATABASE|SCHEMA|INDEX|VIEW|MATERIALIZED|SEQUENCE|TRIGGER|FUNCTION|ROLE|USER|EXTENSION|POLICY|PUBLICATION|AGGREGATE)\b|\b(GRANT|REVOKE)[[:space:]]+.+[[:space:]]+ON[[:space:]]+|\bCOPY[[:space:]]+[^;|]+[[:space:]]+(FROM|TO)\b)'
if echo "$COMMAND" | grep -iE "$SQL_WRITE" > /dev/null; then
  echo "Blocked: read-only audit. SQL write, DDL, and privilege statements are not allowed." >&2
  exit 2
fi

exit 0
