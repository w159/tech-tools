# Marketplace health check - 2026-10-27

Targets: `main` at 9c20c379 (atlas 15.2.1, armada 1.1.1, programmer 0.2.1) and the atlas work branch
`claude/project-thread-9eezyd` at 8e2387b7 (atlas 16.0.0, armada 2.0.0). Claude Code 2.1.311, Linux, root.

Nothing under `plugins/` was changed on this branch. atlas and armada belong to the main-chat threads and
programmer to the rebuild thread, so fixes ship as patches in `patches/` against 8e2387b7.

## Result per plugin

| Check | atlas main | atlas branch | armada main | armada branch | programmer |
|---|---|---|---|---|---|
| marketplace add + install (empty CLAUDE_CONFIG_DIR) | PASS | PASS | PASS | PASS | PASS |
| session starts, plugin loads | PASS, false doctor warning (F2) | PASS, false doctor warning (F2) | PASS | PASS | PASS, 1 of 7 agents (F6) |
| `claude plugin validate` | FAIL (F1) | PASS | PASS | PASS | PASS |
| hooks run on sample input | 22/22 PASS | 14/14 PASS | no hooks | no hooks | 0 hooks (disabled) |
| MCP servers, no credentials | 13/13 PASS | moved to armada | none | 13/13 PASS | none |
| frontmatter + file references | 1 broken link (F4) | 1 broken link (F4), stale doc (F5) | 4 YAML errors, ~150 broken links (F7) | same (F7) | 6 missing agents, 1 YAML error (F6) |
| atlas pytest (scrubbed env) | see "Test suites" | see "Test suites" | 14/14 | 14/14 | 7/7 |

## Findings

F1. atlas main fails validation.
```
$ claude plugin validate plugins/atlas
  > modules.../mod/register.ts: atlas.todoExpanded is not declared: the manifest's types contract must name it in interface PluginState { atlas: { todoExpanded: ... } }
x Validation failed        (exit 1)
```
Branch 8e2387b7: `Validation passed`. Fixed there.

