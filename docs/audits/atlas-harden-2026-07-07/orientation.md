# Atlas Harden Audit - Orientation (Step 0)

Date: 2026-07-07. Run: wf_26eaa706-0ca (read-only, 10 agents, 0 errors).
Raw tier reports: orient-result.json (same folder). No plugin file was written or modified.

## Orientation

- Plugin v2.6.0. Repo copy: plugins/atlas. Installed copy: ~/.claude/plugins/cache/tech-tools/atlas/2.6.0 (lastUpdated 2026-07-06, one commit stale: atlas-grafana.md removal bbd6adb not yet synced; self-heals on reinstall).
- 10 skills present, including atlas-sextant and atlas-stacks. 18 agents, 18 commands, 13 hook entries across 8 event types, 6 scripts referenced by hooks all present.
- Known defect 1 (atlas-sextant dangling): RESOLVED since the prior skills-only audit. SKILL.md exists with valid frontmatter, all invoked scripts exist, all 31 sextant references resolve. No action needed.
- Known defect 2 (UX swarm duplication): CONFIRMED. atlas-expedition is the routed canonical owner (capability-routing.md sends all UX work there; ux-test-swarm.md carries a CANONICAL HOME banner). The five ux-* agents are unrouted duplicates of the same 6-phase/3-gate model.
- REFUTED by Tier 2 (evidence in orient-result.json .result.plan.refuted): the "81 dangling references/*.md" claim (agent checked the vestigial empty top-level references/ dir; actual files live skill-relative and all resolve); "api-usage-map completely orphaned" (roster mentions exist); atlas-grafana divergence as a defect (intentional committed removal); missing mcpServers block (by-design zero-connector posture); atlas-expedition "missing harness" (runtime-generated artifacts).
- SURVIVING defects: capability-routing.md Step 2 lacks rows for atlas-architect, atlas-engine, atlas-stacks; routing table dispatches codebase-explorer/Explore/Plan which are external agent types, unannotated; 4 of 18 agent specs lack a Report-back return schema; 9 of 18 lack hallucination controls (permit "I don't know" / cite / mark [unverified]); atlas_doctor reports 2 failures (marketplace-source and clone-remote point at henssler-financial/tech-tools, expected w159/tech-tools); uncommitted .kimi-plugin/marketplace.json + plugins/README.md changes undocumented in CHANGELOG; dev-artifact dirs untracked-but-present.
- Mission assumption correction: hooks.json holds 13 hook entries over 8 event types, not 8 hooks. The 8-hooks DoD line is reinterpreted as "all hook entries load and fail open" and verified behaviorally in Stage 2.

## Amended stage map (planner stages 1-12 + critic gaps folded in)

Read-only (no gate): 
1. Reference-integrity gate, WIDENED: every references/*.md citation (skill-relative + CLAUDE_PLUGIN_ROOT) AND every agent-name reference in capability-routing.md, agents/, hooks.json, plugin.json; external types (Explore, Plan, codebase-explorer) resolved against the global registry or flagged for annotation. Check: resolver script exits nonzero on any miss.
2. Hook behavioral check, STRENGTHENED: all 13 entries load; dispatch_tripwire.py, completion_gate.py, prompt_optimizer.py executed with synthetic payloads forcing an internal exception, assert exit 0 (fail-open); assert gates no-op without the orchestration marker and engage with it.
3. Connector-inert check: 10 vendor .mcpb in the 4 owning domain plugins, atlas ships zero, no literal secrets.
4. Fable-5 RED capture: 4/18 agents missing Report-back (loop demo red state) + NEW: 9/18 missing hallucination controls + four-part-brief check across skill dispatch examples (residue listed [unverified] if ambiguous) + standing-consent sole-ownership grep (hits outside skills/atlas-engine/ = fail).

Gated writes (require approval below):
5. LOOP-FIX: add Report-back schemas to api-usage-map, schema-inventory, naming-glossary-audit, rls-privilege-audit (fresh implementer context).
6. LOOP-VERIFY: independent verifier context re-derives the check, confirms 0/18 missing (completes red -> fix -> verify across three contexts).
7. Routing rows for atlas-architect, atlas-engine, atlas-stacks; annotate external agent types.
8. UX ownership fixed in place: atlas-expedition sole dispatcher; ux-test-swarm.md + five ux-* agents marked reference-only (no deletions in this stage). NEW: trace expedition harness-generation logic or list [unverified].
9. NEW: hallucination-control language added to the 9 nonconformant agent specs (same three-tier loop pattern).
10. .gitignore re-exclusions for .kimi-plugin/, .pytest_cache/, .ruff_cache/, scripts/.claude/ (allowlist methodology, re-exclusions after allowlist).
11. Marketplace-source reconciliation (BLOCKED on upstream decision below), then atlas_doctor 0 problems.
12. Commit/CHANGELOG reconciliation of the pending marketplace.json + README.md changes.
13. Rollup: decision records (incl. per-candidate removal dispositions), fable-5 residue list, CHANGELOG, re-runnable audit record.

## Removal candidates (ranked; NOTHING deleted without explicit approval)

1. plugins/atlas/references/ (empty top-level dir). Blast: none; nothing routes to it; source of the refuted false alarm.
2. agents/ux-*.md (5 files). Blast: medium; roster + SKILL.md references must be struck first; Stage 8 mark-reference-only is the non-destructive alternative.
3. agents/api-usage-map.md. Blast: low-medium; DB-audit companion with latent value; keep-and-fix recommended over deletion.
4. .kimi-plugin/, .pytest_cache/, .ruff_cache/, scripts/.claude/. Blast: none; prefer gitignore (Stage 10) over deletion.

## Open decisions blocking writes

A. Approve gated write stages (5-13)?
B. Per-candidate removal disposition (delete / keep / defer) for the 4 candidates.
C. Canonical upstream: w159/tech-tools (atlas_doctor expectation) vs henssler-financial/tech-tools (current clone remote) vs keep the uncommitted local-relative-path scheme. Blocks stages 11-12.
