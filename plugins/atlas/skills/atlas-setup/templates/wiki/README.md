# Wiki

Onboarding, how-to, and operational runbooks. graphify renders the
diagrams that live here from `docs/architecture/` and the atlas-audit
graph.json. See references/graphify-wiring.md for the producer pipeline.

## What lives here

- `onboarding.md` - first-day guide for a new agent or developer
- `runbooks/` - operational runbooks (one per recurring operation)
- `diagrams/` - graphify-rendered HTML/SVG diagrams

## Freshness gate

atlas-setup checks wiki freshness on completion: if `architecture/` has
changed more recently than `wiki/diagrams/`, the wiki is stale and the
completion gate fails. See references/graphify-wiring.md for the exact
check.