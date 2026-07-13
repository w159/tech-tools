# Architecture

System design, component maps, and Architecture Decision Records (ADRs).

## What lives here

- `boundaries.md` - feature/module boundaries (atlas-audit writes this)
- `adr/` - Architecture Decision Records, one file per decision
- `maps/` - architecture diagrams produced by graphify from this folder
- `components.md` - component inventory and dependency edges

> Note: `boundaries.md`, `components.md`, `adr/`, and `maps/` are planned but not yet produced. They will be created on the first atlas-audit run that touches architecture. Currently only this README and `skills-mastery.md` exist here.

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

atlas-audit owns this folder. atlas-setup only creates it.