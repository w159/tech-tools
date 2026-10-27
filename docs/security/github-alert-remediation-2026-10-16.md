# GitHub security alert remediation: 2026-10-16

Repository: `w159/tech-tools` (default branch `main`). Framing: FTC Safeguards Rule (16 CFR 314.4(c), (d)), SEC Reg S-P, GLBA. This is the record of which repository security controls were enabled, which alerts were fixed in code, and why the rest were dismissed.

## Controls enabled

| Control | Before | After | Configured by |
|---|---|---|---|
| Dependabot alerts and security updates | enabled | enabled | unchanged |
| Secret scanning | disabled | enabled | GitHub API `PATCH /repos/w159/tech-tools` (`security_and_analysis`) |
| Secret scanning push protection | disabled | enabled | same call |
| CodeQL code scanning | never run (`404 no analysis found`) | default setup, `default` query suite, languages javascript-typescript and python | `PATCH /repos/w159/tech-tools/code-scanning/default-setup` |

Secret scanning found no secrets on its first scan (0 open alerts).

## Result

| Source | Open before | Open after |
|---|---|---|
| Dependabot | 120 (2 critical, 30 high, 87 medium, 1 low), plus #1093 raised during the work | 0 |
| CodeQL | 39 raised by the first runs | 0 (26 fixed in code, 13 dismissed with justification) |
| Secret scanning | not running | 0 |

Commits on `main`: `95687ebe` (dependency updates), `c8bfcb89` (CodeQL fixes, falcon `mcp` 1.30.0), `9b3a6652` (falcon parameter logging).

## Dependabot

All alerts were closed by version updates in the lockfiles; none were dismissed. The three alerts that had no patched version upstream were closed by removing the vulnerable package from the dependency tree:

- `node-forge` <= 1.4.0 (blumira-mcp, cipp-mcp): came only from the `@anthropic-ai/mcpb` dev dependency. That dependency was removed, because the pack scripts already run the tool through `npx --yes @anthropic-ai/mcpb`.
- `sprintf-js` <= 1.1.3 (cipp-mcp): came from `argparse@1`, through jest, istanbul and `js-yaml@3`. cipp-mcp now overrides `argparse` to `^2.0.1`. js-yaml 3 uses argparse only in its CLI, never in its library.

Per-package versions are recorded in `docs/CHANGELOG.md` under Unreleased, Security.

## CodeQL fixes in code (26)

- **Path traversal:** dashboard and connector paths are now confined to their root directories (`plugins/atlas/scripts/atlas_dashboard.py`, `atlas_control.py`).
- **Slow regexes (ReDoS):** regexes rewritten or replaced with linear loops in `atlas_control.py`, `atlas_doctor.py`, `mcp_node/node-spanning/src/config.ts` and `mcp_node/node-paylocity/src/client.ts`.
- **Secrets in logs:** request parameter values are no longer logged. falcon `base.py` and the auvik probe script log only names, and the panos logger redacts credential-named keys.
- **herdr-web-ui:**
  - URL character ranges made explicit.
  - WebSocket handlers type-checked before they are called.
  - Exact host match in place of a substring check.
  - 500 responses return a generic message.
  - Stray `<` and `>` stripped.
- **Tests:** the URL assertions in `mcp_servers/_shared/__tests__/response-quality.test.ts` now use `startsWith` instead of a substring check.

## CodeQL dismissals (13)

| # | Rule | File | Reason | Justification |
|---|---|---|---|---|
| 16 | py/clear-text-logging-sensitive-data | `plugins/atlas/hooks/bash_advisor.py` | false positive | Prints a fixed reason label from the `_SECRETS` table, never the matched secret text. |
| 19 | js/xss-through-dom | `plugins/atlas/scripts/dashboard_ui/js/dom.js` | false positive | Only `createTextNode` or appending existing Nodes; `applyProps` rejects `html`/`innerHTML`/`outerHTML`. |
| 20 | js/xss-through-exception | `plugins/atlas/scripts/dashboard_ui/js/dom.js` | false positive | Same helper; nothing is parsed as HTML. |
| 22 | js/stack-trace-exposure | `plugins/atlas/colony/herdr-web-ui/server/http.ts` | false positive | Returns only `HerdrError` code/message, which the app writes itself, or a fixed "Internal server error"; stack traces are logged server-side only. |
| 23 | js/disabling-certificate-validation | `mcp_servers/connectwise-manage-mcp/src/api-client.ts` | won't fix | Explicit opt-in through `CW_MANAGE_REJECT_UNAUTHORIZED=false`; certificates are verified by default. Needed for on-prem servers with self-signed certificates. |
| 24 | js/disabling-certificate-validation | `mcp_node/node-panos/src/keygen.ts` | won't fix | Opt-in through `PANOS_VERIFY_TLS=false`; verified by default. PAN-OS appliances commonly ship self-signed certificates. |
| 25 | js/disabling-certificate-validation | `mcp_node/node-panos/src/client.ts` | won't fix | Same opt-in, applied through a per-request agent. |
| 29 | js/clear-text-logging | `mcp_servers/panos-mcp/src/utils/logger.ts` | false positive | Context is serialized with a `JSON.stringify` replacer that redacts pass/secret/token/key/authorization/credential keys. |
| 30, 31 | js/shell-command-injection-from-environment | `plugins/atlas/omp/proc.ts` | false positive | `/bin/sh -c` runs a constant script; arguments are passed as positional `"$@"`, never interpolated. |
| 34 | js/incomplete-url-substring-sanitization | `mcp_servers/cipp-mcp/tests/cipp.service.domain-health.test.ts` | used in tests | A test assertion, not production sanitization. |
| 38 | js/incomplete-multi-character-sanitization | `plugins/atlas/colony/herdr-web-ui/scripts/build-site.ts` | false positive | A build-time script that reads the repo's own `site/index.html`; it outputs JSON-LD, not HTML. |
| 39 | py/clear-text-logging-sensitive-data | `plugins/armada/mcp/falcon/falcon_mcp/modules/base.py` | false positive | Logs `sorted(prepared_params)`: parameter key names only. |

Residual risk: the three "won't fix" items let an operator turn off TLS verification for the ConnectWise and PAN-OS connectors. That is acceptable only on a management network the firm controls. Prefer adding the appliance's CA to the Node trust store with `NODE_EXTRA_CA_CERTS` over turning verification off.

## Re-check

```bash
gh api "repos/w159/tech-tools/dependabot/alerts?state=open" --jq length
gh api "repos/w159/tech-tools/code-scanning/alerts?state=open" --jq length
gh api "repos/w159/tech-tools/secret-scanning/alerts?state=open" --jq length
```
