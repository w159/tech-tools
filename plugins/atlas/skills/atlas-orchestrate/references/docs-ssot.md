# docs/ + .atlas/ Single Source of Truth

This is the ONE canonical definition of the atlas project structure. Every atlas
skill, script, agent, and hook that creates, reads, enforces, or maintains project
structure defers to this file. `atlas-setup` scaffolds it; `atlas:docs-curator`
maintains it; the hooks enforce it. If another reference disagrees with this file,
this file wins.

The target project has two tracked trees plus a small set of root files, all with
distinct purposes:

- **`docs/`** - the project wiki. A complete, living reference so collaborators and
  coding agents can understand the project: changes, decisions, issues, features,
  improvements, and updates tracked over the development lifecycle. It exists to keep
  ongoing development moving forward: every session leaves the codebase better
  understood than it found it. Subfolders are **project-adaptive** - a project with
  no HTTP API has no `docs/api/` or `docs/endpoints.md`; a project with one does.
  **Minimum:** `CHANGELOG.md` (completed and verified work) and `ROADMAP.md` (work
  NOT yet completed/verified).

- **`.atlas/`** - atlas's own auditable operational state, driving self-improvement
  and cross-session learning: execution evidence, run state, a dated findings ledger,
  audits, decisions, archived state, self-improvement tracking, persistent memory, and
  the working data for the understand-anything and graphify skills. Never contains
  project wiki content (architecture, plans, specs, features) or a `docs/` subdirectory.

- **Root files** - `README.md`, `AGENTS.md`, `CLAUDE.md` at the project root. The
  human/agent entry points. `README.md` is the human onboarding; `AGENTS.md` orients
  coding agents (commands, architecture, conventions); `CLAUDE.md` carries Claude-Code
  specific operating rules and points at `AGENTS.md` as canonical.

Both trees and the root files live **in the target project being worked on** (the
codebase root under `.git`), never in this workspace or the skill's own directory.
Any coding agent running an atlas skill keeps them accurate automatically as part of
finishing work; it is not a manual afterthought. Layout and root detection live in
`scaffolding.md`.

`.atlas/` must never contain project wiki subdirs (`architecture/`, `plans/`,
`specs/`, `features/`) or a `docs/` subdirectory. A leftover `.atlas/docs/` from
before this SSOT split is a defect: move its unique content into `docs/` or the
appropriate `.atlas/` subfolder, delete the directory, and re-run
`scripts/scaffold_docs.py`, which refuses (exit 1) to scaffold over a non-empty
legacy `.atlas/docs/` holding durable content or over `.atlas/` with project wiki
subdirs present.

## What each path holds

### Root files (project entry points)

| Path | Holds | Committed? |
|---|---|---|
| `README.md` | Human onboarding: what the project is, setup, run/test/build commands, architecture overview. | yes |
| `AGENTS.md` | Agent orientation: how the project works, conventions, the commands that actually work here, glossary, pointers into `docs/`. Loaded every session. | yes |
| `CLAUDE.md` | Claude-Code operating rules for this repo. Points at `AGENTS.md` as the canonical shared source of truth; keeps Claude-specific guidance out of `AGENTS.md`. | yes |

### docs/ - project wiki (project-adaptive)

| Path | Holds | Committed? |
|---|---|---|
| `docs/CHANGELOG.md` | Newest-first append-only log of everything completed and verified as working/implemented. Maintained between sessions. | yes |
| `docs/ROADMAP.md` | Everything NOT yet completed/verified: backlog items with status (planned, in-progress, blocked, deferred). The curator moves completed+verified items to CHANGELOG. | yes |
| `docs/AGENTS.md` | Deep orienting guidance that outgrew the root `AGENTS.md`: full architecture, module map, data flows. Optional; root `AGENTS.md` is the minimum. | yes |
| `docs/architecture/` | Codebase structure, patterns, module boundaries. | yes |
| `docs/decisions/` | Project ADRs (architecture decision records) for the codebase. | yes |
| `docs/plans/` | `<task-slug>.md`, one per planned task. | yes |
| `docs/specs/` | `<YYYY-MM-DD>-<slug>.md` feature specs. | yes |
| `docs/features/` | Per-feature documentation. | yes |
| `docs/lessons/` | `<YYYY-MM-DD>-<slug>.md` gotchas and patterns learned. | yes |
| `docs/wiki/` | Rendered, human-facing graphify diagrams and the published understand-anything wiki. | yes |
| `docs/api/` | **Only if the project has an API.** OpenAPI/Swagger specs (`*.json`/`*.yaml`) and `docs/endpoints.md`. Absent for projects with no API. | yes |
| `docs/standards/`, `docs/glossary.md`, `docs/reference/` | Org/coding standards, business-term-to-code mapping, reference material. Created when the project needs them. | yes |

