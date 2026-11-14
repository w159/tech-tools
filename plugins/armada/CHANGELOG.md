# Changelog

## 2.3.1 - 2026-11-14

### Security

- Auvik: the server no longer loads `.env` from the launch directory, which let any working directory set the credentials. The region is checked against the Auvik shard list (us1-us6, eu1, eu2, au1, ca1) wherever it comes from (env, the `x-auvik-region` header, the client), because it is part of the host that receives the Basic-auth header; an unknown value falls back to us1 and is reported by source name only. Region redirects are followed only to another Auvik API host over https. Bundle `mcp/auvik/server.mjs` rebuilt; the 39 tools are unchanged.
- Falcon: the server no longer calls `load_dotenv`, and the base URL must be https (http only for loopback); a bad value shows as `INVALID_BASE_URL` in status.

### Fixed

- Enterprise setup guide: added the clone step (the installed plugin does not ship `mcp_servers/`), `npm ci` before the admin tool build (without it `tsc` fails with TS2307 on `jose`), and staging of `scripts/gen-jwks.mjs`, which the image build needs.
- Tests: `tests/test_armada_security.py`, `mcp/falcon/tests/test_transport_security.py`, `auvik-mcp/tests/region.test.ts`. armada 39 passed, falcon 1498 passed, auvik vitest 40 passed, tool harness 574 tools pass.
- Not changed: the shipped CIPP, Auvik and gateway bundles were built before the Oct 27 dependency bumps; a pinned esbuild/tsup/node rebuild and a CI bundle diff are still open.

## 2.3.0 - 2026-11-10

### Changed

- The CIPP connector is now a remote MCP server configured by the instance URL
  (`cipp_mcp_url`, the `/api/ExecMcp` endpoint) and the OAuth client id of the Entra app
  registration (`cipp_client_id`, a public client id, default `a0b18b3a-2064-457f-ab94-1fdb5c11ca80`). The client id,
  declared as `oauth.clientId` on the `.mcp.json` entry, is what makes Claude Code sign in with
  that app registration instead of using dynamic client registration. CIPP runs the Microsoft
  sign-in for each user and every call runs with that user's own CIPP role; the five old CIPP
  credential fields (base URL, API key, tenant ID, client ID, client secret) are gone from the
  plugin's user config. The `oauth.clientId` shape follows Claude Code's MCP config
  (`claude mcp add --transport http --client-id`); the client-id sign-in was not exercised
  against a live CIPP instance in this change. The gateway's CIPP backend is unchanged - `catalog/overrides.json` keeps
  its launch line, so the generated catalog is byte-identical.

## 2.2.3 - 2026-11-03

### Fixed

- The data skill packager works under dotted parent dirs, skips its own output zip and fails on zero files.
- The env loader treats an empty shell export as unset.
- The release workflow fails on a fatal `git ls-remote` instead of creating a release.

## 2.2.2 - 2026-11-02

### Fixed

- `discover-brand` agent reference paths corrected.
- `mcp/_env/load.py` prints usage on `--help`.
- The release zip no longer includes caches or tests.

### Tests

- Contract test covers the corrected paths and `load.py --help`.

## 2.2.1 - 2026-10-27

### Fixed

- SonicWall connector bundle (`mcp/sonicwall/server.mjs`) rebuilt after the `client.ts` HTTP error-message fix for CodeQL alert 43. Runtime output is unchanged.

## 2.2.0 - 2026-10-27

### Fixed

- PAN-OS connector sends the `action` parameter on partial and commit-all commits.
- ConnectWise connector: per-request TLS relaxation, bounded redirects and redacted token-exchange errors.
- NinjaOne connector bundle refreshed; Falcon connector tests are hermetic.

### Changed

- Connector audits moved to `docs/audits/`; READMEs and unit tests added for four connectors.

## 2.1.0 - 2026-10-27

### Added

- Enterprise mode, Azure first. New skill `armada-enterprise` deploys the MCP gateway (`mcp_servers/mcp-gateway`) for an organization, maps Entra directory groups to connector roles, reviews audit logs, and adds the org connector to Claude. Procedures live in `skills/armada-enterprise/references/` (`setup.md`, `policy.md`, `audit.md`, `connect.md`).
- Setup is interactive and drives the gateway admin tool (`discover`, `plan`, `provision`). Provisioning is a dry run until the admin says yes.
- `enterprise/`: Bicep template for Azure (Container Apps, Key Vault, Log Analytics), the five saved audit queries as KQL, and an example `policy.yaml`. The Google Cloud Terraform and Cloud Logging filters are kept but not yet supported.
- Contract tests for the new skill, its references, and the enterprise layout.

### Changed

- The `armada` router skill and README name `armada-enterprise`. The router stays read-only.

## 2.0.0 - 2026-10-27

### BREAKING

- armada now ships the 13 vendor MCP connectors that atlas shipped through 15.x: auvik, blumira, cipp, connectwise, falcon, knowbe4, ninjaone, panos, paylocity, sonicwall, spanning, threatlocker, vanta. Files: `plugins/armada/.mcp.json` and `plugins/armada/mcp/`, plus the shared `mcp/_env` loaders.
- Tool names change from `mcp__plugin_atlas_<svc>__*` to `mcp__plugin_armada_<svc>__*`. Update permission allow and deny rules.
- The 57 connector `userConfig` keys now live in armada `plugin.json`. Credentials saved under `atlas@tech-tools` are still read as a fallback; new saves go under armada. `~/.config/atlas/atlas.env` still works.
- Install with `/plugin install armada@tech-tools` and restart. Steps: [README.md](README.md#upgrading-connectors-moved-from-atlas-to-armada).

### Changed

- Env loaders read `armada@` saved options first, then `atlas@`.
- `connector_credential_watch` remains an atlas hook and fires only when both atlas and armada are installed.
- The atlas dashboard and control plane resolve armada through `scripts/armada_root.py` (atlas 16.0.0).

## 1.1.1

- Department layer split out of atlas: 4 setup skills, 11 department agents, 156 department skills. See the repository history for earlier changes.