F2. atlas-doctor reads `~/.claude/plugins` and ignores `CLAUDE_CONFIG_DIR`. Every install under a custom config
dir gets a false "unhealthy" warning at SessionStart, and `--fix` would write into the wrong registry.
Docs: "If you set CLAUDE_CONFIG_DIR, every ~/.claude path on this page lives under that directory instead"
(https://code.claude.com/docs/en/claude-directory.md).
```
# fresh install, CLAUDE_CONFIG_DIR=<freshcfg>, atlas@tech-tools present in <freshcfg>/plugins/installed_plugins.json
HOOK SessionStart: ATLAS-DOCTOR WARNING: atlas plugin is unhealthy - registered: atlas not found in installed_plugins.json.
# same doctor, ATLAS_PLUGINS_DIR=<freshcfg>/plugins
(no output, rc=0)
```
Same warning on branch 8e2387b7. Fix: `patches/atlas-doctor-claude-config-dir.patch` (doctor + regression test).
After the patch, a full fresh-install session on 16.0.0 prints no doctor warning (`tools/summ.py` output: only
the session_boot SessionStart line). New test fails on the unpatched doctor (1 failed, 2 passed) and passes on
the patched one (3 passed). Doctor tests: 173 passed with the patch.

F3. The channel-session lead ("cannot read plugin config: [Errno 2] ... installed_plugins.json") is the
synced-plugin layout. `tools/doctor_synced.sh` reproduces it exactly on 15.2.1; on 8e2387b7 the doctor is
silent (rc=0). Fixed on the branch, not on main.

F4. `plugins/atlas/skills/atlas-orchestrate/SKILL.md:145` links `references/operating-contract.md`, which
resolves inside the skill dir. The file is at the plugin root: the link needs `../../references/operating-contract.md`.
Main and branch.

F5. Branch only: `plugins/atlas/references/connector-config-flow.md` still points at
`${CLAUDE_PLUGIN_ROOT}/mcp/...` and `${CLAUDE_PLUGIN_ROOT}/.env`. The connectors moved to armada in 16.0.0.

F6. programmer (handed to the rebuild thread):
- `skills/code-review/SKILL.md` step 5 dispatches 6 agents (`code-review-architecture`, `-correctness`,
  `-craft`, `-security`, `-data`, `-process`) that do not exist. Session init lists only `programmer:tpp-auditor`.
- `agents/tpp-auditor.md` frontmatter is not valid YAML (unquoted `: ` in the description, line 2 col 348).
- README and marketplace.json claim 7 agents and a UserPromptSubmit hook; 1 agent ships and `hooks.json` is `{}`.

F7. armada department skills (main and branch):
- 4 SKILL.md frontmatters fail YAML (`pandadoc-api-patterns`, `pandadoc-proposals`, `pandadoc-recipients`,
  `pax8-api-patterns`).
- Sibling links lost the vendor prefix when the dirs were renamed: `../api-patterns/SKILL.md` instead of
  `../pax8-api-patterns/SKILL.md`, and so on, across 41 files.
- `it-operations/agents/procurement-specialist.md` links `../skills/product-catalog` and `../skills/api-patterns`
  (real dirs: `psa-product-catalog`, `psa-api-patterns`).
- `productivity` copies `${CLAUDE_PLUGIN_ROOT}/skills/dashboard.html`; the file is at
  `skills/armada/departments/productivity/skills/dashboard.html`.

Fix: `patches/armada-department-links.patch` (made by `tools/armada_link_fix.py` plus the two manual
repoints). On 8e2387b7: 167 links repointed, 0 unresolved, 4 frontmatters quoted. `ref_probe.py` goes
from 162 issues to 5. The 5 left are not defects: 3 are example paths in a plugin-authoring template, 1 is a
`armada:<agent>` placeholder, 1 is the upstream falcon README. armada tests 14 passed, validate passes.

F8. Warnings, not failures:
- All 14 atlas agents carry `tier_allow` and `effort_allow`, which Claude Code logs as unrecognized
  frontmatter keys. Atlas reads them itself.
- `plugins/atlas/README.md` has `documentationUrl "http://127.0.0.1:7421/"`, dropped by the directory check.
- No plugin has an icon (directory check `ICON_MISSING`). armada and programmer READMEs lack the install line.
- The repo's own `node test-mcp-tools.mjs` skips falcon in a source checkout because
  `plugins/atlas/mcp/falcon/.venv` is not created. In an installed plugin, falcon starts through `uv run` and passes.

## MCP servers without credentials

`tools/mcp_probe.py` starts each server from the installed plugin with an empty HOME and empty userConfig,
sends initialize, tools/list, then calls the `*_status` tool, then closes stdin.

| server | init s | tools listed | status tool says | exit on stdin close |
|---|---|---|---|---|
| auvik | 0.2 | auvik_status, auvik_navigate | AUVIK_USERNAME and AUVIK_API_KEY are not set | 0 |
| blumira | 0.1 | 2 | NOT CONFIGURED - set BLUMIRA_JWT_TOKEN or BLUMIRA_CLIENT_ID + BLUMIRA_CLIENT_SECRET | 0 |
| cipp | 0.2 | 1 | CIPP_BASE_URL: MISSING (required) | 0 |
| connectwise | 0.1 | 2 | CW_MANAGE_COMPANY_ID ... NOT SET - required | 0 |
| spanning | 0.1 | 2 | NOT CONFIGURED (set SPANNING_ADMIN_EMAIL and SPANNING_API_TOKEN) | 0 |
| falcon | 0.8 | 4 | MISSING_CREDENTIALS: Set falcon_client_id and falcon_client_secret | 0 |
| knowbe4 | 0.2 | 2 | NOT CONFIGURED (set KNOWBE4_API_KEY) | 0 |
| ninjaone | 0.2 | 5 | NINJAONE_CLIENT_ID: MISSING (required) | 0 |
| paylocity | 0.1 | 2 | NOT CONFIGURED - set PAYLOCITY_CLIENT_ID and PAYLOCITY_CLIENT_SECRET | 0 |
| threatlocker | 0.1 | 2 | NOT CONFIGURED - set THREATLOCKER_API_KEY | 0 |
| vanta | 0.2 | 2 | NOT CONFIGURED - set VANTA_CLIENT_ID and VANTA_CLIENT_SECRET | 0 |
| panos | 0.2 | 2 | NOT CONFIGURED - set PANOS_HOST and PANOS_API_KEY | 0 |
| sonicwall | 0.2 | 2 | NOT CONFIGURED - set SONICWALL_HOST, SONICWALL_USERNAME and SONICWALL_PASSWORD | 0 |

Same 13/13 on the branch, where they ship in armada 2.0.0. No crash, no hang, no non-JSON on stdout.
In the fresh-install session all 13 report `connected`.

## Test suites

atlas pytest, `--ignore=mcp` (falcon is an upstream uv project), run from fresh clones in a scrubbed env (`env -i PATH HOME=<empty> LANG`):

| tree | passed | failed |
|---|---|---|
| main 9c20c379 | 3975 | 36 |
| branch 8e2387b7 | 4133 | 28 |
| branch 8e2387b7 + both patches | 4136 | 28 (same 28 test ids as unpatched) |

The patches add 0 failures; +3 passed is the new doctor test. The atlas failures depend on the environment:
main inside a live Claude Code session fails 12, scrubbed fails 36. Examples: tests read
`CLAUDE_CODE_SESSION_ID` from the running session (`'lead-eed309' != 'lead-sess12'`), assume macOS
(`/private/tmp`), or assume a non-root user (chmod 000 does not block root). That is a hermeticity problem
for the atlas threads to triage; this audit does not attribute those failures to plugin code.
armada contract tests 14/14 and programmer hook tests 7/7 pass on every tree.

## Reproduce

```
export SCRATCH=$(mktemp -d) CLAUDE_CONFIG_DIR=$SCRATCH/cfg
claude plugin marketplace add w159/tech-tools          # or w159/tech-tools#claude/project-thread-9eezyd
for p in atlas armada programmer; do claude plugin install $p@tech-tools; done
docs/audits/2026-10-27_marketplace-health/tools/run_session.sh $CLAUDE_CONFIG_DIR $SCRATCH/run
python3 docs/audits/2026-10-27_marketplace-health/tools/summ.py $SCRATCH/run
python3 docs/audits/2026-10-27_marketplace-health/tools/mcp_probe.py $CLAUDE_CONFIG_DIR/plugins/cache/tech-tools/atlas/15.2.1 $SCRATCH/mcp.json
python3 docs/audits/2026-10-27_marketplace-health/tools/hook_probe.py $CLAUDE_CONFIG_DIR/plugins/cache/tech-tools/atlas/15.2.1 $CLAUDE_CONFIG_DIR $SCRATCH/hooks.json
python3 docs/audits/2026-10-27_marketplace-health/tools/ref_probe.py plugins/armada     # needs pyyaml
```
Apply the fixes on the atlas branch:
```
git checkout claude/project-thread-9eezyd
git apply docs/audits/2026-10-27_marketplace-health/patches/atlas-doctor-claude-config-dir.patch
git apply docs/audits/2026-10-27_marketplace-health/patches/armada-department-links.patch
```
