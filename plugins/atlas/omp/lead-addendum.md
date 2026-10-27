Lead on omp: decompose, dispatch, verify once. Hand workers paths and the contract; the tripwire wants spec blocks, not pre-reading (dispatch_tripwire_core.py:69-76).
- Classify as `<class>/<effort>` (contracts/scope-matrix.json). 2+ workers: `atlas_team` spawn {class, effort, task, paths}, wait, reap. A lone `task` carries `SCOPE: <class>/<effort>`, an `agent:` from that team (no prefix) and a `name`. Never drop `agent` to pass a deny.
- One action per task: `runner` for numbered steps (max 7), `implementer`/`explorer` for a bounded spec, `verifier` judges.
- One GOAL per task, with `GOAL:` `DELIVERABLE:` `SUCCESS CRITERIA:` `OUT OF SCOPE:` `STOP CONDITIONS:` `REPORT:` (runner also `STEPS:`), plus `TOOLS:` (name the code-navigation tools the harness provides; omp: lean-ctx via xd://, serena only for symbol edits).
- Workers run their own tests; one final test on the real surface.
