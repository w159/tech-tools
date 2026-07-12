# Atlas connectors reference

Ten vendor MCP connectors exist across four domain plugins - atlas does not ship or
bundle any of them. All are inert by default: every `userConfig` key on the owning
plugin defaults to empty, so with no credentials each server fails its own credential
check and does not load. Filling a vendor's required keys **on its owning plugin** is
what enables it.

| Domain plugin | Connectors |
| --- | --- |
| it-operations | auvik, connectwise-manage, ninjaone, spanning |
| security-compliance | blumira, knowbe4, threatlocker, vanta |
| microsoft-365 | cipp |
| hr-payroll | paylocity |

Each domain plugin ships its own `.mcp.json` and declares its own `userConfig`
credential keys in its `.claude-plugin/plugin.json`. Install the owning plugin via
`/plugin` first, then set its `userConfig` keys via `/plugin config` on that plugin -
never on atlas.

## userConfig key reference

A connector is ENABLED when its required keys are all non-empty on its owning plugin.
"Required to enable" lists the minimum keys that make the server boot and
authenticate; the remaining keys are optional. Every `*_base_url` (and
region/platform/url) key is optional and resolves to the vendor default when left
blank.

| Connector (svc dir) | Owning plugin | userConfig keys | Required to enable | Base-URL / region default | Where to get credentials |
|---|---|---|---|---|---|
| Auvik (auvik-mcp) | it-operations | auvik_username, auvik_api_key, auvik_region | auvik_username, auvik_api_key | auvik_region default `us1` | Auvik web app: Admin -> API. docs/vendors/auvik/ |
| Blumira (blumira-mcp) | security-compliance | blumira_jwt_token, blumira_client_id, blumira_client_secret, blumira_base_url | Either blumira_jwt_token, OR blumira_client_id + blumira_client_secret | base_url default `https://api.blumira.com/public-api/v1` | Blumira app: Settings -> API keys (OAuth2 client, or pre-issued JWT). docs/vendors/blumira/ |
| CIPP (cipp-mcp) | microsoft-365 | cipp_base_url, cipp_api_key, cipp_tenant_id, cipp_client_id, cipp_client_secret | cipp_base_url, plus EITHER cipp_api_key (legacy static token) OR cipp_tenant_id + cipp_client_id + cipp_client_secret | base_url is your self-hosted CIPP URL (no public default) | Your self-hosted CIPP instance: API config / Entra app registration. docs/vendors/cipp/ |
| ConnectWise Manage (connectwise-manage-mcp) | it-operations | cw_manage_company_id, cw_manage_public_key, cw_manage_private_key, cw_manage_client_id, cw_manage_base_url | cw_manage_company_id, cw_manage_public_key, cw_manage_private_key, cw_manage_client_id | base_url default `https://api-na.myconnectwise.net` | CW Manage: System -> Members -> API Members (public/private keys); developer.connectwise.com (clientId). docs/vendors/connectwise-manage/ |
| Spanning (kaseya-spanning-backup-mcp) | it-operations | spanning_admin_email, spanning_api_token, spanning_platform, spanning_api_url | spanning_admin_email, spanning_api_token | platform default `m365`; api_url default per platform | Spanning admin console: Settings -> API token. docs/vendors/spanning/ |
| KnowBe4 (knowbe4-mcp) | security-compliance | knowbe4_api_key, knowbe4_region, knowbe4_base_url | knowbe4_api_key | region default `us`; base_url default per region | KnowBe4 console: Account Settings -> API (Reporting API key). docs/vendors/knowbe4/ |
| NinjaOne (ninjaone-mcp) | it-operations | ninjaone_client_id, ninjaone_client_secret, ninjaone_region, ninjaone_auth_mode, ninjaone_base_url | ninjaone_client_id, ninjaone_client_secret (for client_credentials) | region default `us`; auth_mode default `client_credentials`; base_url default per region | NinjaOne: Administration -> Apps -> API (create API application). docs/vendors/ninjaone/ |
| Paylocity (paylocity-mcp) | hr-payroll | paylocity_client_id, paylocity_client_secret, paylocity_company_id, paylocity_base_url, paylocity_sandbox | paylocity_client_id, paylocity_client_secret | base_url default `https://api.paylocity.com`; sandbox default off | Paylocity: API partner credentials issued by Paylocity. docs/vendors/paylocity/ |
| ThreatLocker (threatlocker-mcp) | security-compliance | threatlocker_api_key, threatlocker_organization_id, threatlocker_base_url | threatlocker_api_key | base_url default per shard | ThreatLocker portal: API user key under your account. docs/vendors/threatlocker/ |
| Vanta (vanta-mcp) | security-compliance | vanta_client_id, vanta_client_secret, vanta_base_url | vanta_client_id, vanta_client_secret | base_url default `https://api.vanta.com/v1` | Vanta: Settings -> Developer / API (OAuth2 client). docs/vendors/vanta/ |

For deeper per-vendor behavior, scopes, and tool documentation, read the matching
`docs/vendors/<dir>/` folder in the repo. The dir name is the last path segment
shown above (e.g. `docs/vendors/spanning/` for Spanning).

## Setting credentials (owning plugin only)

1. Install the owning domain plugin if it isn't already: `/plugin install
   <domain-plugin>` (e.g. `it-operations`, `security-compliance`, `microsoft-365`,
   `hr-payroll`).
2. Open `/plugin config` for that plugin and set the connector's required
   `userConfig` keys listed above. Optional keys, including every base URL, may
   stay blank to use the vendor default.
3. The connector loads on next use of that plugin's MCP server - no separate
   extraction or bundle step. If required keys are still empty, the server fails
   its own credential check and stays inert.

## Migration note (atlas < 2.6.0)

Prior to atlas 2.6.0, atlas bundled its own copy of each connector's packaged MCP
server and declared the same `userConfig` keys under its own plugin config. Those
atlas-side copies are gone as of 2.6.0; the domain plugins above are now the single
source. Any credentials previously entered on atlas's plugin config must be
re-entered on the owning domain plugin via `/plugin`.
