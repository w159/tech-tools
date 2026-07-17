# Atlas canonical project structure: full scaffold/repair + enforcement across all surfaces

Date: 2026-07-17

## Problem

`atlas-setup`'s `scaffold_docs.py` only seeded a partial `docs/` + `.atlas/` tree. Root
files (`README.md`, `AGENTS.md`, `CLAUDE.md`), `docs/api` (for API projects), and several
`.atlas/` subfolders (`.atlas/decisions/`, `.atlas/understand-anything/`, `.atlas/graphify/`,
orientation `.atlas/CLAUDE.md` and `.atlas/AGENTS.md`) were out of scaffold scope. Meanwhile
the rest of the fleet already assumed the full structure existed:

- `plugins/atlas/agents/docs-curator.md` referenced `.atlas/decisions/` and archive discipline
  into `.atlas/archive/` as if those folders were guaranteed to exist.
- `plugins/atlas/agents/docs-auditor.md` audited `.atlas/` structure completeness against a
  path table that included folders `scaffold_docs.py` never created.
- `plugins/atlas/hooks/session_boot.py` emitted a SessionStart advisory referencing paths that
  a repo scaffolded by an older `atlas-setup` run would not have.
- The two docs-ssot references (`plugins/atlas/skills/atlas-loop/references/docs-ssot.md` and
  `plugins/atlas/skills/atlas-orchestrate/references/docs-ssot.md`) had drifted from each other
  and from what `scaffold_docs.py` actually produced.

A repo scaffolded before this session would silently be missing structure that docs-curator,
docs-auditor, and session_boot all treated as a given, and there was no single definition both
docs-ssot copies and the scaffolder agreed on.

## Resolution

Made the canonical structure one definition, mirrored byte-identical across both docs-ssot
references, and scaffolded/repaired idempotently:

- Both docs-ssot references (`plugins/atlas/skills/atlas-loop/references/docs-ssot.md`,
  `plugins/atlas/skills/atlas-orchestrate/references/docs-ssot.md`, 275 lines each) now define
  the full structure identically: root README/AGENTS/CLAUDE.md; project-adaptive `docs/` tree
  (base subfolders always, `docs/api` only when an API signal is detected); the full `.atlas/`
  tree (`evidence/`, dated `findings/` + `INDEX.md`, dated `audits/`, dated `decisions/`,
  `archive/`, `understand-anything/`, `graphify/`, `self-improvement/`, `memory/`, `nudge/`,
  orientation `CLAUDE.md` + `AGENTS.md`, `.run/`); the zero-trust `.gitignore` contract; the
  learning-loop (consult `.atlas/findings/INDEX.md` before non-trivial work) and
  tooling-activation sections.
- `plugins/atlas/skills/atlas-setup/scripts/scaffold_docs.py`: `DURABLE_ENTRIES` (line 45) and
  `ATLAS_ENTRIES` (line 90) expanded to the full set; `detect_api()` (line 331, signals at
  lines 154-167) makes `docs/api` project-adaptive instead of unconditional; `ensure_gitignore()`
  (line 367) seeds `.gitignore` from the zero-trust template if absent. New
  `plugins/atlas/skills/atlas-setup/templates/` directory holds the seed content for every
  entry (root files, `docs/` subfolder READMEs, `.atlas/decisions/`, `.atlas/findings/INDEX.md`,
  `.atlas/graphify/`, `.atlas/understand-anything/`, `docs/api/`, `endpoints.md`). New
  `plugins/atlas/skills/atlas-setup/scripts/test_scaffold_docs.py` (207 lines, 13 tests) replaces
  the stale duplicate previously at `plugins/atlas/scripts/test_scaffold_docs.py` (deleted this
  session).
- Ownership split made explicit: `docs-curator` (`plugins/atlas/agents/docs-curator.md`) is the
  post-ship writer and enforcer of the structure - it recommends (or runs, if trivial)
  `atlas-setup` when structure is missing rather than inventing paths itself (line 36), and owns
  `.gitignore` hygiene (line 35) and archive discipline (line 37). `docs-auditor`
  (`plugins/atlas/agents/docs-auditor.md`, 34 lines) is read-only: it verifies `.atlas/`
  structure completeness (line 22) and `.gitignore` zero-trust drift via live `git check-ignore`
  outcomes (line 23), and never writes.
- `plugins/atlas/hooks/session_boot.py` SessionStart advisory (line 185) now checks the full
  25-path canonical set, advisory and non-blocking - it will not pass or fail a session, only
  surface a gap.
- `plugins/atlas/skills/atlas-gitignore/templates/gitignore.seed` (193 lines) allowlists the
  full `.atlas/` tree, including the un-ignore-the-parent-then-reignore-contents pattern needed
  for `.atlas/.run/` so only `.atlas/.run/findings.json` survives (lines 137-145).
  `plugins/atlas/skills/atlas-gitignore/scripts/validate_gitignore.sh` checks both structural
  pairing and live `git check-ignore` outcomes against the docs-ssot path set.
