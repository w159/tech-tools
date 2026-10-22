# fallow-main-2 receipt
changed_files: plugins/atlas/scripts/dashboard_ui/js/ui.js; fallow-baselines/health.json
evidence_strategy: characterization via gate commands
- fallow audit -> "No issues in 212 changed files" (exit 0)
- node --test dashboard_ui/js/*.test.js -> pass 111, fail 0
- python3 -m unittest test_atlas_contract -> Ran 111 tests, OK (skipped=3)
clone: Sparkline in ui.js had no consumers (health.js keeps its own string-based sparkSvg); deleting the dead Sparkline removed the clone group. IconButton is used inside ui.js, so only `export` was dropped. Health baseline re-saved.
