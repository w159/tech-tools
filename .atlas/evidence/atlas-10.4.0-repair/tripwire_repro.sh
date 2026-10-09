#!/bin/bash
# Pipe omp-bridge-shaped PreToolUse payloads through the tree's dispatch_tripwire.py.
set -u
P=/Users/jerry/MEGA/Projects/Agentic/tech-tools/plugins/atlas
T=$(mktemp -d)
R=$T/repo; mkdir -p $R && cd $R && git init -q && printf 'def f():\n    return 1\n' > app.py
export ATLAS_DB=$T/atlas.db ATLAS_HOME=$T/home ATLAS_HOOKSTATE_DIR=$T/hs ATLAS_DASHBOARD=off ATLAS_COLONY=off ATLAS_GATES=always ATLAS_CHANNELS=off
unset ATLAS_TRIPWIRE_HARD ATLAS_WORKER_NAME
mkdir -p $ATLAS_HOME $ATLAS_HOOKSTATE_DIR
S=sess-repro
python3 - <<EOF
import sys; sys.path.insert(0,"$P/scripts")
import atlas_db as d
c=d.connect(); d.init(c); pid=d.register_project(c,"$R"); d.start_run(c,pid,"$S"); d.mark_orchestrating(c,"$S","$R"); c.close()
EOF
hook(){ # event tool json [worker]
  python3 -c "import json,sys;print(json.dumps({'session_id':'$S','hook_event_name':'$1','tool_name':'$2','tool_input':json.loads(sys.argv[1]),'cwd':'$R'}))" "$3" \
   | env ${4:+ATLAS_WORKER_NAME=$4} python3 $P/hooks/dispatch_tripwire.py
}
for who in W ""; do
  echo "=== ${who:-LEAD (no ATLAS_WORKER_NAME)} ==="
  echo "-- PreToolUse Edit app.py"
  hook PreToolUse Edit "{\"file_path\":\"$R/app.py\",\"old_string\":\"1\",\"new_string\":\"2\"}" "$who"
  for i in 1 2 3 4 5 6 7; do
    hook PostToolUse Bash "{\"command\":\"make t$i\"}" "$who" >/dev/null
  done
  echo "-- PreToolUse Bash (8th op)"
  hook PreToolUse Bash '{"command":"make t8"}' "$who"
done
