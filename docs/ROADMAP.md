# Roadmap

Newest activity on top. Items move from Backlog -> In Progress -> Done.

---

## In Progress

- [in-progress] atlas 5.14.0 is committed but not installed. The live plugin cache
  still runs 5.13.0, so the noise reduction, gate conditions (i)/(j), the (f)
  cross-check, and the skill-level todo/steering/worktree rules are all inert
  until reinstall. `InstalledParityContract` in
  `plugins/atlas/hooks/test_atlas_contract.py:447` skips while the versions
  differ and re-arms afterward.
- [in-progress] Gate conditions (i) and (j) are verified against fixtures and
  mutation-checked, but never against a live payload: this session's toolset has
  no `TodoWrite`, so no real TodoWrite tool_use has passed through `_open_todos`,
  and no real `isolation: "worktree"` dispatch has passed through the tripwire.
  To close: after reinstall, run one orchestration task that writes a todo list
  and dispatches an isolated writer, then `Stop`. Expected: the gate blocks with
  "(i) Todo list not drained" until the list is completed, and with "(j) N git
  worktree(s) from this run are still on disk" until the trees are merged and
  removed.

- [in-progress] Vendored upstream clones (aider/, claude-code/, cline/, codex/, cursor/,
  gemini-cli/, github-copilot/, pi/, windsurf/, frameworks/, vendors/) still live in docs/.
  Decision needed: move to `reference/` at repo root, or keep in docs/ as reference material.
  These carry their own nested .git dirs and are not project documentation.

## Backlog

### Atlas self-improvement follow-ups (added 2026-08-05)

Chronicle/insights schema and `atlas-doctor` skill shipped this date (see CHANGELOG). One
gap remains; the other two closed in 5.6.0 (2026-08-06):

- [closed 2026-08-06] Gate-block persistence: `completion_gate.py` now writes a
  `friction_events` row per block and `chronicle_facet.py` counts it into
  `facets.gate_block_count`. Also fixed the unscoped friction delete that was erasing those
  rows. See CHANGELOG 2026-08-06 (5.6.0).
- [closed, was never open] The memory-drop test was already written:
  `test_unstorable_lesson_is_recorded_not_dropped` in `hooks/test_memory_capture.py:192`
  asserts a refused `atlas_memory.add()` lands in `friction_events`. This entry was stale,
  not a real gap. 33 tests pass in that file.
- Anonymized feedback exporter: `atlas_feedback.py` was built, then deleted at the user's
  direction after an adversarial verifier proved it leaked the user's vendor stack (MCP
  connector UUIDs, vendor tool names, internal skill codenames) into what was meant to be a
  shareable export. See `docs/decisions/no-anonymized-feedback-exporter-without-designed-in-redaction.md`.
  Facets/findings data keeps accumulating, so this can be rebuilt later with anonymization
  designed in from the start rather than retrofitted.
- [closed 2026-08-06] Phase 1 facet enrichment had no deterministic entry point.
  `atlas_doctor.py --enrich-facet <session_id> '<json>'` now validates against
  `atlas_db.FACET_COLUMNS` and writes the LLM-judged columns; the judgment stays the
  model's, the write is testable.

### Extract MCP connector servers into standalone repos (approved 2026-07-31)

Goal: deliver each of the 10 MCP connector servers via
`npx -y git+https://github.com/w159/<vendor>-mcp.git` instead of as folders inside this
monorepo. Approved as a follow-on target; not started. Four independent blockers confirmed
this session:

1. All 10 are folders in this monorepo, not standalone repos. `git -C mcp_servers/<name>
   rev-parse --show-toplevel` returns the tech-tools root for every one; single remote
   `https://github.com/w159/tech-tools.git`; no `.gitmodules`, no nested `.git`. npm git URLs
   have no subdirectory form, so a git+ URL today would install the whole monorepo, not one
   server.
2. 6 of 10 depend on local `file:../../mcp_node/node-*` paths and cannot install standalone:
   blumira-mcp, kaseya-spanning-backup-mcp, ninjaone-mcp, paylocity-mcp, threatlocker-mcp,
   vanta-mcp.
3. `dist/` is gitignored for all 10, and only 3 of 10 (blumira, cipp, threatlocker) have a
   `prepare` script. npm runs `prepare` (not `build`) on git installs, so the other 7 would
   install as empty packages.
4. None of the 10 are published to npm. All names are unscoped (auvik-mcp, blumira-mcp,
   cipp-mcp, connectwise-manage-mcp, kaseya-spanning-backup-mcp, knowbe4-mcp, ninjaone-mcp,
   paylocity-mcp, threatlocker-mcp, vanta-mcp).

What would unblock it, in order:
- Publish the `mcp_node/node-*` client libraries to npm.
- Replace the 6 `file:` dependencies with published npm versions.
- Add `prepare` scripts to the 7 servers lacking them, or commit `dist/`.
- Extract each server to its own repo (`w159/<vendor>-mcp`). Only `w159/atlas-connectwise`
  exists today and it is unrelated.

Interim decision (approved 2026-07-31): vendor the built servers directly into
`plugins/atlas/mcp/<server-key>/` and launch them with `node` against
`${CLAUDE_PLUGIN_ROOT}`, which works today with no registry or repo work. The npx-from-git
delivery above remains the eventual target, not the current mechanism. Vendoring work itself
is in progress and unverified as of this entry - not recorded here as done.

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
- [resolved 2026-07-29] atlas_doctor `marketplace-source`/`clone-remote` FAILs: this
  was never a marketplace-source mismatch or a fork - the GitHub repo was renamed
  `w159/atlas` -> `w159/tech-tools`, and the `atlas` plugin's own `repository` field
  (which `atlas_doctor.py` reads to derive its expected repo) still carried the
  pre-rename URL. Fixed by repointing that field, and the marketplace catalog name
  itself, to `tech-tools`; see CHANGELOG 2026-07-29.
- Improvement #28 (user-gated): one-line global CLAUDE.md rule that the Skill tool
  is only for listed skills (34 historical Skill(bash/read/write) misfires, 100%
  error rate).

### Atlas context/cost tuning recommendations (carried from Phase 3)

Surface autocompact and thinking-token budgets plus model routing as recommend-then-confirm options
(modeled on ECC), opt-in only. Not yet implemented.

### Tech debt: error-envelope DRY divergence (re-scoped again 2026-07-17, commit adace06)

Commit `adace06` restored a top-level `mcp_servers/_shared/` (see CHANGELOG), but this is a
restore, not the per-server consolidation this item originally asked for: `blumira-mcp`,
`threatlocker-mcp`, and `vanta-mcp` now import the top-level copy via their `@shared/*`
alias, while `auvik-mcp/src/_shared/error-envelope.ts`,
`connectwise-manage-mcp/src/_shared/error-envelope.ts`, and
`cipp-mcp/src/_shared/error-envelope.ts` still carry their own private per-server copies
(confirmed on disk 2026-07-17 - none of the three re-point at `mcp_servers/_shared/`). The
repo now has four independent copies of `error-envelope.ts`/`response-shaper.ts` (one
top-level, three per-server), not one. Still left in Backlog, unplanned: either repoint
`auvik-mcp`/`connectwise-manage-mcp`/`cipp-mcp` at the now-restored top-level `_shared/`, or
accept four copies as the pattern and drop the consolidation goal.

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
