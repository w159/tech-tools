# Plan: atlas skills mastery rebuild (full 184 in one pass)

## Decisions (locked by user)
- Scope: full 184 skills (28 top-level + 156 armada) rebuilt to mastery standard in one orchestrated run.
- Repo-root `skills/` (12): leave in place; wire the plugin to invoke graphify + webapp-testing from there.
- Manual invocation: ONLY atlas-olympus + atlas-doctor. All other 26 top-level + 156 armada = auto-trigger.
- Note: S6 added atlas-wiki, bringing top-level to 28 and total to 184.

## Ground truth (from wave 1 explorers, cited)
- 28 top-level avg 7.5/12 mastery. 21/28 zero supporting files. 0/28 use allowed-tools/paths/context/agent/model/effort/user-invocable. Zero scripts/templates anywhere. (E2)
- 7 capability skills wrongly gated manual: debug, feature, refactor, frontend, component, validate, m365. (E2)
- olympus covers 11 of 28; no mastery-framework reference; no manual-vs-auto map; no scripts/templates/evals; self-referential SSOT bug at SKILL.md:3,25,70-72. (E3)
- .atlas/ exists but EMPTY. graphify consumed by ariadne, no producer. wiki/ named, never populated. (E4)
- 156 armada: 8/156 have any supporting file, 0 templates, 0 use disable-model-invocation/allowed-tools/paths, 64 use atlas-invented `triggers:` field (NOT a real CC frontmatter field - inert), 92 lack when_to_use, 1 over 500 lines (data/interactive-dashboard-builder 786L). (E5)
- Repo-root skills/ (12) = intentional cross-agent staging, tracked, .gitignore allowlisted, inert in CC. (E1)

## Mastery framework standard (applied to every skill)
Frontmatter: name + description (third-person, what+when, key use first, <1024c) + when_to_use (trigger phrases); disable-model-invocation only for olympus/doctor; allowed-tools pre-approve safe tools; paths glob-activate by file pattern where relevant; argument-hint for parameterized skills; context:fork+agent for research/isolation skills.
Body: SKILL.md <500 lines; reference material split to references/*.md linked one level deep; deterministic operations as scripts/ using ${CLAUDE_SKILL_DIR}; templates/ for generated artifacts; "run X" vs "see X" disambiguated.
Auto-trigger: description carries the natural-language keywords; NO reliance on `triggers:` (inert).

## Stage map (numbered; each stage has one failable check + agent + model + verify)

### S1 Foundation: rebuild atlas-olympus as mastery-enforcing onboarding layer [implementer, sonnet]
- Fix SSOT self-referential bug (SKILL.md:3,25,70-72).
- Add references/mastery-framework.md (the L1-L3 + frontmatter standard above).
- Add references/manual-vs-auto-map.md: all 28 top-level + 156 armada, 2 manual / rest auto, per-skill.
- Add scripts/scaffold_docs.py: scaffolds .atlas/docs/ durable tree from templates/.
- Add templates/: CHANGELOG.md, ROADMAP.md, AGENTS.md, evidence/.gitkeep, architecture/README, wiki/README, specs/README, lessons/README, audits/README, features/README, reference_files/README, plans/README.
- Wire graphify producer: references/graphify-wiring.md describing how plugin skills invoke repo-root graphify to render .atlas/docs/wiki/ diagrams; add to olympus recommendation + completion-gate freshness.
- Flip olympus frontmatter to disable-model-invocation: true (manual).
- Surface atlas-doctor as the recovery path in the onboarding flow.
- Check: olympus SKILL.md passes plugin-dev:plugin-validator + references the mastery framework + lists all 28 skills with manual/auto flags + scaffold_docs.py runs and creates the tree.

### S2 Gate flips: 28 top-level frontmatter [implementer, sonnet]
- Only olympus + doctor keep disable-model-invocation:true. Remove it from the other 15 currently-manual skills (debug, feature, refactor, frontend, component, validate, m365, prompt, launch, handoff, readme, gitignore, vendor-assessment, db-audit, harden).
- Add allowed-tools (safe read-only tools) and paths globs where the skill has an obvious file affinity (frontend->.tsx/.css, component->components/**, db-audit->**/*.sql, gitignore->.gitignore, readme->README.md).
- Add argument-hint to parameterized skills (prompt, launch, handoff, feature, refactor).
- Check: grep -L disable-model-invocation across the 26 auto skills returns empty; olympus+doctor retain it; plugin-dev:plugin-validator clean.

### S3 Top-27 resource enrichment, batch A [implementer, sonnet] - skills: metis, ariadne, athena, argus, nestor, hephaestus, chronos
- Add references/scripts/templates per mastery standard; set context:fork+agent on the research/isolation skills (ariadne, athena, argus, nestor) so they run in subagents not inline.
- Check: each skill has >=1 supporting file where it adds value; SKILL.md <500L; references linked one level deep.

