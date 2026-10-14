## a. before
/Users/jerry/.agents/skills/rigs:
total 0
drwxr-xr-x@  2 jerry  staff    64 Oct 14 14:39 .
drwxr-xr-x@ 46 jerry  staff  1472 Oct 14 14:39 ..

/Users/jerry/.claude/skills/rigs:
total 0
drwxr-xr-x@  2 jerry  staff    64 Oct 14 14:39 .
drwxr-xr-x@ 46 jerry  staff  1472 Oct 14 14:39 ..
codex before:
total 283608
drwx------  103 jerry  staff       3296 Oct 14 06:50 .
drwxr-x---@ 133 jerry  staff       4256 Oct 14 14:39 ..
-rw-r--r--@   1 jerry  staff     154052 Oct  7 15:47 .codex-global-state.json
-rw-r--r--@   1 jerry  staff     154052 Oct  7 15:47 .codex-global-state.json.bak
-rw-r--r--@   1 jerry  staff      28676 Oct  8 10:34 .DS_Store
-rw-------    1 jerry  staff          3 Apr 16 08:12 .personality_migration
-rw-------@   1 jerry  staff          3 Aug 26 18:46 .sandbox_migration
-rw-r--r--@   1 jerry  staff          0 Oct  6 10:18 .sqlite-maintenance.lock
drwxr-xr-x  110 jerry  staff       3520 Oct  7 15:45 .tmp
drwxr-xr-x    3 jerry  staff         96 May 16 15:56 .vscode
drwxr-xr-x@ 243 jerry  staff       7776 Oct  7 06:32 agents
lrwxr-xr-x    1 jerry  staff         58 Jul 10 22:20 AGENTS.md -> /Users/jerry/MEGA/Projects/Agentic/osprey/assets/AGENTS.md
-rw-------@   1 jerry  staff       8834 Jul 10 19:50 AGENTS.md.bak
drwxr-xr-x@   6 jerry  staff        192 Sep 16 06:23 ambient-suggestions
drwx------@   3 jerry  staff         96 Oct  7 07:12 app-server-control
drwx------@  11 jerry  staff        352 Oct  7 07:12 app-server-daemon
-rw-------@   1 jerry  staff       4697 Oct  7 06:33 auth.json
-rw-r--r--    1 jerry  staff        235 Jun  2 02:34 azure-codex.config.toml
-rw-r--r--    1 jerry  staff        229 Jun  2 02:34 azure-gpt.config.toml
## b. ensure
{
  "ok": true,
  "action": "started",
  "url": "http://127.0.0.1:7437",
  "running": true,
  "healthy": true,
  "state": "ok",
  "pid": 24425,
  "rig_version": "0.6.10",
  "installed": true,
  "rig_home": "/Users/jerry/.atlas/openrig/home"
}
{"status":"ok","pid":24425,"semver":"0.6.10","commit":"3001cc436656c435e54425443e708e3e2d8c7d68","dirty":false,"builtAt":"2026-10-11T22:36:45Z","selfHostId":"host-0482b116","selfHostIdSource":"generated","eventLoop":{"lagMeanMs":10.88622276923077,"lagP99Ms":12.951551,"utilization":0.13292023282896498,"lastTickAgeMs":161,"healthy":true},"routeTimings":{},"slowOperations":{"healthy":true},"bind":{"mode":"explicit","hosts":["127.0.0.1"],"tailscaleDetected":true},"stuckSweep":{"lastSweepAt":"2026-10-14T18:39:37.465Z","lastOutcome":"clean","lastError":null,"consecutiveFailures":0,"findingsRouted":0},"wakeLadder":{"lastTickAt":null,"lastOutcome":null,"lastError":null,"consecutiveFailures":0,"activeLadders":0,"escalationsOpen":0,"exhaustedTotal":0}}
COMMAND   PID  USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node    24425 jerry   27u  IPv4 0x227f993b47adcd71      0t0  TCP 127.0.0.1:7437 (LISTEN)
## c. after
/Users/jerry/.agents/skills/openrig-skills:
total 0
drwxr-xr-x@  2 jerry  staff    64 Oct 14 14:39 .
drwxr-xr-x@ 46 jerry  staff  1472 Oct 14 14:39 ..