`atlas-setup` scaffolds `CHANGELOG.md`, `ROADMAP.md`, and the always-applicable base
subfolders (`architecture/`, `decisions/`, `plans/`, `specs/`, `features/`,
`lessons/`, `wiki/`) each with a placeholder `README.md`. Project-adaptive subfolders
(`api/`, `endpoints.md`) are created only when atlas-setup detects the relevant signal
(an OpenAPI file, a routes/controllers directory, or a web framework). The curator
adds any other subfolder the moment the project first needs it.

### .atlas/ - atlas internal state (auditable self-improvement + learning)

| Path | Holds | Committed? |
|---|---|---|
| `.atlas/evidence/` | Permanent execution evidence: red->green captures, command output, screenshots; `<YYYY-MM-DD>-<slug>/` per item. | yes |
| `.atlas/findings/` | Durable, **dated** learning ledger: `<YYYY-MM-DD>-<slug>.md` per resolved issue/fix/decision, plus `INDEX.md`. The source coding agents read to avoid re-introducing a bug that was already fixed. Curator promotes verified findings here. | yes |
| `.atlas/audits/` | Atlas-internal audit records, `<YYYY-MM-DD>-<scope>/` (self-audits, structure audits). | yes |
| `.atlas/decisions/` | Dated records of atlas's own operating decisions for this project (which tooling was activated, why a structure choice was made). Distinct from project ADRs in `docs/decisions/`. | yes |
| `.atlas/archive/` | Retired/superseded state: old run logs, deprecated findings, prior structure snapshots. Keeps history without cluttering the live tree. | yes |
| `.atlas/understand-anything/` | Reserved, optional working area for the understand-anything skill (an external plugin with no code path in this repo) if it retains graph snapshots or intermediate data: not populated by any atlas code today. The current published, human-facing output lives at `docs/wiki/`. | yes |
| `.atlas/graphify/` | Reserved, optional working area for retained graphify snapshots or intermediate data: not populated by any atlas code today. The graphify tool always writes its raw output to ephemeral `graphify-out/` at the repo root (gitignored, no `--output` flag); atlas-wiki publishes the rendered diagrams to `docs/wiki/`. | yes |
| `.atlas/self-improvement/` | Skill generation/disabling decisions, context-optimizer output, curator actions, ponytail debt records. | yes |
| `.atlas/memory/` | Persistent memory for cross-session self-improvement. | yes |
| `.atlas/nudge/` | Nudge data: inline-op thresholds, dispatch coaching signals. | yes |
| `.atlas/CLAUDE.md` | Orientation: what `.atlas/` is (atlas runtime/operational state, NOT product source), which dirs are ephemeral vs durable. | yes |
| `.atlas/AGENTS.md` | Same orientation for non-Claude agents. | yes |
| `.atlas/.run/STATE.md` | Live run state: current wave, open subagents, decisions, next wave. | no (gitignored) |
| `.atlas/.run/findings.json` | Per-run working findings and verdicts (schema in `scaffolding.md`). The live ledger; the curator distills verified entries into the dated `.atlas/findings/` history. | yes (durable ledger) |
| `.atlas/.run/work-log.md` | Resumability log; re-read before any continuation. | no (gitignored) |

`.atlas/.run/` is the only ephemeral subtree (except `findings.json`, the durable
verification ledger). Everything else in both trees is committed.

### Learning loop: dated artifacts so problems do not resurface

Durable atlas artifacts are **dated** so a coding agent (or human) can trace what
changed, when, and why, and so a bug fixed once is not reintroduced:

