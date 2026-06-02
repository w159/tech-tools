# Scaffolding

Where artifacts live. The rule that prevents clutter: **scope everything to where it belongs, never to a parent that holds multiple projects.**

## Detect three levels first

1. **Workspace root** — a directory that contains *multiple unrelated projects* (e.g. a `Projects/` or `Web_Projects/` folder). **Never scaffold here.** If the skill is invoked from such a parent, identify which project the task targets and descend into it; if ambiguous, ask.
2. **Project root** — the unit of work: the git repository root, or the single app dir. Living docs and orchestrator state live here.
3. **Codebase roots** — subdirectories with their *own* manifest (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `composer.json`, …). A monorepo has several (e.g. `frontend/`, `backend/`, `admin-webapp/`, `functions/`). Per-codebase artifacts live in each.

Detection heuristic: project root = nearest ancestor with `.git`; codebase roots = descendants (depth ≤ 3, excluding `node_modules`/`.venv*`/`dist`/`build`) containing a manifest. Confirm in the orientation summary before creating anything.

## Artifact layout

```
<project-root>/
├── docs/                      # living docs — single source of truth (create if absent)
│   ├── CHANGELOG.md           #   every shipped change, dated
│   ├── ROADMAP.md             #   planned / deferred items, prioritized
│   └── AGENTS.md              #   operating notes for agents in this repo (stacks, gates, gotchas)
├── .orchestrator/             # working state — consolidated, hidden, gitignore-friendly
│   ├── STATE.md               #   live: current phase, open subagents, decisions, next wave
│   ├── findings.json          #   machine-readable, one object per finding (schema below)
│   ├── findings/              #   one markdown per finding (FE-001.md …) with evidence + repro
│   ├── evidence/              #   captured outputs: test logs, EXPLAIN plans, screenshots
│   └── plans/                 #   remediation / implementation plans
└── <each codebase root>/
    └── graphify-out/          # per-stack knowledge graph (via the graphify skill, scoped to that root)
```

Rules:
- `docs/` and `.orchestrator/` → **project root only**. One `docs/` per project; respect an existing layout if the repo already has one.
- `graphify-out/` → **per codebase root** (run `graphify` scoped to each root, not the whole tree).
- Add `.orchestrator/` to the repo's `.gitignore` unless the user wants state committed. Never write artifacts above the project root.
- For a trivial single-shot task you may skip `.orchestrator/` scaffolding — use judgment; scaffold when the work spans multiple waves or you need to persist findings.

## findings.json schema (one object per finding)

```json
{
  "id": "BE-014",
  "surface": "frontend|admin|backend|database|infra|claude-code-setup",
  "category": "correctness|security|reliability|performance|maintainability|setup",
  "severity": "critical|high|medium|low",
  "title": "one line",
  "evidence": ["path/file.py:L42-58", ".orchestrator/evidence/test_x.log", "screenshot.png"],
  "doc_refs": ["context7: fastapi 0.115 / security"],
  "reproduction": "exact command or test that demonstrates it",
  "proposed_fix": "concise",
  "blast_radius": "single-file|module|cross-service|schema",
  "status": "open|verified|rejected|fixed|deferred|needs-human"
}
```

## Living-docs discipline

Any change to user-visible behavior, a public API, or an operator workflow updates `docs/CHANGELOG.md` (what shipped, dated) and `docs/ROADMAP.md` (move done items out, add follow-ups) as part of the same wave. A code change without its doc update is incomplete. Keep `AGENTS.md` current with discovered stacks, the real gate commands, and gotchas, so the next session orients in seconds.
