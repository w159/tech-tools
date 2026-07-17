# Roadmap

Newest activity on top. Items move from Backlog -> In Progress -> Done.

---

## In Progress

- [active] L1: marketplace plugin (5.0.0) is stale vs the working tree. Run `/reload-plugins`
  (or reinstall) so the live Stop hook executes the fixed `docs`-resolving completion_gate.
  Coverage and test fixes are inert in the live agent until this reload lands.
- [in-progress] Vendored upstream clones (aider/, claude-code/, cline/, codex/, cursor/,
  gemini-cli/, github-copilot/, pi/, windsurf/, frameworks/, vendors/) still live in docs/.
  Decision needed: move to `reference/` at repo root, or keep in docs/ as reference material.
  These carry their own nested .git dirs and are not project documentation.

## Backlog

### Atlas v3.1.0 follow-ups (added 2026-07-09)

- Post-release smoke test: reload plugins (installed cache is still 3.0.2), open a
  fresh session, confirm the ATLAS output-style header appears without /config
  selection and the arm/deny behavior engages live. Everything shipped is verified
  at the code/test level but [unverified live] until the reload.
- Codex token fidelity: persist all token_count deltas, not just the one nearest
  each stored message (~59% of events currently discarded -> systematic
  undercount; see `plugins/atlas/skills/atlas-audit/SKILL.md:270-280`).
- `context_tool_health()` agent filter: totals currently blend claude and codex
  token regimes once codex rows exist (`plugins/atlas/scripts/atlas_db.py:846-854`).
- Classifier arm-precision monitoring: use sextant (runs.orchestrating vs actual
  dispatches) to measure real-world false-arm rate of the accepted dual-use-verb
  residual (audit/investigate/debug/profile/harden).
- atlas_doctor marketplace-source repair: pre-existing FAILs (installed cache
  tracks henssler-financial remote, expected w159/atlas per
  `plugins/atlas/.claude-plugin/plugin.json:8`; the marketplace name itself
  is `atlas` per `.claude-plugin/marketplace.json:3`, and the marketplace
  now lists 2 plugins, not 12) - run
  `python3 plugins/atlas/scripts/atlas_doctor.py --fix` then reload plugins.
- Improvement #28 (user-gated): one-line global CLAUDE.md rule that the Skill tool
  is only for listed skills (34 historical Skill(bash/read/write) misfires, 100%
  error rate).

### Atlas context/cost tuning recommendations (carried from Phase 3)

Surface autocompact and thinking-token budgets plus model routing as recommend-then-confirm options
(modeled on ECC), opt-in only. Not yet implemented.

### Tech debt: error-envelope DRY divergence (re-scoped 2026-07-17)

The single top-level `mcp_servers/_shared/error-envelope.ts` this item originally proposed
consolidating into was deleted in commit `56d1a9f` (along with `response-shaper.ts`,
`base-url.ts`, etc.), which broke `auvik-mcp`'s imports. The 2026-07-17 build-break fix
(see CHANGELOG) restored `auvik-mcp`'s copy as a per-server
`mcp_servers/auvik-mcp/src/_shared/error-envelope.ts`, matching the pattern already used by
`connectwise-manage-mcp/src/_shared/error-envelope.ts` and
`cipp-mcp/src/_shared/error-envelope.ts` (both pre-existing, confirmed on disk). All three
servers now carry a private per-server copy - there is no live top-level `_shared/` to
consolidate into. Re-scope this item: either restore a top-level `mcp_servers/_shared/` and
repoint all three servers' imports at it, or accept per-server copies as the pattern and
drop the consolidation goal. Left in Backlog, unplanned - no code change toward
consolidation exists in this diff.

### Bug: blumira-mcp, threatlocker-mcp, vanta-mcp fail to build (missing @shared alias target, found 2026-07-17)

Same root cause as the DRY-divergence item above (`mcp_servers/_shared/` deleted in
`56d1a9f`), but unlike `auvik-mcp`/`connectwise-manage-mcp`/`cipp-mcp` these three never
got a local `src/_shared/` fallback. They still import `@shared/response-shaper.js`,
`@shared/error-envelope.js`, and `@shared/base-url.js`
(e.g. `mcp_servers/threatlocker-mcp/src/domains/_helpers.ts:15,21,26`, same pattern in
`mcp_servers/blumira-mcp/src/domains/_helpers.ts` and
`mcp_servers/vanta-mcp/src/domains/_helpers.ts`), aliased by `tsup.config.ts` to a
`mcp_servers/_shared/` path that no longer exists. Reproduced 2026-07-17: `cd
mcp_servers/threatlocker-mcp && npm run build` fails with 3 esbuild "Could not resolve"
errors against `mcp_servers/_shared/{response-shaper,error-envelope,base-url}.js`. Fix
needs either a restored top-level `mcp_servers/_shared/` or a local `src/_shared/` copy
per server, matching whichever direction the DRY-divergence item above resolves to.
Out of scope for the 2026-07-17 dependency remediation (package.json/lockfile only).

