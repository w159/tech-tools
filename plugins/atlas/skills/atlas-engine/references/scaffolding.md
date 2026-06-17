# Scaffolding

Where artifacts live. The rule that prevents clutter: **scope everything to where it belongs, never to a parent that holds multiple projects.**

All orchestrator artifacts live under one tree: the codebase root's `docs/`. There is no separate `.orchestrator/` directory. `docs/` is the single source of truth. See `docs-ssot.md` for the full contract of who writes what and when.

## Detect three levels first

1. **Workspace root**: a directory that contains *multiple unrelated projects* (e.g. a `Projects/` or `Web_Projects/` folder). **Never scaffold here.** If the skill is invoked from such a parent, identify which project the task targets and descend into it; if ambiguous, ask.
2. **Project root**: the unit of work, the git repository root, or the single app dir. Detection: nearest ancestor with `.git`.
3. **Codebase roots**: subdirectories with their *own* manifest (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `composer.json`, ...). A monorepo has several (e.g. `frontend/`, `backend/`, `admin-webapp/`, `functions/`). Detection: descendants (depth <= 3, excluding `node_modules`/`.venv*`/`dist`/`build`) containing a manifest.

The `docs/` tree lives at the **codebase root** the task targets, not at a multi-project parent. A single-app repo has one codebase root (= project root) and one `docs/`. A monorepo gets a `docs/` under whichever codebase root the work touches; respect any existing layout the repo already has. Confirm the chosen root in the orientation summary before creating anything.

## Artifact layout

```
<codebase-root>/docs/                 # single source of truth (create if absent)
├── CHANGELOG.md          # append-only, newest-first; everything done/changed
├── ROADMAP.md            # everything still to be done; backlog with status
├── AGENTS.md             # how the project works: architecture, conventions, real run/test/build/lint commands, glossary
├── evidence/             # COMMITTED permanent execution-evidence; one dir per item: <YYYY-MM-DD>-<slug>/
├── architecture/         # system design, component maps, data flows; ADRs under architecture/decisions/
├── reference_files/      # external/vendor doc snippets, API references, sample configs the project depends on
├── audits/               # audit reports (security/quality/performance) with date + scope
├── features/             # per-feature specs-as-built: what it does, where it lives, how it is tested
├── lessons/              # durable lessons learned, gotchas, postmortems, why-we-did-X
├── wiki/                 # onboarding, how-to, operational runbooks
├── specs/                # requirements and specifications (pre-build intent)
├── plans/                # implementation plans = numbered stage maps, one per task, living documents
└── .run/                 # EPHEMERAL, GITIGNORED run state
    ├── STATE.md          #   live: current wave, open subagents, decisions, next wave
    ├── findings.json     #   machine-readable, one object per finding (schema below)
    └── work-log.md       #   resumability log; re-read before any continuation
```

Per-codebase knowledge graphs stay scoped per root:

```
<each codebase root>/graphify-out/    # per-stack knowledge graph (via the graphify skill, scoped to that root)
```

Rules:
- Everything under `docs/` is **committed** except `docs/.run/`. Add `docs/.run/` to the repo's `.gitignore`: it is ephemeral run state and must never be committed.
- One `docs/` per codebase root. Respect an existing layout if the repo already has one; merge into it rather than duplicating.
- `graphify-out/` is **per codebase root** (run `graphify` scoped to each root, not the whole tree).
- Never write artifacts above the codebase root.
- For a trivial single-shot task you may skip `docs/.run/` scaffolding (use judgment); scaffold when the work spans multiple waves or you need to persist findings. The durable subfolders are still updated for any shipping change (see "Living-docs discipline").

## findings.json schema (one object per finding)

Lives at `docs/.run/findings.json`. One object per finding:

```json
{
  "id": "BE-014",
  "surface": "frontend|admin|backend|database|infra|claude-code-setup",
  "category": "correctness|security|reliability|performance|maintainability|setup",
  "severity": "critical|high|medium|low",
  "title": "one line",
  "evidence": ["path/file.py:L42-58", "docs/evidence/2026-06-15-test-x/run.log", "screenshot.png"],
  "doc_refs": ["context7: fastapi 0.115 / security"],
  "reproduction": "exact command or test that demonstrates it",
  "proposed_fix": "concise",
  "blast_radius": "single-file|module|cross-service|schema",
  "status": "verified|rejected|needs-evidence|open"
}
```

The `status` enum is `verified | rejected | needs-evidence | open`. A finding starts `open`, becomes `needs-evidence` when it lacks a reproduction or capture, and resolves to `verified` or `rejected` only through a separate verifier context. Bulky evidence referenced from a finding is committed under `docs/evidence/`, not inlined.

## Living-docs discipline

Any change to user-visible behavior, a public API, or an operator workflow updates `docs/CHANGELOG.md` (what shipped, newest-first) and reconciles `docs/ROADMAP.md` (move done items out, add follow-ups) as part of the same wave. A code change without its doc update is incomplete. Every affected durable subfolder (`architecture/`, `features/`, `lessons/`, `audits/`, `wiki/`, `specs/`) is updated too. Keep `docs/AGENTS.md` current with discovered stacks, the real gate commands, and gotchas, so the next session orients in seconds. This is the "docs-current" state the completion gate enforces, see `docs-ssot.md`.
