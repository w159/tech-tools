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

if echo "$COMMAND" | grep -iE '\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|MERGE|GRANT|REVOKE|COPY)\b' > /dev/null; then
  echo "Blocked: read-only audit. SQL write, DDL, and privilege statements are not allowed." >&2
  exit 2
fi

exit 0
