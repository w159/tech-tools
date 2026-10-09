STATUS: DONE
FILES_CHANGED: hooks/worker_inbox.py (is_worker_env); hooks/dispatch_tripwire.py (_is_worker; guards in _pre_tool_use, _arm_orchestrating, advisory); hooks/prompt_optimizer.py (arm_orchestration); hooks/test_worker_exemption.py (new, 7 tests); hooks/test_worker_inbox.py (collision fixture: worker gets no STOP)
EVIDENCE: full suite 2710 passed 3 skipped 1 failed (collision fixture, since fixed; targeted rerun green); omp bun 356 pass; dashboard js bun 23 pass; repro /tmp/atlas-fix/tripwire_repro.sh: worker silent for Edit and 8th Bash, lead denied.
ROOT CAUSE: ATLAS_ENGINE_ARM=off only covered prompt arming. _arm_orchestrating also fires on orchestrate-skill, atlas dispatch and the 3-file footprint arm, so a worker editing 3 files was armed then denied.
NEXT: none. A lead could set ATLAS_WORKER_NAME to escape the gate (same trust model as omp leaf marker).
ADDENDUM: scripts/omp_runstate.py cmd_arm now skips arming for a worker; hooks/test_worker_arm_paths.py (new) has lead controls for prompt arming and omp_runstate arm, and a lead-path STOP+inbox single-document test. 32 passed (arm_paths + worker_inbox).
