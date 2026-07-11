# .atlas/docs/ Single Source of Truth

The target project's `.atlas/docs/` directory is the only home for orchestrator artifacts. There is no `.orchestrator/` directory. This file is the contract: what each path holds, who writes it, when, naming, and the "docs-current" definition the completion gate enforces.

This `.atlas/docs/` tree is created and maintained **in the target project being worked on** (the codebase root under `.git`), never in this workspace or the skill's own directory. Any coding agent running the atlas-metis skill keeps it accurate automatically as part of finishing work; it is not a manual afterthought. Layout and root detection live in `scaffolding.md`.

## What each path holds

| Path | Holds | Committed? |
|---|---|---|
| `.atlas/docs/CHANGELOG.md` | Append-only, newest-first log of everything done or changed | yes |
| `.atlas/docs/ROADMAP.md` | Everything still to be done; backlog items with status | yes |
| `.atlas/docs/AGENTS.md` | Orienting guidance: how the project works, architecture summary, conventions, the real run/test/build/lint commands, glossary | yes |
| `.atlas/docs/evidence/` | Permanent execution-evidence: red->green captures, command output, screenshots; one dir per item | yes |
| `.atlas/docs/architecture/` | System design, component maps, data flows; ADRs under `architecture/decisions/` | yes |
| `.atlas/docs/reference_files/` | External/vendor doc snippets, API references, sample configs the project depends on | yes |
| `.atlas/docs/audits/` | Audit reports (security/quality/performance) with date and scope | yes |
| `.atlas/docs/features/` | Per-feature specs-as-built: what each feature does, where it lives, how it is tested | yes |
| `.atlas/docs/lessons/` | Durable lessons learned, gotchas, postmortems, why-we-did-X | yes |
| `.atlas/docs/wiki/` | Onboarding, how-to, operational runbooks | yes |
| `.atlas/docs/specs/` | Requirements and specifications (pre-build intent) | yes |
| `.atlas/docs/plans/` | Implementation plans = numbered stage maps, one per task, living documents | yes |
| `.atlas/docs/.run/STATE.md` | Live run state: current wave, open subagents, decisions, next wave | no (gitignored) |
| `.atlas/docs/.run/findings.json` | Per-run findings and verdicts (schema in `scaffolding.md`) | no (gitignored) |
| `.atlas/docs/.run/work-log.md` | Resumability log; re-read before any continuation | no (gitignored) |

`.atlas/docs/.run/` is the only ephemeral subtree. Everything else is committed, so `.atlas/docs/` MUST be git-tracked. Under a deny-by-default `.gitignore`, allowlist the SSOT subtree explicitly (`!.atlas/docs/`, `!.atlas/docs/*.md`, and each durable subfolder as `!dir/` + `!dir/**`) and re-exclude `.atlas/docs/.run/` after it. Never blanket-allow `!.atlas/docs/**`: vendored doc-site clones under .atlas/docs/ carry their own nested .git and must stay ignored (re-exclude `.atlas/docs/**/.git/`). Verify with `git check-ignore .atlas/docs/CHANGELOG.md` (must report NOT ignored).

## Ownership: who writes what

| Path | Owner | Notes |
|---|---|---|
| `.atlas/docs/.run/*` | Orchestrator | Live run state, findings, work-log. Re-read `work-log.md` before any continuation. |
| `.atlas/docs/plans/*` | Orchestrator | Numbered stage maps; living documents updated as stages complete. |
| `.atlas/docs/CHANGELOG.md`, `.atlas/docs/ROADMAP.md`, `.atlas/docs/AGENTS.md` | `atlas:docs-curator` | Orchestrator may also update root files directly when a curator pass is overkill. |
| Durable subfolders (`architecture/`, `reference_files/`, `audits/`, `features/`, `lessons/`, `wiki/`, `specs/`) | `atlas:docs-curator` | Write-capable, confined to `.atlas/docs/`. |
| `.atlas/docs/evidence/*` | Write-capable execution agents (`atlas:implementer`, `atlas:ui-runtime-tester`) | They capture proof at the moment they produce it. |

Hard boundaries:
- The orchestrator never edits target source code.
- `atlas:docs-curator` is write-capable but confined to `.atlas/docs/`: it never touches source.
- `atlas:docs-auditor` is **read-only**; it independently audits `.atlas/docs/` for drift against the code and reports findings, fixing nothing.

## When to write

