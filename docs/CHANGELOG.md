# Changelog

Newest entry on top. Dates are ISO 8601 (YYYY-MM-DD).

---

## 2026-06-25 -- Atlas v2.0.0: final 8-skill redesign, observability DB, de-hardcoded swarms

Completed the atlas plugin skill-set redesign. Every skill is now canonically named under the
`atlas-*` prefix; the five retired names (atlas-loop, atlas-connectors, atlas-self-improving,
atlas-uxt-swarm, atlas-operating-contract) no longer appear in the plugin or its docs except in
historical CHANGELOG entries below.

### Skill renames and retirements

- `atlas-loop` -> `atlas-orbit`: same loop library, canonical name dropped the ambiguous "loop" suffix.
- `atlas-connectors` -> `atlas-harbor`: vendor MCP connector setup skill; name reflects the "safe harbor"
  for external integrations.
- `atlas-self-improving` retired; replaced by `atlas-sextant`: the new skill reads a SQLite observability
  DB (`~/.atlas/atlas.db`) populated by the session/tripwire/completion hooks, computes wall-clock, inline-ops, dispatches, parallel
  waves, context, recall, and verifier-coverage scores, and proposes metric-backed improvement targets
  (baseline -> target). Measurable; not motivational.
- `atlas-uxt-swarm` retired; its pipeline (cartographer -> persona -> fuzzer -> oracle -> reporter) is now
  the implementation detail of `atlas-expedition`. atlas-expedition adds app-discovery: it auto-finds
  routes and form fields in any live web app with no hardcoded paths, so it works on any project.
- `atlas-operating-contract` retired; the operating contract itself (`operating-contract.md`) still ships
  as a reference file under atlas-engine/references/. The skill wrapper was not necessary.

### New skills

- `atlas-cartographer`: produces an evidence-grounded architecture map of any codebase, identifies
  structural duplicates (DRY-at-the-module level), and writes `docs/architecture/boundaries.md` as a
  persistent artifact a future agent can load instead of re-discovering structure.
- `atlas-expedition`: app-discovering UX swarm. Discovers routes/fields from a live app via a cartographer
  phase, then runs the full persona + fuzz + accuracy-oracle + reporter pipeline. No hardcoded paths;
  works on any web app.
- `atlas-survey`: discovery-first comprehensive quality and security audit swarm. Covers code quality
  (complexity, dead code, test coverage, error handling), security (OWASP Top 10, SANS 25, secrets,
  auth, injection, SSRF), and dependency risk. Returns severity-graded findings and an actionable
  remediation plan.
- `atlas-sextant` (detailed above).

### Manifest and docs reconciliation

- `plugins/atlas/.claude-plugin/plugin.json` bumped 1.2.1 -> 2.0.0 (MAJOR: breaking change - four skills
  renamed and `atlas-operating-contract` removed, so any external reference to an old skill name breaks);
  description updated to enumerate all 8 skills with their one-line purpose and the 8-hook count; 5 new
  keywords added (observability-db, architecture-audit, owasp, security-audit, ux-swarm).
- `plugins/atlas/README.md` updated: "What ships" table expanded to all 8 skill rows; layout tree
  updated to show all 8 skill directories.
- `plugins/atlas/skills/atlas-engine/references/capability-catalog.md` updated: 3 new signal rows added
  for atlas-cartographer, atlas-survey, atlas-expedition.
- `plugins/atlas/skills/atlas-engine/references/capability-routing.md` updated: atlas-expedition added
  to the UX-sweep row; 6 new routing rows added for atlas-survey, atlas-cartographer, atlas-orbit,
  atlas-harbor, atlas-sextant, and the app-routes-unknown expedition path.
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

### atlas-architect: Architect Mode + no-args scan

The architect turns the session into a pure orchestrator: it rewrites vague or incomplete prompts into
structured, reference-backed tasks (operating contract + doc quotations), delegates research/impl/test to
parallel subagents, and routes every claimed change to an adversarial verifier for red -> green evidence.
With no task/args, any atlas skill runs a standard scan and reports the gap to atlas standard. Bootstrap
now treats claude-mem + context-mode + ponytail as the session-augmentation trio and surfaces the
loop-library and connector built-ins.
(`plugins/atlas/skills/atlas-architect/SKILL.md`)

### Discovery: ponytail, loop-library, connectors

capability-catalog and discover_capabilities.py now recommend ponytail (always), loop-library (via
atlas-loop), and connectors (when `mcp_servers/` or `*.mcpb` present). session_boot reports ponytail
status and points at the no-prompt scan. Fixed a pre-existing broken path: the discover script is now
anchored at `${CLAUDE_PLUGIN_ROOT}/scripts/discover_capabilities.py` in both the skill and the catalog.
(`plugins/atlas/scripts/discover_capabilities.py`, `plugins/atlas/skills/atlas-engine/references/capability-catalog.md`, `plugins/atlas/hooks/session_boot.py`)

### Session docs lifecycle

New `references/session-lifecycle.md`: START reconciles recent claude-mem/context-mode work against docs/
(correct invalid, archive outdated) before new work; END runs a docs-curator that moves every completed
ROADMAP task to CHANGELOG with date and evidence. Wired as pointers into atlas-engine and docs-ssot.
(`plugins/atlas/skills/atlas-engine/references/session-lifecycle.md`)

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
The reference files `atlas-engine/references/operating-contract.md` and `references/self-improving.md`
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
`plugins/atlas/commands/.claude-plugin/`.
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

`plugins/atlas/commands/atlas-validate.md` added. Drives `plugin-dev:plugin-validator` and
`plugin-dev:skill-reviewer` over a target plugin, providing structured quality gates without
requiring the full atlas orchestration path.
(`plugins/atlas/commands/atlas-validate.md`)

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
