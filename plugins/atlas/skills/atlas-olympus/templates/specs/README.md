# Specs

Requirements and specifications. Specs describe what a feature must do
before it is built; features/ describes what it actually does after it
ships.

## What lives here

- `<feature>-spec.md` - one spec per feature
- `requirements/` - cross-cutting requirements (security, compliance, NFRs)

## Spec template

```
# <feature> spec

## Problem
The user pain this solves.

## Requirements
- R1: <must>
- R2: <must>

## Acceptance criteria
- [ ] R1 is met and verified
- [ ] R2 is met and verified

## Out of scope
- <explicit non-goals>
```

atlas-feature and atlas-metis write here. atlas-olympus only creates it.