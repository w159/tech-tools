# Decisions

Project Architecture Decision Records (ADRs): the record of a design
choice made for this codebase, why, and what it costs. Distinct from
`.atlas/decisions/`, which records atlas's own operating decisions for
this project (tooling activated, structure choices), not project ADRs.

## What lives here

- `<YYYY-MM-DD>-<slug>.md` - one ADR per file, date-first so a listing sorts chronologically

## ADR template

```
# <title>
Date: YYYY-MM-DD
Status: proposed | accepted | superseded

## Context
Why this decision is needed.

## Decision
What we decided.

## Consequences
What changes because of this.
```

atlas:docs-curator owns this folder. atlas-setup only creates it.
