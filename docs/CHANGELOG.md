# Changelog

Newest entry on top. Dates are ISO 8601 (YYYY-MM-DD).

---

## 2026-07-22 -- Kimi marketplace installation fixed: all 3 plugins now installable

Fixed Kimi marketplace installation by adding missing `.kimi-plugin/plugin.json` manifests for armada and programmer plugins, and adding repo root `kimi.plugin.json` and `.kimi-plugin/marketplace.json` with GitHub source URLs.

- Added `plugins/armada/.kimi-plugin/plugin.json` (v1.0.0) - Armada org deployment plugin manifest
- Added `plugins/programmer/.kimi-plugin/plugin.json` (v0.1.0) - Programmer plugin manifest  
- Added root `kimi.plugin.json` (v2) listing all 3 plugins with local paths: `./plugins/atlas`, `./plugins/armada`, `./plugins/programmer`
- Added `.kimi-plugin/marketplace.json` with GitHub URLs for all 3 plugins: `https://github.com/w159/atlas/tree/main/plugins/atlas`, `https://github.com/w159/atlas/tree/main/plugins/armada`, `https://github.com/w159/atlas/tree/main/plugins/programmer`
- Root `marketplace.json` also updated with GitHub URLs (was using local paths)
- All 3 plugins (atlas v5.1.1, armada v1.0.0, programmer v0.1.0) now installable via Kimi marketplace

Evidence: `kimi.plugin.json:1-8`, `.kimi-plugin/marketplace.json:1-8`, `marketplace.json:1-8`, `plugins/armada/.kimi-plugin/plugin.json:1-11`, `plugins/programmer/.kimi-plugin/plugin.json:1-11`

---

## 2026-07-21 -- README updated with accurate inventory and marketplace 3.1.0

Documentation sync: README.md updated to reflect real skill and plugin counts, marketplace version bump, and structural additions.

- Corrected skill count: 22 → 20 (README.md:16, 37, 164). Two skills were consolidated or removed in the v5.1.1 plugin release but README had not been synced.
- Bumped marketplace catalog version: 3.0.0 → 3.1.0 (README.md:19-20, 27, 382).
- Corrected plugin manifest file path reference: `plugins/atlas/.claude-plugin/plugin.json:3` → `:2` (README.md:19).
- Added marketplace catalog path reference: `.claude-plugin/marketplace.json:5` (README.md:20).
- Added "Other plugins in this marketplace" section (README.md:300-321) documenting the three plugins now shipped in the unified catalog:
  - `atlas` (v5.1.1) - core agent and skill framework
  - `armada` (v1.0.0) - organizational deployment (11 departments, 156 skills)
  - `programmer` (v0.1.0) - Pragmatic Programmer auditor with 2 skills and 89-concept glossary
- Updated quickstart instructions to name all three plugins in the marketplace listing (README.md:76-84).
- Added "Prerequisites and configuration" clarification that `programmer` is optional and independent (README.md:424-426).
- Fixed repository layout tree: added `programmer/` to plugin section (README.md:396).
- Fixed malformed closing `</div>` tag (README.md:473).

---

## 2026-07-21 -- Added `programmer` plugin (Pragmatic Programmer auditor) to the marketplace

Moved the standalone `pragmatic-programmer` plugin into the `atlas` marketplace as a new plugin named `programmer`, with skills namespaced `tpp-*`.

- New plugin at `plugins/programmer/`: 2 skills (`tpp-audit`, `tpp-principles`, renamed from `pragmatic-audit`/`pragmatic-principles`), 1 agent (`tpp-auditor`, renamed from `pragmatic-auditor`), 1 UserPromptSubmit hook, and an 89-concept glossary under `skills/tpp-principles/references/concepts/`.
- Renamed internal cross-references throughout `agents/tpp-auditor.md`, `skills/tpp-audit/SKILL.md`, `skills/tpp-audit/references/dimensions.md`, `README.md`, and `LICENSE` to match the new `tpp-*` naming.
- Registered `programmer` in `.claude-plugin/marketplace.json`: version `3.0.0` → `3.1.0`, plugin added with `source: ./plugins/programmer`, `category: developer-tools`.
- Verified by two independent `atlas:verifier` passes: first pass REFUTED on a stale `LICENSE:3` path reference (`skills/pragmatic-principles/references/concepts/` → `skills/tpp-principles/references/concepts/`); fixed and re-verified CONFIRMED on all 9 checks. Full evidence: `.atlas/evidence/2026-07-21-programmer-plugin-move.md`.

---

## 2026-07-21 -- Removed atlas-m365 and atlas-vendor-assessment skills

Deleted two unused auto-trigger skills from the atlas plugin: `plugins/atlas/skills/atlas-m365/` and `plugins/atlas/skills/atlas-vendor-assessment/`, including their SKILL.md and references. Neither had callers; `atlas-m365` overlapped with armada's own M365 coverage, `atlas-vendor-assessment` was a niche security-evaluation skill.

- Atlas plugin skill count: 22 → 20 (16 → 14 task skills). Verified via `plugins/atlas/skills/atlas-setup/scripts/plugin-health.py plugins/atlas` → `skills: actual=20, PASS`.
- Updated: `plugins/atlas/README.md`, `plugins/atlas/.claude-plugin/plugin.json` (description), `plugins/atlas/skills/atlas/SKILL.md`, `plugins/atlas/skills/atlas-setup/SKILL.md`, `plugins/atlas/skills/atlas-setup/references/manual-vs-auto-map.md`, `plugins/atlas/skills/atlas-setup/references/skill-routing.md`, `plugins/atlas/skills/atlas-setup/templates/reference_files/README.md`, root `README.md`.
- Full record: `.atlas/findings/2026-07-21-remove-m365-vendor-assessment.md`.

---

## 2026-07-17 -- Residual Dependabot alerts cleared, mcp_servers/_shared restored, commit adace06

Follow-up to the 711fb10 remediation below. Closes both defects that entry tracked as out
of scope, plus the minimatch ReDoS residual, via a simpler path than originally planned.

- Restored `mcp_servers/_shared/` (deleted by `56d1a9f`, 9 files: `error-envelope.ts`,
  `response-shaper.ts`, `base-url.ts`, `annotate-tool.ts`, `pack-mcpb.js`, `package.json`,
  `tsconfig.json`, `ADOPTION.md`, `__tests__/response-quality.test.ts`). The `@shared/*`
  imports in `mcp_servers/threatlocker-mcp/src/domains/_helpers.ts:15,21,26` (same pattern
  in `blumira-mcp` and `vanta-mcp`) now resolve; `npm run build` verified passing in each of
  the three previously-broken servers. Resolves ROADMAP item "Bug: blumira-mcp,
  threatlocker-mcp, vanta-mcp fail to build."
- Added npm `overrides` across all 17 `mcp_servers/*` and `mcp_node/*` projects:
  - `esbuild ^0.28.1` - clears the dev-only esbuild low left over from 711fb10, repo-wide
    (e.g. `mcp_servers/blumira-mcp/package.json`, `mcp_node/node-blumira/package.json`).
  - `minimatch ^3.1.2` (resolves to 3.1.5) - clears the ReDoS high in
    `connectwise-manage-mcp`, `knowbe4-mcp`, `ninjaone-mcp`, and `cipp-mcp` without the
    eslint-9 / `@typescript-eslint` 8 migration the 711fb10 entry and ROADMAP originally
    called for (`mcp_servers/connectwise-manage-mcp/package.json`,
    `mcp_servers/cipp-mcp/package.json`). Resolves ROADMAP item "Tech debt: eslint 9 /
    @typescript-eslint 8 migration to clear minimatch ReDoS residual" by pinning the
    transitive instead of the major-version migration.
  - `tmp ^0.2.4` - clears the `cipp-mcp` / `blumira-mcp` `tmp` advisory pulled in via
    `@anthropic-ai/mcpb` (`mcp_servers/cipp-mcp/package.json`,
    `mcp_servers/blumira-mcp/package.json`).
- Result: every one of the 17 projects now reports `npm audit` = 0 vulnerabilities. No
  source edits beyond the `_shared` restore; `node_modules` symlink convention preserved.
- Not fixed here, remains open in ROADMAP: the vitest 4 / `node_modules.nosync.noindex`
  symlink test-glob issue (unrelated to dependency pins or the `_shared` restore).

---

## 2026-07-17 -- Dependency remediation: 17 Node MCP projects (Dependabot), commit 711fb10

Remediated GitHub Dependabot alerts across 10 `mcp_servers/*` and 7 `mcp_node/*`
Node projects. Baseline before this commit: 344 open alerts (16 critical, 82 high,
199 medium, 47 low). Two changes only, `package.json` + `package-lock.json` per
project; no source files touched (`git show --stat 711fb10`, 32 files changed,
27872 insertions(+), 86960 deletions(-)):

- Removed unused `semantic-release` + `@semantic-release/*` dev tooling from every
  project that carried it. No `.github/workflows` in this repo invokes it; its
  bundled npm dragged in vulnerable `sigstore`, `tar`, `handlebars`, and
  `minimatch` transitively.
- Bumped `vitest` from 1.x/2.x to `4.1.10` in projects with real tests (clears the
  critical vitest advisory plus the vulnerable `vite`/`esbuild` chain it pulled
  in); dropped `vitest` entirely from projects with no tests.
- Runtime dependencies re-resolved in-range via clean lockfile regeneration.

Result: per-project `npm audit` after the change drops to 1 low (residual
dev-only `esbuild` advisory `GHSA-g7r4-m6w7-qqqr`) for most projects. Verified
residual exceptions, confirmed by `npm audit` on 2026-07-17:
- `connectwise-manage-mcp`, `knowbe4-mcp`, `ninjaone-mcp`: 6 high each, a
  `minimatch` ReDoS chain via `@typescript-eslint/eslint-plugin` `^6`
  (`@typescript-eslint/utils` 6.16.0-7.5.0) - needs an eslint 9 /
  `@typescript-eslint` 8 major migration to clear (tracked in ROADMAP).
- `cipp-mcp`: 11 vulnerabilities (4 low, 7 high) via `@inquirer/prompts` <=6.0.1
  pulled in by `@anthropic-ai/mcpb`.
- `blumira-mcp`: 6 vulnerabilities (5 low, 1 high), same `@anthropic-ai/mcpb`
  chain.