### S4 Top-27 resource enrichment, batch B [implementer, sonnet] - skills: hermes, odysseus, armada, vendor-assessment, db-audit, readme, doctor
- hermes: vendors.md already exists; add templates/ for connector manifests. odysseus: add scripts/ for UX-swarm driver. armada: add templates/ for department onboarding. readme: add templates/README.seed.md. doctor: add references/ for the checks matrix. vendor-assessment/db-audit: add references/ + scripts/.
- Check: per-skill supporting files present and referenced from SKILL.md.

### S5 Top-27 resource enrichment, batch C [implementer, sonnet] - skills: prompt, launch, handoff, harden, gitignore, feature, debug, refactor, frontend, component, validate, m365
- prompt: add references/prompt-spec-template.md. launch/handoff: add templates/ for handoff + launch artifacts. harden/gitignore: add templates/ + scripts/validate_gitignore.sh. feature/debug/refactor/frontend/component/validate/m365: add references/ (workflow + checklist) and templates/ where they produce artifacts; these are the 7 un-gated auto skills, so descriptions must carry strong natural-language trigger keywords.
- Check: descriptions lead with the key use case + trigger phrases; each skill >=1 supporting file; <500L.

### S6 Graphify + wiki producer [implementer, sonnet]
- Create a new auto-trigger skill OR a hook + reference that invokes the repo-root graphify skill to generate .atlas/docs/wiki/ diagrams from .atlas/docs/architecture/ + ariadne graph.json. Add a wiki-freshness check to the completion gate (or a cronos loop). Verify webapp-testing (repo-root) is invokable from atlas-odysseus.
- Check: graphify is invoked end-to-end and writes a diagram into .atlas/docs/wiki/; freshness check detects a stale wiki.

### S7 Armada frontmatter + resources, 11 department batches [11x implementer, sonnet, parallel]
- One implementer per department (design, it-operations, security, product, support, hr, finance, data, engineering, productivity, microsoft-365).
- Per department: (a) remove atlas-invented `triggers:` field, fold its keywords into description + when_to_use; (b) add when_to_use to the 92 skills lacking it; (c) add allowed-tools pre-approving the department's MCP tools; (d) for side-effecting vendor skills (restore-orchestrator, ticket-creation, deploy-*), evaluate disable-model-invocation - but user said only olympus+doctor manual, so keep them auto and instead rely on allowed-tools + the agent's gate; (e) add references/ to resource-heavy skills (api-patterns, interactive-dashboard-builder); (f) split data/interactive-dashboard-builder (786L) into SKILL.md + references/.
- Check per department: no `triggers:` field remains; every skill has when_to_use; plugin-dev:plugin-validator clean; the split skill <500L.

### S8 .atlas/docs scaffold + reconcile [docs-curator, sonnet]
- Run olympus scripts/scaffold_docs.py to create the durable tree from templates. Populate CHANGELOG/ROADMAP/AGENTS.md seeds. Move completed ROADMAP items to CHANGELOG with this run's evidence.
- Check: all 12 durable subfolders exist; CHANGELOG + ROADMAP + AGENTS.md present and non-empty.

### S9 Verify (per stage, fresh atlas:verifier) - the gate
- One verifier per implementer stage (S1-S7), fresh context, re-derives the check from the user's original directive (not the author's command). Reproduces: skill auto-triggers on a natural-language phrase (description match), manual gating correct (only olympus+doctor), supporting files linked one-deep, <500L, no inert `triggers:`, graphify end-to-end, .atlas/docs tree exists.
- Write findings.json entry per implementer->verifier pair.

### S10 Completeness critic + final docs reconcile [completeness-critic opus, docs-curator]
- Critic hunts missed skills, broken auto-trigger descriptions, stale refs. Docs-curator reconciles plugin CHANGELOG/ROADMAP/README + .atlas/docs.
- Check: 184 skills all pass mastery scorecard >=10/12; .atlas/docs current; completion gate green.

## Failable checks summary
- S1: scaffold_docs.py runs; olympus references mastery + full 28 map; validator clean.
- S2: 26 auto / 2 manual confirmed by grep.
- S3-S5: each top-level skill has supporting files, <500L, strong description.
- S6: graphify produces a wiki diagram end-to-end.
- S7: no `triggers:` remains; all armada skills have when_to_use; validator clean.
- S8: 12 durable subfolders exist.
- S9: independent verifier confirms each.
- S10: 184 skills >=10/12; docs current.

## Blast radius + rollback
- Writes: 184 skill SKILL.md + many new files under skills/*/; .atlas/docs/ tree; plugin CHANGELOG/ROADMAP/README. No source code outside the plugin. No dependencies. No migrations.
- Rollback: `git checkout -- plugins/atlas/skills plugins/atlas/agents plugins/atlas/CHANGELOG.md plugins/atlas/README.md .atlas/` restores prior state. All work is on main; consider a feature branch before starting (user decision).

## Open item
- Branch first or work on main? Recommend a feature branch `atlas-skills-mastery-rebuild` so the 184-skill change is reviewable before merge.