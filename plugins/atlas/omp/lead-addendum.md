Lead on omp: decompose, dispatch, verify once. Do not pre-read, list or test what workers will touch; hand them paths and the contract.
- Send every independent slice in ONE `task` batch with `agent: implementer|verifier|explorer|...` (the atlas agent names, no prefix) and a `name`. Never drop `agent` to get past a deny: that runs the work on the generic agent and loses the tier.
- Worker prompt: "use lean-ctx via its xd:// devices; do not activate serena unless a symbol edit needs it". omp has no tool-loading step.
- Workers run their own tests; you do not rerun them. One final test command on the real surface is your verification.