- Findings: `.atlas/findings/<YYYY-MM-DD>-<slug>.md` (resolved issue + root cause + fix + evidence ref).
- Evidence: `.atlas/evidence/<YYYY-MM-DD>-<slug>/`.
- Audits: `.atlas/audits/<YYYY-MM-DD>-<scope>/` and `docs/audits/atlas-<scope>-<YYYY-MM-DD>/`.
- Decisions: `.atlas/decisions/<YYYY-MM-DD>-<slug>.md` (atlas ops) and `docs/decisions/<slug>.md` (project ADRs).
- Lessons/specs: `docs/lessons/<YYYY-MM-DD>-<slug>.md`, `docs/specs/<YYYY-MM-DD>-<slug>.md`.

Before starting non-trivial work, agents consult `.atlas/findings/INDEX.md` and
`docs/lessons/` for prior art on the same area. The understand-anything and graphify
skills feed this loop: their knowledge graphs and diagrams (working data in
`.atlas/understand-anything/` and `.atlas/graphify/`, published output in `docs/wiki/`)
are how a project stays continuously understandable as it grows.

### .gitignore: zero-trust, deny-by-default

The project's `.gitignore` is produced and maintained by the `atlas-gitignore` skill
(deny everything, then allowlist intentionally, then re-exclude secrets/build
artifacts last). It must allowlist the durable trees and re-exclude the ephemeral one:

- Allowlist `docs/` (`!docs/`, `!docs/**`) and all root entry files.
- Allowlist each committed `.atlas/` subfolder: `!.atlas/evidence/`, `!.atlas/evidence/**`,
  `!.atlas/findings/`, `!.atlas/findings/**`, `!.atlas/audits/`, `!.atlas/audits/**`,
  `!.atlas/decisions/`, `!.atlas/decisions/**`, `!.atlas/archive/`, `!.atlas/archive/**`,
  `!.atlas/understand-anything/`, `!.atlas/understand-anything/**`, `!.atlas/graphify/`,
  `!.atlas/graphify/**`, `!.atlas/self-improvement/`, `!.atlas/self-improvement/**`,
  `!.atlas/memory/`, `!.atlas/memory/**`, `!.atlas/nudge/`, `!.atlas/nudge/**`,
  `!.atlas/CLAUDE.md`, `!.atlas/AGENTS.md`.
- Re-exclude `.atlas/.run/` AFTER the allowlist so it stays ignored, then re-include only
  the durable ledger: `!.atlas/.run/findings.json`.

Verify with `git check-ignore docs/CHANGELOG.md` and
`git check-ignore .atlas/evidence/.gitkeep` (both must report NOT ignored) and
`git check-ignore .atlas/.run/STATE.md` (must report ignored). Secrets
(`.env`, `*.key`, `*.pem`, credentials) must be ignored regardless of the allowlist -
the re-exclusion block comes last and wins.

## Ownership: who writes what

| Path | Owner | Notes |
|---|---|---|
| `README.md`, `AGENTS.md`, `CLAUDE.md` (root) | `atlas:docs-curator` (seeded by `atlas-setup`) | Orchestrator may update directly when a curator pass is overkill. |
| `.atlas/.run/*` | Orchestrator | Live run state, working findings, work-log. Re-read `work-log.md` before any continuation. |
| `.atlas/evidence/*` | Write-capable execution agents (`atlas:implementer`, `atlas:ui-runtime-tester`) | They capture proof at the moment they produce it. |
| `.atlas/findings/*`, `.atlas/audits/*`, `.atlas/decisions/*`, `.atlas/archive/*` | `atlas:docs-curator` | Distills verified `.run/findings.json` entries into the dated durable ledger; archives retired state. |
| `.atlas/understand-anything/*`, `.atlas/graphify/*` | The understand-anything and graphify skills | Working data; the curator publishes rendered output to `docs/wiki/`. |
| `.atlas/nudge/*`, `.atlas/self-improvement/*`, `.atlas/memory/*` | Atlas hooks and self-improvement scripts | Written by the atlas infrastructure itself. |
| `docs/CHANGELOG.md`, `docs/ROADMAP.md`, `docs/AGENTS.md` | `atlas:docs-curator` | Orchestrator may also update directly when a curator pass is overkill. |
| `docs/` subfolders (`architecture/`, `plans/`, `specs/`, `features/`, `audits/`, `lessons/`, `wiki/`, `api/`, etc.) | `atlas:docs-curator` | Write-capable, confined to `docs/`. Creates subfolders on demand as the project needs them. |
| `.gitignore` | `atlas-gitignore` skill / `atlas:docs-curator` maintenance | Kept zero-trust and current as new tracked paths appear. |

