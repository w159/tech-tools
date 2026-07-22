# Plans

Implementation plans and numbered stage maps. A plan here is the
decomposition of a task into ordered stages, each with one failable check,
before any code is written.

## What lives here

- `<YYYY-MM-DD>-<slug>.md` - one plan per file
- `stages/` - per-stage detail files for large plans

## Plan template

```
# <title> plan
Date: YYYY-MM-DD
Owner: <skill>
Goal: <one sentence>

## Stages
1. <stage> - check: <what proves it is done>
2. <stage> - check: <what proves it is done>
...

## Concurrent stages
Stages that can run in parallel (and why it is safe).

## Assumptions vs proven
- <assumption> -> to be proven by stage N
```

atlas-planner and atlas-orchestrate write here. atlas-setup only creates it.