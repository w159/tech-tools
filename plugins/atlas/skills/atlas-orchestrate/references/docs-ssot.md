# docs/ + .atlas/ Single Source of Truth

The target project has two tracked trees with distinct purposes:

- **`docs/`** - the project wiki. A complete, living reference so collaborators and
  coding agents can understand the project: changes, decisions, issues, features,
  improvements, and updates tracked over the development lifecycle. This includes
  graphify results for the codebase and the understand-anything knowledge base.
  **Minimum:** `CHANGELOG.md` (completed and verified work, maintained between
  sessions) and `ROADMAP.md` (work NOT yet completed/verified - planned, in-flight,
  blocked, deferred). Additional subfolders grow dynamically as the project needs
  them: `architecture/`, `plans/`, `specs/`, `audits/`, `lessons/`, `features/`,
  `decisions/`, `wiki/` (graphify results), etc. The scaffold does not pre-create them.

- **`.atlas/`** - atlas's own auditable operational state, driving self-improvement:
  execution evidence, run state, nudge data, self-improvement tracking, and persistent
  memory. Never contains project wiki content (architecture, plans, specs, audits,
  lessons, wiki) or a `docs/` subdirectory.

Both trees live **in the target project being worked on** (the codebase root under
`.git`), never in this workspace or the skill's own directory. Any coding agent
running the atlas-orchestrate skill keeps them accurate automatically as part of
finishing work; it is not a manual afterthought. Layout and root detection live in
`scaffolding.md`.

`.atlas/` must never contain project wiki subdirs (`architecture/`, `plans/`,
`specs/`, `audits/`, `lessons/`, `wiki/`) or a `docs/` subdirectory. A leftover
`.atlas/docs/` from before this SSOT split is a defect: move its unique content
into `docs/` or the appropriate `.atlas/` subfolder, delete the directory, and
re-run `scripts/scaffold_docs.py`, which refuses (exit 1) to scaffold over a
non-empty legacy `.atlas/docs/` holding durable content or over `.atlas/` with
project wiki subdirs present.

## What each path holds

### docs/ - project wiki (dynamic)

| Path | Holds | Committed? |
|---|---|---|
| `docs/CHANGELOG.md` | Newest-first append-only log of everything completed and verified as working/implemented. Maintained between chat sessions. | yes |
| `docs/ROADMAP.md` | Everything NOT yet completed/verified: backlog items with status (planned, in-progress, blocked, deferred). Maintained between chat sessions. The docs-curator moves completed items from ROADMAP to CHANGELOG after validation. | yes |
| `docs/AGENTS.md` | Orienting guidance: how the project works, architecture summary, conventions, run/test/build/lint commands, glossary. | yes |
| `docs/` subfolders | Dynamic, created on demand: `architecture/`, `plans/`, `specs/`, `audits/`, `lessons/`, `features/`, `decisions/`, `wiki/` (graphify results), `standards/`, `reference/`, etc. The understand-anything knowledge base lives here too. | yes |

The scaffold creates only `CHANGELOG.md` and `ROADMAP.md`. Every other subfolder
is created by an atlas skill (usually `atlas:docs-curator`) when the project first
needs it. The wiki structure adapts to the codebase.

### .atlas/ - atlas internal state (auditable self-improvement)

| Path | Holds | Committed? |
|---|---|---|
| `.atlas/evidence/` | Permanent execution evidence: red→green captures, command output, screenshots; one file or dir per item. | yes |
| `.atlas/nudge/` | Nudge data: inline-op thresholds, dispatch coaching signals. | yes |
| `.atlas/self-improvement/` | Self-improvement tracking: skill generation/disabling decisions, context-optimizer output, curator actions. | yes |
| `.atlas/memory/` | Persistent memory for cross-session self-improvement. | yes |
| `.atlas/.run/STATE.md` | Live run state: current wave, open subagents, decisions, next wave. | no (gitignored) |
| `.atlas/.run/findings.json` | Per-run findings and verdicts (schema in `scaffolding.md`). | yes (durable ledger) |
| `.atlas/.run/work-log.md` | Resumability log; re-read before any continuation. | no (gitignored) |

`.atlas/.run/` is the only ephemeral subtree (except `findings.json`, the durable
verification ledger). Everything else in both trees is committed. Under a
deny-by-default `.gitignore`, allowlist `docs/` explicitly (`!docs/`,
`!docs/**`) plus the `.atlas/` subfolders (`!.atlas/evidence/`,
`!.atlas/evidence/**`, `!.atlas/self-improvement/`, `!.atlas/self-improvement/**`,
`!.atlas/memory/`, `!.atlas/memory/**`, `!.atlas/nudge/`, `!.atlas/nudge/**`) and
re-exclude `.atlas/.run/` after them so it stays ignored (except
`!.atlas/.run/findings.json`). Verify with `git check-ignore docs/CHANGELOG.md`
and `git check-ignore .atlas/evidence/.gitkeep` (both must report NOT ignored)
and `git check-ignore .atlas/.run/STATE.md` (must report ignored).

