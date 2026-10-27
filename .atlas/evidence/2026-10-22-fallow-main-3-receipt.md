# fallow main 3 receipt
Panel, KPI, Table in plugins/atlas/scripts/dashboard_ui/js/ui.js: unused anywhere (only their definitions matched), so all three functions were DELETED (100 lines). None un-exported. No helpers orphaned (Empty and cls are used elsewhere).
- `fallow audit` (repo root): "No issues in 232 changed files", exit 0
- `node --test dashboard_ui/js/*.test.js`: tests 111, pass 111, fail 0
