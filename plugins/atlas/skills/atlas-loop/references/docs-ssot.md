# docs/ Single Source of Truth (plus .atlas/ internal state)

The target project's `docs/` directory is the only home for durable, project-facing
documentation. `.atlas/` (never `.atlas/docs/`) holds atlas's own internal
state: execution evidence, audit reports, and ephemeral run state. There is no
separate `.orchestrator/` directory. This file is the contract: what each path
holds, who writes it, when, naming, and the "docs-current" definition the
completion gate enforces.

Both trees are created and maintained **in the target project being worked on**
(the codebase root under `.git`), never in this workspace or the skill's own
directory. Any coding agent running the atlas-orchestrate skill keeps them
accurate automatically as part of finishing work; it is not a manual
afterthought. Layout and root detection live in `scaffolding.md`.

`.atlas/` must never contain a `docs/` subdirectory. A leftover `.atlas/docs/`
from before this split is a defect: move its unique content into `docs/`,
delete the directory, and re-run `scripts/scaffold_docs.py`, which refuses
(exit 1) to scaffold over a non-empty legacy `.atlas/docs/`.

## What each path holds

| Path | Holds | Committed? |
|---|---|---|
| `docs/CHANGELOG.md` | Append-only, newest-first log of everything done or changed | yes |
| `docs/ROADMAP.md` | Everything still to be done; backlog items with status | yes |
| `docs/AGENTS.md` | Orienting guidance: how the project works, architecture summary, conventions, the real run/test/build/lint commands, glossary | yes |
| `docs/architecture/` | System design, component maps, data flows; ADRs under `architecture/decisions/` | yes |
| `docs/reference_files/` | External/vendor doc snippets, API references, sample configs the project depends on | yes |
| `docs/features/` | Per-feature specs-as-built: what each feature does, where it lives, how it is tested | yes |
| `docs/lessons/` | Durable lessons learned, gotchas, postmortems, why-we-did-X | yes |
| `docs/wiki/` | Onboarding, how-to, operational runbooks | yes |
| `docs/specs/` | Requirements and specifications (pre-build intent) | yes |
| `docs/plans/` | Implementation plans = numbered stage maps, one per task, living documents | yes |
| `.atlas/evidence/` | Permanent execution-evidence: red->green captures, command output, screenshots; one dir per item | yes |
| `.atlas/audits/` | Audit reports (security/quality/performance) with date and scope | yes |
| `.atlas/.run/STATE.md` | Live run state: current wave, open subagents, decisions, next wave | no (gitignored) |
| `.atlas/.run/findings.json` | Per-run findings and verdicts (schema in `scaffolding.md`) | no (gitignored) |
| `.atlas/.run/work-log.md` | Resumability log; re-read before any continuation | no (gitignored) |

`.atlas/.run/` is the only ephemeral subtree. Everything else in both trees is
committed. Under a deny-by-default `.gitignore`, allowlist `docs/` explicitly
(`!docs/`, `!docs/**`) plus `!.atlas/evidence/`, `!.atlas/evidence/**`,
`!.atlas/audits/`, `!.atlas/audits/**`, and re-exclude `.atlas/.run/` after
them so it stays ignored. Verify with `git check-ignore docs/CHANGELOG.md`
and `git check-ignore .atlas/evidence/.gitkeep` (both must report NOT
ignored) and `git check-ignore .atlas/.run/findings.json` (must report
ignored).

## Ownership: who writes what

| Path | Owner | Notes |
|---|---|---|
| `.atlas/.run/*` | Orchestrator | Live run state, findings, work-log. Re-read `work-log.md` before any continuation. |
| `docs/plans/*` | Orchestrator | Numbered stage maps; living documents updated as stages complete. |
| `docs/CHANGELOG.md`, `docs/ROADMAP.md`, `docs/AGENTS.md` | `atlas:docs-curator` | Orchestrator may also update root files directly when a curator pass is overkill. |
| Durable subfolders (`architecture/`, `reference_files/`, `features/`, `lessons/`, `wiki/`, `specs/`) | `atlas:docs-curator` | Write-capable, confined to `docs/`. |
| `.atlas/evidence/*` | Write-capable execution agents (`atlas:implementer`, `atlas:ui-runtime-tester`) | They capture proof at the moment they produce it. |
| `.atlas/audits/*` | `atlas:docs-curator` or the atlas-audit orchestrator | Write-capable, confined to `.atlas/audits/`. |

