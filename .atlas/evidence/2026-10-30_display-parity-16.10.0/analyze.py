import re,glob,os,sys
base='/tmp/claude-0/-home-user-tech-tools/efb6ce52-9f4c-5fae-93ab-1aadb2a05a17/scratchpad/cap'
def frame(f):
    t=open(f,encoding='utf-8',errors='replace').read().split('\n')
    n=sum(1 for l in t if re.match(r'^\s*◯ ',l))
    hdr=None;rows=0;more=0
    for i,l in enumerate(t):
        m=re.match(r'^\s*Subagents · (\d+) running',l)
        if m:
            hdr=int(m.group(1))
            for r in t[i+1:]:
                l2=r.split('│')[0] if False else r
                if re.match(r'^\s*[├└]─ [•◑●○✓✖]',l2) or re.match(r'^\s*[└├]─ \S.*(explorer|implementer|verifier|auditor|runner|agent)',l2): rows+=1
                elif re.match(r'^\s*[├└]─ … (\d+) more',l2): more+=int(re.search(r'… (\d+) more',l2).group(1))
                elif re.match(r'^\s*[├└] ?─? ?… (\d+) more',l2): more+=int(re.search(r'… (\d+) more',l2).group(1))
                else: break
            break
    return n,hdr,rows,more
for run in sys.argv[1:]:
    viol=[];multi=0;detail=[]
    for f in sorted(glob.glob(f'{base}/{run}/*.txt')):
        n,hdr,rows,more=frame(f); fid=os.path.basename(f)[:-4]
        if n>=1:
            ok = hdr is not None and hdr==n and rows+more==n
            if n>=2: multi+=1
            detail.append((fid,n,hdr,rows,more,ok))
            if not ok: viol.append(fid)
    print(f'== {run}: frames with CC list N>=1: {len(detail)} (N>=2: {multi}); violations: {len(viol)}')
    print('   violating frames:',' '.join(viol))
    if '-v' in os.environ.get('V',''):
        for d in detail: print('  ',d)