## Ownership: who writes what

| Path | Owner | Notes |
|---|---|---|
| `.atlas/.run/*` | Orchestrator | Live run state, findings, work-log. Re-read `work-log.md` before any continuation. |
| `.atlas/evidence/*` | Write-capable execution agents (`atlas:implementer`, `atlas:ui-runtime-tester`) | They capture proof at the moment they produce it. |
| `.atlas/nudge/*`, `.atlas/self-improvement/*`, `.atlas/memory/*` | Atlas hooks and self-improvement scripts | Written by the atlas infrastructure itself. |
| `docs/CHANGELOG.md`, `docs/ROADMAP.md`, `docs/AGENTS.md` | `atlas:docs-curator` | Orchestrator may also update root files directly when a curator pass is overkill. |
| `docs/` subfolders (`architecture/`, `plans/`, `specs/`, `audits/`, `lessons/`, `wiki/`, etc.) | `atlas:docs-curator` | Write-capable, confined to `docs/`. Creates subfolders on demand as the project needs them. |

Hard boundaries:
- The orchestrator never edits target source code.
- `atlas:docs-curator` is write-capable but confined to `docs/`: it never touches source.
- `atlas:docs-auditor` is **read-only**; it independently audits `docs/` for drift against the code and reports findings, fixing nothing.

## When to write

- **During a wave:** the orchestrator keeps `.atlas/.run/STATE.md` and `.atlas/.run/work-log.md` current; findings land in `.atlas/.run/findings.json`.
- **At the moment of proof:** the agent that ran the test or drove the UI writes its capture to `.atlas/evidence/<dir>/` immediately, then references that path from its finding.
- **Before any change is called done:** CHANGELOG updated (completed + verified), ROADMAP reconciled (in-flight items still listed), and every affected `docs/` subfolder updated. This is the completion gate (see "docs-current").
- **On resume:** re-read `.atlas/.run/work-log.md` first, then `STATE.md`, before dispatching anything.

## Naming conventions

- Evidence dirs: `.atlas/evidence/<YYYY-MM-DD>-<slug>/` (e.g. `.atlas/evidence/2026-06-15-auth-redirect-fix/`). Inside: the raw `run.log`, `before.png`/`after.png`, EXPLAIN output, etc.
- Project wiki subfolders: `docs/<subfolder>/<slug>.md` - lowercase-kebab-case. Examples:
  - Audits: `docs/audits/atlas-<scope>-<YYYY-MM-DD>/` (e.g. `docs/audits/atlas-security-2026-06-15/`).
  - Plans: `docs/plans/<task-slug>.md`, one per task.
  - Specs: `docs/specs/<YYYY-MM-DD>-<slug>.md`.
  - Architecture: `docs/architecture/<slug>.md`.
  - Lessons: `docs/lessons/<YYYY-MM-DD>-<slug>.md`.
  - Features: `docs/features/<slug>.md`.
  - Decisions: `docs/decisions/<slug>.md`.
  - Wiki (graphify): `docs/wiki/<slug>.md`.
- Root files: all-caps (`CHANGELOG.md`, `ROADMAP.md`, `AGENTS.md`).

**Every `<slug>`, `<id>`, `<scope>`, and `*-slug` above must be filesystem-safe before it goes into a path.** A path that a model composes from a raw feature, task, or finding name can carry a character Windows forbids, and a single bad name makes the whole repo un-checkout-able on Windows (`git error: invalid path` aborts the entire checkout, not just that file). A colon is the usual offender: `docs/plans/frontend:public-site.md` blocks every Windows clone. Derive the slug this way: lowercase; replace every character outside `a-z 0-9 . _ -` (this removes the Windows-reserved set `< > : " / \ | ? *` plus spaces and control characters) with a single `-`; collapse repeated `-` and trim leading/trailing `-` and `.`; if the result is empty or a Windows reserved device name (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`), prefix it with the artifact kind (`plan-`, `feature-`, `run-`). The human-readable name still goes in the file's heading, so nothing is lost.

## "docs-current": the completion gate definition

A shipping change is **docs-current** only when all of the following are true:

1. `docs/CHANGELOG.md` has a newest-first entry for the change (completed and verified as working/implemented).
2. `docs/ROADMAP.md` is reconciled: completed items moved out, new follow-ups added, in-flight items still listed.
3. Every affected `docs/` subfolder is updated (a new feature adds `docs/features/`; a design shift adds `docs/architecture/`; a gotcha adds `docs/lessons/` - each created on demand if it does not yet exist).
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
- [in-progress] Migrate file uploads to streaming. Blocked-by: none. Plan: .atlas/plans/streaming-uploads.md.
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