Hard boundaries:
- The orchestrator never edits target source code.
- `atlas:docs-curator` is write-capable but confined to `docs/`, `.atlas/` durable
  subfolders, the root entry files, and `.gitignore`: it never touches source.
- `atlas:docs-auditor` is **read-only**; it independently audits `docs/`, the `.atlas/`
  structure, and `.gitignore` for drift against the code and reports findings, fixing nothing.

## When to write

- **During a wave:** the orchestrator keeps `.atlas/.run/STATE.md` and `.atlas/.run/work-log.md` current; findings land in `.atlas/.run/findings.json`.
- **At the moment of proof:** the agent that ran the test or drove the UI writes its capture to `.atlas/evidence/<YYYY-MM-DD>-<slug>/` immediately, then references that path from its finding.
- **Before any change is called done:** CHANGELOG updated (completed + verified), ROADMAP reconciled (in-flight items still listed), every affected `docs/` subfolder updated, and verified findings distilled into `.atlas/findings/`. This is the completion gate (see "docs-current").
- **On resume:** re-read `.atlas/.run/work-log.md` first, then `STATE.md`, and check `.atlas/findings/INDEX.md` for prior art, before dispatching anything.

## Naming conventions

- Evidence dirs: `.atlas/evidence/<YYYY-MM-DD>-<slug>/`. Inside: the raw `run.log`, `before.png`/`after.png`, EXPLAIN output, etc.
- Durable findings: `.atlas/findings/<YYYY-MM-DD>-<slug>.md` + `.atlas/findings/INDEX.md`.
- Atlas audits/decisions: `.atlas/audits/<YYYY-MM-DD>-<scope>/`, `.atlas/decisions/<YYYY-MM-DD>-<slug>.md`.
- Project wiki subfolders: `docs/<subfolder>/<slug>.md` - lowercase-kebab-case. Examples:
  - Audits: `docs/audits/atlas-<scope>-<YYYY-MM-DD>/` (e.g. `docs/audits/atlas-security-2026-06-15/`).
  - Plans: `docs/plans/<task-slug>.md`, one per task.
  - Specs: `docs/specs/<YYYY-MM-DD>-<slug>.md`.
  - Architecture: `docs/architecture/<slug>.md`.
  - Lessons: `docs/lessons/<YYYY-MM-DD>-<slug>.md`.
  - Features: `docs/features/<slug>.md`.
  - Decisions: `docs/decisions/<slug>.md`.
  - Wiki (graphify): `docs/wiki/<slug>.md`.
- Root files: all-caps (`README.md`, `CHANGELOG.md`, `ROADMAP.md`, `AGENTS.md`, `CLAUDE.md`).

