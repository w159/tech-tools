#!/bin/bash
# usage: arm.sh <single|lean|atlas|old> <run-label>
set -u
B=/tmp/claude-0/-home-user/f7cc7cab-6754-5976-b57d-d0817aade866/scratchpad/bench
ARM=$1; LABEL=$2; FIX=${FIX:-fixture}; OUT=$B/runs/$FIX-$ARM-$LABEL; rm -rf $OUT; mkdir -p $OUT
cp -r $B/$FIX/task $OUT/work; cd $OUT/work && git init -q && git add -A && git commit -qm base
MODEL=claude-sonnet-5-5; EFFORT=medium
TASK="$(cat $B/$FIX/task.txt)"
TASK_UNUSED=" \`python3 -m pytest -q\` passes in this directory. Do not modify the tests. Work until the whole suite passes."
SCRUB="-u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_REMOTE_SESSION_ID"
LEAN_ENV="-u CLAUDE_MEMORY_STORES -u CLAUDE_COWORK_MEMORY_PATH_OVERRIDE -u CLAUDE_CODE_POST_TURN_MEMORY -u CLAUDE_CODE_POST_TURN_MEMORY_CONFIG -u CLAUDE_CODE_ENABLE_CFC -u CLAUDE_CODE_ENABLE_REMOTE_RECAP -u CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION"
T0=$(date +%s.%N)
case $ARM in
 single)
  env $SCRUB claude -p "$TASK" --output-format stream-json --verbose --model $MODEL --effort $EFFORT --permission-mode acceptEdits --allowedTools Bash < /dev/null > $OUT/lead.log 2>&1 ;;
 lean)
  env $SCRUB $LEAN_ENV claude -p "$TASK" --output-format stream-json --verbose --model $MODEL --effort $EFFORT --permission-mode acceptEdits --allowedTools Bash --strict-mcp-config --setting-sources project,local --disable-slash-commands --no-chrome --tools Bash,Read,Edit,Write,Grep,Glob < /dev/null > $OUT/lead.log 2>&1 ;;
 old)
  MUX=/home/user/tech-tools/plugins/atlas/scripts/atlas_mux.py
  LP="$TASK

Run this as an Atlas tmux team (Atlas 16.2.0 flow): write task.md with shared context first, then one '## member: <role>[-N]' section per member (members in order: planner, implementer, implementer-2, implementer-3, verifier); then
  python3 $MUX spawn-team --class implement --effort high --paths pkgkit --task-file task.md --root \$PWD
  python3 $MUX wait --team <team_id> --root \$PWD   (repeat until every member reported)
  python3 $MUX reap --team <team_id> --root \$PWD