/Users/jerry/.agents/skills/refocusing:
total 0
drwxr-xr-x@  2 jerry  staff    64 Oct 14 14:39 .
drwxr-xr-x@ 46 jerry  staff  1472 Oct 14 14:39 ..

/Users/jerry/.agents/skills/rigs:
total 0
drwxr-xr-x@  2 jerry  staff    64 Oct 14 14:39 .
drwxr-xr-x@ 46 jerry  staff  1472 Oct 14 14:39 ..

/Users/jerry/.claude/skills/openrig-skills:
total 0
drwxr-xr-x@  2 jerry  staff    64 Oct 14 14:39 .
drwxr-xr-x@ 46 jerry  staff  1472 Oct 14 14:39 ..

/Users/jerry/.claude/skills/refocusing:
total 0
drwxr-xr-x@  2 jerry  staff    64 Oct 14 14:39 .
drwxr-xr-x@ 46 jerry  staff  1472 Oct 14 14:39 ..

/Users/jerry/.claude/skills/rigs:
total 0
drwxr-xr-x@  2 jerry  staff    64 Oct 14 14:39 .
drwxr-xr-x@ 46 jerry  staff  1472 Oct 14 14:39 ..
[openrig] [plugin-vendor] global skill 'rigs' at /Users/jerry/.claude/skills/rigs is unversioned/external authority; leaving it unchanged
[openrig] [plugin-vendor] global skill 'rigs' at /Users/jerry/.agents/skills/rigs is unversioned/external authority; leaving it unchanged
kernel-boot: OPENRIG_NO_KERNEL=1 — skipping kernel auto-boot
kernel-boot: tracker-state=skipped
workflow boot sweep: 0 in-flight instances (no-op)
[gateway] slack delivery not configured (connector disabled (rig slack enable)) — wire is inert; dispatches would be refused honestly
[gateway] gateway subsystem active (in-process)
OpenRig daemon listening on http://127.0.0.1:7437
codex after:
total 283608
drwx------  103 jerry  staff       3296 Oct 14 06:50 .
drwxr-x---@ 133 jerry  staff       4256 Oct 14 14:39 ..
-rw-r--r--@   1 jerry  staff     154052 Oct  7 15:47 .codex-global-state.json
-rw-r--r--@   1 jerry  staff     154052 Oct  7 15:47 .codex-global-state.json.bak
-rw-r--r--@   1 jerry  staff      28676 Oct  8 10:34 .DS_Store
-rw-------    1 jerry  staff          3 Apr 16 08:12 .personality_migration
-rw-------@   1 jerry  staff          3 Aug 26 18:46 .sandbox_migration
-rw-r--r--@   1 jerry  staff          0 Oct  6 10:18 .sqlite-maintenance.lock
drwxr-xr-x  110 jerry  staff       3520 Oct  7 15:45 .tmp
drwxr-xr-x    3 jerry  staff         96 May 16 15:56 .vscode
drwxr-xr-x@ 243 jerry  staff       7776 Oct  7 06:32 agents
lrwxr-xr-x    1 jerry  staff         58 Jul 10 22:20 AGENTS.md -> /Users/jerry/MEGA/Projects/Agentic/osprey/assets/AGENTS.md
-rw-------@   1 jerry  staff       8834 Jul 10 19:50 AGENTS.md.bak
drwxr-xr-x@   6 jerry  staff        192 Sep 16 06:23 ambient-suggestions
drwx------@   3 jerry  staff         96 Oct  7 07:12 app-server-control
drwx------@  11 jerry  staff        352 Oct  7 07:12 app-server-daemon
-rw-------@   1 jerry  staff       4697 Oct  7 06:33 auth.json
-rw-r--r--    1 jerry  staff        235 Jun  2 02:34 azure-codex.config.toml
-rw-r--r--    1 jerry  staff        229 Jun  2 02:34 azure-gpt.config.toml
## d. round trip
create1 {'ok': True, 'pane_id': 'w-probe@atlas-live', 'workspace_id': 'atlas-live', 'tab_id': None, 'name': 'probe', 'run': 'atlas-live'}
create2 {'ok': False, 'reason': 'rig up failed (rc=1):'}
agents {"reachable": true, "reason": null, "workspaces": [{"workspace_id": "atlas-live", "label": "atlas-live", "focused": false, "agent_status": null, "pane_count": 1}], "agents": [{"pane_id": "w-probe@atlas-live", "workspace_id": "atlas-live", "workspace": "atlas-live", "tab_id": null, "name": "probe", "agent": "terminal", "status": "unknown", "cwd": "", "title": "w-probe@atlas-live", "focused": false, "state_change_seq": null, "completion_seq": null, "deep_link": "tmux attach -t w-probe@atlas-live"}]}
panes [{'pane_id': 'w-probe@atlas-live', 'workspace_id': 'atlas-live', 'workspace': 'atlas-live', 'tab_id': None, 'label': 'probe', 'cwd': ''}]
capture w-probe@atlas-live {"ok":true,"sessionName":"w-probe@atlas-live","content":"\n/tmp $ echo LIVE_OK_$RANDOM\nLIVE_OK_23572\n/tmp $\n","lines":4,"omittedLines":0,"requestedLines":10}
 