**Every `<slug>`, `<id>`, `<scope>`, and `*-slug` above must be filesystem-safe before it goes into a path.** A path that a model composes from a raw feature, task, or finding name can carry a character Windows forbids, and a single bad name makes the whole repo un-checkout-able on Windows (`git error: invalid path` aborts the entire checkout, not just that file). A colon is the usual offender: `docs/plans/frontend:public-site.md` blocks every Windows clone. Derive the slug this way: lowercase; replace every character outside `a-z 0-9 . _ -` (this removes the Windows-reserved set `< > : " / \ | ? *` plus spaces and control characters) with a single `-`; collapse repeated `-` and trim leading/trailing `-` and `.`; if the result is empty or a Windows reserved device name (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`), prefix it with the artifact kind (`plan-`, `feature-`, `run-`). The human-readable name still goes in the file's heading, so nothing is lost.

## Tooling activation (atlas-setup)

Beyond scaffolding files, `atlas-setup` ensures the plugins, skills, agents, and hooks
that measurably improve results for the project's tech stack are installed, wired, and
active - for example claude-mem (cross-session memory), context-mode (context-window
protection), ponytail (simplicity discipline), and the completion/dispatch gate hooks.
Detection and the activation flow live in `atlas-setup/references/install.md`; the
record of what was activated and why is written to `.atlas/decisions/`.

## "docs-current": the completion gate definition

A shipping change is **docs-current** only when all of the following are true:

1. `docs/CHANGELOG.md` has a newest-first entry for the change (completed and verified as working/implemented).
2. `docs/ROADMAP.md` is reconciled: completed items moved out, new follow-ups added, in-flight items still listed.
3. Every affected `docs/` subfolder is updated (a new feature adds `docs/features/`; a design shift adds `docs/architecture/`; a gotcha adds `docs/lessons/` - each created on demand if it does not yet exist).
4. Evidence for the change is committed under `.atlas/evidence/` and referenced from its finding.
5. Verified findings are distilled into `.atlas/findings/<YYYY-MM-DD>-<slug>.md` so the fix is discoverable next session.

Code that ships without docs-current is incomplete. The completion gate refuses to mark the task done until docs-current holds. Drift caught later by `atlas:docs-auditor` is a defect, not a follow-up.

## Copy-ready templates

### CHANGELOG.md entry (newest-first)

Newest entries go at the top, directly under the heading. Keep the file append-at-top.

```markdown
## 2026-06-15

### Fixed
- Auth redirect dropped the `returnTo` query param on token refresh. Root cause: refresh
  handler rebuilt the URL without the original search string. (.atlas/evidence/2026-06-15-auth-redirect-fix/,
  .atlas/findings/2026-06-15-auth-redirect-fix.md)

### Added
- Cursor-based pagination on `GET /api/v1/users`. See docs/decisions/0007-switch-to-cursor-pagination.md.

### Changed
- Bumped Node minimum to 20 in AGENTS.md run commands.
```

### ROADMAP.md item (with status)

Statuses: `planned | in-progress | blocked | deferred | done`. Move `done` items to CHANGELOG and drop them from here on the next pass. Session-start reconcile and session-end curate are defined in `session-lifecycle.md`.

```markdown
## Backlog

- [planned] Rate-limit `POST /api/v1/login` (Redis sliding window, 100/min). Owner: unassigned.
- [in-progress] Migrate file uploads to streaming. Blocked-by: none. Plan: docs/plans/streaming-uploads.md.
- [blocked] Replace legacy session store. Blocked-by: vendor SSO cutover (ETA Q3).
- [deferred] Dark-mode theming. Reason: out of scope for current milestone.
```

### AGENTS.md section

`AGENTS.md` orients the next agent in seconds. Lead with the commands that actually work in this repo.

```markdown
# AGENTS.md

## Commands
- run:    `npm run dev`            # serves on http://localhost:5173
- test:   `npm test`              # vitest; coverage gate 85%
- build:  `npm run build`
- lint:   `npm run lint`          # eslint + prettier, must be clean before commit

## Architecture summary
- frontend/  React 18 + Tailwind + shadcn/ui. Data fetching only in pages/.
- backend/   Express; routes -> services -> repositories -> Postgres. No SQL in services.
- shared/    Single source of truth for cross-side TypeScript types.

## Conventions
- yarn over npm. If the repo lives on a cloud-synced drive, stage installs outside it (e.g. /tmp) to avoid sync churn.
- Error envelope: { error: { code, message, details, traceId } }. See docs/architecture/.

## Glossary
- transaction: a single ledger movement. Same noun across API, DB table, and UI types.
```

## Relationship to the rest of the skill

- Layout, root detection, and the findings.json schema: `scaffolding.md`.
- How to dispatch the agents named above and their read/write boundaries: `subagent-kit.md`.
- Curator and auditor are dispatched like any other companion agent, with `docs/`, the durable `.atlas/` subfolders, the root entry files, and `.gitignore` as the curator's writable scope, or read scope (auditor).
- Tech-stack tooling activation: `atlas-setup/references/install.md`.
