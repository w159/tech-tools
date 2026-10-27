# Atlas connectors reference

Thirteen vendor MCP connectors are bundled inside the armada plugin under a **flat**
layout: `plugins/armada/mcp/<name>/` (install atlas and armada together). All Node connectors ship as a single
`server.mjs` ESM bundle. Falcon ships as vendored Python source
(`pyproject.toml` + `falcon_mcp/`) and is launched with `uv`.

They are intended to be **inert by default**: every `userConfig` key on the armada
plugin defaults to `""`. Filling a vendor's required keys **on the armada plugin**
(dashboard Credentials, `/plugin config`, or plugin `.env`) is what enables it.

| Kind | Connectors |
| --- | --- |
| Node bundles (`mcp/<name>/server.mjs`) | auvik, blumira, cipp, connectwise, spanning, knowbe4, ninjaone, panos, paylocity, threatlocker, vanta, sonicwall |
| Python vendored (`mcp/falcon/`) | falcon (requires `uv` on PATH) |

## userConfig key reference

A connector is ENABLED when its required keys are all non-empty on the armada
plugin. "Required to enable" lists the minimum keys that make authenticated calls
possible; remaining keys are optional. Every `*_base_url` (and region/platform)
key is optional and resolves to the vendor default when left blank.

Verified 2026-09-02 against `plugins/armada/.mcp.json`,
`plugins/armada/.claude-plugin/plugin.json`, wiring unit tests, and live stdio probes.

| Connector | Entry point | userConfig keys | Required to enable | Base-URL / region default | Where to get credentials |
|---|---|---|---|---|---|
| Auvik | `mcp/auvik/server.mjs` | auvik_username, auvik_api_key, auvik_region | auvik_username, auvik_api_key | region default `us1` | Auvik web app: Admin → API |
| Blumira | `mcp/blumira/server.mjs` | blumira_jwt_token, blumira_client_id, blumira_client_secret, blumira_base_url | Either blumira_jwt_token **or** blumira_client_id + blumira_client_secret | base_url default `https://api.blumira.com/public-api/v1` | Blumira app: Settings → API keys |
| CIPP | `mcp/cipp/server.mjs` | cipp_base_url, cipp_api_key, cipp_tenant_id, cipp_client_id, cipp_client_secret | cipp_base_url, plus EITHER cipp_api_key **or** cipp_tenant_id + cipp_client_id + cipp_client_secret | self-hosted CIPP URL (no public default) | Self-hosted CIPP / Entra app registration |
| ConnectWise Manage | `mcp/connectwise/server.mjs` | cw_manage_company_id, cw_manage_public_key, cw_manage_private_key, cw_manage_client_id, cw_manage_base_url | all four non-base_url keys | base_url default `https://api-na.myconnectwise.net` | CW Manage API Members + developer.connectwise.com clientId |
| Spanning | `mcp/spanning/server.mjs` | spanning_admin_email, spanning_api_token, spanning_platform, spanning_api_url | spanning_admin_email, spanning_api_token | platform default `m365` | Spanning admin console → API token |
| CrowdStrike Falcon | `mcp/falcon/` (Python) | falcon_client_id, falcon_client_secret, falcon_base_url, falcon_member_cid | falcon_client_id, falcon_client_secret | base_url default `https://api.crowdstrike.com` | Falcon console → API clients and keys |
| KnowBe4 | `mcp/knowbe4/server.mjs` | knowbe4_api_key, knowbe4_region, knowbe4_base_url | knowbe4_api_key | region default `us` | KnowBe4 → Account Settings → API |
| NinjaOne | `mcp/ninjaone/server.mjs` | ninjaone_client_id, ninjaone_client_secret, ninjaone_region, ninjaone_auth_mode, ninjaone_base_url | ninjaone_client_id, ninjaone_client_secret | region default `us` | NinjaOne → Administration → Apps → API |
| Paylocity | `mcp/paylocity/server.mjs` | paylocity_client_id, paylocity_client_secret, paylocity_company_id, paylocity_base_url, paylocity_sandbox | paylocity_client_id, paylocity_client_secret | base_url default `https://api.paylocity.com` | Paylocity API partner credentials |
| ThreatLocker | `mcp/threatlocker/server.mjs` | threatlocker_api_key, threatlocker_organization_id, threatlocker_base_url | threatlocker_api_key | base_url must match portal instance (blank assumes instance `g`, not universal) | ThreatLocker portal → API user key |
| Vanta | `mcp/vanta/server.mjs` | vanta_client_id, vanta_client_secret, vanta_base_url | vanta_client_id, vanta_client_secret | base_url default `https://api.vanta.com/v1` | Vanta → Settings → Developer / API |
| PAN-OS | `mcp/panos/server.mjs` | panos_host, panos_api_key, panos_username, panos_password, panos_target, panos_verify_tls, panos_rest_version | panos_host + panos_api_key (username + password only generate a key) | see `docs/panos-connector-design.md` for defaults | PAN-OS firewall or Panorama admin account (API key) |
| SonicWall | `mcp/sonicwall/server.mjs` | sonicwall_host, sonicwall_username, sonicwall_password, sonicwall_port, sonicwall_verify_tls, sonicwall_session_override | sonicwall_host, sonicwall_username, sonicwall_password | no vendor default host (the appliance); port default `443`, verify_tls default `true`, session_override default `false` | SonicOS → Device → Settings → Administration (dedicated API admin) |

## Tool disclosure (verified live)

| Pattern | Connectors | Cold-start tools/list (this workspace) |
|---|---|---|
| Credential-gated shell | connectwise | 2 until keys complete |
| Navigate + status shell | blumira | 2 |
| Always-on full catalog + `*_status` | auvik 39, cipp 43, spanning 14, knowbe4 30, ninjaone 45, paylocity 16, threatlocker 19, vanta 28 | full list; domain tools fail with MISSING_CREDENTIALS when unconfigured |
| Falcon inert-then-full | falcon | **4** tools unconfigured (`falcon_status` → MISSING_CREDENTIALS); full catalog after auth |

## Setting credentials (armada plugin)

1. Prefer dashboard Credentials, or `/plugin config` on **armada**. Values saved under atlas and
   `~/.config/atlas/atlas.env` are still read as a fallback.
2. Set required keys only; leave optional base URLs blank unless needed.
3. Reload Claude Code so MCP children re-read config.
4. Prefer each connector's `*_status` tool before domain calls (including `falcon_status`).

## Migration note

Older docs referred to department folders (`mcp/hr/`, `mcp/it-operations/`, …) and
`.mcpb` bundles. Those paths are **obsolete**. Current source is flat
`mcp/<name>/server.mjs` (or `mcp/falcon/` for Python). Credentials always live on
the **armada** plugin.