Two pre-existing defects were found during verification and are explicitly out
of scope for this remediation (not fixed here, tracked in ROADMAP):
1. `mcp_servers/_shared/` was deleted in commit `56d1a9f` and never restored.
   `blumira-mcp`, `threatlocker-mcp`, and `vanta-mcp` still import `@shared/*`
   (e.g. `mcp_servers/threatlocker-mcp/src/domains/_helpers.ts:15,21,26`) with no
   local fallback, so `npm run build` fails for all three (reproduced:
   `cd mcp_servers/threatlocker-mcp && npm run build` -> esbuild "Could not
   resolve ... mcp_servers/_shared/response-shaper.js" and 2 more, 3 errors).
2. `vitest` 4's default file glob follows the `node_modules ->
   node_modules.nosync.noindex` symlink convention used in this repo and picks
   up test files belonging to vendored packages inside it. Reproduced:
   `cd mcp_servers/threatlocker-mcp && npm test -- --run` -> 15 of 184 test files
   fail, all under `node_modules.nosync.noindex/zod/...` and
   `node_modules.nosync.noindex/node-threatlocker/...`
   (`mcp_servers/threatlocker-mcp/vitest.config.ts` has no `exclude` override).

---

## 2026-07-17 -- Full audit remediation and marketplace truth pass (v5.1.1)

Follow-up to the entry below: the remaining defects in
`atlas-audit-2026-07-17.md` were reproduced, fixed, and verified
(972 passed, 0 failed). Root `SKILL.md` moved to `skills/atlas/`
(the root file never loaded; /atlas now works), skill factory output
redirected to `~/.claude/skills/`, trigger flags reconciled
(22 skills: 2 manual, 20 auto), CLI exit codes hardened, prompt-optimizer
timeout wired, and every stale count/version/path in README.md,
plugins/README.md, plugin manifests, and atlas-setup references corrected.
Audit-review verdicts recorded in `atlas-audit-2026-07-17-review.md`.
Detail: `plugins/atlas/CHANGELOG.md` 5.1.1.

---

## 2026-07-17 -- Security/correctness remediation from atlas-audit CODE 2026-07-17

Findings from `docs/audits/atlas-audit-2026-07-17/report.md` (baseline: 967 tests passing).
Verified: `python3 -m pytest plugins/atlas/ -q` -> 973 passed, 8 subtests passed.

**Hook contract fix (H1-H4):** `additionalContext` was emitted as a bare top-level JSON key,
which Claude Code drops silently; report H1 traced this to
`test_session_boot.py` asserting on `data["additionalContext"]` at top level instead of the
real contract shape (report.md:40). Now nested under `hookSpecificOutput` with the firing
`hookEventName`, restoring the SessionStart injection path:
- `plugins/atlas/hooks/session_boot.py:419-421` (`hookEventName: "SessionStart"`)
- `plugins/atlas/hooks/auto_skill.py:86`
- `plugins/atlas/hooks/memory_capture.py:291`
- `plugins/atlas/hooks/nudge.py:137`
- `plugins/atlas/hooks/test_session_boot.py` (19 assertions across the file rewritten to read
  `data["hookSpecificOutput"]["additionalContext"]` / `["hookEventName"]`, e.g. line 92, 115)

**atlas_memory.py data-loss and injection fixes (H5-H6):**
- `_read_file` (`plugins/atlas/scripts/atlas_memory.py:99`) no longer swallows a read error
  and then overwrites the file on the next write.
- `add()` (`atlas_memory.py:189`) now runs entries through `_sanitize_entry`
  (`atlas_memory.py:121`, called at `atlas_memory.py:191` and in `apply_batch` at
  `atlas_memory.py:325,330`) to collapse newlines and strip control chars, closing a
  stored-prompt-injection path into `~/.atlas/memory/MEMORY.md` that SessionStart re-injects.
- Regression tests added in `plugins/atlas/scripts/test_atlas_memory.py` (67 insertions).

**Other CODE-audit fixes, each with a regression test in the suite above:**
- `atlas_context_optimizer.py` `disable_skill` (`plugins/atlas/scripts/atlas_context_optimizer.py:260`):
  fixed frontmatter corruption where the closing `---` was glued onto the last field,
  producing invalid YAML.
- `skill_factory.py` `_build_skill_md` (`plugins/atlas/scripts/skill_factory.py:76`): the
  `description` field is now escaped via `json.dumps` (comment at line 72) so an embedded
  quote cannot break the generated `SKILL.md` frontmatter.
- `atlas_curator.py` `_skill_activity_time` (`plugins/atlas/scripts/atlas_curator.py:103`):
  now skips the curator's own `.stale`/`.pinned` marker files
  (`CURATOR_MARKER_FILES` at `atlas_curator.py:39`), fixing an infinite
  mark-stale/reactivate oscillation that had prevented the 90-day archive path from ever
  firing.
- `prompt_optimizer.py`: env ints/floats now parsed defensively via `_env_num`
  (`plugins/atlas/hooks/prompt_optimizer.py:80-84`) so a non-numeric env value falls back to
  the default instead of crashing the never-block hook; the CSI regex
  (`prompt_optimizer.py:68`) was broadened from `[0-9]*` to `[0-9;]*` so multi-param ANSI
  color codes (e.g. `38;5;108m`) are matched and stripped instead of leaking into cleaned
  text, with a matching `try`/`except` guard at `prompt_optimizer.py:103-106`.

**Build break fix:** commit `56d1a9f` deleted the top-level `mcp_servers/_shared/`
(`error-envelope.ts`, `response-shaper.ts`, `base-url.ts`, etc.), leaving `auvik-mcp`'s
imports at `mcp_servers/auvik-mcp/src/tools/shared.ts:12,17` and
`mcp_servers/auvik-mcp/src/tools/status.ts:5` dangling. Restored a per-server
`mcp_servers/auvik-mcp/src/_shared/` (`base-url.ts`, `response-shaper.ts`,
`error-envelope.ts`) and repointed the imports from `../../../_shared/...` to
`../_shared/...`, matching the per-server pattern already in use by
`connectwise-manage-mcp/src/_shared/` and `cipp-mcp/src/_shared/`.

## 2026-07-17 -- atlas canonical project structure: full scaffold/repair + enforcement across all surfaces

`atlas-setup` previously only seeded a handful of `docs/` and `.atlas/` subfolders and left
new/refreshed root files, `docs/api`, and several `.atlas/` subfolders (`decisions/`,
`understand-anything/`, `graphify/`, orientation `.atlas/CLAUDE.md`/`.atlas/AGENTS.md`) out of
scope, so repos scaffolded by an older run silently missed structure the rest of the fleet
(docs-curator, docs-auditor, session_boot advisory, atlas-gitignore) already assumed existed.
This change makes the canonical structure one definition, scaffolded/repaired idempotently, and
enforced consistently everywhere it is read.

- Canonical structure definition expanded and mirrored byte-identical in both docs-ssot
  references: root README/AGENTS/CLAUDE.md; project-adaptive `docs/` tree (base subfolders
  plus `docs/api` only when an API signal is detected); full `.atlas/` tree including dated
  `.atlas/findings/`, `.atlas/audits/`, `.atlas/decisions/`, `.atlas/archive/`,
  `.atlas/understand-anything/`, `.atlas/graphify/`, and orientation `.atlas/CLAUDE.md` +
  `.atlas/AGENTS.md`; the zero-trust `.gitignore` contract; learning-loop and
  tooling-activation sections.
  (`plugins/atlas/skills/atlas-loop/references/docs-ssot.md` (275 lines),
  `plugins/atlas/skills/atlas-orchestrate/references/docs-ssot.md` (275 lines, byte-identical
  mirror))
- `scaffold_docs.py` scaffolds and repairs the full tree idempotently: `DURABLE_ENTRIES`
  (`plugins/atlas/skills/atlas-setup/scripts/scaffold_docs.py:45`), `ATLAS_ENTRIES`
  (`scaffold_docs.py:90`), project-adaptive API detection via `detect_api()`
  (`scaffold_docs.py:331`, signals at `scaffold_docs.py:154-167`), and `.gitignore` seeding via
  `ensure_gitignore()` (`scaffold_docs.py:367`). New `templates/` dir at
  `plugins/atlas/skills/atlas-setup/templates/` (root README/AGENTS/CLAUDE.md, `docs/`,
  `.atlas/decisions/`, `.atlas/findings/`, `.atlas/graphify/`,
  `.atlas/understand-anything/`, `docs/api/`, `endpoints.md`). New
  `plugins/atlas/skills/atlas-setup/scripts/test_scaffold_docs.py` (207 lines, 13 tests, all
  passing); superseded the stale duplicate at `plugins/atlas/scripts/test_scaffold_docs.py`
  (deleted).
- `atlas-setup` `SKILL.md` (264 lines), `references/install.md` (154 lines), and
  `references/recommendation-engine.md` (154 lines) rewritten for full-structure onboarding,
  always-repair routing, structural-completeness recommendation, and tech-stack tooling
  activation (claude-mem, context-mode, ponytail, gate hooks) recorded to `.atlas/decisions/`.
- `docs-curator` agent now owns and enforces the structure: `.gitignore` hygiene
  (`plugins/atlas/agents/docs-curator.md:35`), structure-completeness check that recommends
  `atlas-setup` rather than silently inventing missing paths (`docs-curator.md:36`), archive
  discipline into `.atlas/archive/` (`docs-curator.md:37`), knowledge-graph refresh
  (`docs-curator.md:38`). `docs-auditor` agent (34 lines) is read-only and audits the full
  `.atlas/` structure completeness (`plugins/atlas/agents/docs-auditor.md:22`) and
  `.gitignore` zero-trust drift via `git check-ignore` outcomes (`docs-auditor.md:23`).
- `session_boot.py` SessionStart advisory now checks the full 25-path canonical set, advisory
  and non-blocking (`plugins/atlas/hooks/session_boot.py:185`).
- `atlas-gitignore` zero-trust seed allowlists the full `.atlas/` tree, including the
  un-ignore-parent-then-reignore-contents pattern for `.atlas/.run/` so only
  `.atlas/.run/findings.json` survives
  (`plugins/atlas/skills/atlas-gitignore/templates/gitignore.seed:107-145`); the validator
  checks structural pairing plus live `git check-ignore` outcomes against the docs-ssot path
  set (`plugins/atlas/skills/atlas-gitignore/scripts/validate_gitignore.sh:1-44`);
  `plugins/atlas/skills/atlas-gitignore/SKILL.md` (58 lines) updated to match.
- `atlas-orchestrate` references corrected to the `.atlas/` split layout: archive moves to
  `.atlas/archive/`, not `docs/archive/`
  (`plugins/atlas/skills/atlas-orchestrate/references/scaffolding.md:31-57`,
  `plugins/atlas/skills/atlas-orchestrate/references/session-lifecycle.md:22,68-90`).
- Root `AGENTS.md` Section 0 (`AGENTS.md:5-36`) states atlas/armada are products developed in
  this repo, not tools to run here; `plugins/README.md:3-6` points to it; new
  `docs/plugin-development-scope.md` (148 lines) records the scope rule in `docs/`.
- Regression fixed same-day: `plugins/atlas/skills/atlas-setup/SKILL.md:73` carried a dead
  `references/docs-ssot.md` link that failed `test_no_dangling_skill_references`; reworded to
  a descriptive pointer, restoring `test_skill_agent_conformance.py` to 13/13.

- This repo's own root `.gitignore` had drifted from the expanded contract above: it
  allowlisted only `.atlas/evidence/` and `.atlas/audits/` (`.gitignore:237-241` before this
  fix), so `.atlas/findings/`, `.atlas/decisions/`, `.atlas/archive/`,
  `.atlas/understand-anything/`, `.atlas/graphify/`, `.atlas/self-improvement/`,
  `.atlas/memory/`, `.atlas/nudge/`, `.atlas/CLAUDE.md`, and `.atlas/AGENTS.md` were all
  silently gitignored - `git check-ignore -q .atlas/findings/INDEX.md` returned rc=0
  (ignored) before the fix. Added the missing `!.atlas/<subfolder>/` + `!.atlas/<subfolder>/**`
  allowlist pairs (`.gitignore:237-259`, docs-curator `.gitignore` hygiene duty at
  `plugins/atlas/agents/docs-curator.md:35`). After the fix, `git check-ignore -q` on
  `.atlas/findings/INDEX.md` returns rc=1 (not ignored, tracked).

Verified: `python3 -m pytest plugins/atlas/skills/atlas-setup/scripts/test_scaffold_docs.py -q`
-> 13 passed; `python3 -m pytest plugins/atlas/hooks/test_session_boot.py -q` -> 33 passed;
`python3 -m pytest plugins/atlas/hooks/test_completion_gate.py -q` -> 53 passed;
`python3 -m pytest plugins/atlas/scripts/test_skill_agent_conformance.py -q` -> 13 passed.
Live proof in a scratch temp dir: `scaffold_docs.py <tmpdir>` produced "OK: full docs/ +
.atlas/ + root canonical structure is in place" (9/9 `docs/` entries, 11/11 `.atlas/` entries,
root files, seeded `.gitignore`); `git check-ignore -q` on the resulting repo confirmed
`docs/CHANGELOG.md` and `.atlas/findings/INDEX.md` are NOT ignored (rc=1),
`.atlas/.run/STATE.md` IS ignored (rc=0), and `.atlas/.run/findings.json` is NOT ignored
(rc=1, i.e. tracked) - the zero-trust contract behaves exactly as documented. The root
`.gitignore` fix above was confirmed the same way against the real repo (not the scratch
dir). Note: `bash plugins/atlas/skills/atlas-gitignore/scripts/validate_gitignore.sh
.gitignore` still FAILs on pre-existing, session-unrelated em dashes in `.gitignore` comment
prose - tracked as a new ROADMAP backlog item, not fixed here (out of scope for this
change). Independent verifier evidence for this change, including the same scratch-dir
proof and an idempotency re-run (second pass: zero `seeded:` lines, all `keep existing:`),
is recorded at `.atlas/evidence/2026-07-17-atlas-canonical-structure/verification.md`. One
pre-existing, unrelated test failure noted there
(`test_skill_factory.py::test_cli_auto`, KeyError on `created` with no DB) is out of scope:
`skill_factory.py` was not touched this session.

## 2026-07-16 -- atlas plugin 5.1.0: connector wiring repaired, path conventions unified

Full details and per-fix evidence: `plugins/atlas/CHANGELOG.md` (5.1.0 entry)
and `.atlas/evidence/2026-07-16-atlas-5.1.0-wiring-repair.md`.

- `plugins/atlas/.mcp.json` moved from `.claude-plugin/` to the plugin root so
  the manifest's `mcpServers: "./.mcp.json"` actually resolves; all 10
  connector servers were silently unregistered before this.
- Agent evidence writes (`ui-runtime-tester`, `db-prober`) redirected from
  `docs/evidence/` to `.atlas/evidence/` to match the completion gate.
- Operating-contract fallback in 14 skills anchored at
  `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md`.
- Deleted git-tracked legacy run markers `plugins/atlas/docs/.run/*.active`
  (pre-5.0 layout; made the completion gate grade the wrong root).
- Em dash sweep (18 lines), rename residue in atlas-launch/atlas-audit,
  absolute-path and unanchored-path fixes in atlas-wiki/atlas-db-audit,
  plugin CHANGELOG 5.1.0 entry added to match the manifest version.
- Verified: `python3 -m pytest hooks scripts -q` -> 960 passed; independent
  atlas:verifier pass recorded in `.atlas/.run/findings.json`.

## 2026-07-15 -- SSOT correction: atlas-internal content moved from docs/ to .atlas/

The previous `.atlas/docs/` → `docs/` refactor (2026-07-14) moved paths but left
atlas-internal content in `docs/` — the exact dual-SSOT problem it was supposed
to solve. This correction moves all atlas-internal content to `.atlas/` and
restores the correct split: `docs/` is the project wiki (CHANGELOG, ROADMAP,
dynamic subfolders including graphify results); `.atlas/` is atlas's auditable
self-improvement surface (evidence, audits, plans, specs, architecture, lessons,
wiki, nudge, self-improvement, memory, .run state).

- Moved `docs/audits/` → `.atlas/audits/` (2 audit trees, 29 files).
- Moved `docs/evidence/` → `.atlas/evidence/` (6 files, merged with existing 9).
- Moved `docs/lessons/` → `.atlas/lessons/` (1 file).
- Moved `docs/plans/` → `.atlas/plans/` (11 files).
- Moved `docs/specs/` → `.atlas/specs/` (1 file).
- Moved `docs/architecture/` → `.atlas/architecture/` (1 file).
- Moved `docs/superpowers/` → `.atlas/plans/` + `.atlas/specs/` (4 files).
- Deleted `docs/.run/` (stale, untracked; `.atlas/.run/` is the live location).
- Deleted `docs/self-improvement/` (empty).
- `docs/` now holds only: CHANGELOG.md, ROADMAP.md, AGENTS.md, README.md,
  standards/ (18 files). Vendored upstream clones (aider/, claude-code/, cline/,
  etc.) remain in docs/ pending a separate cleanup decision.
- Updated `scaffold_docs.py`: `ATLAS_ENTRIES` expanded from 3 to 11 subdirs
  (evidence, audits, plans, specs, architecture, lessons, wiki, nudge,
  self-improvement, memory, .run). `DURABLE_ENTRIES` remains minimal
  (CHANGELOG.md, ROADMAP.md) — the wiki grows dynamically.
- Rewrote `docs-ssot.md` (atlas-orchestrate + atlas-loop): new contract with
  correct split. docs/ = project wiki (dynamic); .atlas/ = self-improvement
  surface (auditable tracking, skill generation/disabling, subagent management).
- Updated `atlas-launch` SKILL.md + references: `docs/audits/` → `.atlas/audits/`.
- Updated `atlas-orchestrate` SKILL.md: `docs/plans/` → `.atlas/plans/`.
- Fixed 14 stale `.atlas/docs/` references in `.atlas/architecture/skills-mastery.md`
  and `.atlas/plans/skills-mastery-rebuild.md`.
- Added 4 new tests in `test_scaffold_docs.py`:
  `test_legacy_atlas_docs_with_only_run_marker_proceeds` (Bug 1 regression),
  `test_legacy_atlas_docs_empty_dir_proceeds`, `test_scaffold_creates_minimal_docs_and_full_atlas`,
  `test_no_atlas_internal_dirs_in_docs`.

## 2026-07-14 -- fix: flaky `test_orchestration_with_no_capture_nudges_to_capture` (test isolation)

- What changed: `plugins/atlas/hooks/test_nudge.py:115-124` now mocks
  `nudge._check_memory_captured` and `nudge._check_skill_created` to `False`
  around its `_run_main` call, matching the pattern already used in the three
  sibling tests below it in the same file.
- Why: the two `nudge.py` functions (`nudge.py:46-57`, `:60-75`) read real
  global state under `~/.atlas/memory/MEMORY.md` and `~/.atlas/skills/*/SKILL.md`.
  Any process touching either within 60 seconds (e.g. `auto_skill.py`'s
  skill-factory) flipped this test's "nudge to capture" assertions to fail.
  `nudge.py` itself was not modified -- test-only fix.
- Evidence: `.atlas/evidence/nudge-test-isolation-fix.md`. `pytest
  plugins/atlas/hooks/test_nudge.py -v` -> 29 passed; `pytest
  plugins/atlas/hooks/ -q` -> 428 passed, 8 subtests passed. Independent
  `atlas:verifier` reproduced the original failure via `git stash` against a
  faked `~/.atlas/skills/__verify_tmp_skill__/SKILL.md`, then confirmed the
  fix eliminates it. Verdict: verified (`.atlas/.run/findings.json`, batch
  `nudge-test-isolation-fix`).

## 2026-07-14 -- docs consolidation: `.atlas/docs/` retired, `docs/` is the sole project-documentation SSOT

`.atlas/docs/` and `docs/` had drifted into two independent, partially-overlapping copies
of CHANGELOG.md, ROADMAP.md, AGENTS.md, and the durable subfolders (architecture/, plans/,
specs/, features/, wiki/, reference_files/, lessons/) -- exactly the duplication this entry
closes. Per explicit instruction: `.atlas/` never contains a `docs/` subdirectory again;
project documentation, wiki, ROADMAP.md, and CHANGELOG.md live solely under `docs/` and its
subdirectories; `.atlas/` is reserved for atlas's own self-improvement, evidence, findings,
`.run/` state, audits, and coding-agent-relevant details.

- Moved: `.atlas/docs/architecture/skills-mastery.md` -> `docs/architecture/skills-mastery.md`;
  `.atlas/docs/plans/skills-mastery-rebuild.md` -> `docs/plans/skills-mastery-rebuild.md`.
- Relocated (atlas-internal, not project docs): `.atlas/docs/evidence/` -> `.atlas/evidence/`;
  `.atlas/docs/.run/` -> `.atlas/.run/`; `.atlas/docs/audits/` -> `.atlas/audits/`.
- Unique entries from `.atlas/docs/CHANGELOG.md` (2026-07-13, 2026-07-14) and
  `.atlas/docs/ROADMAP.md` (zero-defect-loop Z1-Z9, live item L1) merged below/into
  `docs/ROADMAP.md`; unique orientation sections (Stack, Architecture, Conventions, Commands)
  from `.atlas/docs/AGENTS.md` merged into `docs/AGENTS.md`.
- `.atlas/docs/` deleted entirely (was: AGENTS.md, CHANGELOG.md, ROADMAP.md, and 7
  boilerplate-only `README.md` placeholders under architecture/, audits/, features/, lessons/,
  plans/, reference_files/, specs/, wiki/ -- content-free, not migrated).
- Every `.atlas/docs/*` path reference across `plugins/atlas/skills/**` (SKILL.md files,
  `references/*.md`, `templates/*`) and `plugins/armada/skills/armada/references/org-config-schema.md`
  rewritten: durable/project paths now read `docs/*`; atlas-internal paths now read
  `.atlas/evidence/`, `.atlas/audits/`, `.atlas/.run/`.
- Evidence: `find .atlas -type d -name docs` -> empty (no `.atlas/**/docs/` directory exists);
  `grep -rl '\.atlas/docs' plugins .atlas docs README.md .gitignore` -> no matches outside
  historical CHANGELOG prose (append-only logs are not rewritten).
- Verdict: done -- directory structure and every live skill/reference path updated; independent
  verification pending a fresh `atlas:verifier` pass (see ROADMAP.md).

## 2026-07-14 -- atlas-orchestrate -- README.md self-contradiction fix: version-counter split and duplicate-SSOT claim clarified

- What changed: root README.md:26-32 added a clarifying paragraph after the marketplace/plugin
  version mentions, stating the marketplace wrapper version (`3.0.0`,
  `.claude-plugin/marketplace.json:3`) and the plugin version (`5.0.0`,
  `plugins/atlas/.claude-plugin/plugin.json:3`) are two independent counters bumped together
  in commit `ad7313c`, not a stale reference. This entry's own claim of a `.atlas/docs/` vs
  `docs/` split is superseded by the 2026-07-14 consolidation entry above: the two directories
  are no longer independent SSOTs, `docs/` is now the only one.
- Evidence: `cat .claude-plugin/marketplace.json` -> `"version": "3.0.0"`; `cat
  plugins/atlas/.claude-plugin/plugin.json` -> `"version": "5.0.0"`; `git log --oneline -1
  -S'"version": "3.0.0"' -- .claude-plugin/marketplace.json` -> `ad7313c` (same commit as the
  plugin's 5.0.0 bump, confirming two counters moved together, not drift).
- Verdict: done -- docs-only prose change, no source code touched.

## 2026-07-14 -- atlas:docs-curator -- README.md fleet section rewritten with detailed skills/agents/hooks/architecture tables

- What changed: root README.md:238-380 replaced the old thin skills-table/agent-list/hooks-prose
  under "## The atlas fleet" with four detailed tables sourced from an atlas:explorer inventory
  pass: 21 skills (Skill/Path/Description/When-to-Use), 12 agents
  (Agent/Role/Model/Color/Tool-Restrictions), hooks (Event/Handlers/Purpose/Evidence). Added a
  new "## Architecture & design principles" section: single-source-of-truth list, 5 key design
  laws, testing/quality-gate table, stack/commands table.
- Evidence: `grep -c "&amp;" README.md` -> `0` (no stray HTML-entity artifacts from the source
  inventory); `wc -l README.md` -> 428 lines (was 345 before the edit).
- Verdict: done -- docs-only/prose change, no source code touched.

## 2026-07-13 -- atlas:docs-curator -- zero-defect hardening complete: all batches verified, coverage 17%->98% hooks / 63%->99% scripts

- Final state (fresh gates this session): hooks `Ran 365 tests in 4.012s, OK`; scripts `Ran 502
  tests in 0.659s, OK` (867 total, up from 495). Coverage: hooks TOTAL 3962 63 98%; scripts
  TOTAL 6708 40 99%. `ruff check plugins/atlas/hooks plugins/atlas/scripts` -> `All checks
  passed!`. `npx pyright plugins/atlas/hooks plugins/atlas/scripts` -> `0 errors, 0 warnings,
  0 informations`. Coverage bars MET (lines/functions/branches/statements all >=85).
- Batches verified (findings.json: 14/14 "verified"): 1, 2a, 2b, 2c, lint-zero, 3a, 3b, 4
  (folded into 4a-1/4a-2/4b-1/4b-2), 4a-1 (6 zero-coverage hooks -> 96%), 4a-2 (4 partial hooks
  -> 97-100%), 4b-1 (5 lowest scripts -> 99-100%), 4b-2 (7 mid scripts -> 99-100%),
  pyright-cleanup (pyrightconfig.json extraPaths + 18 test errors cleared), dry-rounds (K=3
  consecutive clean + bars met).
- Batch 3a (frontmatter): 10 SKILL.md files fixed (missing closing `---`) and
  `test_valid_frontmatter` added. Evidence: `.atlas/evidence/batch-3a-verification.md`.
- Batch 3b (pyright types): `plugins/atlas/scripts/test_session_ingest.py:614` int-iterable,
  `plugins/atlas/scripts/verify_install_hooks.py:41-42` ModuleSpec|None,
  `plugins/atlas/scripts/atlas_db.py:656-658` Literal['agent'] resolved; pyrightconfig
  import-resolution added. Evidence: `.atlas/evidence/batch-3b-verification.md`.
- Batch 4a/4b (coverage): 4 false-green test files fixed (test_dispatch_tripwire, test_nudge,
  test_session_boot_db, test_prompt_classifier); tests added for previously untested
  hooks/scripts. Per-batch evidence: `.atlas/evidence/batch-4a-1/4a-2/4b-1/4b-2-verification.md`.
- pyright-cleanup: pyrightconfig.json extraPaths (atlas_db/scaffold_docs/atlas_memory
  import-resolution), 18 test errors cleared. Evidence:
  `.atlas/evidence/pyright-cleanup-verification.md`.
- Law 5 (verifier on every shipping change) enforced throughout: every batch closed by a fresh
  atlas:verifier pass captured in findings.json and the evidence files above.
- LIVE ACTION ITEM (not closed): the installed marketplace plugin (5.0.0) is stale vs this
  working tree. See ROADMAP.md.
- Verdict: done -- see ROADMAP.md for the still-open live action item.

## 2026-07-12 -- README rewrite follow-up: correct the 12-plugin catalog mismatch

The README rewritten in the v5.0.0 entry above still described a 12-plugin Claude Code
catalog that no longer matches the repo. The new README (344 lines) corrects four
load-bearing facts to match the on-disk state, supersedes the v5.0.0 README claim.

- The Claude Code marketplace lists 2 plugins (`atlas`, `armada`), not 12
  (`.claude-plugin/marketplace.json:8-29`).
- The Kimi manifest ships 12 plugins but does not list `armada`: it is `atlas` plus
  11 legacy domain clusters (`.kimi-plugin/marketplace.json:4-63`).
- The `mcp_servers/` directory has 11 entries: `_shared/` plus 10 vendor folders
  (Auvik, Blumira, CIPP, ConnectWise Manage, Kaseya Spanning, KnowBe4, NinjaOne,
  Paylocity, ThreatLocker, Vanta).
- The `plugins/` directory on disk holds 2 plugin folders (`atlas`, `armada`);
  the 11 Kimi-manifest entries reference legacy plugin folders that are not in
  the active Claude Code marketplace.

Caught by an atlas:completeness-critic sweep after the v5.0.0 README rewrite.
The new README is 344 lines and is not US-ASCII: it contains 21 em-dashes
(U+2014) on lines 66, 68, 70, 74, 81, 83, 87, 88, 90, 94, 97, 99, 101, 102,
220, 223, 226, 229, 234, 331, 333 (`README.md`, verified with `rg -n '[--]'`).
This supersedes the "Manifests made honest" line at `docs/CHANGELOG.md:26` of
the v5.0.0 entry. The earlier "343 lines, US-ASCII, 0 banned chars" claim in
this entry and the matching sub-bullet at `plugins/atlas/CHANGELOG.md:44` were
wrong; follow-up still needed to replace the 21 em-dashes per `writing-style.md`
and correct the plugin changelog sub-bullet.

---

## Atlas v5.0.0 -- skill consolidation: mythology retired, 21 plain names, armada split out, runtime-evidence gate (2026-07-12)

Driven by forensics on a 4.7-hour production session export (38 subagent
dispatches, exactly 1 skill auto-invocation, zero self-improvement actions):
the mythological names never routed, the fleet was 3x its working set, and
verifiers CONFIRMED changes the running app contradicted (backend gates ran
against in-memory SQLite while the dev DB sat at migration rev 129).

- Renames: atlas-metis -> atlas-orchestrate, atlas-chronos -> atlas-loop,
  atlas-odysseus -> atlas-ux-test.
- Merges: athena + ariadne + argus -> atlas-audit (code/architecture/self
  modes); olympus + hephaestus + hermes + doctor -> atlas-setup
  (onboard/install/connectors/repair modes). atlas-nestor deleted.
- armada moved to its own plugin (`plugins/armada`, v1.0.0) with the 11
  department agents; new marketplace entry; atlas keeps 12 core agents.
- Verifier doctrine: `verified` now requires runtime parity (live UI pass or
  migration-parity check), not just green suites; atlas-orchestrate's
  definition-of-done gained the same fourth condition, and Law 2 now forces
  worktree isolation or serialization for concurrent writers.
- Manifests, README, and setup references rewritten for the honest 21-skill
  inventory (`plugins/atlas/.claude-plugin/plugin.json:3` version 5.0.0).

## Atlas v4.0.0 -- skills mastery rebuild: 184-skill fleet rebuilt and verified (2026-07-11)

Full atlas skills mastery rebuild. The 184-skill fleet (28 top-level plus
156 armada across 11 departments) was rebuilt to the Claude Code Skills
Mastery Framework standard. 23 agents. 2 manual skills
(atlas-olympus, atlas-doctor, `disable-model-invocation: true`); the other
26 top-level are auto-trigger; all 156 armada are auto-trigger behind
atlas-armada. All 11 armada departments were rebuilt and independently
verified by fresh atlas:verifier passes (CONFIRMED each). S10 content
fixes (em-dash removal, manual-vs-auto-map 184/28, plugin.json 184
count) verified. Version 3.3.0 -> 4.0.0
(`plugins/atlas/.claude-plugin/plugin.json:3` version 4.0.0).

- Mastery framework standard applied to every skill: three-layer
  progressive disclosure (L1 metadata, L2 SKILL.md under 500 lines, L3
  references/scripts/templates loaded on demand). Authoritative spec at
  `plugins/atlas/skills/atlas-olympus/references/mastery-framework.md`.
- Gate flips: 2 manual, 26 auto. Verified by grep for
  `disable-model-invocation` across `plugins/atlas/skills/*/SKILL.md`
  (returns only atlas-doctor and atlas-olympus). The manual-vs-auto map
  at `plugins/atlas/skills/atlas-olympus/references/manual-vs-auto-map.md`
  lists 28 top-level (2 manual, 26 auto) and all 156 armada.
- atlas-wiki producer skill added (top-level now 28, total 184):
  `plugins/atlas/skills/atlas-wiki/SKILL.md` (198 lines, auto-trigger),
  ships `scripts/check_wiki_freshness.sh` (emits FRESH, MISSING, STALE).
- Inert `triggers:` field removed from all armada skills; keywords
  folded into `description` and `when_to_use`.
- S7 armada all 11 departments CONFIRMED: design, productivity, data,
  it-ops, support, finance, hr, security, engineering, m365, product.
- S10 content fixes verified: 3 security SKILL.md
  (audit-forensics, evidence-gap-hunter, framework-audit-readiness)
  gained L2 read-directive to `references/audit-rubric.md`; 5 engineering
  Sentry skills (sentry-api-patterns, sentry-issue-triage,
  sentry-error-investigation, sentry-release-health,
  sentry-seer-root-cause) had allowed-tools corrected to
  `mcp__io_github_getsentry_sentry-mcp__*` (real server key
  `io.github.getsentry/sentry-mcp`); manual-vs-auto-map updated to 28
  top-level; pre-existing em-dash at
  `metis/references/multi-stage-planning.md:79` replaced with ASCII.
- 9 reserved placeholder directories (advisory, not deleted): 3 hr
  (new-hire-flow, pay-rate-audit, roster-snapshot), 5 finance
  (ramp-api-patterns, ramp-bill-vendor-reconciliation,
  ramp-card-controls, ramp-reimbursement-review, ramp-spend-triage),
  1 engineering (sonarqube-quality-gate).
- Evidence: `.atlas/docs/.run/findings.json` (S1-S8 and S10 all status
  "verified"). See `plugins/atlas/CHANGELOG.md` 4.0.0 entry for the full
  per-wave breakdown.

## Atlas v3.1.3 -- close the rest of the Windows invalid-path class (2026-07-10)

An independent atlas:verifier (agentId a10e294b3d3b68c55) confirmed the 3.1.2 fix
line by line but flagged that the "fixes the root cause" framing was overstated:
the same defect was still live in three writers the 3.1.2 commit never touched.
3.1.3 closes them. Version 3.1.2 -> 3.1.3
(`plugins/atlas/.claude-plugin/plugin.json:3`).

- Canonical slug rule added to `atlas-metis/references/docs-ssot.md` "Naming
  conventions": one filesystem-safe algorithm (Windows-reserved set `< > : " / \
  | ? *`, reserved device names) covering every `<slug>`/`<id>`/`<scope>` the
  docs SSOT defines - `docs/plans/<slug>.md`, `docs/features/<feature-slug>.md`,
  `docs/runs/<id>/`, evidence dirs, ADRs, lessons. This is load-bearing for all
  atlas-metis output, so a raw `frontend:auth` task name flowing into a plan
  path would have reproduced the identical checkout failure.
- `atlas-chronos/SKILL.md` loop-creation (`loops/<id>.md`) and
  `session-lifecycle.md` run-archive (`docs/runs/<id>/`) now require a
  filesystem-safe id and point to the canonical rule.
- Verifier verdict recorded at `docs/.run/findings.json` (status verified),
  including the hole and its closure.

## Atlas v3.1.2 -- filesystem-safe audit filenames (2026-07-10)

atlas-ariadne and atlas-athena wrote per-feature and per-finding files from
raw, model-chosen names. When a name carried a colon (e.g.
`charts/frontend:public-site-and-auth.md`), Git on Windows rejected the entire
checkout with `error: invalid path`, blocking everyone from syncing the repo.
The generators now slug every filename before writing. Version 3.1.1 -> 3.1.2
(`plugins/atlas/.claude-plugin/plugin.json:3`); commit `940087e`.

- Slug rule added to `plugins/atlas/skills/atlas-ariadne/SKILL.md:84-95`
  ("Filename safety"): lowercase; replace any character outside `a-z 0-9 . _ -`
  (the Windows-reserved set `< > : " / \ | ? *` plus spaces) with `-`; collapse
  and trim; guard reserved device names and slug collisions. The human-readable
  name still heads the file, so nothing is lost.
- Inline reminders at both write points (`SKILL.md:40` charts, `:66` handoffs)
  plus slugged placeholders in the output tree.
- `plugins/atlas/skills/atlas-athena/SKILL.md:87` carries the matching constraint
  at its `handoffs/<finding-id>.md` write point (same latent exposure).
- `build_hub.py` ruled out as a source: it only reads existing handoff files via
  `os.listdir` (`build_hub.py:118`) and writes fixed names; the fix is in the
  orchestrator prompts, not the script.
- Observed-behavior proof: the documented slug rule applied to all seven real
  colon filenames from the git error produces Windows-valid, colon-free,
  collision-free names; edge-case guards (reserved device name, all-reserved
  string, whitespace-only) fire. Evidence:
  `docs/evidence/2026-07-10-cartographer-slug-fix.md`. Independently confirmed by
  atlas:verifier (`docs/.run/findings.json`).
- Scope: fixes the generator only. Files already committed to
  `gwh-firstrespondersapp` still need renaming (colon -> hyphen) from a
  macOS/Linux checkout; Windows cannot check that branch out to fix in place.

## Atlas v3.1.1 -- phase glyphs in the status header (2026-07-10)

The `ATLAS | <phase> | <state>` output-style header gained a per-phase emoji so
the current engine stage reads at a glance in the terminal
(`plugins/atlas/output-styles/atlas-orchestrator.md`). Scoped ASCII exception:
the eight header glyphs are permitted; prose stays emoji-free. Commit `a9ba716`.

## Atlas v3.1.0 -- enforcement teeth, fork doctrine, sextant multi-agent chronicle, de-overlap (2026-07-09)

Full overhaul of the atlas plugin as the load-bearing orchestration layer. Every
shipping change carries an independent atlas:verifier record in
`docs/.run/findings.json`; regression 115/115 tests green; version bumped
3.0.2 -> 3.1.0 (`plugins/atlas/.claude-plugin/plugin.json:3`).

- Arm-early classifier: `prompt_optimizer.py` now classifies each UserPromptSubmit
  and arms the orchestration flag for substantive engineering prompts (error
  signal / strong verb / common-verb-with-code-anchor tiers), injecting a one-line
  engine nudge; trivial prompts untouched; `ATLAS_ENGINE_ARM=off` escape
  (`plugins/atlas/hooks/prompt_optimizer.py:297-398`). Broke the chicken-and-egg
  where the flag was only ever set after a dispatch happened. Looped back once:
  the first verifier refuted the initial point-scoring design with conversational
  false positives; the two-tier rework re-verified clean with one accepted,
  documented residual (dual-use verbs like "audit"/"debug").
- Tripwire deny tier: `dispatch_tripwire.py` gains a PreToolUse path that denies
  the 9th undelegated inline op (`DENY_THRESHOLD = 8`) and any inline
  Edit/Write/MultiEdit to non-docs production paths, orchestration-flagged
  sessions only, using the documented `permissionDecision: "deny"` form;
  `ATLAS_TRIPWIRE_HARD=off` disables only the deny tier; the PostToolUse advisory
  at 4 is unchanged (`plugins/atlas/hooks/dispatch_tripwire.py:26,57-64,70`;
  `plugins/atlas/hooks/hooks.json` PreToolUse registration).
- Completion gate condition (g): Law 5 machine-enforced - Stop is blocked when
  code changed and `atlas_db.unpaired_implementer_dispatches(conn, run_id) > 0`,
  naming the count and atlas:verifier (`plugins/atlas/hooks/completion_gate.py:290-354`).
- Verifier coverage re-sourced: `derive_run_metrics` computes `verifier_coverage`
  from the `dispatches` table (agent_type pairing; NULL when zero implementer
  dispatches) instead of the mismatch-prone `tool_calls` targets
  (`plugins/atlas/scripts/atlas_db.py:342-411`).
- Fork routing doctrine: `subagent-kit.md` documents `subagent_type: "fork"`
  (full-history inheritance, prompt-cache reuse, `CLAUDE_CODE_FORK_SUBAGENT=1`,
  dispatch-time only, no nested forks) routed to planner/completeness-critic/
  docs-curator/synthesis; verifier and explorer stay fresh-context per Law 5
  (`plugins/atlas/skills/atlas-metis/references/subagent-kit.md:60-82`). The env
  var was enabled globally in `~/.claude/settings.json` (user-approved, verified
  against live docs). Exercised live this run: the completeness critique and this
  docs reconciliation both ran as forks.
- Output style resurrected: `atlas-orchestrator.md` gains `force-for-plugin: true`
  (auto-applies when the plugin is enabled) and was trimmed 66 -> 49 lines with a
  fork-vs-fresh section; zero claude.ai behavior-prompt content
  (`plugins/atlas/output-styles/atlas-orchestrator.md:1-5`).
- Observer-session pollution fixed and purged: `is_synthetic_session` excludes
  `.claude-mem/observer-sessions` transcripts at ingest
  (`plugins/atlas/scripts/session_ingest.py:204-214`), and
  `purge_observer_sessions` removed the existing 14,078 polluted session_logs
  rows plus 98,940 child rows from the live DB (backup taken; runs/dispatches
  untouched) - before/after capture in `docs/evidence/2026-07-09-observer-purge.md`.
- Sextant chronicles codex: `session_logs` gains an `agent` column (default
  'claude', idempotent migration) and a generic adapter registry with a codex
  JSONL adapter; the gated real backfill ingested 170 codex sessions (68
  observer-cwd files correctly excluded; claude rows byte-identical; idempotency
  proven) - `docs/evidence/2026-07-09-codex-backfill.md`. Known limitation
  documented: codex token deltas are only partially persisted (undercount), see
  `plugins/atlas/skills/atlas-argus/SKILL.md:270-280`.
- De-overlap wave: 33 of 40 frontmatter descriptions rewritten to tight unique
  triggers (plugin.json description 1548 -> 281 chars, sextant 1177 -> 447,
  atlas-prompt 648 -> 157); zero duplicate or first-60-char-identical
  descriptions; atlas-nestor command is routes-only; docs-auditor is the sole
  owner of docs-drift; verifier confirmed every diff touched exactly the
  description line. Two weakened triggers (m365 "Graph", doctor symptom clause)
  were caught by the verifier and restored.
- Docs synced to the new enforcement reality: engine SKILL.md, hooks-automation.md
  ("seven conditions"), plugin README hook table, and the sextant public-API list
  all reconciled against the shipped code by a dedicated pass, then re-verified
  claim-by-claim against the implementation.

## Unreleased -- atlas harden: agent-roster cleanup, spec conformance, routing, marketplace repoint (2026-07-07)

Audit: `docs/audits/atlas-harden-2026-07-07/` (orientation, decisions, per-stage
reports, red baseline, green-gate cross-check, final report). No plugin.json version
bump in this pass - release timing left to Jerry.

- Removed the five `ux-*` agent specs (`ux-cartographer`, `ux-persona`, `ux-fuzzer`,
  `ux-accuracy-oracle`, `ux-reporter`) and `api-usage-map`, guarded by a pre-delete grep
  for live skill/command dispatches (`docs/audits/atlas-harden-2026-07-07/stage-removals.md:13-41`).
  UX testing's canonical owner is now `atlas-odysseus`; `ux-test-swarm.md` collapsed
  to an 11-line pointer at that skill (`stage-removals.md:75-78`). Struck all
  references to the six removed names from `plugins/atlas/README.md` (roster count
  corrected 18 -> 12), `output-styles/atlas-orchestrator.md`,
  `skills/atlas-metis/SKILL.md`, and `skills/atlas-odysseus/references/personas.md`
  (`stage-removals.md:46-84`).
- Added three routing rows to
  `plugins/atlas/skills/atlas-metis/references/capability-routing.md` for
  atlas-hephaestus (project boot/onboarding), atlas-metis's own self-entry
  (orchestration), and atlas-nestor (skill selection); annotated 12 built-in/global
  agent-type mentions (`codebase-explorer`, `Explore`, `Plan`, `debugger`, etc.) with a
  `*` footnote marking them as not shipped under `plugins/atlas/agents/`
  (`docs/audits/atlas-harden-2026-07-07/stage-routing.md:6-14`).
- Added named-field Report-back sections to the three agent specs that lacked one
  (`naming-glossary-audit.md`, `rls-privilege-audit.md`, `schema-inventory.md`) and
  explicit hallucination-control grounding language ("I don't know" is a valid
  result, cite what was actually read, unproven gaps stay `[unverified]`) across all
  12 remaining agent specs
  (`docs/audits/atlas-harden-2026-07-07/stage-conformance.md:7-36`).
- Repointed the tech-tools marketplace registration from the stale
  `henssler-financial/tech-tools` fork to canonical `w159/tech-tools` via
  `atlas_doctor.py --fix`, which rewrote `known_marketplaces.json`'s source URL and
  reset the marketplace clone's git remote/HEAD; doctor now reports `HEALTHY - atlas`
  with 0 problems (`docs/audits/atlas-harden-2026-07-07/stage-marketplace.md:37-105`).
- Hardened repo-root `.gitignore`: added a re-exclusion for `**/.in_use/` (and
  `**/.in_use/**`) after the `!plugins/**` allowlist, the one dev-runtime pattern of
  four checked that was not already covered
  (`docs/audits/atlas-harden-2026-07-07/stage-gitignore.md:19-39`).
- Deleted untracked dev caches (`plugins/atlas/.pytest_cache`,
  `plugins/atlas/.ruff_cache`, `plugins/atlas/scripts/.claude`) and the empty
  `plugins/atlas/references/` directory; no tracked file was affected
  (`docs/audits/atlas-harden-2026-07-07/stage-removals.md:96-107`).
- Known residue carried into the audit's final report for owner follow-up (not fixed
  in this pass; see `docs/audits/atlas-harden-2026-07-07/final-report.md` section 4):
  a prior commit (`d1be66b`) already baked the local-relative-path marketplace scheme
  into `.kimi-plugin/marketplace.json` before this session's revert step ran, so the
  intended revert was a no-op and reverting it now requires a history-changing commit
  outside this audit's authority; and the Magic/Plaid credential strings previously
  flagged in `.kimi-plugin/import-plan.json`'s git history remain unrotated and
  unrewritten.

## Atlas v2.6.0 -- vendor connectors single-sourced to domain plugins (2026-07-03)

All 10 vendor `.mcpb` bundles atlas carried in `plugins/atlas/mcp/` were confirmed
byte-identical (SHA-256) to the copies already shipped by the four domain plugins that
own each vendor - it-operations (auvik, connectwise-manage, ninjaone, spanning),
security-compliance (blumira, knowbe4, threatlocker, vanta), microsoft-365 (cipp), and
hr-payroll (paylocity). Atlas now stops carrying them: `plugins/atlas/mcp/` (10 `.mcpb`
files + `extract.sh` + `launch.sh`, ~27 MB) and `plugins/atlas/.mcp.json` are removed,
and `plugins/atlas/.claude-plugin/plugin.json` drops the `mcpServers` key and the
entire `userConfig` block of vendor credential keys (version bumped to 2.6.0). The
domain plugins already declare their own `userConfig`/`.mcp.json` per vendor and are
now the single source. `atlas-hermes` is rewritten from "enable atlas's bundled
connectors" to a cross-plugin setup guide: it detects which domain plugins are
installed, shows enabled/disabled state per vendor against the *owning* plugin's
config, and directs credential entry to that plugin's `/plugin config`; `vendors.md`
updated to match, with a migration note. Stale bundling/`.mcpb`/`userConfig` claims
swept from `capability-catalog.md`, `atlas-metis/SKILL.md`,
`scripts/discover_capabilities.py`, `commands/atlas.md`, and `README.md`. The
marketplace entry description for atlas was re-synced from the updated plugin
manifest. MIGRATION: credentials previously entered on atlas's own plugin config
(e.g. `paylocity_client_id`) must be re-entered on the owning domain plugin via
`/plugin` - atlas's copies of those keys no longer exist.

## Atlas v2.5.0 -- deterministic orchestration wiring + docs gate widened (2026-07-03)

Session audit found the plugin's connective tissue was prose, not machinery: the
orchestration marker was never set automatically (so the tripwire and completion gate
stayed inert in normal use), the gate ignored ROADMAP/README/docs-drift, both
atlas-metis and `atlas-prompt` explicitly forbade asking the user scoping questions, and
five orphan pre-rename skill dirs plus cache debris sat on disk. All fixed in
`plugins/atlas/CHANGELOG.md` 2.5.0: auto-marking via the dispatch tripwire (Skill +
`atlas:*` dispatch signals), a 6-condition completion gate with blocking docs-drift,
one-round AskUserQuestion elicitation, docs-curator-owned graphify regeneration, and
leftover removal. Expanded in the same session: new atlas-nestor skill/command
(AskUserQuestion-driven skill stacking), elicitation guidance in all nine skills plus a
subagent DECISION-NEEDED bubbling rule, atlas-doctor `stale-assets` +
`orchestration-wiring` checks with quarantine-based --fix and an asset-count fix
(.DS_Store no longer counted as a skill), and quarantine of the ghost pre-atlas assets
(orchestrate.backup-*, uxt-swarm, self-improving, connector-ops skeletons and 36 orc-*
agent files) that polluted the slash/agent pickers. 73 hook/script tests pass. Also
repaired the dev repo itself: `.git/HEAD` + `.git/config` were missing (MEGA sync loss)
and 276 deleted tracked files were restored via `git restore`.

## Atlas v2.4.0 -- atlas-doctor installation self-repair (2026-07-01)

Root-caused and fixed the plugin-rollback incident: the tech-tools marketplace entry in
`~/.claude/plugins/known_marketplaces.json` tracked the stale henssler-financial fork with
autoUpdate on, so `/plugin` updates silently rolled atlas back to 1.0.1 (no subagents, no
hooks, no engine). Marketplace repointed to w159/tech-tools; atlas re-registered.

- **atlas-doctor** (`scripts/atlas_doctor.py`, `/atlas-doctor`): eight-check CHECK/SET/VERIFY
  health pass over the installation itself -- marketplace source vs the canonical repo from
  the plugin's own manifest, clone remote, version sync, rollback high-water mark
  (`~/.atlas/doctor-state.json`), `.orphaned_at` GC markers, hooks wiring, asset inventory.
  `--fix` auto-repairs; 7 sandbox unit tests recreate the incident.
- **SessionStart rollback guard**: `atlas_doctor.py --hook` (warn-only, exit 0) added to
  `hooks/hooks.json` so any future downgrade is announced at the top of the session.
- Marketplace manifest 1.6.1; counts reconciled (17 launchers, doctor hook) across
  plugin.json, marketplace.json, and the plugin README.

## Atlas v2.3.0 -- cohesion program (2026-06-30)

The five-workstream Atlas cohesion program plus three adoption follow-ups. Each workstream was
independently reviewed before merge. Plans + evidence under `docs/audits/atlas-cohesion-2026-06-29/`.

- **WS1 - hook misfires**: per-session orchestration marker (`runs.orchestrating` + `mark-orchestrating`
  CLI). The dispatch tripwire, completion gate, and nudge now gate on it, so non-orchestration sessions
  are never nagged or blocked. Hook inventory reconciled to the real 8 across all surfaces.
  (`plugins/atlas/hooks/*`, `plugins/atlas/scripts/atlas_db.py`)
- **WS2 - instrumentation**: most was already shipped in v2.2.3 (dispatch logging, metric derivation,
  classifier). Net-new: a `record_recall` signal (`record-recall <session> hit|miss` CLI) so the engine
  Orient step records recall hit/miss. Validated to survive `derive_run_metrics`.
- **WS3 - graphify scoping**: per-root scoping + a non-interactive size gate (`GRAPHIFY_NONINTERACTIVE`)
  so audits never stall on whole-monorepo scope; repo `.graphifyignore`. (`skills/graphify/SKILL.md`,
  `plugins/atlas/skills/atlas-athena/SKILL.md`)
- **WS4 - knowledge-graph hub + launcher**: `scripts/build_hub.py` (file-granular node<->finding
  manifest + branded Atlas hub HTML) and the new `/atlas-launch` command closing the audit->remediation
  loop. Survey/cartographer/engine wired. (15 -> 16 launchers)
- **WS5 - adoption**: memo with user-confirmed verdicts (no assets pruned). Follow-ups landed:
  `/atlas menu` discoverability mode; claude-mem worker-runtime call conventions
  (`references/memory-access.md`) fixing the 44% error rate; supermemory pointed at cloud.

### Sextant self-improvement run (2026-06-30, post-WS5)

Two further fixes from an `atlas-argus` self-improvement pass, plus two related changes outside
the plugin.

- **Fixed: the `dispatches` run-health metric was a stale snapshot, not a delegation gap.**
  `derive_run_metrics` now recomputes `dispatches = COUNT(*) FROM dispatches WHERE run_id=?` onto
  the metrics row instead of trusting the one-shot snapshot `finalize_run` takes at the first Stop.
  Dispatches landing in later turns of the same session (via the `dispatch_tripwire` last-run
  fallback) were never recounted, so `metrics.dispatches` read 0 even when the `dispatches` table
  had rows -- across the DB, 46 dispatch rows existed across 10 runs but only 3 metrics rows showed
  `dispatches>0`; run 52 had 7 dispatch rows with `metrics.dispatches=0`, now corrected to 7. This
  reframes the recurring "zero subagent dispatches" investigations from prior sessions (the v2.2.3
  work) as chasing a REPORTING bug, not a delegation failure -- delegation was happening; the metric
  was not counting it.
  (`plugins/atlas/scripts/atlas_db.py:380-397`)
- **Added: auto-derived session resume on SessionStart.** `session_boot.py` gained `resume_block(root)`
  plus helpers `_relative_time`, `_claude_mem_summary`, `_atlas_session_context` (198 lines added).
  On boot it derives and prints a "## Resuming &lt;project&gt;" block from three read-only sources:
  claude-mem's `session_summaries`/observations, the atlas mirror (last session, last user prompt,
  last edited file, unverified-claim count), and the newest transcript mtime for freshness.
  Fail-silent; never blocks boot. Deliberately replaces a rejected "continue from last session"
  command -- resume state is derived, never re-typed by the user. Known gap, intentionally
  deferred: there is no Stop-time `next_step` signal, so the part of resume state that depends on
  what-to-do-next still relies on claude-mem's `session_summaries.next_steps` field rather than a
  dedicated atlas signal.
  (`plugins/atlas/hooks/session_boot.py:31-216`)
- The claude-mem worker-runtime calling convention shipped in WS5 above
  (`plugins/atlas/skills/atlas-metis/references/memory-access.md`) proved insufficient on its own:
  two sessions after that commit still mis-called `observation_search` in worker runtime. The rule
  was promoted to the user's global, always-loaded `~/.claude/CLAUDE.md` so it loads regardless of
  whether the skill is in context. Cross-referenced, not duplicated, in `memory-access.md`.
  (`plugins/atlas/skills/atlas-metis/references/memory-access.md:36`)
- The user's global verification protocol (`agentic-tools/rules/verification-protocol.md`, outside
  this repo) was independently strengthened in response to mined signals -- 29 unverified-claim
  findings across 7 projects and 64 assumption-admission findings across 12 -- closing a
  prediction-phrase loophole and adding an assumption gate and claim-evidence adjacency requirement.
  No file in this repo changed for this item; noted here for cross-project traceability. See
  `plugins/atlas/skills/atlas-metis/references/verification-and-grounding.md:78` for the
  cross-reference.

## Atlas v2.2.3 (released 2026-06-29)

Four work items extending the observability layer shipped in v2.2.1/2.2.2. Not yet released.

- **Run-kind tagging**: tag each session/run as orchestrator or worker so Trends aggregates exclude
  short-lived sidechain worker sessions from run-health metrics. Requires a `run_kind` column in
  the `runs` table and hook-side detection of background/subagent launches.
  (`plugins/atlas/scripts/atlas_db.py`)
- **Docs-freshness advisory completion gate**: `completion_gate.py` will emit a one-time advisory
  when `docs/CHANGELOG.md` or `docs/ROADMAP.md` have not been updated since the last run that
  touched skill or hook files. Advisory only; fail-open; disable with `ATLAS_GATE=off`.
  (`plugins/atlas/hooks/completion_gate.py`)
- **Late-dispatch drop hardening**: a `current_or_last_run_id` helper to replace the
  `current_run_id`-after-Stop NULL pattern that caused the 2.2.2 `latest_run_id` fix; ensures
  post-Stop hooks attach metric derivation regardless of hook ordering.
  (`plugins/atlas/scripts/atlas_db.py`)
- **Docs SSOT backfill**: repo-level `docs/CHANGELOG.md`, `docs/ROADMAP.md`, and `docs/AGENTS.md`
  brought current with v2.2.1 and v2.2.2 (previously recorded only in `plugins/atlas/CHANGELOG.md`).
  (`docs/CHANGELOG.md`, `docs/ROADMAP.md`, `docs/AGENTS.md`)

---

## 2026-06-29 -- Atlas v2.2.2: run-metrics population fix and defect corrections

Commit 1d0f6c4. Corrects three defects found by end-to-end testing against the live hooks that
left `est_context_tokens`, `verifier_coverage`, `parallel_waves`, `in_flight_peak`, and
`wall_clock_s` NULL on every real (non-test) run after v2.2.1.

- `derive_run_metrics` wired into `ingest_transcript`: v2.2.1 added the function but nothing
  called it outside tests, so the four computed metrics stayed NULL on every live run. Now called
  after each mirror refresh (Stop / SubagentStop / SessionEnd / PreCompact).
  (`plugins/atlas/scripts/session_ingest.py`)
- `finalize_run` defaults `wall_clock_s`: the Stop hook called `finalize_run(run_id)` with no
  duration, so `wall_clock_s` was NULL on every historical run. It now defaults to
  `max(0.0, time.time() - started_at)` when the argument is omitted.
  (`plugins/atlas/scripts/atlas_db.py:179`)
- COALESCE order corrected in `derive_run_metrics` upsert: the previous form
  `COALESCE(excluded.wall_clock_s, wall_clock_s)` overwrote finalize's authoritative value with
  the (often zero) transcript span. Flipped to `COALESCE(wall_clock_s, excluded.wall_clock_s)`
  so derive only fills a wall clock that finalize never set (backfill-only sessions).
  (`plugins/atlas/scripts/atlas_db.py:276`)
- `trends()` now returns the full metric set: the selector previously chose three columns while
  the `atlas-argus` Trends table compares five; it now returns all metrics including
  `verifier_coverage` and `parallel_waves`.
  (`plugins/atlas/scripts/atlas_db.py:325`)
- `latest_run_id(conn, session_id)` added: resolves the most recent run open or closed so
  post-Stop metric derivation attaches regardless of hook ordering.
  (`plugins/atlas/scripts/atlas_db.py`)
- `atlas-argus` SKILL.md corrected: `derive_run_metrics` marked auto-wired, `latest_run_id`
  documented, Trends column list and the example (which used `current_run_id`, NULL after Stop)
  fixed.
  (`plugins/atlas/skills/atlas-argus/SKILL.md`)

---

## 2026-06-26 -- Atlas v2.2.1: session transcript ingestion, hook exec-bit fix, run metrics

Commit 0c792dd. Adds a session-forensics lens to atlas-argus: the observability DB now indexes
the lossless JSONL session transcripts Claude Code writes, so sextant can see every message,
tool call, and token-usage number instead of only the sparse live-event counters. Also fixes a
hook exec-bit defect that logged "Permission denied" on every PostToolUse call, and adds
`derive_run_metrics()` to compute `wall_clock_s` and `est_context_tokens` per run.

### Session transcript ingestion

- New `scripts/session_ingest.py`: parses transcripts incrementally by byte cursor (reads only
  new lines per call), classifies each tool call as builtin/skill/mcp/agent, scrubs secrets from
  input summaries, records per-message token and cache usage, and tags three behavioral signals
  (assumption_admission, unverified_claim, user_correction). `--backfill` walks
  `~/.claude/projects` idempotently; single-session mode for the hook.
  (`plugins/atlas/scripts/session_ingest.py`)
- New `hooks/ingest_session.py` wired in `hooks.json` on Stop, SubagentStop, SessionEnd, and
  PreCompact; fail-open and fast (reads only new bytes). Disable with `ATLAS_INGEST=off`.
  (`plugins/atlas/hooks/ingest_session.py`, `plugins/atlas/hooks/hooks.json`)
- Five new mirror tables in the observability DB, joinable to `projects`/`runs` by `session_id`:
  - `session_logs`: one row per transcript file with byte cursor and file size.
    (`plugins/atlas/scripts/atlas_db.py:44`)
  - `messages`: per-message token/cache usage and sidechain flag.
    (`plugins/atlas/scripts/atlas_db.py:56`)
  - `tool_calls`: per-call classification (kind, target, server), input summary, result excerpt.
    (`plugins/atlas/scripts/atlas_db.py:64`)
  - `user_prompts`: normalized human prompts with machine-generated openings excluded.
    (`plugins/atlas/scripts/atlas_db.py:73`)
  - `signals`: behavioral signals deduped per message per signal_type.
    (`plugins/atlas/scripts/atlas_db.py:79`)
- Six read helpers added to `atlas_db.py`: `tool_usage`, `idle_assets`, `context_tool_health`,
  `signal_counts`, `signal_rollup`, `repeated_prompts`. Token totals recomputed from child rows
  so re-ingest never double-counts. Machine-generated openings excluded from `user_prompts` so
  the repeated-request signal reflects real human asks.
  (`plugins/atlas/scripts/atlas_db.py`)

### Hook exec-bit fix

`hooks.json` previously invoked hooks by bare path, requiring the execute bit.
`dispatch_tripwire.py` shipped mode 0644 (no execute bit), so every PostToolUse call logged
"Permission denied" and the tripwire did not fire. All hooks now invoked as
`python3 "${CLAUDE_PLUGIN_ROOT}/hooks/X.py"`, making them exec-bit-independent and
path-space-safe.
(`plugins/atlas/hooks/hooks.json`)

### Run metrics

`derive_run_metrics()` added to `atlas_db.py`: derives `est_context_tokens` (peak input+cache_read
over main-thread messages) and `wall_clock_s` (session span from the mirror) and upserts them into
the `metrics` table. Recall hits/misses stay NULL and are filled by atlas-argus on demand.
(`plugins/atlas/scripts/atlas_db.py:268`)

### Tests and version

New `scripts/test_session_ingest.py` covers classification, secret redaction, result join, signal
detection, token aggregates, idempotency/incremental, truncation reset, and machine-prompt
filtering. Derive test added to `test_atlas_db.py`. Full suite: 15 tests green. Plugin bumped
2.0.0 -> 2.2.1.
(`plugins/atlas/scripts/test_session_ingest.py`, `plugins/atlas/scripts/test_atlas_db.py`,
`plugins/atlas/.claude-plugin/plugin.json`)

## 2026-06-25 -- Atlas v2.0.0: final 8-skill redesign, observability DB, de-hardcoded swarms

Completed the atlas plugin skill-set redesign. Every skill is now canonically named under the
`atlas-*` prefix; the five retired names (atlas-loop, atlas-connectors, atlas-self-improving,
atlas-uxt-swarm, atlas-operating-contract) no longer appear in the plugin or its docs except in
historical CHANGELOG entries below.

### Skill renames and retirements

- `atlas-loop` -> `atlas-chronos`: same loop library, canonical name dropped the ambiguous "loop" suffix.
- `atlas-connectors` -> `atlas-hermes`: vendor MCP connector setup skill; name reflects the "safe harbor"
  for external integrations.
- `atlas-self-improving` retired; replaced by `atlas-argus`: the new skill reads a SQLite observability
  DB (`~/.atlas/atlas.db`) populated by the session/tripwire/completion hooks, computes wall-clock, inline-ops, dispatches, parallel
  waves, context, recall, and verifier-coverage scores, and proposes metric-backed improvement targets
  (baseline -> target). Measurable; not motivational.
- `atlas-uxt-swarm` retired; its pipeline (cartographer -> persona -> fuzzer -> oracle -> reporter) is now
  the implementation detail of `atlas-odysseus`. atlas-odysseus adds app-discovery: it auto-finds
  routes and form fields in any live web app with no hardcoded paths, so it works on any project.
- `atlas-operating-contract` retired; the operating contract itself (`operating-contract.md`) still ships
  as a reference file under atlas-metis/references/. The skill wrapper was not necessary.

### New skills

- `atlas-ariadne`: produces an evidence-grounded architecture map of any codebase, identifies
  structural duplicates (DRY-at-the-module level), and writes `docs/architecture/boundaries.md` as a
  persistent artifact a future agent can load instead of re-discovering structure.
- `atlas-odysseus`: app-discovering UX swarm. Discovers routes/fields from a live app via a cartographer
  phase, then runs the full persona + fuzz + accuracy-oracle + reporter pipeline. No hardcoded paths;
  works on any web app.
- `atlas-athena`: discovery-first comprehensive quality and security audit swarm. Covers code quality
  (complexity, dead code, test coverage, error handling), security (OWASP Top 10, SANS 25, secrets,
  auth, injection, SSRF), and dependency risk. Returns severity-graded findings and an actionable
  remediation plan.
- `atlas-argus` (detailed above).

### Manifest and docs reconciliation

- `plugins/atlas/.claude-plugin/plugin.json` bumped 1.2.1 -> 2.0.0 (MAJOR: breaking change - four skills
  renamed and `atlas-operating-contract` removed, so any external reference to an old skill name breaks);
  description updated to enumerate all 8 skills with their one-line purpose and the 8-hook count; 5 new
  keywords added (observability-db, architecture-audit, owasp, security-audit, ux-swarm).
- `plugins/atlas/README.md` updated: "What ships" table expanded to all 8 skill rows; layout tree
  updated to show all 8 skill directories.
- `plugins/atlas/skills/atlas-metis/references/capability-catalog.md` updated: 3 new signal rows added
  for atlas-ariadne, atlas-athena, atlas-odysseus.
- `plugins/atlas/skills/atlas-metis/references/capability-routing.md` updated: atlas-odysseus added
  to the UX-sweep row; 6 new routing rows added for atlas-athena, atlas-ariadne, atlas-chronos,
  atlas-hermes, atlas-argus, and the app-routes-unknown expedition path.
- `.claude-plugin/marketplace.json` atlas entry updated: description and keywords now match plugin.json.

## 2026-06-23 -- Connector .mcpb bloat fixed; marketplace install repaired; atlas connectors made standalone-resolvable

Diagnosed why connector-heavy plugins did not appear (or appeared empty) when adding the marketplace in
Claude Desktop. Root cause was bundle weight, not manifest structure: the marketplace catalog, all 12
plugin.json manifests, userConfig/mcp.json key parity, and component frontmatter were all valid and
git-tracked (confirmed via the plugin-dev plugin-validator agent).

### Packer fix (root cause)

`mcp_servers/_shared/pack-mcpb.js` copied each `file:`-linked vendor lib with a recursive `cpSync`, which
dragged in that lib's nested `node_modules` and its iCloud `node_modules.nosync.noindex` twin (dev toolchain:
esbuild, vite, typescript, rollup, msw). That was the entire bloat. Two earlier per-server packer variants
attempted a fix but their regexes only matched `node_modules` followed by a separator, so they missed the
`.nosync.noindex` twin. The fix dereferences the symlinked vendor (`realpathSync`) and filters out both
nested `node_modules` and any `.nosync*` directory, plus a defensive staging cleanup and `.mcpbignore`
entries. Propagated the one canonical packer to all 10 per-server copies (they had drifted into 3 variants;
now a single md5, all `node --check` clean).

### Bundles rebuilt and verified (staged in /tmp, never npm-installed under iCloud)

| connector | before | after |
| --- | --- | --- |
| spanning | 99 MB | 2.78 MB |
| blumira | 60 MB | 2.61 MB |
| vanta | 51 MB | 2.77 MB |
| threatlocker | 47 MB | 2.76 MB |
| paylocity | 25 MB | 2.77 MB |

Tracked `.mcpb` total dropped from ~283 MB to ~14 MB across these five; largest single bundle is now 3.3 MB
vs GitHub's 104.8 MB hard push limit. Each rebuild was adversarially verified: size <= 20 MB, entry point
present, zero `.nosync` entries, and a credential-free stdio launch returning a full `tools/list` (spanning,
blumira, vanta ~30 tools, threatlocker 18, paylocity 17).

### atlas connectors resolvable standalone

`plugins/atlas/mcp/extract.sh` searched only the operator data dir, an env override, and a source checkout -
none exist on a marketplace install, so all 10 declared atlas connectors were "declared but not set up."
Added a `${CLAUDE_PLUGIN_ROOT}/mcp/<name>.mcpb` search candidate and shipped all 10 slimmed bundles (~27 MB
total) under `plugins/atlas/mcp/` named `<svc>-mcp.mcpb`. Verified end to end: extract resolves the bundled
copy and launch boots vanta credential-free with full tools/list. Connectors stay INERT until credentials
are supplied.

### bash_advisor.py exec bit

`plugins/atlas/hooks/bash_advisor.py` (the PreToolUse Bash advisor) was missing its execute bit while the six
peer hooks had it; hooks.json wires it as a bare command path, so a direct execve could fail to launch the
catastrophic-command advisor. `chmod +x` and `git update-index --chmod=+x` (mode 100644 -> 100755) so a fresh
clone keeps the bit. Verified: script exits 0 on a sample Bash event.

### docs / .gitignore

Corrected the `.gitignore` comment that wrongly assured connector bundles were "~3 MB, well under GitHub's
limit" (they were up to 99 MB); it now states the slim-pack requirement and the regression risk. Refreshed
`PLUGIN_INVENTORY.md` to document the slim packer and atlas standalone bundling.

## 2026-06-23 -- Atlas optimization Phase 2/3: Architect Mode, ponytail/loop-library/connector discovery, session-lifecycle docs, visual layer

Independently verified (adversarial verifier, 14/14 after fixing one pre-existing broken script path).
All additive and opt-in; default sessions are unchanged.

### atlas-hephaestus: Architect Mode + no-args scan

The architect turns the session into a pure orchestrator: it rewrites vague or incomplete prompts into
structured, reference-backed tasks (operating contract + doc quotations), delegates research/impl/test to
parallel subagents, and routes every claimed change to an adversarial verifier for red -> green evidence.
With no task/args, any atlas skill runs a standard scan and reports the gap to atlas standard. Bootstrap
now treats claude-mem + context-mode + ponytail as the session-augmentation trio and surfaces the
loop-library and connector built-ins.
(`plugins/atlas/skills/atlas-hephaestus/SKILL.md`)

### Discovery: ponytail, loop-library, connectors

capability-catalog and discover_capabilities.py now recommend ponytail (always), loop-library (via
atlas-loop), and connectors (when `mcp_servers/` or `*.mcpb` present). session_boot reports ponytail
status and points at the no-prompt scan. Fixed a pre-existing broken path: the discover script is now
anchored at `${CLAUDE_PLUGIN_ROOT}/scripts/discover_capabilities.py` in both the skill and the catalog.
(`plugins/atlas/scripts/discover_capabilities.py`, `plugins/atlas/skills/atlas-metis/references/capability-catalog.md`, `plugins/atlas/hooks/session_boot.py`)

### Session docs lifecycle

New `references/session-lifecycle.md`: START reconciles recent claude-mem/context-mode work against docs/
(correct invalid, archive outdated) before new work; END runs a docs-curator that moves every completed
ROADMAP task to CHANGELOG with date and evidence. Wired as pointers into atlas-metis and docs-ssot.
(`plugins/atlas/skills/atlas-metis/references/session-lifecycle.md`)

### Visual layer (opt-in)

18 subagents given role-family colors (explorer cyan, implementer green, verifier red, db yellow, ux
purple, docs orange, planner blue). New opt-in "Atlas Orchestrator" output style and an opt-in colored
statusline script. No default changed; no settings.json touched.
(`plugins/atlas/agents/`, `plugins/atlas/output-styles/`, `plugins/atlas/statusline/`)

## 2026-06-23 -- Atlas optimization Phase 1: skill rename, loop-library + atlas-loop, all 10 connectors (disabled), self-improvement settings

Verified zero-degradation by an independent adversarial verifier (12/12 claims PASS).

### Skill naming fixed (atlas-* prefix)

`operating-contract` -> `atlas-operating-contract`, `self-improving` -> `atlas-self-improving`,
`uxt-swarm` -> `atlas-uxt-swarm`. Folders, `name:` fields, and every in-plugin reference updated.
The reference files `atlas-metis/references/operating-contract.md` and `references/self-improving.md`
were intentionally left as-is (they are docs the commands read, not the skills).
(`plugins/atlas/skills/`)

### New: loop-library + atlas-loop skill

`atlas-loop` discovers and instantiates the best-fit reusable loop for a recurring or iterative task.
Ships 12 loops (loop-until-dry, fan-out-adversarial-verify, red-green-tdd, doc-reconcile, incident-triage,
dependency-bump-sweep, flaky-test-hunt, migration-pipeline, perf-profile-iterate, security-finding-verify,
build-fix-loop, code-review-iterate) plus an INDEX catalog, read progressively.
(`plugins/atlas/skills/atlas-loop/`)

### New: atlas connectors (all 10, disabled by default, extract-on-demand)

atlas declares all 10 repo MCP servers via `.mcp.json`, inert by default (40 userConfig keys, all
required:false default:""). `mcp/launch.sh` + `extract.sh` extract a vendor bundle on demand so atlas
stays small (no ~297MB bundled), and emit a clear not-set-up message instead of crashing. New
`atlas-connectors` skill runs guided setup. plugin.json bumped 1.1.0 -> 1.2.0 (purely additive).
(`plugins/atlas/.mcp.json`, `plugins/atlas/mcp/`, `plugins/atlas/skills/atlas-connectors/`)

### New: project self-improvement settings

`.claude/settings.json` re-enables claude-mem auto-memory for this project (overrides the global
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` that was silently disabling the atlas nudge), sets
`ATLAS_BUILD_DIR=/tmp` for iCloud-safe builds, and pre-approves context-mode/docs MCP tools plus
safe Bash to cut approval friction. No hooks declared (the plugin auto-loads them).
(`.claude/settings.json`)

## 2026-06-22 -- MCP server hardening pass: error-envelope fix, ThreatLocker approve tool, vanta vitest suite, description and risk-prefix quality sweep

### Error-envelope HTTP classifier fixed (shared + connectwise + cipp private copies + auvik mapper)

`_shared/error-envelope.ts` `classifyError()` previously returned INTERNAL_ERROR for all
HTTP failures because it inspected `error.status` only; the vendor clients surface the code
on `error.statusCode` and the body on `error.response`. Both fields are now read before
falling back to INTERNAL_ERROR. The same fix was applied to two private copies of the
classifier (`connectwise-manage-mcp/src/_shared/error-envelope.ts` and
`cipp-mcp/src/_shared/error-envelope.ts`) and to auvik-mcp's private error mapper
(`auvik-mcp/src/errors.ts`). CIPP and auvik were real misclassification bugs: both servers
carried `statusCode` on their error objects but the code read only `status`, so HTTP
401/403/404/429/5xx all returned as INTERNAL_ERROR with no vendor detail. All three private
copies now verified to classify a `statusCode:403` error as FORBIDDEN with vendor detail.
Downstream effect: node-threatlocker, node-vanta, connectwise-manage, cipp, and auvik now
emit FORBIDDEN (403), NOT_FOUND (404), and RATE_LIMITED (429) correctly.
(`mcp_servers/_shared/error-envelope.ts`,
`mcp_servers/connectwise-manage-mcp/src/_shared/error-envelope.ts`,
`mcp_servers/cipp-mcp/src/_shared/error-envelope.ts`,
`mcp_servers/auvik-mcp/src/errors.ts`)

### New tool: threatlocker_approvals_approve (DESTRUCTIVE)

Added `threatlocker_approvals_approve` to threatlocker-mcp. Calls
`POST /ApprovalRequest/ApprovalRequestPermitApplication` to approve a pending application
request. Prefixed DESTRUCTIVE per the tool-quality contract.
ThreatLocker Portal API exposes no deny endpoint; deny must be performed in the Portal UI.
threatlocker-mcp version bumped 1.2.0 -> 1.3.0; tool count 17 -> 18.
(`mcp_servers/threatlocker-mcp/src/domains/approvals.ts`,
`mcp_servers/threatlocker-mcp/manifest.json`)

### Vanta-mcp: README and vitest suite added

vanta-mcp gained a README.md (setup, auth, env vars, tool index) and 20 vitest unit specs
covering the main domain handlers. vanta-mcp version bumped 0.2.0 -> 0.2.3.
(`mcp_servers/vanta-mcp/README.md`, `mcp_servers/vanta-mcp/src/__tests__/`)

### Auvik: 39 tool descriptions rewritten verb-first

All 39 auvik-mcp tool descriptions rewritten to start with a verb and state what the tool
returns and when an agent should call it. No tool count change. Version bumped 0.4.1 -> 0.4.2.
(`mcp_servers/auvik-mcp/src/domains/`)

### Blumira: 6 tools re-prefixed DESTRUCTIVE / VISIBLE-TO-OTHERS

Six blumira-mcp tools that create, update, or send data gained the required
DESTRUCTIVE or VISIBLE-TO-OTHERS prefix per the tool-quality contract.
Version bumped 1.1.4 -> 1.1.5.
(`mcp_servers/blumira-mcp/src/domains/`)

### All 10 .mcpb bundles rebuilt and plugin copies refreshed

After the above source changes all 10 servers were rebuilt (`npm run build`) and repacked
(`npm run pack:mcpb`). Plugin copies under `plugins/*/mcp/` updated to match.
Version table (all 10 bumped):
auvik 0.4.1 -> 0.4.2 | blumira 1.1.4 -> 1.1.5 | cipp 0.2.0 -> 0.2.2 |
connectwise-manage 0.1.0 -> 1.5.2 | kaseya-spanning-backup 1.1.2 -> 1.1.3 |
knowbe4 1.1.0 -> 1.1.2 | ninjaone 1.6.0 -> 1.6.2 | paylocity 0.1.3 -> 0.1.4 |
threatlocker 1.2.0 -> 1.3.0 | vanta 0.2.0 -> 0.2.3.
Grand total: 298 tools across 10 servers.
(`mcp_servers/*/manifest.json`, `plugins/*/mcp/*.mcpb`)

---

## 2026-06-22 -- Ramp connector removed from finance plugin; marketplace keyword parity fix

### Ramp connector removed from finance plugin (version 1.4.0 -> 1.4.1)

Decision reversed from "pending - wire when Ramp publishes an endpoint." Ramp publishes no
wireable hosted MCP endpoint; the five ramp-* skill folders are no longer API-pattern value
enough to justify the dead references in the manifest.

- Deleted skill folders: `ramp-api-patterns`, `ramp-bill-vendor-reconciliation`,
  `ramp-card-controls`, `ramp-reimbursement-review`, `ramp-spend-triage`.
  (`plugins/finance/skills/`)
- Removed Ramp section from `plugins/finance/CONNECTORS.md`.
  (`plugins/finance/CONNECTORS.md`)
- Removed keywords `ramp`, `spend-management`, `card-controls` from finance `plugin.json`
  and the finance entry of `.claude-plugin/marketplace.json`.
  (`plugins/finance/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`)
- Finance plugin version bumped 1.4.0 -> 1.4.1.
  (`plugins/finance/.claude-plugin/plugin.json`)
- Verified: 0 ramp references remain in `plugins/finance/`; both JSON files are valid.

To restore: recover from git history and wire via the pax8/pandadoc `.mcp.json` pattern
once Ramp ships an official MCP server.

### Marketplace keyword parity fix (all 12 plugins)

Keyword lists in `.claude-plugin/marketplace.json` were out of sync with the corresponding
`plugin.json` files in four plugins. Brought all 12 into parity.

- `finance` marketplace entry: added missing keywords `pax8`, `pandadoc`.
  (`.claude-plugin/marketplace.json`)
- `it-operations` marketplace entry: added missing keyword `endpoint`.
  (`.claude-plugin/marketplace.json`)
- `security-compliance` marketplace entry: added missing keyword `email-security`.
  (`.claude-plugin/marketplace.json`)
- Verified: all 12 plugins now have matching keyword lists between `plugin.json` and
  `marketplace.json`; `marketplace.json` is valid JSON.

---

## 2026-06-22 -- atlas plugin Phase 1 optimization (hook contract, manifests, reliability guidance)

### Hard contract: atlas hooks are advisory-only, never approval-blocking

Atlas hooks now carry a non-negotiable contract: no hook emits `permissionDecision` and no hook
exits with code 2 to block a tool call. The only permitted influence channels are
`additionalContext` (factual, advisory) and a one-time fail-open `Stop`-event reminder.
Verified by independent smoke tests and atlas:verifier pass (see
`docs/evidence/2026-06-22-atlas-hook-contract.md`).

- `plugins/atlas/hooks/bash_guard.py` renamed to `bash_advisor.py` and rewritten advisory-only.
  (`plugins/atlas/hooks/bash_advisor.py`)
- `bash_advisor.py` now emits `additionalContext` ONLY on catastrophic, near-irreversible
  commands (`rm -rf /`, fork bomb pattern, `mkfs`, `dd` to a raw disk device). The prior "ask"
  list (`sudo`, force push, `curl|sh`) was removed -- those are not near-irreversible.
  (`plugins/atlas/hooks/bash_advisor.py`)
- `hooks.json` updated to wire `bash_advisor.py` under `PreToolUse` for `Bash`.
  (`plugins/atlas/hooks/hooks.json`)
- `session_boot.py`: strengthened the orchestrator-delegation statement injected at `SessionStart`,
  making the delegation intent explicit.
  (`plugins/atlas/hooks/session_boot.py`)
- `completion_gate.py`: docstring corrected from "opt-in" to "opt-out" (on by default when
  `docs/` exists; disable with `ATLAS_GATE=off`). Behavior unchanged: one-time, fail-open
  `Stop` reminder.
  (`plugins/atlas/hooks/completion_gate.py`)

### Stale "orchestrate" output tokens replaced with "atlas"

All wired hooks and scripts that emitted `[orchestrate ...]` prefixes in their `additionalContext`
or log output now emit `[atlas ...]`. `install_hooks.py` updated accordingly.
Zero residuals confirmed by grep across `plugins/atlas/hooks/`, `plugins/atlas/scripts/`, and
`plugins/atlas/skills/.claude-plugin/`.
(`plugins/atlas/scripts/install_hooks.py`)

### Manifest accuracy: 18-agent count, new launchers, version bump to 1.1.0

- `plugin.json` and the marketplace.json atlas entry now correctly state "18-agent subagent squad"
  (disk count confirmed: 18 agents under `plugins/atlas/agents/`; prior claim was 14).
  (`plugins/atlas/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`)
- Both manifests enumerate all launchers including `atlas-prompt` and the new `atlas-validate`.
  (`plugins/atlas/.claude-plugin/plugin.json`)
- Marketplace top-level description changed from "the orchestrate multi-agent coding meta-agent"
  to "the atlas multi-agent coding meta-agent".
  (`.claude-plugin/marketplace.json`)
- Atlas plugin version bumped from 1.0.1 to 1.1.0.
  (`plugins/atlas/.claude-plugin/plugin.json`)
- `plugins/atlas/README.md` reconciled to match manifest claims.
  (`plugins/atlas/README.md`)

### New launcher: atlas-validate

`plugins/atlas/skills/atlas-validate.md` added. Drives `plugin-dev:plugin-validator` and
`plugin-dev:skill-reviewer` over a target plugin, providing structured quality gates without
requiring the full atlas orchestration path.
(`plugins/atlas/skills/atlas-validate.md`)

### Reliability guidance added (path verification, ToolSearch-before-deferred, timeout+retry)

Grounded in error telemetry (claude-mem obs #14075): path/file-not-found errors account for
approximately 56% of all atlas session errors; timeouts are second; InputValidationError
accounts for approximately 6,800 occurrences. Three mitigations documented:

- **Path-exists verification** -- agents must confirm a path exists before using it as an
  argument to any tool.
- **ToolSearch before deferred/MCP tool calls** -- any tool whose schema is not loaded (deferred
  in the harness) requires a `ToolSearch` call before invocation; calling without the schema
  produces `InputValidationError`.
- **Timeout and retry** -- long-running tool calls should set explicit timeouts and retry once
  on transient failure before escalating.

Added to:
(`plugins/atlas/references/verification-and-grounding.md`,
`plugins/atlas/references/subagent-kit.md`,
`plugins/atlas/agents/explorer.md`,
`plugins/atlas/agents/implementer.md`)

### Phase 3 -- finance connectors wired, productivity/nudge made standalone, ASCII normalization complete (shipped 2026-06-22)

#### finance plugin: pax8 + pandadoc connectors wired

`plugins/finance/.mcp.json` created with two remote connector entries. Pax8 uses
`https://mcp.pax8.com/v1/mcp` with an `x-pax8-mcp-token` header; pandadoc uses
`https://developers.pandadoc.com/mcp` with an `Authorization: API-Key` header; both
transport via the `npx mcp-remote` stdio pattern.

`plugins/finance/.claude-plugin/plugin.json` updated: `"mcpServers": "./.mcp.json"`
added; `userConfig` block declares `pax8_mcp_token` and `pandadoc_api_key` (both
marked sensitive); version bumped 1.3.0 -> 1.4.0; pax8 and pandadoc keywords added.
Finance README and CONNECTORS documentation updated.

Verified: userConfig keys match the `${user_config.*}` references in `.mcp.json`
exactly; both JSON files are valid.

- `plugins/finance/.mcp.json` (created)
- `plugins/finance/.claude-plugin/plugin.json` (version 1.3.0 -> 1.4.0)

Remaining caveat: the Ramp connector is NOT wired. Ramp has no documented public MCP
endpoint. The `ramp-*` skills remain available as API-pattern references only. Will
wire once Ramp publishes an official MCP endpoint.

#### productivity/nudge made standalone (macOS launchd dependency removed)

`plugins/productivity/commands/nudge.md` rewritten to remove the macOS launchd/plist
dependency. Install now scaffolds `~/.nudge` state and documents portable scheduler
options (cron, systemd, Task Scheduler). kick/eval/status subcommands run on demand
with no background daemon required. The command is now OS-agnostic.

- `plugins/productivity/commands/nudge.md`

#### ASCII normalization complete across all 12 plugins

All 12 plugins plus `plugins/_templates/` and `plugins/CLAUDE.md` normalized to pure
ASCII. Transformations applied: em/en dashes -> "-", arrows -> "->", box-drawing
characters -> "+", "-", "|", status emoji -> bracketed labels (e.g. "[PASS]"),
math symbols -> "<=", ">=", "+", "-", "x". Final scan confirms 0 non-ASCII codepoints
across all `plugins/**/*.md`.

- `plugins/_templates/` (all markdown files)
- `plugins/CLAUDE.md`
- All 12 plugin clusters (normalized in place)

#### Verification summary (2026-06-22 Phase 3)

- 362 frontmatter files parsed with PyYAML, 0 failures. Corruption class remains
  fully closed.
- 0 non-ASCII codepoints across all `plugins/**/*.md`.
- `plugins/finance/.mcp.json` and `plugins/finance/.claude-plugin/plugin.json` valid
  JSON; userConfig keys match `.mcp.json` `${user_config.*}` references exactly.
- `marketplace.json` lists 12 plugins matching disk.

---

### Phase 2 -- marketplace-wide hygiene (shipped 2026-06-22)

Validated all 12 marketplace plugins; corrected frontmatter corruptions and non-ASCII
characters across four plugin clusters; repaired stale references in root README.md and
plugin READMEs; re-verified 362 frontmatter files parse cleanly (0 failures).

- **Full plugin validation pass**: ran `plugin-dev:plugin-validator` across all 12 non-atlas
  marketplace plugins. `marketplace.json` matches disk exactly (12/12). The `.env.template`
  gap from obs #13987 was already resolved prior to this phase; all 10 connectors' vars
  are present. No new structural gaps found.
- **YAML frontmatter critical fixes (2 files)**: unquoted `description` values containing
  an internal colon-space sequence caused PyYAML parse failures. Fixed by wrapping in double
  quotes.
  (`plugins/finance/skills/ramp-api-patterns/SKILL.md`,
  `plugins/engineering/skills/dead-code-cleanup/SKILL.md`)
- **Non-ASCII frontmatter fixes (12 files)**: em dashes and right-arrow characters inside
  YAML frontmatter blocks replaced with ASCII equivalents across four plugin clusters:
  hr-payroll, finance, engineering, data. All 12 files now pass PyYAML parse.
- **Root README.md stale references fixed**: removed all remaining `orchestrate` plugin
  references; corrected broken link `plugins/orchestrate` -> `plugins/atlas`; updated
  counts to 15 launchers and 18 subagents.
  (`README.md`)
- **plugins/it-operations/README.md name fix**: updated old "operations" plugin name to
  current name.
  (`plugins/it-operations/README.md`)
- **Leaked personal path removed**: a local filesystem path was removed from the install
  command in `plugins/productivity/commands/nudge.md`.
  (`plugins/productivity/commands/nudge.md`)
- **Re-verification**: 362 frontmatter files across all plugins re-parsed with PyYAML; 0
  failures. This closes the claude-mem obs #13947 corruption class.

---

## 2026-06-09 -- Shared response-quality layer, marketplace, skills consolidation

### Shared response-quality layer (mcp_servers/_shared/)

All 10 MCP servers adopted a shared response-quality layer shipped in `mcp_servers/_shared/`. Three modules:

- **response-shaper** -- list/get tools now default to compact summaries. Callers can pass `fields=[...]` to select
  specific fields or `full=true` to get the raw vendor payload. This eliminated the ConnectWise
  context-flooding defect: a single `cw_list_tickets` response shrank from 158,777 bytes to 5,960 bytes
  (green vs. red in the harness) without losing any information the agent needs for triage.
- **error-envelope** -- all tool errors now return a structured object
  `{error:{code, message, detail, hint}}` instead of raw exception strings. The `hint` field names
  the env var to set, the endpoint to enable, or the vendor doc page to consult.
- **base-url** -- each server hardcodes its vendor's documented default base URL. The corresponding
  `<VENDOR>_BASE_URL` env var is optional -- missing/empty resolves to the default with no warning
  and no error. Manifest `user_config` entries updated to `"required": false`.

### ThreatLocker default base URL corrected

Default corrected from the old shard URL to `https://portalapi.g.threatlocker.com/portalapi`.
The `.env.template` comment and manifest description updated to match.

### Blumira auth surface expanded

`blumira-mcp` manifest now accepts `BLUMIRA_CLIENT_ID` / `BLUMIRA_CLIENT_SECRET` / `BLUMIRA_BASE_URL`
in addition to the original `BLUMIRA_JWT_TOKEN`. Default base URL is `https://api.blumira.com/public-api/v1`.

### Pack-script transitive-dependency filter

All 10 server `scripts/pack-mcpb.js` wrappers and `_shared/pack-mcpb.js` gained a filter that
prevents nested transitive dependencies of `file:`-linked `mcp_node` libraries from poisoning
the bundle's `node_modules`. Bundles are now smaller and reproducible across machines.

### Manifest version bumps

All 10 server `manifest.json` files were version-bumped to reflect the response-quality surface change.
Current versions: auvik 0.4.0, blumira 1.1.0, cipp 0.2.0, connectwise-manage 0.1.0,
kaseya-spanning-backup 1.1.0, knowbe4 1.1.0, ninjaone 1.6.0, paylocity 0.1.1,
threatlocker 1.2.0, vanta 0.2.0.

### Status tools boot without credentials

Every server's `<vendor>_status` tool now boots and returns a structured status report even when
credentials are absent. The report names which env vars are missing and which endpoints to configure.

### Verified tool counts (2026-06-09)

auvik 39, blumira 30, cipp 43, connectwise 52, kaseya-spanning 14, knowbe4 30,
ninjaone 26, paylocity 16, threatlocker 17, vanta 28.

### Plugin marketplace (26 plugins + minutes)

`.claude-plugin/marketplace.json` created at the repo root, listing 26 plugins with name, source
path, description, category, and keywords. The `plugins/minutes` plugin (contains a nested Rust
application) is excluded from marketplace auto-install and documented separately.

All plugin `plugin.json` manifests normalized to a consistent structure.

### Skills consolidated 25 -> 13

The `skills/` directory was pruned from 25 skills to 13. New skills added: `msoffice-docs`,
`database-optimization`, `security-audit`. Skills merged into survivors: `codeql` and
`pytest-coverage` -> `security-audit`; `prompt-optimizer` and `self-improving` ->
`orchestrate` (as referenced sub-patterns). Remaining retirements had overlapping scope
with the 13 survivors.

Final 13: `az-cost-optimize`, `azure-deployment-preflight`, `cloud-design-patterns`,
`codebase-brain`, `database-optimization`, `entra-agent-user`, `graphify`, `msgraph-sdk`,
`msoffice-docs`, `orchestrate`, `scrapling-official`, `security-audit`, `webapp-testing`.

---

## 2026-06-02 -- Prompt-optimizer hook

- `UserPromptSubmit` hook wired in `always` mode, routing non-trivial prompts through local
  ollama `prompt-optimizer:latest` before they reach the main session.
- Two follow-ups deferred: command collision with the existing `/prompt-optimizer` skill, and
  whether `always` mode latency (~25-45s per first turn) warrants switching to `trigger` mode.

---
