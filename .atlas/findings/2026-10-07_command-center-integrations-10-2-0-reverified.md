# command-center-integrations-10.2.0-reverified: Independent re-verification of command-center-integrations 10.2.0 fixes (single-instance colony, open-file/editor root guard, settings/sweep, colony gate p, channels)

- id: command-center-integrations-10.2.0-reverified
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-07T10:54:34+00:00

## Evidence
- (1) suites: hooks unittest Ran 1169 OK (skipped=3); scripts pytest 1469 passed 0 failed (test_atlas_remote did not fail this run, so the 2 allowed env failures did not occur); omp bun test 353 pass 0 fail; typecheck rc=0; node test-mcp-tools.mjs PASS rc=0; lint_skill_names OK; lint_docs_names OK (956 paths); contrast ALL PAIRS PASS; generateAgents into temp outDir 13 files, diff -r identical; no .atlas under $TMPDIR or /tmp
- (2) single instance: 1 managed.ts(15385 ppid 1) -> supervisor.ts(15388) -> server/index.ts(15390 cwd ~/.atlas/colony/herdr-web-ui, listens 7317); 17317/27317/37317/47317 free; the other server/index.ts pids are sweep-harness hosts (ppid = bun run.mjs). session_boot x3 in temp ATLAS_HOME with stub bun + herdr-web-ui on PATH: 'colony: checking', 'colony ready at :7317' x2; stub log 0 bytes; count 5->5. Forced stale web_ui_down cache (url :17317) -> 'colony: http://127.0.0.1:7317 (ready)', 0 spawns. test_session_boot_colony.py: each no-spawn test asserts popen==[] or ensures()==[]; only test_no_stack_and_herdr_up_one_guarded_ensure expects exactly one ensure (intended)
- (3) root guard, isolated dashboard + sqlite .backup DB copy (projects still contain '/' and '/Users/jerry'): open-file {/etc,/etc/hosts} 403; {/,/etc/hosts} 403; {/Users/jerry,~/.zshrc} 403; open-editor /etc/hosts 403; ~/.zshrc 403 (unknown_root), argv log 0 bytes; no token 401; repo root README.md line 3 -> 200 argv 'herdr plugin pane open --plugin herdr-file-viewer ... HERDR_FILE_VIEWER_OPEN=plugins/atlas/README.md:3'; open-editor 200 argv 'tode --goto .../README.md:3:1'
- (4) sweep run.mjs x3: run1 cells 60/60 deep 6/10 at load 69 (herdr iframe frames=0, projects hint, settings integrations text, path:line 'Request context disposed' unhandled route error) = timing flake; run2 60/60 10/10; run3 (load 9->5) 60/60 10/10. Theme deep check now asserts data-theme, computed body bg and saved pref all change: dark rgb(12,18,21) -> light rgb(242,246,247) prefs light. Screenshots viewed: settings fully rendered (no skeleton; topbar 'No agents', rail 'Loading agents' at capture), overview KPIs + needs-attention + trend, fleet 3 agent cards, channel lens 'No channels in these projects yet' + project chips, herdr console pane with view-only notice, projects mobile 390 cards + 'Reading herdr-projects'
- (5) session_boot 20 runs, temp ATLAS_HOME, ATLAS_DASHBOARD=off, load 14.2/9.2/7.9: colony on p50 58.6 ms p95 77.0; colony off p50 51.0 p95 54.3 (baseline 62 ms HEAD); no >100 ms figure
- (6) pytest test_omp_transcript.py: 44 passed under default env and ATLAS_GATES=always; test_condition_p_blocks_when_workers_dispatched_and_channel_silent and test_condition_p_passes_when_worker_posted_to_lead_subchannel PASSED; completion_gate.py:1049-1060 colony_failing = workers>=2 and not _colony_channel_used; omp_transcript.py product diff is formatting + 3 MCP server names only
- (7) temp git repo on feature/x: main fvrepo@feature/x; sub fvrepo@feature/x/lead (parent main, members lead/A/B/C role subagent parent lead); A->B note lands on the lead subchannel; inboxes B=1 A=0 C=0; only A.jsonl written
- (8) secrets regex scan of .atlas/.run/evidence + 769 untracked files: only fixtures colony/herdr-web-ui/server/voice.test.ts 'sk-test-0123456789abcdef' and colony/herdr-web-ui/scripts/ssh-integration.ts 'herdr-fixture-secret-only'; no live X-Atlas-Token in evidence

## Reproduction
/tmp/fv/suites.sh; /tmp/fv/rootguard.py; /tmp/fv/sweep.sh + one more bun .atlas/.run/evidence/sweep/run.mjs; session_boot with PATH=/tmp/fv/stub:$PATH ATLAS_HOME=$(mktemp -d); python3 -m pytest -q scripts/test_omp_transcript.py [ATLAS_GATES=always]

## Proposed fix
none recorded

## Doc refs
- plugins/atlas/hooks/session_boot.py:68-202
- plugins/atlas/scripts/atlas_integrations.py:577-765
- plugins/atlas/hooks/completion_gate.py:1049-1060
- plugins/atlas/hooks/test_session_boot_colony.py
- .atlas/.run/evidence/sweep/run.mjs:149-158

## History
- no earlier verdicts
