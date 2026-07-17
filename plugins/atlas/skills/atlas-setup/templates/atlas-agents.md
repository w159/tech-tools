# AGENTS.md (.atlas/)

Orientation for this directory, for non-Claude agents. `.atlas/` is
atlas's own runtime and operational state (execution evidence, findings,
audits, decisions, memory), never product source and never a project
wiki. Project documentation lives under `docs/` at the repo root, not
here.

## Ephemeral vs durable

- `.atlas/.run/` is ephemeral and gitignored, except `findings.json`
  which is a durable ledger. Everything else in `.atlas/` is durable and
  committed.

## Do not put here

- Architecture, plans, specs, or feature docs -- those belong in `docs/`.
- A `docs/` subdirectory -- `.atlas/docs/` is a legacy layout the scaffold
  refuses to run over; see `docs-ssot.md` in the atlas-loop skill.

See the atlas-loop skill's `references/docs-ssot.md` for the full,
canonical definition of this tree.
