# CHANGELOG

Append-only, newest-first. Every atlas run appends what it did or changed
here so the project has a durable audit trail.

## Template

Each entry uses this shape:

```
## YYYY-MM-DD - <skill> - <one-line summary>
- What changed (file:line or artifact path)
- Evidence (command run + result, or link to evidence capture)
- Verdict (pass/fail/in-progress)
```

## Entries

<!-- Newest entries go at the top. atlas-olympus scaffolds this file;
     subsequent atlas skills append to it. -->

## 2026-07-13 - atlas:docs-curator - zero-defect hardening complete: all batches verified, coverage 17%->98% hooks / 63%->99% scripts

- Final state (fresh gates this session): hooks `Ran 365 tests in 4.012s, OK`; scripts `Ran 502 tests in 0.659s, OK` (867 total, up from 495). Coverage: hooks TOTAL 3962 63 98%; scripts TOTAL 6708 40 99%. `ruff check plugins/atlas/hooks plugins/atlas/scripts` -> `All checks passed!`. `npx pyright plugins/atlas/hooks plugins/atlas/scripts` -> `0 errors, 0 warnings, 0 informations`. Coverage bars MET (lines/functions/branches/statements all >=85).
- Batches now verified (findings.json: 14/14 "verified"): 1, 2a, 2b, 2c, lint-zero, 3a, 3b, 4 (coverage-lift, folded into 4a-1/4a-2/4b-1/4b-2), 4a-1 (6 zero-coverage hooks -> 96%), 4a-2 (4 partial hooks -> 97-100%), 4b-1 (5 lowest scripts -> 99-100%), 4b-2 (7 mid scripts -> 99-100%), pyright-cleanup (pyrightconfig.json extraPaths + 18 test errors cleared), dry-rounds (K=3 consecutive clean + bars met). See .atlas/docs/.run/findings.json.
- Batch 3a (frontmatter): 10 SKILL.md files fixed (missing closing `---`) and `test_valid_frontmatter` added. Evidence: .atlas/docs/evidence/batch-3a-verification.md.
- Batch 3b (pyright types): `plugins/atlas/scripts/test_session_ingest.py:614` int-iterable, `plugins/atlas/scripts/verify_install_hooks.py:41-42` ModuleSpec|None, `plugins/atlas/scripts/atlas_db.py:656-658` Literal['agent'] resolved; pyrightconfig import-resolution added. Evidence: .atlas/docs/evidence/batch-3b-verification.md.
- Batch 4a/4b (coverage): 4 false-green test files fixed (test_dispatch_tripwire, test_nudge, test_session_boot_db, test_prompt_classifier); tests added for previously untested hooks/scripts. Per-batch evidence: .atlas/docs/evidence/batch-4a-1/4a-2/4b-1/4b-2-verification.md.
- pyright-cleanup: pyrightconfig.json extraPaths (atlas_db/scaffold_docs/atlas_memory import-resolution), 18 test errors cleared. Evidence: .atlas/docs/evidence/pyright-cleanup-verification.md.
- Law 5 (verifier on every shipping change) enforced throughout: every batch closed by a fresh atlas:verifier pass captured in findings.json and the evidence files above. The Law 5 dispatch site lives at plugins/atlas/scripts/atlas_db.py (`_dispatch_coverage_counts` / `is_shipping_agent`).
- LIVE ACTION ITEM (not closed): the installed marketplace plugin (5.0.0) is stale vs this working tree. It must be `/reload-plugins`'d (or reinstalled) so the live Stop hook runs the fixed `.atlas/docs`-resolving completion_gate. Tracked in .atlas/docs/ROADMAP.md.


## 2026-07-12 - atlas 5.0.0 ship - retire mythology names, consolidate 27 skills to 21, split armada, add runtime-evidence gate

Breaking release, commit ad7313c (2026-07-12 09:17:45 -0400). Recorded in
plugins/atlas/CHANGELOG.md `## 5.0.0 (2026-07-12)` and docs/CHANGELOG.md
`Atlas v5.0.0` entry (line 31); this SSOT entry mirrors those. Driven by
forensics on a 4.7-hour production session (38 dispatches, 1 skill
auto-invocation): the mythological names never routed, the fleet was 3x
its working set, and verifiers confirmed changes the running app
contradicted.

