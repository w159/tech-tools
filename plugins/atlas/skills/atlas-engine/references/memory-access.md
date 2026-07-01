# claude-mem access (worker runtime) - call it correctly

Atlas relies on claude-mem for recall at Orient. In the default **worker** runtime, every claude-mem
failure observed in the wild was a CALLER mistake (wrong tool for the runtime, or wrong arg types) -
the server is not broken. Follow these conventions and recall stops erroring.

## The three worker-runtime tools (use these)

1. **`search`** - full-text memory search. Returns an index of IDs. This is Step 1. Params: `query`,
   `limit` (default 20), optional `project`, `type`, `dateStart`/`dateEnd`, `offset`.
2. **`timeline`** - context around a result. Params: `anchor` (an integer observation ID) **OR**
   `query` (finds the anchor automatically), plus `depth_before` / `depth_after`. There is **no
   `limit` param** - passing one errors.
3. **`get_observations`** - full detail for specific IDs. Param: `ids` must be an **array of numbers**
   (`[15619, 15620]`), never quoted strings (`["15619"]`).

Flow: `search` (get IDs) -> `timeline` (context around an anchor) -> `get_observations` (full text).

## Do NOT use in worker runtime

- **`observation_search`** is **server-beta only**. In worker runtime it returns:
  `requires CLAUDE_MEM_RUNTIME=server-beta. Current runtime is "worker"; use the existing
  search/timeline/get_observations tools`. Use `search` instead - it covers the same need.

## The exact mistakes that caused the historical 44% error rate (don't repeat)

| Tool | Bad call | Why it failed | Correct call |
|---|---|---|---|
| `observation_search` | any call | server-beta only; runtime is worker | use `search` |
| `get_observations` | `ids: ["15619","15620"]` | schema wants numbers, got strings | `ids: [15619, 15620]` |
| `timeline` | `{"limit": "40"}` | `limit` is not a timeline param; no anchor/query | `{"query": "...", "depth_after": 5}` |

When recall succeeds with these, record `record-recall ... hit`; when it genuinely returns nothing
usable, record `... miss` (see the Orient step). A tool ERROR is neither - fix the call and retry.

## Promoted to global instructions (2026-06-30)

This file alone did not fix the error rate: two sessions after it shipped still mis-called
`observation_search` in worker runtime, because a skill-scoped reference does not always load. The
calling convention above is now also codified in the user's global, always-loaded
`~/.claude/CLAUDE.md` so it applies even when this skill is out of context. This file remains the
authoritative detail (tables, exact bad/good calls); the global copy is the always-on enforcement
layer, not a duplicate to maintain in parallel.