Workers coordinate over the team channel (atlas_todo notes). After the team finishes, make sure the result is in this directory and \`python3 -m pytest -q\` passes."
  env $SCRUB claude -p "$LP" --output-format stream-json --verbose --model $MODEL --effort $EFFORT --permission-mode acceptEdits --allowedTools Bash < /dev/null > $OUT/lead.log 2>&1 ;;
 atlas)
  CREW=/home/user/tech-tools/plugins/atlas/scripts/atlas_crew.py
  LP="$TASK

Run this as an Atlas crew (parallel lean workers in tmux that coordinate on an IRC channel). $(cat $B/crew_howto2.md | sed "s#{CREW}#$CREW#g; s#{MODEL}#$MODEL#g; s#{EFFORT}#$EFFORT#g; s#{FILES}#$(cat $B/$FIX/files.txt)#g; s#{TESTS}#$(cat $B/$FIX/tests.txt)#g")"
  env $SCRUB claude -p "$LP" --output-format stream-json --verbose --model $MODEL --effort $EFFORT --permission-mode acceptEdits --allowedTools Bash < /dev/null > $OUT/lead.log 2>&1 ;;
 skill)
  PD=${PD:-/home/user/tech-tools/plugins/atlas}
  SP="/atlas:atlas-crew --spec SPEC.md --files '$(cat $B/$FIX/files.txt)' --tests '$(cat $B/$FIX/tests.txt)' --check 'python3 -m pytest -q' --model $MODEL --effort $EFFORT"
  env $SCRUB claude -p "$SP" --plugin-dir $PD --output-format stream-json --verbose --model $MODEL --effort $EFFORT --permission-mode acceptEdits --allowedTools Bash < /dev/null > $OUT/lead.log 2>&1 ;;
 warmp)
  PD=${PD:-/home/user/tech-tools/plugins/atlas}; WL=$PD/scripts/atlas_warm_lead.py
  SP="/atlas:atlas-crew --spec SPEC.md --files '$(cat $B/$FIX/files.txt)' --tests '$(cat $B/$FIX/tests.txt)' --check 'python3 -m pytest -q' --model $MODEL --effort $EFFORT"
  env $SCRUB python3 $WL start --root $OUT/work --recycle off -- claude --plugin-dir $PD --model $MODEL --effort $EFFORT --permission-mode acceptEdits --allowedTools Bash > $OUT/warm_start.json 2>&1
  sleep ${WARM_IDLE:-5}
  T0=$(date +%s.%N)
  python3 $WL send --root $OUT/work --wait --timeout 900 "$SP" > $OUT/warm_send.json 2>&1
  T1W=$(date +%s.%N)
  python3 $WL stop --root $OUT/work > $OUT/warm_stop.json 2>&1
  cp $OUT/work/.atlas/.run/warm/lead/lead.log $OUT/lead.log ;;
 singlew)
  WARM_IDLE=0 python3 $B/warmlead.py $OUT "$TASK" claude -p --input-format stream-json --output-format stream-json --verbose --model $MODEL --effort $EFFORT --permission-mode acceptEdits --allowedTools Bash
  T0=$(python3 -c "import json;print(json.load(open('$OUT/warm.json'))['t_send'])") ;;
 warm)
  PD=${PD:-/home/user/tech-tools/plugins/atlas}
  SP="/atlas:atlas-crew --spec SPEC.md --files '$(cat $B/$FIX/files.txt)' --tests '$(cat $B/$FIX/tests.txt)' --check 'python3 -m pytest -q' --model $MODEL --effort $EFFORT"
  python3 $B/warmlead.py $OUT "$SP" claude -p --input-format stream-json --plugin-dir $PD --output-format stream-json --verbose --model $MODEL --effort $EFFORT --permission-mode acceptEdits --allowedTools Bash
  T0=$(python3 -c "import json;print(json.load(open('$OUT/warm.json'))['t_send'])") ;;
esac
T1=$(date +%s.%N)
[ "$ARM" = warmp ] && T1=$T1W
[ "$ARM" = warm -o "$ARM" = singlew ] && T1=$(python3 -c "import json;print(json.load(open('$OUT/warm.json'))['t_result'])")
python3 -m pytest -q -p no:cacheprovider tests > $OUT/final_pytest.txt 2>&1; RC=$?
git status --porcelain tests > $OUT/tests_touched.txt
python3 - "$OUT" "$T0" "$T1" "$RC" "$ARM" <<'PY'
import json,sys,glob,re
sys.path.insert(0,"/tmp/claude-0/-home-user/f7cc7cab-6754-5976-b57d-d0817aade866/scratchpad/bench")
from acct import acct
out,t0,t1,rc,arm=sys.argv[1],float(sys.argv[2]),float(sys.argv[3]),int(sys.argv[4]),sys.argv[5]
logs=[out+"/lead.log"]+sorted(glob.glob(out+"/work/.atlas/.run/crew/*/logs/*.log"))+sorted(glob.glob(out+"/work/.atlas/.run/logs/*.log"))
parts={}; tot={"total":0,"cost":0.0}
for l in logs:
    a=acct(l); parts[l.split("/")[-1]]={"total":a["total"],"cost":round(a["cost"],4),"turns":a["turns"]}
    tot["total"]+=a["total"]; tot["cost"]+=a["cost"]
txt=open(out+"/final_pytest.txt").read()
m=re.search(r"(\d+) passed",txt); f=re.search(r"(\d+) failed",txt)
res={"arm":arm,"wall_s":round(t1-t0,1),"pytest_rc":rc,"passed":int(m.group(1)) if m else 0,"failed":int(f.group(1)) if f else 0,
     "tests_touched":open(out+"/tests_touched.txt").read().strip(),"tokens":tot["total"],"cost_usd":round(tot["cost"],3),"parts":parts}
json.dump(res,open(out+"/result.json","w"),indent=1); print(json.dumps({k:res[k] for k in ("arm","wall_s","pytest_rc","passed","failed","tokens","cost_usd","tests_touched")}))
PY