- Mythology retired; fleet collapsed 27 -> 21 skills. Renames:
  atlas-metis -> atlas-orchestrate, atlas-chronos -> atlas-loop,
  atlas-odysseus -> atlas-ux-test. Merges: atlas-athena + atlas-ariadne
  + atlas-argus -> atlas-audit (code/architecture/self modes; demoted
  bodies live on as references/architecture-map.md and
  references/self-telemetry.md). atlas-olympus + atlas-hephaestus
  + atlas-hermes + atlas-doctor -> atlas-setup
  (onboard/install/connectors/repair modes; scripts/atlas_doctor.py
  unchanged, still wired at SessionStart). atlas-nestor (skill-stacking
  concierge) deleted: a concierge over a smaller fleet is routing
  overhead.
- armada split into its own plugin (`plugins/armada`, v1.0.0): the 3.0 MB
  org-deployment tree and 11 armada-* department agents moved out of
  atlas; atlas alone now carries 12 core agents. New marketplace entry.
- Runtime-evidence gate added. agents/verifier.md:17 requires runtime
  parity for a `verified` verdict (atlas:ui-runtime-tester pass or
  observed live behavior for user-facing changes; migration parity for
  schema-touching backend changes; `create_all`/in-memory SQLite suites
  do not count). The atlas-orchestrate definition-of-done mirrors this
  at plugins/atlas/skills/atlas-orchestrate/SKILL.md:127. Motivated by
  the mined session where backend gates ran against in-memory SQLite
  while dev sat at migration rev 129.
- Law 2 hardened: any wave with more than one writing agent uses
  `isolation: "worktree"` per writer or serializes; "they touch
  different files" is not an exemption.
- Manifests made honest: plugin.json, .kimi-plugin/plugin.json,
  marketplace.json, README.md, and setup references
  (skill-routing.md, manual-vs-auto-map.md, recommendation-engine.md)
  rewritten for the 21-skill fleet; stale 18-file commands/ claim
  removed from README.
- dispatch_tripwire.py ORCH_SKILLS and atlas_context_optimizer.py
  CORE/NICHE lists deduplicated for the merged names; optimizer tests
  updated (atlas-wiki replaces atlas-nestor as the niche fixture).
- Source: commit ad7313c; plugins/atlas/CHANGELOG.md 5.0.0 entry;
  docs/CHANGELOG.md 2026-07-12 v5.0.0 entry.

## 2026-07-12 - atlas:docs-curator - zero-defect loop: Batch 1, 2a, 2b, 2c, lint-zero verified; 3a/3b/4/dry remaining

