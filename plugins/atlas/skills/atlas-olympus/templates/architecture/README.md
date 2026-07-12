# Architecture

System design, component maps, and Architecture Decision Records (ADRs).

## What lives here

- `boundaries.md` - feature/module boundaries (atlas-ariadne writes this)
- `adr/` - Architecture Decision Records, one file per decision
- `maps/` - architecture diagrams produced by graphify from this folder
- `components.md` - component inventory and dependency edges

## ADR template

```
# ADR-NNNN: <title>
Date: YYYY-MM-DD
Status: proposed | accepted | superseded

## Context
Why this decision is needed.

## Decision
What we decided.

## Consequences
What changes because of this.
```

atlas-ariadne owns this folder. atlas-olympus only creates it.