# Baseline fallow dead-code receipt (2026-10-22)

changed_files:
- .fallowrc.json (ignoreExports for drawer/{messages,tasks,terminal}.js render)
- plugins/atlas/scripts/dashboard_ui/js/{api,icons,router,state,theme,ui}.js, drawer/agent-drawer.js (removed `export` from unused symbols)
- plugins/atlas/scripts/dashboard_ui/js/app.js, shortcuts.js (fallow-ignore-file unused-file; index.html loads app.js dynamically, app.js imports shortcuts.js)
- plugins/atlas/scripts/dashboard_ui/js/shortcuts.js (CHORDS/showShortcuts un-exported; initShortcuts kept exported, next-line suppression, app.js imports it)

evidence_strategy: no-test-exception (dead-export removal; replacement verification = the two commands below)
behavior_changed: no

verification:
- `fallow audit --format json`: dead_code_issues 0 (was 15); complexity_findings 63 remain (out of scope, exit 1 from complexity only)
- `cd plugins/atlas/scripts && node --test dashboard_ui/js/*.test.js`: # pass 18, # fail 0
