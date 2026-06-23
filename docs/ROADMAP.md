# Roadmap

Newest activity on top. Items move from Backlog -> In Progress -> Done.

---

## Backlog

### Atlas context/cost tuning recommendations (carried from Phase 3)

Surface autocompact and thinking-token budgets plus model routing as recommend-then-confirm options
(modeled on ECC), opt-in only. Not yet implemented.

## Done

### Connector .mcpb bloat fixed + marketplace install repaired (resolved 2026-06-23)

The canonical packer dragged each file:-linked vendor lib's iCloud
`node_modules.nosync.noindex` twin into the bundle, ballooning 5 connectors to
25-100M (spanning 99M, a hair under GitHub's 100M push limit). Two earlier packer
variants tried to fix this but their regexes missed the `.nosync` twin. Fixed
`mcp_servers/_shared/pack-mcpb.js` (dereference symlink + drop nested
`node_modules` and `.nosync*`), propagated to all 10 per-server copies (now one
md5), and rebuilt the 5 oversized bundles staged in /tmp: spanning 99M->2.78M,
blumira 60M->2.61M, vanta 51M->2.77M, threatlocker 47M->2.76M, paylocity
25M->2.77M. Each verified credential-free launch with full tools/list. Atlas now
ships all 10 slimmed connectors under `plugins/atlas/mcp/` with an added
`extract.sh` search path so its declared connectors resolve standalone. Also fixed
`bash_advisor.py` exec bit (git mode 100644->100755). Details in CHANGELOG
2026-06-23. Diagnosis: was the dominant cause of connector-heavy plugins not
appearing in a Claude Desktop marketplace install.

### Atlas optimization (Phases 1-3) -- shipped and verified (resolved 2026-06-23)

Skill renames (atlas-* prefix), loop-library + atlas-loop, all 10 connectors (disabled, extract-on-demand),
project self-improvement settings, Architect Mode + no-args scan, ponytail/loop-library/connector
discovery, session-lifecycle docs, and the opt-in visual layer (colored subagents, output style,
statusline). All additive/opt-in; independently verified zero-degradation. Details in CHANGELOG 2026-06-23.

### ThreatLocker approve tool -- shipped; API-limited to approve only (resolved 2026-06-22)

`threatlocker_approvals_approve` added (DESTRUCTIVE, POST /ApprovalRequest/ApprovalRequestPermitApplication).
No deny tool: the ThreatLocker Portal API exposes no deny endpoint; deny must be done in the
Portal UI. Documented in `docs/vendors/threatlocker/README.md`.
(`mcp_servers/threatlocker-mcp/src/domains/approvals.ts`)

### Error-envelope HTTP classifier -- FORBIDDEN/NOT_FOUND/RATE_LIMITED now correct (resolved 2026-06-22)

`_shared/error-envelope.ts` `classifyError()` now reads `statusCode` and `response` in
addition to `status`, so vendor HTTP errors classify correctly instead of falling through to
INTERNAL_ERROR. Affects node-threatlocker and node-vanta.
(`mcp_servers/_shared/error-envelope.ts`)

### Auvik verb-first description pass -- all 39 tools updated (resolved 2026-06-22)

All 39 auvik-mcp tool descriptions rewritten verb-first. No tool count change.
(`mcp_servers/auvik-mcp/src/domains/`)

### Blumira DESTRUCTIVE/VISIBLE-TO-OTHERS risk-prefix pass -- 6 tools updated (resolved 2026-06-22)

Six blumira-mcp tools prefixed DESTRUCTIVE or VISIBLE-TO-OTHERS per the tool-quality contract.
(`mcp_servers/blumira-mcp/src/domains/`)

### Vanta README and vitest suite -- 20 specs added (resolved 2026-06-22)

vanta-mcp received a README.md and 20 vitest unit specs covering the main domain handlers.
(`mcp_servers/vanta-mcp/README.md`, `mcp_servers/vanta-mcp/src/__tests__/`)

### Ramp connector -- removed; no wireable endpoint exists (resolved 2026-06-22)

Decision reversed from "pending." Ramp publishes no hosted MCP endpoint. The five ramp-*
skill folders were deleted and all Ramp references removed from the finance plugin manifest
and marketplace.json. To restore: recover from git history and follow the pax8/pandadoc
`.mcp.json` pattern if Ramp ships an official MCP server in the future.
(`plugins/finance/skills/`, `plugins/finance/CONNECTORS.md`,
`plugins/finance/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`)

### Marketplace keyword parity fix -- all 12 plugins in sync (resolved 2026-06-22)

Keyword lists in `.claude-plugin/marketplace.json` brought into parity with each plugin's
`plugin.json`. Three plugins patched: finance (+pax8, +pandadoc), it-operations (+endpoint),
security-compliance (+email-security). All 12 plugins now match; marketplace.json valid.
(`.claude-plugin/marketplace.json`)

### Phase 3 -- finance connectors wired, nudge standalone, ASCII normalization (shipped 2026-06-22)

All three open decisions from Phase 2 resolved (finance wiring, nudge plist, ASCII sweep).
See `docs/CHANGELOG.md` Phase 3 entry dated 2026-06-22.

- finance: pax8 + pandadoc connectors wired via `.mcp.json`; `plugin.json` bumped 1.3.0 -> 1.4.0;
  userConfig keys verified against `${user_config.*}` references.
  (`plugins/finance/.mcp.json`, `plugins/finance/.claude-plugin/plugin.json`)
- productivity/nudge: macOS launchd/plist dependency removed; command is now OS-agnostic;
  plist template question resolved by dropping the launchd approach entirely.
  (`plugins/productivity/commands/nudge.md`)
- ASCII normalization: 0 non-ASCII codepoints confirmed across all 12 plugins, `_templates/`,
  and `CLAUDE.md`. Em/en dashes, arrows, box-drawing, emoji, math symbols all replaced.
  (`plugins/_templates/`, `plugins/CLAUDE.md`, all 12 plugin clusters)
- Re-verification: 362 frontmatter files, 0 PyYAML failures; marketplace.json 12/12 matches disk.

### Phase 2 -- marketplace-wide hygiene (shipped 2026-06-22)

All items verified; 0 PyYAML failures across 362 frontmatter files.
See `docs/CHANGELOG.md` entry dated 2026-06-22 (Phase 2 section).

- plugin-dev validation sweep: all 12 non-atlas plugins validated; marketplace.json 12/12.
- Frontmatter re-verify: 2 CRITICAL YAML corruptions fixed; 12 non-ASCII frontmatter files
  corrected across hr-payroll, finance, engineering, data clusters. 362 files, 0 failures.
  (`plugins/finance/skills/ramp-api-patterns/SKILL.md`,
  `plugins/engineering/skills/dead-code-cleanup/SKILL.md`)
- .env.template backfill: confirmed already complete (prior work resolved obs #13987).
- README stale-name fixes: root README.md and plugins/it-operations/README.md corrected;
  leaked personal path removed from plugins/productivity/commands/nudge.md.
  (`README.md`, `plugins/it-operations/README.md`, `plugins/productivity/commands/nudge.md`)

### Phase 1 -- atlas plugin optimization (shipped 2026-06-22)

All items below were independently verified by atlas:verifier (verdict: CONFIRMED).
See `docs/CHANGELOG.md` entry dated 2026-06-22 and
`docs/evidence/2026-06-22-atlas-hook-contract.md` for smoke-test evidence.

- Hard hook contract established: no atlas hook emits `permissionDecision` or exits 2.
  (`plugins/atlas/hooks/bash_advisor.py`, `plugins/atlas/hooks/hooks.json`)
- `bash_guard.py` renamed to `bash_advisor.py`, rewritten advisory-only; catastrophic-command
  list narrowed to four near-irreversible patterns; old "ask" list removed.
  (`plugins/atlas/hooks/bash_advisor.py`)
- `session_boot.py` orchestrator-delegation statement strengthened.
  (`plugins/atlas/hooks/session_boot.py`)
- `completion_gate.py` docstring corrected (opt-out, not opt-in).
  (`plugins/atlas/hooks/completion_gate.py`)
- All `[orchestrate ...]` output tokens renamed `[atlas ...]` across hooks, scripts, commands.
  (`plugins/atlas/scripts/install_hooks.py`)
- Manifests corrected to 18-agent count; version bumped 1.0.1 -> 1.1.0; all launchers
  enumerated; marketplace description de-staled.
  (`plugins/atlas/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`)
- New `atlas-validate` launcher added.
  (`plugins/atlas/commands/atlas-validate.md`)
- Reliability guidance (path-exists, ToolSearch-before-deferred, timeout+retry) added to
  references and agent prompts.
  (`plugins/atlas/references/verification-and-grounding.md`,
  `plugins/atlas/references/subagent-kit.md`,
  `plugins/atlas/agents/explorer.md`,
  `plugins/atlas/agents/implementer.md`)

---

## Backlog

### Tech debt: consolidate error-envelope DRY divergence

The bug that caused CIPP and auvik to misclassify HTTP errors existed because three
servers carry private copies of the classifier instead of importing the shared module.
Consolidate `connectwise-manage-mcp/src/_shared/error-envelope.ts`,
`cipp-mcp/src/_shared/error-envelope.ts`, and `auvik-mcp/src/errors.ts` into the single
`mcp_servers/_shared/error-envelope.ts` so future classifier changes propagate everywhere
without manual synchronization. (Surfaced by 2026-06-22 error-envelope fix.)

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
