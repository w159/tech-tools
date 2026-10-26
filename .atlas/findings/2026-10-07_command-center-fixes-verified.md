# command-center-fixes-verified: Independent re-verification of 10.2.0 fixes: colony guard, open-file/open-editor root rejection, settings timeout+Retry, nav normalisation all reproduced; suites green. Non-blocking defects: rail ignores nav_order; DB-known home children (~/.codex, ~/.claude, ~/MEGA, ~/Downloads) are openable

- id: command-center-fixes-verified
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-07T10:24:04+00:00

## Evidence
- (1) session_boot x3 isolated ATLAS_HOME, ATLAS_DASHBOARD=off, stub bun/node/herdr-web-ui on PATH vs live stack: stub log empty, pgrep managed.ts 1->1, 'bun server/index.ts' 1->1; lines 'colony: checking' (cold cache) then 'colony ready at http://127.0.0.1:7317' x2; curl 17317 rc=7 refused. Seeded cache {healthy:false,web_ui_down,upstream_plugin_on_port:true,url:17317} x3 -> 'colony: http://127.0.0.1:7317 (ready)', no ensure log, no stub call; same with upstream flag false. No-stack sim (fake herdr socket, HERDR_WEB_URL free port, ps/port probes patched, stub bun): 2 concurrent boots -> 2 detached flock-guarded ensure processes, exactly 1 'bun scripts/plugin.ts start', 2nd ensure action=reused. (2) isolated dashboard on sqlite .backup of real DB (projects has '/', home, /private/tmp, TMPDIR), stub herdr/tode: 22 hostile cases (/ /etc home /tmp /private/tmp TMPDIR /Users, symlink root+path to /etc, prefix-sibling of a known root, ../ and absolute escapes) -> 403 (unknown_root/path_outside_root), 0 stub spawns; missing/wrong X-Atlas-Token -> 401, 0 spawns; repo root -> 200, argv 'herdr plugin pane open --plugin herdr-file-viewer --entrypoint file-viewer --placement split --direction right --focus --env HERDR_FILE_VIEWER_ROOT=<repo> --env HERDR_FILE_VIEWER_OPEN=README.md:3', 'tode --goto <repo>/README.md:7:1', 'tode <repo>'; repeat within 10s -> 429. Real-DB roots ~/.agents, ~/.codex/auth.json, ~/.claude/settings.json, ~/MEGA, ~/Downloads, ~/.config/cmux -> 200 + tode spawned (~/.ssh -> 403). (3) playwright-core+Chrome vs isolated dashboard: #/settings content in 5/5 loads each for dark, light (?theme=light, data-theme=light), mobile 390 dark and light; 0 console/page errors; 0 'Loading' left. /api/connectors delayed 20s: 3 Loading at 5s, 'Connectors unavailable: timed_out' + Retry at 15.7s; Retry -> request 2, section loads, error gone. Seeded old nav_order [overview,activity,health,colony,work,irc,improve,projects,settings] via PUT prefs + localStorage: editor shows Overview,Activity,Health,Agents,Self-improvement,Projects,Settings,Herdr console (no aliases, no dupes, all 8); Move Projects up persists in server prefs and after reload; rail is fixed GROUPS order and does NOT change (app.js buildNav never reads nav_order). (4) sweep once: 59/60 cells, deep 10/10; only fail overview/desktop/dark textLen=16, the screenshot shows full content (measured before render: harness race). (5) hooks 1169 OK (3 skipped); scripts 1460 passed (test_atlas_remote passed too); omp 353 pass 0 fail; tsc rc 0; /var/folders/t4/3yydl26s5mqb99t84qw3_wrm0000gn/T//.atlas and /tmp/.atlas absent. (6) scorecard hook_session_boot p50 43.98ms p95 49.64ms (n=15); 20-run harness cold p50 57.7 p95 60.7, warm p50 54.9 p95 81.3 ms. (7) single stack managed.ts(ppid1)->supervisor.ts->server/index.ts, cwd ~/.atlas/colony/herdr-web-ui; 1 herdr server; my processes and temp dirs removed; 14 secret values (stack env + local token files) plus key patterns: 0 hits in .atlas/.run/evidence.

## Reproduction
ATLAS_HOME=$(mktemp -d) ATLAS_DASHBOARD=off PATH=<stubdir>:$PATH python3 plugins/atlas/hooks/session_boot.py < SessionStart.json (x3, then with the seeded herdr-status-cache.json); atlas_dashboard.py serve --foreground --port <free> on a sqlite .backup DB, then curl POST /api/v2/open-file|open-editor; bun pw.mjs (playwright-core, route delay 20s); bun .atlas/.run/evidence/sweep/run.mjs; the three suites as dispatched; atlas_scorecard.py run --only hook_latency

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
