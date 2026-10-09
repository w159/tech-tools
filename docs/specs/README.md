# Specs

Requirements and specifications. Specs describe what a feature must do
before it is built; features/ describes what it actually does after it
ships.

## What lives here

- `<YYYY-MM-DD>-<slug>.md` - one spec per feature, date-first so a listing sorts chronologically
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

atlas-feature and atlas-orchestrate write here. atlas-setup only creates it.