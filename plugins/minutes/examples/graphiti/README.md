# Minutes → Graphiti Adapter

Reference implementation. Pipes Minutes meetings into
[Graphiti](https://github.com/getzep/graphiti), Zep's OSS temporal knowledge
graph for agent memory.

## What gets built

Each meeting becomes a Graphiti **episode** with `reference_time` set to the
meeting date and a JSON body containing the full structured content. Graphiti's
LLM extractor then infers entities and relationships from that body. This
adapter does **not** pre-declare entity nodes; it hands Graphiti a clean JSON
structure and lets the graph be constructed from it. That tradeoff is honest
and lightweight; if you need stronger identity guarantees, seed canonical
person nodes yourself before running.

| Minutes field | Lands in Graphiti as |
|---|---|
| Meeting | Episode, `source=json`, `reference_time=meeting.date` |
| `attendees` | Strings inside the episode body — LLM extractor creates entity nodes |
| `decisions[]` | Objects inside the episode body with `text`, `topic`, `authority`, `supersedes` — extractor builds facts |
| `action_items[]` | Objects with `assignee`, `task`, `due`, `status` — extractor builds task-owner relationships |
| `group_id` | Defaults to `"minutes-corpus"` — scopes the graph so corpora don't cross-contaminate |

## Setup

Graphiti needs a graph backend. The quickest path is Neo4j via Docker:

```bash
docker run -d --name neo4j-minutes-demo -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/demodemodemo \
  neo4j:5
```

The container name is specific so it's clear this is a throwaway instance for
the adapter demo, not your production Neo4j.

Then:

```bash
cd examples/graphiti
pip install -r requirements.txt
export OPENAI_API_KEY=...  # Graphiti uses OpenAI for LLM-based extraction by default
python adapter.py          # reads ~/.minutes/demo by default
```

To run against your real corpus:

```bash
python adapter.py --meetings-dir ~/meetings
```

## Verifying the result

Once the adapter finishes:

```python
import asyncio
from graphiti_core import Graphiti

async def main():
    g = Graphiti("bolt://localhost:7687", "neo4j", "demodemodemo")
    # Always pass group_ids so your query stays scoped to the demo corpus
    # and doesn't bleed into any other Graphiti data in the same instance.
    results = await g.search(
        "what did we decide about pricing",
        group_ids=["minutes-corpus"],
    )
    for r in results:
        print(r)

asyncio.run(main())
```

You should see the pricing decisions with temporal ordering — the 2026-03-25
reversal comes after the 2026-02-28 launch, and Graphiti's temporal reasoning
should surface the reversal as the current state.

## Honest caveats

- Graphiti's Python API is evolving (still `graphiti_core` at time of writing).
  If constructor or episode signatures drift, update here.
- The adapter pushes one episode per meeting — no incremental upserts. Running
  it twice will add duplicate episodes. For idempotency you'd need to track
  which meetings you've already pushed (by path + mtime) in a sidecar file.
- Graphiti runs LLM extraction on every episode. Expect real OpenAI/Anthropic
  spend if you point this at a large corpus. The 5-meeting demo should cost
  well under a dollar.
- No deletion path. To scrub just the adapter's group without touching the rest
  of your Neo4j data, run this scoped Cypher in a Neo4j shell:

  ```cypher
  MATCH (n) WHERE n.group_id = 'minutes-corpus' DETACH DELETE n;
  ```

  Do **not** run `MATCH (n) DETACH DELETE n` — that wipes the entire database.
- This is not a supported package.
