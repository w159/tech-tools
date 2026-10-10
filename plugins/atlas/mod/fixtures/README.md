# Run-state fixtures for the Atlas mod tests

A snapshot of a live lead session: `todos.json` (two sessions, phase-prefixed items), `channels.json` (roster for `lead-01a122` with one finished and one pane-carrying member), and `board/*.jsonl` notes written by `scripts/atlas_todo.py note()`. One intentionally torn line lives in `impl-auth.jsonl`; every timestamp derives from `FIXTURE_EPOCH_MS` (1760000000 seconds), so reads stay deterministic.
