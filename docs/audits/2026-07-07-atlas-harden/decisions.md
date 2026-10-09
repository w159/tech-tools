# Decision record - atlas-harden 2026-07-07

Answers given by Jerry at the Step 0 gate (AskUserQuestion, this session):

1. Write stages 5-13: APPROVED, all of them.
2. Removals, DELETE approved for:
   - plugins/atlas/references/ (empty top-level dir)
   - agents/ux-cartographer.md, ux-persona.md, ux-fuzzer.md, ux-accuracy-oracle.md, ux-reporter.md
   - agents/api-usage-map.md (guarded: abort this one if a live skill/command dispatch is found at delete time)
   - dev-artifact dirs (.kimi-plugin, caches)
3. Canonical upstream: w159/tech-tools. atlas_doctor --fix repoints the marketplace clone remote. The uncommitted local-relative-path scheme in .kimi-plugin/marketplace.json is rejected and reverted.

Execution deviation (surfaced to Jerry in the same turn):
- Tracked .kimi-plugin/ marketplace content is RETAINED. It is committed feature content
  (Kimi Code CLI marketplace, commits 3fdca5a and 82bfb02), not a regenerable cache, so it
  does not match the "dev-artifact caches" description it was approved under. Only untracked
  caches (.pytest_cache/, .ruff_cache/, scripts/.claude/) are deleted; the uncommitted
  .kimi-plugin/marketplace.json and plugins/README.md modifications are reverted per the
  w159 decision. Jerry can override by asking for .kimi-plugin removal explicitly.

Standing constraints for all implement stages:
- No commits or pushes; all changes stay in the working tree for review.
- Fix references in place; never create *_v2 / *_fixed parallel copies.
- No bulk moves/renames beyond the approved deletions (cloud sync active).
