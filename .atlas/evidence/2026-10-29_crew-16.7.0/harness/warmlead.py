"""Warm lead driver: start the lead, wait until it is idle and ready, hand it the task,
time from hand-off to the turn's result event. Writes t_send/t_result/t_exit to <out>/warm.json."""
import subprocess,time,json,os,sys,threading
out,prompt=sys.argv[1],sys.argv[2]; cmd=sys.argv[3:]
env={k:v for k,v in os.environ.items() if k not in("CLAUDE_CODE_SESSION_ID","CLAUDE_CODE_REMOTE_SESSION_ID")}
log=open(out+"/lead.log","w"); seen={"ready":False,"result":None,"results":[]}
t_start=time.time()
p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,env=env)
def rd():
    for l in p.stdout:
        log.write(l); log.flush()
        if '"type":"autocompact_state"' in l: seen["ready"]=time.time()
        if '"type":"result"' in l:
            seen["results"].append(time.time())
            if seen["result"] is None: seen["result"]=time.time()
threading.Thread(target=rd,daemon=True).start()
while not seen["ready"]: time.sleep(0.05)
time.sleep(float(os.environ.get("WARM_IDLE","5")))   # lead sits idle and warm before the task arrives
t_send=time.time()
p.stdin.write(json.dumps({"type":"user","message":{"role":"user","content":prompt}})+"\n"); p.stdin.flush()
while seen["result"] is None and p.poll() is None: time.sleep(0.02)
t_res=seen["result"] or time.time()
p.stdin.close(); p.wait(); t_exit=time.time()
# background agents can end the first turn early and add later turns: the work ends at the LAST result
json.dump({"t_start":t_start,"t_ready":seen["ready"],"t_send":t_send,"t_result_first":t_res,"t_result":(seen["results"] or [t_res])[-1],"results":len(seen["results"]),"t_exit":t_exit},open(out+"/warm.json","w"))
