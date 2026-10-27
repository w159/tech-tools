# claude-mem 44% error rate - triage (WS5 follow-up)

Date: 2026-06-30. Source: live `~/.atlas/atlas.db` `tool_calls` + live reproduction.

## Finding: claude-mem is NOT broken. All 4 failures were caller misuse.

Of 9 claude-mem calls, 4 errored. Grouped by tool:

| Tool | calls | errors | Root cause |
|---|---|---|---|
| `observation_search` | 2 | 2 | server-beta-only tool invoked in **worker** runtime |
| `get_observations` | 3 | 1 | `ids` passed as quoted strings; schema requires numbers |
| `timeline` | 2 | 1 | passed `limit` (not a valid param) with no anchor/query |
| `search` | 2 | 0 | correct usage - never failed |

## Live reproduction (confirms, not infers)

```
observation_search(query=...) ->
  ERROR: "requires CLAUDE_MEM_RUNTIME=server-beta. Current runtime is 'worker';
          use the existing search/timeline/get_observations tools for worker-mode access"
search(query=...) -> OK, 15 results
```

Tool schemas confirm the other two:
- `get_observations.ids`: `items: {type: number}` - the failing call passed `["15619",...]` (strings).
- `timeline`: params are `anchor`|`query` + `depth_before`/`depth_after`; there is no `limit`.

## Fix (in our control)

Codified the correct worker-runtime call conventions so atlas stops making these calls:
- New `plugins/atlas/skills/atlas-engine/references/memory-access.md` (the 3 worker tools, correct
  arg types, the exact mistakes to avoid).
- atlas-engine SKILL: recall law + reference index now point to it.

Not in our control (claude-mem plugin internals): nothing - the worker runtime works correctly when
called correctly. `observation_search` only exists for the server-beta runtime; switching to that
runtime is a claude-mem deployment choice, not an atlas fix. Recommend staying on worker + `search`.

## Expected effect

With the conventions followed, the recurring error classes (observation_search-in-worker, string ids,
timeline-limit) disappear, so the recall signal (WS2) reflects real hit/miss instead of tool errors.
