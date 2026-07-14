# Atlas connectors reference

Ten vendor MCP connectors are bundled inside the atlas plugin. All are inert by
default: every `userConfig` key on the atlas plugin defaults to `""`, so with no
credentials each server fails its own credential check and does not load. Filling
a vendor's required keys **on the atlas plugin** via `/plugin config` is what
enables it.

| Department | Connectors |
| --- | --- |
| `mcp/hr/` | paylocity |
| `mcp/it-operations/` | auvik, connectwise, ninjaone, spanning |
| `mcp/microsoft-365/` | cipp |
| `mcp/security/` | blumira, knowbe4, threatlocker, vanta |

## userConfig key reference

A connector is ENABLED when its required keys are all non-empty on the atlas
plugin. "Required to enable" lists the minimum keys that make the server boot
and authenticate; the remaining keys are optional. Every `*_base_url` (and
region/platform/url) key is optional and resolves to the vendor default when left
blank.

| Connector (bundle) | Owning plugin | userConfig keys | Required to enable | Base-URL / region default | Where to get credentials | Bundle path |
|---|---|---|---|---|---|---|
| Auvik (auvik.mcpb) | atlas | auvik_username, auvik_api_key, auvik_region | auvik_username, auvik_api_key | auvik_region default `us1` | Auvik web app: Admin -> API. | `plugins/atlas/mcp/it-operations/` |
| Blumira (blumira.mcpb) | atlas | blumira_jwt_token, blumira_client_id, blumira_client_secret, blumira_base_url | Either blumira_jwt_token, OR blumira_client_id + blumira_client_secret | base_url default `https://api.blumira.com/public-api/v1` | Blumira app: Settings -> API keys (OAuth2 client, or pre-issued JWT). | `plugins/atlas/mcp/security/` |
| CIPP (cipp.mcpb) | atlas | cipp_base_url, cipp_api_key, cipp_tenant_id, cipp_client_id, cipp_client_secret | cipp_base_url, plus EITHER cipp_api_key (legacy static token) OR cipp_tenant_id + cipp_client_id + cipp_client_secret | base_url is your self-hosted CIPP URL (no public default) | Your self-hosted CIPP instance: API config / Entra app registration. | `plugins/atlas/mcp/microsoft-365/` |
| ConnectWise Manage (connectwise.mcpb) | atlas | cw_manage_company_id, cw_manage_public_key, cw_manage_private_key, cw_manage_client_id, cw_manage_base_url | cw_manage_company_id, cw_manage_public_key, cw_manage_private_key, cw_manage_client_id | base_url default `https://api-na.myconnectwise.net` | CW Manage: System -> Members -> API Members (public/private keys); developer.connectwise.com (clientId). | `plugins/atlas/mcp/it-operations/` |
| Spanning (spanning.mcpb) | atlas | spanning_admin_email, spanning_api_token, spanning_platform, spanning_api_url | spanning_admin_email, spanning_api_token | platform default `m365`; api_url default per platform | Spanning admin console: Settings -> API token. | `plugins/atlas/mcp/it-operations/` |
| KnowBe4 (knowbe4.mcpb) | atlas | knowbe4_api_key, knowbe4_region, knowbe4_base_url | knowbe4_api_key | region default `us`; base_url default per region | KnowBe4 console: Account Settings -> API (Reporting API key). | `plugins/atlas/mcp/security/` |
| NinjaOne (ninjaone.mcpb) | atlas | ninjaone_client_id, ninjaone_client_secret, ninjaone_region, ninjaone_auth_mode, ninjaone_base_url | ninjaone_client_id, ninjaone_client_secret (for client_credentials) | region default `us`; auth_mode default `client_credentials`; base_url default per region | NinjaOne: Administration -> Apps -> API (create API application). | `plugins/atlas/mcp/it-operations/` |
| Paylocity (paylocity.mcpb) | atlas | paylocity_client_id, paylocity_client_secret, paylocity_company_id, paylocity_base_url, paylocity_sandbox | paylocity_client_id, paylocity_client_secret | base_url default `https://api.paylocity.com`; sandbox default off | Paylocity: API partner credentials issued by Paylocity. | `plugins/atlas/mcp/hr/` |
| ThreatLocker (threatlocker.mcpb) | atlas | threatlocker_api_key, threatlocker_organization_id, threatlocker_base_url | threatlocker_api_key | base_url default per shard | ThreatLocker portal: API user key under your account. | `plugins/atlas/mcp/security/` |
| Vanta (vanta.mcpb) | atlas | vanta_client_id, vanta_client_secret, vanta_base_url | vanta_client_id, vanta_client_secret | base_url default `https://api.vanta.com/v1` | Vanta: Settings -> Developer / API (OAuth2 client). | `plugins/atlas/mcp/security/` |

For deeper per-vendor behavior, scopes, and tool documentation, extract the
matching `.mcpb` bundle and read its `manifest.json` and `README.md`. The bundle
path is shown above.

## Setting credentials (atlas plugin only)

1. Open `/plugin config` for the **atlas plugin**.
2. Set the connector's required `userConfig` keys listed above. Optional keys,
   including every base URL, may stay blank to use the vendor default.
3. The connector loads on next use of the atlas plugin's MCP server. If required
   keys are still empty, the server fails its own credential check and stays
   inert.

## Migration note (atlas < 2.6.0)

Prior to atlas 2.6.0, atlas bundled its own copy of each connector's packaged MCP
server and declared the same `userConfig` keys under its own plugin config. From
2.6.0 through 5.0.x the connectors were moved to separate domain plugins. As of
this release they are consolidated back into the atlas plugin under
`plugins/atlas/mcp/`. Any credentials previously entered on a domain plugin's
config must be re-entered on the atlas plugin via `/plugin config`.
