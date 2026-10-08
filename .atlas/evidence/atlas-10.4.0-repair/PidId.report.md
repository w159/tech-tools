STATUS: DONE (omp bun test criterion not met; failures pre-existing, not this slice)
STEPS: 5/5
FILES_CHANGED: plugins/atlas/scripts/atlas_todo.py; plugins/atlas/scripts/atlas_dash_colony.py; plugins/atlas/scripts/test_atlas_dash_colony.py; plugins/atlas/scripts/test_atlas_channels.py; plugins/atlas/README.md
EVIDENCE:
1. full suite (spec command) -> "2716 passed, 3 skipped, 422 subtests passed in 191.41s", 0 failed; /tmp/atlas-fix/suite7.txt
2. after last edits (ps moved outside registry lock; dead-pid test uses reaped Popen(["true"])): pytest test_atlas_dash_colony.py test_atlas_channels.py hooks/test_atlas_contract.py -> "129 passed, 3 skipped, 78 subtests passed"
3. dashboard_ui/js bun test -> "23 pass, 0 fail"
4. omp bun test -> "340 pass, 16 fail" (dispatch_tripwire/bridge/F8 gate tests); clean HEAD worktree baseline -> "339 pass, 17 fail". Pre-existing; worktree removed (git worktree list shows no /tmp/atlas-fix/base).
5. `ps -o lstart= -p $$` -> "Thu Oct  8 11:36:18 2026" (available on this macOS)
DELIVERABLE: atlas_todo.pid_start/pid_matches (ps run with LC_ALL=C, outside the registry lock); set_member_handles records pid_start next to pid (None when ps fails, overwriting any older value); revive drops pid_start. Colony _pid_alive(entry) = pid_matches(pid, pid_start), used by build_colony liveness and h_colony_kill; recycled/start-less pid -> dead, kill 409 member_dead. Real pid caller: atlas_mux.py:596 set_member_handles(..., pid=proc.pid); atlas_launch.py and the pane path record only pane_id. Tests: kill with matching start (200, process gone), mismatched start (409, process alive), no start (409, process alive), pid_start recorded/matched/cleared on revive. README: new "Colony roster, Channels, Terminal" section; stale "edge to edge" Colony wording replaced.
NEXT: Lead: decide on the 16 pre-existing omp bun failures; CHANGELOG/findings/todo gate items (a,b,f,i,m,n,o) are lead-owned and out of this slice.
