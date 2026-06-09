# Minutes → Mem0 Adapter

Reference implementation. Walks your Minutes meetings folder, parses
frontmatter, and pushes structured memories into [Mem0](https://mem0.ai).

## What gets pushed

For each meeting file, one summary memory plus individual memories for each
decision and action item. Metadata preserves the meeting date, path, topic,
authority, and assignee so downstream Mem0 queries can filter.

| Minutes field | Mem0 representation |
|---|---|
| Meeting summary | Memory with `category: meeting`, metadata includes date, attendees, path |
| Each `decision` | Memory with `category: decision`, metadata includes topic + authority + supersedes |
| Each `action_item` | Memory with `category: action_item`, metadata includes assignee + due + status |
| `people[]` slugs | Used as `user_id` candidates for attribution |

The whole corpus lands under a single `user_id` (default `minutes-demo`) and
`agent_id` (default `minutes-adapter`). Change via CLI flags if you want
per-attendee memory scoping.

## Setup

```bash
cd examples/mem0
pip install -r requirements.txt
export MEM0_API_KEY=...        # from https://app.mem0.ai
python adapter.py              # reads ~/.minutes/demo by default
```

To run against your real corpus:

```bash
python adapter.py --meetings-dir ~/meetings
```

## Verifying the result

Once the adapter finishes, query Mem0:

```python
from mem0 import MemoryClient
client = MemoryClient()
hits = client.search(
    query="what did we decide about pricing",
    user_id="minutes-demo",
    agent_id="minutes-adapter",
)
for h in hits:
    print(h)
```

You should see both pricing decisions from the demo corpus — the 2026-02-28
launch and the 2026-03-25 reversal. The adapter carries `supersedes` as
metadata on the later decision; Mem0 itself does not automatically reason over
that field, so if your agent wants to answer "which decision is current?" it
needs to compare the metadata or ask by date. The adapter is preserving the
signal, not doing the reasoning.

## Honest caveats

- Mem0's SDK evolves. If `add()` or `search()` signatures drift, this adapter
  will need touch-up. `requirements.txt` is a floor-only pin; run it against
  the exact version you have in your lockfile for stable behavior.
- The adapter is idempotent in intent, not strictly idempotent in effect: running
  twice pushes the same content a second time, which Mem0's dedup may or may not
  catch depending on your plan.
- No deletion path. If you want to clean up, use Mem0's UI or API directly.
- This is not a supported package. It's a starting point.
