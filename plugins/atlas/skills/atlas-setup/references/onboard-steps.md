# Onboarding steps 7 and 10: full procedure

Read at the named step of the first-run onboarding in `SKILL.md`.

## Step 7 - Deploy self-improvement

Verify the atlas self-improvement system
is deployed and functional:
- `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_memory.py` exists and `~/.atlas/memory/` is writable
- `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_curator.py` exists
- `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_context_optimizer.py` exists
- `hooks/memory_capture.py` and `hooks/chronicle_facet.py` exist; both run in-process from `hooks/stop_tail.py` (the single Stop entry in hooks.json), not as separate hook entries
Run the context optimizer to disable unused skills/agents:
`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_context_optimizer.py" optimize --dry-run`
Present the savings estimate to the user and confirm before applying.
This is the single most impactful action for reducing token cost - atlas
loads 22 skills + 12 agents into every API call; disabling unused ones
can cut that by 40%+.

## Step 10 - Analytics choice (anonymous, on by default)

Run
`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_analytics.py" explain`, then
`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_analytics.py" preview`, then
`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_analytics.py" prove`, and show all three
verbatim. State plainly that anonymous usage counts are on by default and that
`references/telemetry.md` lists every counter. Name the four ways to turn it off:
`DO_NOT_TRACK=1`, `ATLAS_ANALYTICS=off` (environment or `~/.atlas/settings.json`), the
"Anonymous usage counters" settings knob, and `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_analytics.py" disable`.
Then AskUserQuestion: "Keep anonymous Atlas usage counts on?" with options "Yes, keep
them on" (default, listed first) and "No, turn them off". On yes run
`atlas_analytics.py enable` (it records the choice and ends the first-run notice); on no run
`atlas_analytics.py disable`; on no answer change nothing, since the default already
applies. `prove` checks the payload against the anonymity rules and `delete` removes
everything. Skip when `atlas_analytics.py status` already shows a decision, or when
`DO_NOT_TRACK` or `ATLAS_ANALYTICS=off` is already set.
