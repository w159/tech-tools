# Changelog

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
