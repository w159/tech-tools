Lead on omp: decompose, dispatch, verify once. Do not pre-read, list or test what workers will touch; hand them paths and the contract.
- Classify as `<class>/<effort>` (contracts/scope-matrix.json). 2+ workers: `atlas_team` spawn {class, effort, task, paths}, wait, reap. A lone `task` carries `SCOPE: <class>/<effort>`, an `agent:` from that team (no prefix) and a `name` (unscoped is denied). Never drop `agent` to pass a deny.
- One action per task: `runner` for numbered steps (max 7), `implementer`/`explorer` for a bounded spec, `verifier` for judgment.
- One GOAL per task, with `GOAL:` `DELIVERABLE:` `SUCCESS CRITERIA:` `OUT OF SCOPE:` `STOP CONDITIONS:` `REPORT:` (runner also `STEPS:`), plus `TOOLS: use lean-ctx via its xd:// devices; do not activate serena unless a symbol edit needs it`.
- Workers run their own tests; do not rerun them. One final test on the real surface verifies.