- **During a wave:** the orchestrator keeps `.atlas/docs/.run/STATE.md` and `.atlas/docs/.run/work-log.md` current; findings land in `.atlas/docs/.run/findings.json`.
- **At the moment of proof:** the agent that ran the test or drove the UI writes its capture to `.atlas/docs/evidence/<dir>/` immediately, then references that path from its finding.
- **Before any change is called done:** CHANGELOG updated, ROADMAP reconciled, and every affected durable subfolder updated. This is the completion gate (see "docs-current").
- **On resume:** re-read `.atlas/docs/.run/work-log.md` first, then `STATE.md`, before dispatching anything.

## Naming conventions

- Evidence dirs: `.atlas/docs/evidence/<YYYY-MM-DD>-<slug>/` (e.g. `.atlas/docs/evidence/2026-06-15-auth-redirect-fix/`). Inside: the raw `run.log`, `before.png`/`after.png`, EXPLAIN output, etc.
- Audits: `.atlas/docs/audits/<YYYY-MM-DD>-<scope>.md` (e.g. `.atlas/docs/audits/2026-06-15-security-authz.md`).
- ADRs: `.atlas/docs/architecture/decisions/NNNN-<slug>.md`, zero-padded sequential (e.g. `0007-switch-to-cursor-pagination.md`).
- Plans: `.atlas/docs/plans/<task-slug>.md`, one per task.
- Features: `.atlas/docs/features/<feature-slug>.md`.
- Lessons: `.atlas/docs/lessons/<slug>.md`.
- Files: `lowercase-kebab-case.md` except the all-caps root files (`CHANGELOG.md`, `ROADMAP.md`, `AGENTS.md`).

**Every `<slug>`, `<id>`, `<scope>`, and `<*-slug>` above must be filesystem-safe before it goes into a path.** A path that a model composes from a raw feature, task, or finding name can carry a character Windows forbids, and a single bad name makes the whole repo un-checkout-able on Windows (`git error: invalid path` aborts the entire checkout, not just that file). A colon is the usual offender: `.atlas/docs/plans/frontend:public-site.md` blocks every Windows clone. Derive the slug this way: lowercase; replace every character outside `a-z 0-9 . _ -` (this removes the Windows-reserved set `< > : " / \ | ? *` plus spaces and control characters) with a single `-`; collapse repeated `-` and trim leading/trailing `-` and `.`; if the result is empty or a Windows reserved device name (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`), prefix it with the artifact kind (`plan-`, `feature-`, `run-`). The human-readable name still goes in the file's heading, so nothing is lost.

## "docs-current": the completion gate definition

A shipping change is **docs-current** only when all of the following are true:

1. `.atlas/docs/CHANGELOG.md` has a newest-first entry for the change.
2. `.atlas/docs/ROADMAP.md` is reconciled: completed items moved out, new follow-ups added.
3. Every affected durable subfolder is updated (a new feature updates `features/`; a design shift updates `architecture/`; a gotcha updates `lessons/`; an audit lands in `audits/`).
4. Evidence for the change is committed under `.atlas/docs/evidence/` and referenced from its finding.

Code that ships without docs-current is incomplete. The completion gate refuses to mark the task done until docs-current holds. Drift caught later by `atlas:docs-auditor` is a defect, not a follow-up.

## Copy-ready templates

### CHANGELOG.md entry (newest-first)

Newest entries go at the top, directly under the heading. Keep the file append-at-top.

```markdown
## 2026-06-15

### Fixed
- Auth redirect dropped the `returnTo` query param on token refresh. Root cause: refresh
  handler rebuilt the URL without the original search string. (.atlas/docs/evidence/2026-06-15-auth-redirect-fix/)

### Added
- Cursor-based pagination on `GET /api/v1/users`. See .atlas/docs/architecture/decisions/0007-switch-to-cursor-pagination.md.

### Changed
- Bumped Node minimum to 20 in AGENTS.md run commands.
```

### ROADMAP.md item (with status)

Statuses: `planned | in-progress | blocked | deferred | done`. Move `done` items to CHANGELOG and drop them from here on the next pass. Session-start reconcile and session-end curate are defined in `session-lifecycle.md`.

```markdown
## Backlog

- [planned] Rate-limit `POST /api/v1/login` (Redis sliding window, 100/min). Owner: unassigned.
- [in-progress] Migrate file uploads to streaming. Blocked-by: none. Plan: .atlas/docs/plans/streaming-uploads.md.
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
- Error envelope: { error: { code, message, details, traceId } }. See .atlas/docs/architecture/.

## Glossary
- transaction: a single ledger movement. Same noun across API, DB table, and UI types.
```

## Relationship to the rest of the skill

- Layout, root detection, and the findings.json schema: `scaffolding.md`.
- How to dispatch the agents named above and their read/write boundaries: `subagent-kit.md`.
- Curator and auditor are dispatched like any other companion agent, with `.atlas/docs/` as their only writable scope (curator) or read scope (auditor).