True
close {'ok': True, 'closed': ['probe'], 'panes': ['w-probe@atlas-live']}
gone
## e. status
{
  "running": true,
  "healthy": true,
  "state": "ok",
  "url": "http://127.0.0.1:7437",
  "pid": 24425,
  "rig_version": "0.6.10",
  "installed": true,
  "rig_home": "/Users/jerry/.atlas/openrig/home"
}
## d2. second worker after rig add fix (rig up/--existing returns rig_name_running)
{'ok': True, 'pane_id': 'w-probe@atlas-live', 'workspace_id': 'atlas-live', 'tab_id': None, 'name': 'probe', 'run': 'atlas-live'}
{'ok': True, 'pane_id': 'w-probe2@atlas-live', 'workspace_id': 'atlas-live', 'tab_id': None, 'name': 'probe2', 'run': 'atlas-live'}
['w-probe@atlas-live', 'w-probe2@atlas-live']
{"ok":true,"sessionName":"w-probe@atlas-live","content":"\n/tmp $ echo LIVE_OK_$RANDOM\nLIVE_OK_9447\n/tmp $\n","lines":4,"omittedLines":0,"requestedLines":10}
 True
{"ok":true,"sessionName":"w-probe2@atlas-live","content":"\n/tmp $ echo LIVE_OK2_$RANDOM\nLIVE_OK2_10899\n/tmp $\n","lines":4,"omittedLines":0,"requestedLines":10}
 True
{'ok': True, 'closed': ['probe', 'probe2'], 'panes': ['w-probe@atlas-live', 'w-probe2@atlas-live']}
gone
## e2. final status
{
  "running": true,
  "healthy": true,
  "state": "ok",
  "url": "http://127.0.0.1:7437",
  "pid": 24425,
  "rig_version": "0.6.10",
  "installed": true,
  "rig_home": "/Users/jerry/.atlas/openrig/home"
}
## verdicts
| check | result |
|---|---|
| bind-loopback-only | PASS: lsof shows only 127.0.0.1:7437; healthz bind.hosts=[127.0.0.1] |
| skills-quarantined | PASS: six dirs empty; daemon.log 'unversioned/external authority; leaving it unchanged' (note: dirs were already empty before step a, 14:39) |
| codex-home-untouched | PASS: ~/.codex/config.toml mtime Oct 14 14:32 (spike time), unchanged by this run |
| create-pane | PASS |
| agents-mapping | PASS: agents() lists w-probe@atlas-live (status unknown, cwd empty) |
| capture-roundtrip | PASS: LIVE_OK_23572 in capture |
| second-worker | FAIL then fixed: rig up --existing rejects with rig_name_running; now uses rig add atlas-live w frag.json; PASS |
| close-run | PASS: closed both, tmux ls gone |