Hard boundaries:
- The orchestrator never edits target source code.
- `atlas:docs-curator` is write-capable but confined to `docs/` (plus `.atlas/audits/` when acting for atlas-audit): it never touches source.
- `atlas:docs-auditor` is **read-only**; it independently audits `docs/` for drift against the code and reports findings, fixing nothing.

## When to write

- **During a wave:** the orchestrator keeps `.atlas/.run/STATE.md` and `.atlas/.run/work-log.md` current; findings land in `.atlas/.run/findings.json`.
- **At the moment of proof:** the agent that ran the test or drove the UI writes its capture to `.atlas/evidence/<dir>/` immediately, then references that path from its finding.
- **Before any change is called done:** CHANGELOG updated, ROADMAP reconciled, and every affected durable subfolder updated. This is the completion gate (see "docs-current").
- **On resume:** re-read `.atlas/.run/work-log.md` first, then `STATE.md`, before dispatching anything.

## Naming conventions

- Evidence dirs: `.atlas/evidence/<YYYY-MM-DD>-<slug>/` (e.g. `.atlas/evidence/2026-06-15-auth-redirect-fix/`). Inside: the raw `run.log`, `before.png`/`after.png`, EXPLAIN output, etc.
- Audits: `.atlas/audits/<YYYY-MM-DD>-<scope>.md` (e.g. `.atlas/audits/2026-06-15-security-authz.md`).
- ADRs: `docs/architecture/decisions/NNNN-<slug>.md`, zero-padded sequential (e.g. `0007-switch-to-cursor-pagination.md`).
- Plans: `docs/plans/<task-slug>.md`, one per task.
- Features: `docs/features/<feature-slug>.md`.
- Lessons: `docs/lessons/<slug>.md`.
- Files: `lowercase-kebab-case.md` except the all-caps root files (`CHANGELOG.md`, `ROADMAP.md`, `AGENTS.md`).

**Every `<slug>`, `<id>`, `<scope>`, and `<*-slug>` above must be filesystem-safe before it goes into a path.** A path that a model composes from a raw feature, task, or finding name can carry a character Windows forbids, and a single bad name makes the whole repo un-checkout-able on Windows (`git error: invalid path` aborts the entire checkout, not just that file). A colon is the usual offender: `docs/plans/frontend:public-site.md` blocks every Windows clone. Derive the slug this way: lowercase; replace every character outside `a-z 0-9 . _ -` (this removes the Windows-reserved set `< > : " / \ | ? *` plus spaces and control characters) with a single `-`; collapse repeated `-` and trim leading/trailing `-` and `.`; if the result is empty or a Windows reserved device name (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`), prefix it with the artifact kind (`plan-`, `feature-`, `run-`). The human-readable name still goes in the file's heading, so nothing is lost.

## "docs-current": the completion gate definition

A shipping change is **docs-current** only when all of the following are true:

1. `docs/CHANGELOG.md` has a newest-first entry for the change.
2. `docs/ROADMAP.md` is reconciled: completed items moved out, new follow-ups added.
3. Every affected durable subfolder is updated (a new feature updates `features/`; a design shift updates `architecture/`; a gotcha updates `lessons/`).
4. Evidence for the change is committed under `.atlas/evidence/` and referenced from its finding.

Code that ships without docs-current is incomplete. The completion gate refuses to mark the task done until docs-current holds. Drift caught later by `atlas:docs-auditor` is a defect, not a follow-up.

## Copy-ready templates

### CHANGELOG.md entry (newest-first)

Newest entries go at the top, directly under the heading. Keep the file append-at-top.

```markdown
## 2026-06-15

### Fixed
- Auth redirect dropped the `returnTo` query param on token refresh. Root cause: refresh
  handler rebuilt the URL without the original search string. (.atlas/evidence/2026-06-15-auth-redirect-fix/)

### Added
- Cursor-based pagination on `GET /api/v1/users`. See docs/architecture/decisions/0007-switch-to-cursor-pagination.md.

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
- Curator and auditor are dispatched like any other companion agent, with `docs/` (plus `.atlas/audits/` for the curator) as their only writable scope, or read scope (auditor).