- `plugins/atlas/skills/atlas-orchestrate/references/scaffolding.md` and
  `.../session-lifecycle.md` corrected: archived run state moves to `.atlas/archive/`, not
  `docs/archive/`.

## Regression caught and fixed same session

`plugins/atlas/skills/atlas-setup/SKILL.md:73` carried a dead `references/docs-ssot.md` link
(the file lives under `atlas-orchestrate`/`atlas-loop`, not `atlas-setup`), which failed
`test_no_dangling_skill_references`. Reworded to a descriptive pointer instead of a broken
relative link; `test_skill_agent_conformance.py` restored to 13/13.

## Verification evidence

- `python3 -m pytest plugins/atlas/skills/atlas-setup/scripts/test_scaffold_docs.py -q` -> 13
  passed.
- `python3 -m pytest plugins/atlas/hooks/test_session_boot.py -q` -> 33 passed.
- `python3 -m pytest plugins/atlas/hooks/test_completion_gate.py -q` -> 53 passed.
- `python3 -m pytest plugins/atlas/scripts/test_skill_agent_conformance.py -q` -> 13 passed.
- Live scratch-dir proof: ran `scaffold_docs.py` against an empty temp directory. Output ended
  "OK: full docs/ + .atlas/ + root canonical structure is in place" with 9/9 `docs/` entries and
  11/11 `.atlas/` entries seeded, plus root files and a seeded `.gitignore`.
- `git init` in that scratch dir, then `git check-ignore -q`: `docs/CHANGELOG.md` and
  `.atlas/findings/INDEX.md` NOT ignored (rc=1, tracked); `.atlas/.run/STATE.md` IS ignored
  (rc=0); `.atlas/.run/findings.json` NOT ignored (rc=1, tracked) - the zero-trust contract
  behaves exactly as the docs-ssot `.gitignore` section describes.
- Independent verifier evidence for the same claims, plus an idempotent second scaffold run
  (zero `seeded:` lines, all `keep existing:`) and API adaptivity confirmation, is recorded at
  `.atlas/evidence/2026-07-17-atlas-canonical-structure/verification.md`.
- This repo's own root `.gitignore` had drifted from the contract above (only
  `.atlas/evidence/` and `.atlas/audits/` were allowlisted, `.gitignore:237-241` before this
  finding) - `.atlas/findings/`, `.atlas/decisions/`, `.atlas/archive/`,
  `.atlas/understand-anything/`, `.atlas/graphify/`, `.atlas/self-improvement/`,
  `.atlas/memory/`, `.atlas/nudge/`, `.atlas/CLAUDE.md`, and `.atlas/AGENTS.md` were silently
  gitignored. Fixed in the same change (`.gitignore:237-259`); confirmed with
  `git check-ignore -q .atlas/findings/INDEX.md` returning rc=1 (not ignored) after the fix
  where it returned rc=0 (ignored) before.
- Pre-existing, unrelated: `bash
  plugins/atlas/skills/atlas-gitignore/scripts/validate_gitignore.sh .gitignore` still FAILs
  on em dashes in ~20 pre-existing `.gitignore` comment lines, unrelated to this change. Not
  fixed here; tracked as a new `docs/ROADMAP.md` backlog item.

## Key file:line touchpoints (for future sessions)

- `plugins/atlas/skills/atlas-loop/references/docs-ssot.md` and
  `plugins/atlas/skills/atlas-orchestrate/references/docs-ssot.md` must stay byte-identical.
  If one changes, mirror the change into the other in the same commit.
- `plugins/atlas/skills/atlas-setup/scripts/scaffold_docs.py:45` (`DURABLE_ENTRIES`) and `:90`
  (`ATLAS_ENTRIES`) are the single source of truth for what gets scaffolded; keep them in sync
  with the docs-ssot path tables.
- `plugins/atlas/agents/docs-curator.md:36` is where "recommend atlas-setup, do not invent
  structure" is enforced - do not weaken this into silent directory creation.
- `plugins/atlas/skills/atlas-gitignore/templates/gitignore.seed:137-145` is the
  `.atlas/.run/` un-ignore-parent / reignore-contents / re-allow-findings.json pattern; changing
  the ordering of these three lines breaks the zero-trust contract silently (git will not
  traverse into an ignored parent).

## Do not regress

- Do not let `scaffold_docs.py`'s entry lists drift from either docs-ssot reference again.
- Do not let the two docs-ssot references diverge; they must mirror byte-identical.
- Do not let `docs-curator` or any other writer silently create missing canonical-structure
  paths; the correct response to a gap is to flag it and recommend/run `atlas-setup`.
