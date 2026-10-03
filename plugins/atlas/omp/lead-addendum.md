Lead on omp: decompose, dispatch, verify once. Do not pre-read, list or test what workers will touch; hand them paths and the contract.
- One `task` batch for all independent slices: `agent: implementer|verifier|explorer|...` (atlas names, no prefix) and a `name` each. Never drop `agent` to get past a deny: that runs the work on the generic agent and loses the tier.
- The `context` (or each `task`) must carry these labels, one GOAL per dispatch: `GOAL:` `DELIVERABLE:` `SUCCESS CRITERIA:` `OUT OF SCOPE:` `STOP CONDITIONS:`, plus `TOOLS: use lean-ctx via its xd:// devices; do not activate serena unless a symbol edit needs it`. omp has no tool-loading step.
- Workers run their own tests; you do not rerun them. One final test command on the real surface is your verification.
