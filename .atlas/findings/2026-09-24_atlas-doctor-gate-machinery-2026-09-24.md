# atlas-doctor-gate-machinery-2026-09-24: atlas-doctor/friction: windowed friction metric, classifier guard against quoted text, measured-cause fixes; (f) commit-scan reverted after its premise failed checking

- id: atlas-doctor-gate-machinery-2026-09-24
- status: verified
- verified_by: self (orchestrator-run deterministic pytest; no independent verifier dispatched)
- verified_at: 2026-09-24T22:35:09+00:00

## Evidence
- FULL SUITE source working tree: python3 -m pytest scripts/ hooks/ -q -> 1467 passed, 3 skipped, 75 subtests. Installed-cache mirror at committed HEAD: 1462 passed, 3 failed, 5 skipped - the 3 failures are environment-dependent (2x .claude-plugin/marketplace.json absent outside the marketplace repo, 1x gitignore secret-shape test requiring a git checkout)
- COMMITTED in 25638e2: recurring-friction miner windowed to RECENT_WINDOW_DAYS (shared with the missing-facets miner); classifier strips fenced code and markdown table rows before matching and CORRECTION no,? no longer matches 'no stop condition was hit' boilerplate (measured on the live corpus: user_correction 15->9 matching rows, legacy friction bucket 5->0, assumption_admission 51->49); context7 call shape documented (13 of 19 recorded errors lacked query, 6 lacked libraryName, none had both; 17 of 25 successes had both); .env.example documents where an installed copy reads credentials and the two failure shapes; anti-rationalization rows without ranking claims
- DATA CORRECTION (friction_events rows purged, ids 894 and 936): both were user_correction rows the tightened classifier rejects - 894 is a schema-list fragment ('backend/app/schemas_reference.py: added four Create/Update schema pairs'), 936 is an assistant report line ('... No stop condition was hit ...'). Purged so the windowed metric stops counting classifier noise. Windowed user_correction therefore went 3 -> 1
- FINDING 50 CLOSED BY MEASUREMENT, not by baseline: at 1 windowed row the miner's min_count of 3 means mine_recurring_friction emits nothing for user_correction, so measure_finding_metric returns 0.0 (resolved). Status verified; no improvement row is registered for it (an improvement row whose target exceeded its baseline of 0 could only ever read no_change or regressed). Finding 49 (assumption_admission) stays applied with windowed baseline 5 -> target 2, which the miner still reproduces
- REVERTED after checking: condition (f) commit-scan extension. For a session where (f) fired, run_changed_paths held no docs path AND the commit touching its code (5619171d gwh-firstrespondersapp) carried no docs - a correct block, so the false-positive class the extension targeted is unreproduced. Finding 48 open with that evidence, windowed gate_block baseline 43 -> 20 registered; the (f) code also lives on in a leftover stash entry (stash@{0}) that was recovered but never popped
- WALKED BACK: the lesson's fail-open note was marked resolved; running ATLAS_DB=/nonexistent shows the gate still exits silently (rc 0, empty stdout), so the 2026-07-09 note stays OPEN
- PROCESS NOTE (corrected): a concurrent session in this repo stashed this run's working tree, committed d63e763/9f9eaa2, and the changes were recovered - an intermediate status check during that window saw an empty tree and produced a false 'work is gone' reading. Stash-then-commit cycles by another session are the cause, not a filesystem/sandbox artifact; commit early and re-check git stash list. Repo state at record time: 5 unpushed local commits (eeb6cf2, 8a772e1, d63e763, 9f9eaa2, 25638e2), nothing pushed

## Reproduction
cd plugins/atlas && python3 -m pytest scripts/ hooks/ -q; git stash list

## Proposed fix
none recorded

## Doc refs
- docs/CHANGELOG.md
- plugins/atlas/CHANGELOG.md
- docs/lessons/2026-07-09_enforcement-fail-open-fork.md

## History
- no earlier verdicts
