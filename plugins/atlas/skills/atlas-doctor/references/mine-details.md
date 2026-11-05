# Phase 2 - MINE: details

Read at Phase 2 before triaging mined findings (the `--mine --json` command and the `--list-findings` command stay in `SKILL.md`).

The miner registry lives in `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py`'s `MINERS` dict - one
function per miner, each reading facets + friction_events + metrics +
tool_calls (or, for a couple of static-code miners, the plugin's own source).
That dict is the extension point: to add a new class of defect detection,
write a `mine_*(conn, root)` function returning `_finding(...)` dicts and
register it there. Nothing else needs to change - `mine()` fingerprints,
upserts, and dedupes generically for every registry entry.

`tool_error_rate_high:*` findings count only calls that actually ran and failed:
calls an atlas gate blocked (`tool_calls.denied=1` - the lean-ctx Grep/Glob
redirect, recall gate, `DENY - ...` dispatch/edit denials) are excluded from both
the error count and the call total, and are reported separately as `denied` in
the evidence. The finding's detail and `evidence.top_errors` carry the most
frequent `tool_calls.error_snippet` texts (first 500 chars of the failed
result), so triage starts from the actual failure, not a bare rate. Rows
ingested before `error_snippet` existed have no text; an empty `top_errors`
means "no text captured", not "no errors".

`friction_events` rows with category `gate_block` carry
`conditions: <letters> (<names>)` - e.g. `conditions: c,d,e (CHANGELOG missing,
ROADMAP missing, README missing)` - so a block names the rule that fired.

## Reply-quality loop (turn_quality miner)

Optional; needs `TYPESAFE_API_KEY` in the environment. The `turn_quality`
miner reads model-scored replies (`turn_scores`), so score first:

1. Score: `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/turn_scoring.py" --recent-days 14`
2. Mine: `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --mine`
3. Review `turn_quality:*` findings. Each names the surface to fix
   (`target_path`: an `atlas-orchestrator.md` output-style section, a hook, or a skill) and
   its detail shows whether the judgment predicts next-turn user corrections;
   treat a judgment that does not predict them as noise.
4. Apply the fix to that surface (Phase 4), then `--baseline`, and later
   `--remeasure` re-runs the miner and reports improved|no_change|regressed.

Cost: input tokens only, billed at the provider's current rate (see the provider's
pricing page); atlas does not compute this cost. Privacy: transcript excerpts are sent to
api.typesafe.ai with secrets scrubbed; `ATLAS_TYPESAFE_SCORING=off` disables
scoring. Thresholds are constants in `atlas_doctor.py` (see
`docs/architecture/atlas-turn-scoring.md`).
