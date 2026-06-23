# Atlas connectors reference

Ten vendor MCP connectors ship with the atlas plugin. All are inert by default:
every userConfig key defaults to empty, so with no credentials each server fails
its own credential check and does not load. Filling a vendor's required keys is
what enables it.

Atlas does NOT bundle the vendor `.mcpb` archives (they total roughly 297MB).
Each bundle is located and extracted on demand the first time its connector is
used. See "Making a bundle available" at the bottom.

## userConfig key reference

A connector is ENABLED when its required keys are all non-empty. "Required to
enable" lists the minimum keys that make the server boot and authenticate; the
remaining keys are optional. Every `*_base_url` (and region/platform/url) key is
optional and resolves to the vendor default when left blank.

| Connector (svc dir) | userConfig keys | Required to enable | Base-URL / region default | Where to get credentials |
|---|---|---|---|---|
| Auvik (auvik-mcp) | auvik_username, auvik_api_key, auvik_region | auvik_username, auvik_api_key | auvik_region default `us1` | Auvik web app: Admin -> API. docs/vendors/auvik/ |
| Blumira (blumira-mcp) | blumira_jwt_token, blumira_client_id, blumira_client_secret, blumira_base_url | Either blumira_jwt_token, OR blumira_client_id + blumira_client_secret | base_url default `https://api.blumira.com/public-api/v1` | Blumira app: Settings -> API keys (OAuth2 client, or pre-issued JWT). docs/vendors/blumira/ |
| CIPP (cipp-mcp) | cipp_base_url, cipp_api_key, cipp_tenant_id, cipp_client_id, cipp_client_secret | cipp_base_url, plus EITHER cipp_api_key (legacy static token) OR cipp_tenant_id + cipp_client_id + cipp_client_secret | base_url is your self-hosted CIPP URL (no public default) | Your self-hosted CIPP instance: API config / Entra app registration. docs/vendors/cipp/ |
| ConnectWise Manage (connectwise-manage-mcp) | cw_manage_company_id, cw_manage_public_key, cw_manage_private_key, cw_manage_client_id, cw_manage_base_url | cw_manage_company_id, cw_manage_public_key, cw_manage_private_key, cw_manage_client_id | base_url default `https://api-na.myconnectwise.net` | CW Manage: System -> Members -> API Members (public/private keys); developer.connectwise.com (clientId). docs/vendors/connectwise-manage/ |
| Spanning (kaseya-spanning-backup-mcp) | spanning_admin_email, spanning_api_token, spanning_platform, spanning_api_url | spanning_admin_email, spanning_api_token | platform default `m365`; api_url default per platform | Spanning admin console: Settings -> API token. docs/vendors/spanning/ |
| KnowBe4 (knowbe4-mcp) | knowbe4_api_key, knowbe4_region, knowbe4_base_url | knowbe4_api_key | region default `us`; base_url default per region | KnowBe4 console: Account Settings -> API (Reporting API key). docs/vendors/knowbe4/ |
| NinjaOne (ninjaone-mcp) | ninjaone_client_id, ninjaone_client_secret, ninjaone_region, ninjaone_auth_mode, ninjaone_base_url | ninjaone_client_id, ninjaone_client_secret (for client_credentials) | region default `us`; auth_mode default `client_credentials`; base_url default per region | NinjaOne: Administration -> Apps -> API (create API application). docs/vendors/ninjaone/ |
| Paylocity (paylocity-mcp) | paylocity_client_id, paylocity_client_secret, paylocity_company_id, paylocity_base_url, paylocity_sandbox | paylocity_client_id, paylocity_client_secret | base_url default `https://api.paylocity.com`; sandbox default off | Paylocity: API partner credentials issued by Paylocity. docs/vendors/paylocity/ |
| ThreatLocker (threatlocker-mcp) | threatlocker_api_key, threatlocker_organization_id, threatlocker_base_url | threatlocker_api_key | base_url default per shard | ThreatLocker portal: API user key under your account. docs/vendors/threatlocker/ |
| Vanta (vanta-mcp) | vanta_client_id, vanta_client_secret, vanta_base_url | vanta_client_id, vanta_client_secret | base_url default `https://api.vanta.com/v1` | Vanta: Settings -> Developer / API (OAuth2 client). docs/vendors/vanta/ |

For deeper per-vendor behavior, scopes, and tool documentation, read the matching
`docs/vendors/<dir>/` folder in the repo. The dir name is the last path segment
shown above (e.g. `docs/vendors/spanning/` for Spanning).

## Making a bundle available (extract-on-demand)

The connector launcher (`mcp/launch.sh`) calls `mcp/extract.sh`, which searches
for `<svc-dir>.mcpb` in this order and uses the first hit:

1. `${CLAUDE_PLUGIN_DATA}/mcp/<svc-dir>.mcpb` - drop the bundle here.
2. `${ATLAS_MCP_SOURCE_DIR}/<svc-dir>.mcpb` - set that env var to a directory of bundles.
3. `<repo>/mcp_servers/<svc-dir>/<svc-dir>.mcpb` - reachable when running from the source checkout.

Note: the bundle filename matches the svc dir, e.g. `auvik-mcp.mcpb`,
`vanta-mcp.mcpb`, `kaseya-spanning-backup-mcp.mcpb`.

Option A - copy one bundle into the plugin data dir:

```
mkdir -p "${CLAUDE_PLUGIN_DATA}/mcp"
cp /path/to/tech-tools/mcp_servers/<svc-dir>/<svc-dir>.mcpb "${CLAUDE_PLUGIN_DATA}/mcp/"
```

Option B - point at a directory that holds the bundles:

```
export ATLAS_MCP_SOURCE_DIR=/path/to/tech-tools/built-mcpb
```

If no bundle is found, the connector stays declared but not set up, and its
launcher exits with: "Connector <svc-dir> is declared but not set up. Run
/atlas-connectors and complete setup for <svc-dir>." It never crashes.
