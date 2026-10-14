# OpenRig spike evidence (2026-10-14)

Runtime: PFX=$HOME/.atlas/openrig, RIG=$PFX/npm/node_modules/.bin/rig, OPENRIG_HOME=$PFX/home, OPENRIG_PORT=7437, OPENRIG_NO_KERNEL=1.

## 1. Preflight
    node --version -> v22.23.1
    npm --version  -> 10.9.8
    tmux -V        -> tmux 3.8
    which rig      -> rig not found
    ls -la ~/.openrig -> No such file or directory

## 2. Private install
    npm install --prefix $PFX/npm @openrig/cli@0.6.10 -> added 115 packages in 2s
    ls $PFX/npm/bin/rig -> No such file or directory
    ls $PFX/npm/node_modules/.bin/rig -> exists
    $RIG --version -> 0.6.10 (3001cc43)

## 3. Daemon
    $RIG daemon start --no-kernel --port 7437 -> Daemon started on port 7437 (pid 78491)
    curl /healthz -> {"status":"ok","pid":78491,"semver":"0.6.10",...,"bind":{"mode":"default","hosts":["127.0.0.1","100.78.157.97"],"tailscaleDetected":true}...}
    daemon.json -> {"pid":78491,"port":7437,"host":"127.0.0.1","db":"/Users/jerry/.atlas/openrig/home/openrig.sqlite","startedAt":"2026-10-14T18:32:46.998Z"}
    daemon.log tail -> ... kernel-boot: OPENRIG_NO_KERNEL=1 — skipping kernel auto-boot / OpenRig daemon listening on http://127.0.0.1:7437
    $RIG daemon status -> Daemon running on port 7437 (pid 78491)
    ls -la ~/.openrig -> ls: /Users/jerry/.openrig: No such file or directory

## 4. Rig up
Spec: /Users/jerry/.atlas/openrig/spike/rig.yaml. First attempt (spec as dispatched) rejected:

    {"error":"Source is YAML but not a valid rig spec: pods[0].label: required non-empty string"}

Fix: add `label: Worker` to the pod (pods require `label`). Then:

    rig up ... --yes --json -> {"runId":"01M4XV0RRY34FDMQBJ3D08YQHB","status":"completed",...,"nodes":[{"logicalId":"w.probe","status":"launched"}],"warnings":["w.probe: permission_policy absent; launch_posture=floor"],"attachCommand":"tmux attach -t w-probe@atlas-spike"}
    rig ps --json -> [{"rigId":"01M4XV0RS2TCHMQGG48XGHEMNG","name":"atlas-spike","nodeCount":1,"runningCount":1,"status":"running",...}]
    rig ps --nodes --rig atlas-spike --json -> [{"logicalId":"w.probe","canonicalSessionName":"w-probe@atlas-spike","runtime":"terminal","sessionStatus":"running","startupStatus":"ready",...}]
    tmux ls | grep atlas-spike -> w-probe@atlas-spike: 1 windows (created Wed Oct 14 14:32:57 2026)

Note: `rig ps --nodes` without `--rig <name>` or `-A` errors ("no target").

## 5. Round trip
Attempt 1, plain `rig send` (adds a From/To envelope, so the shell parses envelope text and fails):

    capture -> "...To: w-probe@atlas-spike\nSent: 10-14 18:33Z\n---\necho ATLAS_SPIKE_OK_$(date +%s)\n---\n...zsh: parse error near `\n'"
    (token NOT executed)

Alternative (documented in `rig send --help`): `--raw` sends exact text with no envelope.

    rig send --raw 'w-probe@atlas-spike' 'echo ATLAS_SPIKE_OK_$(date +%s)' --json -> {"ok":true,...,"warning":"producer-link: no activity hook ..."}
    rig capture 'w-probe@atlas-spike' --lines 6 --json -> "...spike $ echo ATLAS_SPIKE_OK_$(date +%s)\nATLAS_SPIKE_OK_1792002791\nspike $\n"

Both sends return ok:true with a producer-link warning (advisory, terminal seats have no activity hook).

## 6. Teardown
    rig down atlas-spike --delete --json -> {"rigId":"01M4X...","sessionsKilled":1,"snapshotId":"01M4XV18MCP7DP0Y7NDW9TAA2R","deleted":true,"deleteBlocked":false,"errors":[]}
    tmux ls | grep atlas-spike -> gone
    rig daemon stop -> Daemon stopped
    curl healthz http code -> 000 (down)
    ls ~/.openrig -> No such file or directory
    du -sh $PFX -> 99M

## VERDICT
| item | result | proving line |
|---|---|---|
| install-private-prefix | PASS | added 115 packages in 2s; --version 0.6.10 (3001cc43) |
| bin-path | PASS | /Users/jerry/.atlas/openrig/npm/node_modules/.bin/rig (npm/bin/rig does not exist) |
| daemon-start-detached | PASS | "Daemon started on port 7437 (pid 78491)", command returned, healthz status ok, kernel skipped |
| no-writes-to-home-openrig | PASS for ~/.openrig | ls: /Users/jerry/.openrig: No such file or directory (before and after). See surprise 1 for other global writes |
| terminal-seat-up | PASS (after fix) | startupStatus ready, tmux w-probe@atlas-spike; spec needs pod `label` |
| send-capture-roundtrip | PASS with --raw only | ATLAS_SPIKE_OK_1792002791 in capture; plain send fails (envelope) |
| down-clean | PASS | sessionsKilled 1, deleted true, tmux gone, healthz 000 |

## Surprises
1. Daemon boot logs "[plugin-vendor] global skill 'rigs'/'openrig-skills'/'refocusing' ... leaving it unchanged". Dirs exist at ~/.claude/skills/rigs and ~/.agents/skills/rigs, and the session skill list gained openrig-skills, refocusing, rigs after the daemon ran. So the daemon touches (and probably created) global skill dirs outside the private prefix, ignoring OPENRIG_HOME. [unverified whether this run created them; check mtimes. Needs a decision before adoption: this is a "skills written by a background process" concern under the user's no-auto-skills rule.]
2. Pod `label` is required by the 0.2 spec (dispatch YAML lacked it).
3. Plain `rig send` wraps text in a From/To envelope; use `--raw` to drive a shell seat. `rig capture` content includes the envelope text and a trailing prompt line.
4. Daemon binds 127.0.0.1 AND the Tailscale address 100.78.157.97 (bind mode "default"), so it is reachable on the tailnet. Needs a bind restriction check before real use.
5. plugin-vendor fetch of openrig-core returned 404, falls back to vendored (network call at boot).
6. `rig ps --nodes` needs `--rig <name>` or `-A`.
7. Timing: install 2s (npm cache warm), daemon healthy within 3s, rig up about 1s. Whole spike about 40s. Disk 99M for $PFX.
8. State left in place: $PFX/npm install and $PFX/home (openrig.sqlite, topology). Daemon stopped.
