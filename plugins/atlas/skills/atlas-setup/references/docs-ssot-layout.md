## The docs/ SSOT (plus .atlas/ internal state)

The full canonical structure is defined once, authoritatively, in the
docs-ssot.md single source of truth (maintained in the atlas-orchestrate and
atlas-loop skills). Onboarding scaffolds root entry files
plus two trees at the project root: project documentation lives under
`docs/`; atlas's own self-improvement state lives under `.atlas/` directly.
`.atlas/` never contains a `docs/` subdirectory or project-wiki content
(architecture, plans, specs, features).

```
README.md, AGENTS.md, CLAUDE.md   root entry points: human onboarding, agent
                                   orientation, Claude-Code operating rules

docs/
  CHANGELOG.md            append-only, newest-first, completed + verified work
  ROADMAP.md              backlog with status (planned/in-progress/blocked/deferred)
  AGENTS.md               deep orienting doc; optional, root AGENTS.md is the minimum
  architecture/           system design, maps, ADRs source material (atlas-audit)
  decisions/              project ADRs (architecture decision records)
  plans/                  implementation plans, one per task
  specs/                  requirements and specifications
  features/               per-feature specs-as-built
  lessons/                durable lessons, gotchas, postmortems
  wiki/                   rendered graphify diagrams + understand-anything wiki
  api/                    PROJECT-ADAPTIVE: only when an API is detected
                           (OpenAPI file, routes/controllers dir, web framework)

.atlas/
  evidence/               permanent execution-evidence captures
  findings/               dated learning ledger (<date>-<slug>.md + INDEX.md)
  audits/                 internal audit records
  decisions/              atlas's own dated operating decisions (tooling
                           activation, structure repairs) - see install.md
  archive/                retired/superseded state
  understand-anything/    knowledge-graph working data (published to docs/wiki/)
  graphify/               diagram working data (published to docs/wiki/)
  self-improvement/       skill-gen/disable decisions, context-optimizer output
  memory/                 persistent cross-session memory
  nudge/                  inline-op thresholds, dispatch coaching signals
  CLAUDE.md               orientation: what .atlas/ is, ephemeral vs durable
  AGENTS.md               same orientation for non-Claude agents
  .run/                   EPHEMERAL, GITIGNORED run state (except
                           .run/findings.json, which is durable)
```

Subfolders under `docs/` are project-adaptive: a project with no HTTP API
has no `docs/api/`; a project with one does. `docs/standards/`,
`docs/glossary.md`, and `docs/reference/` are created on demand by the
curator, not by the scaffold. `.atlas/findings/` is the dated, durable
learning ledger agents consult before non-trivial work; `.atlas/decisions/`
is where atlas's own dated operating decisions land, including the
tooling-activation record install mode writes (`references/install.md`).

Everything shown above except `.atlas/.run/`
(minus its durable `findings.json`) is committed, behind a zero-trust,
deny-by-default `.gitignore` that allowlists the durable trees and
re-excludes secrets last (see `atlas-gitignore`). The scaffold is created by
a deterministic, idempotent script, never inline prose:

    python3 "${CLAUDE_SKILL_DIR}/scripts/scaffold_docs.py" <repo-root>

Idempotent means safe to re-run on every invocation: it creates only what
is missing and never overwrites a non-empty file, so running it against a
project that already has a partial or drifted structure repairs the gaps
without disturbing what is already correct. A leftover `.atlas/docs/` from
before this split is not migrated automatically; the script refuses (exit
1) until its unique content is moved into `docs/` and the legacy directory
deleted.
