# docs/ Single Source of Truth

The target project's `docs/` directory is the only home for orchestrator artifacts. There is no `.orchestrator/` directory. This file is the contract: what each path holds, who writes it, when, naming, and the "docs-current" definition the completion gate enforces.

This `docs/` tree is created and maintained **in the target project being worked on** (the codebase root under `.git`), never in this workspace or the skill's own directory. Any coding agent running the orchestrate skill keeps it accurate automatically as part of finishing work; it is not a manual afterthought. Layout and root detection live in `scaffolding.md`.

## What each path holds

| Path | Holds | Committed? |
|---|---|---|
| `docs/CHANGELOG.md` | Append-only, newest-first log of everything done or changed | yes |
| `docs/ROADMAP.md` | Everything still to be done; backlog items with status | yes |
| `docs/AGENTS.md` | Orienting guidance: how the project works, architecture summary, conventions, the real run/test/build/lint commands, glossary | yes |
| `docs/evidence/` | Permanent execution-evidence: red->green captures, command output, screenshots; one dir per item | yes |
| `docs/architecture/` | System design, component maps, data flows; ADRs under `architecture/decisions/` | yes |
| `docs/reference_files/` | External/vendor doc snippets, API references, sample configs the project depends on | yes |
| `docs/audits/` | Audit reports (security/quality/performance) with date and scope | yes |
| `docs/features/` | Per-feature specs-as-built: what each feature does, where it lives, how it is tested | yes |
| `docs/lessons/` | Durable lessons learned, gotchas, postmortems, why-we-did-X | yes |
| `docs/wiki/` | Onboarding, how-to, operational runbooks | yes |
| `docs/specs/` | Requirements and specifications (pre-build intent) | yes |
| `docs/plans/` | Implementation plans = numbered stage maps, one per task, living documents | yes |
| `docs/.run/STATE.md` | Live run state: current wave, open subagents, decisions, next wave | no (gitignored) |
| `docs/.run/findings.json` | Per-run findings and verdicts (schema in `scaffolding.md`) | no (gitignored) |
| `docs/.run/work-log.md` | Resumability log; re-read before any continuation | no (gitignored) |

`docs/.run/` is the only ephemeral subtree. Everything else is committed. Add `docs/.run/` to `.gitignore`.

## Ownership: who writes what

| Path | Owner | Notes |
|---|---|---|
| `docs/.run/*` | Orchestrator | Live run state, findings, work-log. Re-read `work-log.md` before any continuation. |
| `docs/plans/*` | Orchestrator | Numbered stage maps; living documents updated as stages complete. |
| `docs/CHANGELOG.md`, `docs/ROADMAP.md`, `docs/AGENTS.md` | `orc-docs-curator` | Orchestrator may also update root files directly when a curator pass is overkill. |
| Durable subfolders (`architecture/`, `reference_files/`, `audits/`, `features/`, `lessons/`, `wiki/`, `specs/`) | `orc-docs-curator` | Write-capable, confined to `docs/`. |
| `docs/evidence/*` | Write-capable execution agents (`orc-implementer`, `orc-ui-runtime-tester`) | They capture proof at the moment they produce it. |

Hard boundaries:
- The orchestrator never edits target source code.
- `orc-docs-curator` is write-capable but confined to `docs/`: it never touches source.
- `orc-docs-auditor` is **read-only**; it independently audits `docs/` for drift against the code and reports findings, fixing nothing.

## When to write

- **During a wave:** the orchestrator keeps `docs/.run/STATE.md` and `docs/.run/work-log.md` current; findings land in `docs/.run/findings.json`.
- **At the moment of proof:** the agent that ran the test or drove the UI writes its capture to `docs/evidence/<dir>/` immediately, then references that path from its finding.
- **Before any change is called done:** CHANGELOG updated, ROADMAP reconciled, and every affected durable subfolder updated. This is the completion gate (see "docs-current").
- **On resume:** re-read `docs/.run/work-log.md` first, then `STATE.md`, before dispatching anything.

## Naming conventions

- Evidence dirs: `docs/evidence/<YYYY-MM-DD>-<slug>/` (e.g. `docs/evidence/2026-06-15-auth-redirect-fix/`). Inside: the raw `run.log`, `before.png`/`after.png`, EXPLAIN output, etc.
- Audits: `docs/audits/<YYYY-MM-DD>-<scope>.md` (e.g. `docs/audits/2026-06-15-security-authz.md`).
- ADRs: `docs/architecture/decisions/NNNN-<slug>.md`, zero-padded sequential (e.g. `0007-switch-to-cursor-pagination.md`).
- Plans: `docs/plans/<task-slug>.md`, one per task.
- Features: `docs/features/<feature-slug>.md`.
- Lessons: `docs/lessons/<slug>.md`.
- Files: `lowercase-kebab-case.md` except the all-caps root files (`CHANGELOG.md`, `ROADMAP.md`, `AGENTS.md`).

## "docs-current": the completion gate definition

A shipping change is **docs-current** only when all of the following are true:

1. `docs/CHANGELOG.md` has a newest-first entry for the change.
2. `docs/ROADMAP.md` is reconciled: completed items moved out, new follow-ups added.
3. Every affected durable subfolder is updated (a new feature updates `features/`; a design shift updates `architecture/`; a gotcha updates `lessons/`; an audit lands in `audits/`).
4. Evidence for the change is committed under `docs/evidence/` and referenced from its finding.

Code that ships without docs-current is incomplete. The completion gate refuses to mark the task done until docs-current holds. Drift caught later by `orc-docs-auditor` is a defect, not a follow-up.

## Copy-ready templates

### CHANGELOG.md entry (newest-first)

Newest entries go at the top, directly under the heading. Keep the file append-at-top.

```markdown
## 2026-06-15

### Fixed
- Auth redirect dropped the `returnTo` query param on token refresh. Root cause: refresh
  handler rebuilt the URL without the original search string. (docs/evidence/2026-06-15-auth-redirect-fix/)

### Added
- Cursor-based pagination on `GET /api/v1/users`. See docs/architecture/decisions/0007-switch-to-cursor-pagination.md.

### Changed
- Bumped Node minimum to 20 in AGENTS.md run commands.
```

### ROADMAP.md item (with status)

Statuses: `planned | in-progress | blocked | deferred | done`. Move `done` items to CHANGELOG and drop them from here on the next pass.

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
- yarn over npm. Never run installs under the iCloud path; stage in /tmp.
- Error envelope: { error: { code, message, details, traceId } }. See docs/architecture/.

## Glossary
- transaction: a single ledger movement. Same noun across API, DB table, and UI types.
```

## Relationship to the rest of the skill

- Layout, root detection, and the findings.json schema: `scaffolding.md`.
- How to dispatch the agents named above and their read/write boundaries: `subagent-kit.md`.
- Curator and auditor are dispatched like any other companion agent, with `docs/` as their only writable scope (curator) or read scope (auditor).