- Batch 1 (5 HIGH defects) verifier: CONFIRMED. Files: plugins/atlas/scripts/atlas_db.py (is_shipping_agent + _dispatch_coverage_counts for Law 5 (g)); plugins/atlas/scripts/atlas_context_optimizer.py (used-set no fail-open); plugins/atlas/hooks/auto_skill.py (skill_factory errors to stderr + non-zero exit); plugins/atlas/hooks/memory_capture.py (_resolve_scope + _in_clause multi-session orbit); plugins/atlas/references/operating-contract.md (promoted to plugin-level, 14 SKILL.md updated to ${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md).
- Batch 2a (6 MEDIUM hook defects M1-M8) verifier: CONFIRMED. Files: plugins/atlas/hooks/completion_gate.py (fail-closed malformed findings.json + git subprocess error); plugins/atlas/hooks/dispatch_tripwire.py (notebook_path + inline_ops fail-closed); plugins/atlas/hooks/session_boot.py (empty session_id guard); plugins/atlas/hooks/memory_capture.py (atlas_memory.add error surfaced); plugins/atlas/hooks/nudge.py (is_orchestrating DB error no spurious nudge); plugins/atlas/hooks/bash_advisor.py (long-flag rm detection). New plugins/atlas/hooks/test_bash_advisor.py.
- Batch 2b (7 MEDIUM script defects M10-M22) verifier: CONFIRMED. Files: plugins/atlas/scripts/scaffold_docs.py (idempotent no-op + dual-SSOT warning); plugins/atlas/scripts/skill_factory.py (cleanup-on-failure + sqlite3 error surfaced); plugins/atlas/scripts/atlas_curator.py (corrupt state-file logged + failures surfaced); plugins/atlas/scripts/atlas_context_optimizer.py (disable/enable OSError surfaced); plugins/atlas/scripts/session_ingest.py (11 silent-pass sites now report skipped-count); plugins/atlas/scripts/install_hooks.py (missing-file error surfaced); plugins/atlas/scripts/atlas_doctor.py (trash/telemetry caps + maintenance log). New test_scaffold_docs.py, test_session_ingest.py, test_install_hooks.py; extended test_atlas_doctor.py.
- Batch 2c (skill-reference conformance M16-M18) verifier: CONFIRMED. Files: 4 dangling cross-skill reference targets copied into referencing skill references/ (workflow-template.md, self-telemetry.md, graphify-wiring.md, docs-ssot.md) and rewritten to ${CLAUDE_SKILL_DIR}/references/<file>; atlas-orchestrate session-lifecycle.md disambiguated; 7 bare plugin-script references prefixed with ${CLAUDE_PLUGIN_ROOT}/scripts/. Extended plugins/atlas/scripts/test_skill_agent_conformance.py.
- Lint-zero verifier: CONFIRMED. ruff 23 -> 0 across hooks + scripts (behavior-preserving import/var cleanup).
- Evidence: .atlas/docs/evidence/batch-1-2-verification.md; .atlas/docs/.run/findings.json (batch 1, 2a, 2b, 2c, lint-zero status "verified"; 3a/3b/4/dry status "unverified").
- IN PROGRESS: Batch 3a (frontmatter fix on 10 skills + test_valid_frontmatter), 3b (Pyright type cleanup), 4 (coverage 85/85/75/85 + fix 4 false-green test files + add tests for 5 untested hooks), dry rounds (atlas:completeness-critic K=3 consecutive clean) remain. Do NOT mark done.

## 2026-07-11 - skills-mastery-rebuild - Run complete: all 11 departments verified, S8 + S10 verified

The 184-skill fleet rebuild is complete and verified. All 11 armada
departments (S7) are verified green, the .atlas/docs scaffold (S8) is
verified, and the S10 content fixes (security audit-rubric directive,
engineering Sentry allowed-tools, manual-vs-auto-map atlas-wiki, metis
em-dash) are verified. The only remaining items are advisory: 9 reserved
placeholder directories with 0-line SKILL.md files that will not
auto-trigger (3 hr, 5 finance, 1 engineering).

- S7 armada all 11 departments CONFIRMED: design, productivity, data,
  it-ops, support, finance, hr, security, engineering, m365, product.
  No `triggers:` field remains; every skill has when_to_use; validator
  clean; the split skill under 500 lines.
- S8 .atlas/docs scaffold verified: 12 durable subfolders exist;
  CHANGELOG, ROADMAP, AGENTS.md non-empty.
- S10 content fixes verified: 3 security SKILL.md gained L2 read-directive
  to references/audit-rubric.md; 5 engineering Sentry skills had
  allowed-tools corrected to mcp__io_github_getsentry_sentry-mcp__*;
  manual-vs-auto-map.md updated with atlas-wiki (28 top-level);
  metis em-dash fixed.
- 9 reserved placeholder dirs (advisory): hr (new-hire-flow,
  pay-rate-audit, roster-snapshot), finance (ramp-api-patterns,
  ramp-bill-vendor-reconciliation, ramp-card-controls,
  ramp-reimbursement-review, ramp-spend-triage), engineering
  (sonarqube-quality-gate).

Evidence: .atlas/docs/.run/findings.json (S7 all 11 departments status
"verified", S8 "verified", S10 "verified").

## 2026-07-11 - skills-mastery-rebuild - Waves 1 and 2 verified (S1, S2, S3, S4, S5a, S5b, S6, olympus-cleanup)

Incremental reconcile of the 184-skill fleet to the Skills Mastery
Framework standard. Waves 1 and 2 are verified by a fresh atlas:verifier.
Wave 3 (S7 armada, S8 scaffold) and S10 are now also verified; see the
completion entry above.

- S1 olympus rebuilt: SSOT self-referential bug fixed; references/
  mastery-framework.md and references/manual-vs-auto-map.md added;
  scripts/scaffold_docs.py scaffolds the 12-folder .atlas/docs/ tree
  (idempotent, exit 0); disable-model-invocation: true at
  plugins/atlas/skills/atlas-olympus/SKILL.md:5. Verifier: 9/9 claims
  reproduced.
- S2 gate flips: exactly 2 manual (olympus, doctor), 26 auto; all 26
  auto skills have when_to_use; no `triggers:` field. Verified by grep
  for disable-model-invocation across plugins/atlas/skills/*/SKILL.md
  (returns only atlas-doctor/SKILL.md and atlas-olympus/SKILL.md).
- S3 batch A (metis, ariadne, athena, argus, nestor, hephaestus,
  chronos): references/scripts/templates added; context:fork set on the
  research/isolation skills; metis em-dashes fixed. Verifier: 10/10.
- S4 batch B (hermes, odysseus, armada, vendor-assessment, db-audit,
  readme, doctor): supporting files present; plugin-health.py reports
  184 skills / 23 agents, exit 0. Verifier: 11/11.
- S5a batch C-1 (prompt, launch, handoff, harden, gitignore, feature):
  validate scripts pass (validate_gitignore.sh 4 cases,
  validate_harden_script.sh 3 cases); zero-trust gitignore seed intact;
  prompt 7-section spec present. Verifier: 10/10.
- S5b batch C-2 (debug, refactor, frontend, component, validate, m365):
  descriptions lead with trigger phrases; m365 has 12-plus
  learn.microsoft.com citations; validation-gate.md is a real 3-gate.
  Verifier: 8/8.
- S6 atlas-wiki producer added (top-level now 28): scripts/
  check_wiki_freshness.sh emits FRESH/MISSING/STALE (exits 0/0/1);
  graphify flags grounded in the graphify SKILL.md. atlas-wiki SKILL.md
  is 198 lines, auto-trigger. Verifier: load-bearing claims CONFIRMED.
- olympus-cleanup: `import os` removed; allowed-tools corrected to
  Bash(python3:*); scaffold 12/12 idempotent. Verifier: 7/7.

Evidence: .atlas/docs/.run/findings.json (stages S1, S2, S3, S4, S5a,
S5b, S6, olympus-cleanup all status "verified", verifier_verdict
"confirmed").

## 2026-07-11 - skills-mastery-rebuild - S7 armada partial verification (design, productivity, data, it-ops, support, finance, hr)

Per-department verifier verdicts from findings.json S7 (status
in_progress, verifier_verdict partial):

- design CONFIRMED 7/7 (8 skills, max 319 lines).
- productivity CONFIRMED 8/8 (9 skills, pdf MCP confirmed, Write scoped
  to 3 file-writers).
- data CONFIRMED 8/8 (7 skills; interactive-dashboard-builder split
  786->235 lines plus a 647-line reference; content moved not deleted;
  no reference chains).
- it-ops CONFIRMED 10/10 (27 skills; all 4 MCP wildcards match real
  .mcp.json names auvik/ninjaone/connectwise/spanning; restore-orchestrator
  AUTO).
- support CONFIRMED 8/8 (5 skills; both reference extractions genuine:
  article-templates 127 lines, triage-rubric 115 lines; linked one level
  deep; no chains).
- finance CONFIRMED 8/8 (17 skills; audit-support 5-way split: 80-line
  SKILL.md plus 5 refs at 68/75/82/91/129 lines; no `triggers:`; no
  mcp__; max 358 lines).
- hr CONFIRMED (10 skills; paylocity and context-mode MCP prefixes
  confirmed against .mcp.json and the live tool list; 3 refs at 115/89/98
  lines; ADVISORY: 3 empty placeholder dirs new-hire-flow, pay-rate-audit,
  roster-snapshot have 0-line SKILL.md, superseded by paylocity skills,
  cannot auto-trigger, routed to S10 cleanup).

In-progress (NOT done):
- m365 implementer returned (19 skills; triggers removed; scoped
  allowed-tools cipp/microsoft-graph/microsoft-docs; 19 references/
  microsoft-graph-api.md with 53 MS Learn citations; max 243 lines);
  V-S7-m365 verifier dispatched, running.
- security (24 skills) and engineering (16 skills): implementer
  complete, verifiers in flight.
- product department: implementer in flight.