### Bug: vitest 4 globs into node_modules.nosync.noindex symlink target during npm test (found 2026-07-17)

The repo's `node_modules -> node_modules.nosync.noindex` symlink convention (iCloud
hygiene) is not excluded by vitest 4's default test glob, so `npm test` picks up test
files belonging to vendored packages. Reproduced 2026-07-17: `cd
mcp_servers/threatlocker-mcp && npm test -- --run` -> 15 of 184 test files fail, all
under `node_modules.nosync.noindex/zod/src/v4/classic/tests/*.test.ts` (missing
optional peer deps `recheck`, `@web-std/file`, `@seriousme/openapi-schema-validator`)
and `node_modules.nosync.noindex/node-threatlocker/tests/unit/computers.test.ts` (a
different project's tests reached through the symlink). Real test count for the
project itself: 1882 passed, 3 failed on an unrelated live-HTTP-440 issue.
`mcp_servers/threatlocker-mcp/vitest.config.ts` has no `exclude` override. Fix needs
an explicit `test.exclude` (or `test.dir` scoping to `tests/` and `src/`) added to
each project's `vitest.config.ts` bumped to vitest 4 in the 2026-07-17 dependency
remediation. Out of scope for that remediation (package.json/lockfile only).

### Tech debt: eslint 9 / @typescript-eslint 8 migration to clear minimatch ReDoS residual (found 2026-07-17)

`connectwise-manage-mcp`, `knowbe4-mcp`, and `ninjaone-mcp` each carry 6 high-severity
`npm audit` findings after the 2026-07-17 dependency remediation: a `minimatch` ReDoS
chain via `@typescript-eslint/eslint-plugin` `^6` / `@typescript-eslint/utils`
6.16.0-7.5.0. Clearing it needs an eslint 9 / `@typescript-eslint` 8 major-version
migration (breaking change to lint config, deferred from the 2026-07-17 remediation
which only bumped in-range). `cipp-mcp` and `blumira-mcp` carry a separate residual
(`@inquirer/prompts` <=6.0.1 / `tmp` / `esbuild` via `@anthropic-ai/mcpb`) not covered
by this eslint migration.

### Tech debt: tool-description polish pass on cipp / connectwise / ninjaone / paylocity

cipp-mcp, connectwise-manage-mcp, ninjaone-mcp, and paylocity-mcp still have tool
descriptions that do not fully satisfy the quality contract (verb-first sentence, explicit
"returns X", "when an agent should call it" clause). A targeted rewrite pass similar to
the 2026-06-22 auvik pass is needed for each server.

### Tech debt: repo-wide implicit-any in .map() callbacks (TS7006)

A latent `item => ...` pattern throughout the server sources produces TS7006 implicit-any
warnings that tsup does not surface during builds. A repo-wide pass to add explicit
parameter types would catch type drift earlier and make the linter clean.

### Verify: knowbe4-mcp inlined-client error shape vs classifier

knowbe4-mcp uses an inlined HTTP client whose error shape may not match the
`{ statusCode, response }` structure the classifier now expects. Confirm a real 403 from
KnowBe4 is recognized as FORBIDDEN rather than falling through to INTERNAL_ERROR.

### Tech debt: root .gitignore fails its own zero-trust validator (found 2026-07-17)

`bash plugins/atlas/skills/atlas-gitignore/scripts/validate_gitignore.sh .gitignore` FAILs
on "banned Unicode (em/en dash, curly quotes, or ellipsis) present." Root cause: about 20
pre-existing comment lines (`.gitignore:30-377`, e.g. lines 30-36, 43-55, 132-202, 260-306,
377) use em dashes in prose. Unrelated to the 2026-07-17 canonical-structure change (which
added only ASCII allowlist lines for `.atlas/findings/`, `.atlas/decisions/`,
`.atlas/archive/`, `.atlas/understand-anything/`, `.atlas/graphify/`,
`.atlas/self-improvement/`, `.atlas/memory/`, `.atlas/nudge/`, `.atlas/CLAUDE.md`,
`.atlas/AGENTS.md` - the missing allowlist entries that had been silently gitignoring those
dated/durable subfolders). The validator also exits on the first failing check, so whether
the structural (pairing) and runtime (`git check-ignore`) checks pass is unverified until
this Unicode sweep lands. Needs an ASCII sweep of `.gitignore` comment prose (em dash ->
hyphen/comma/rewrite) followed by a clean validator run.
