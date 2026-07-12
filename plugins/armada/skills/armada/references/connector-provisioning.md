# Connector Provisioning

Vendor MCP connectors are provisioned per department. Credentials are
collected via the atlas plugin's `userConfig` keys (set through `/plugin
config`), never through free-text chat.

## Connector ownership

| Connector | Owning department | userConfig keys | Required to enable |
|---|---|---|---|
| NinjaOne | it-operations | ninjaone_client_id, ninjaone_client_secret | client_id + client_secret |
| ConnectWise Manage | it-operations | cw_manage_company_id, cw_manage_public_key, cw_manage_private_key, cw_manage_client_id, cw_manage_base_url | company_id + public_key + private_key + client_id + base_url |
| Auvik | it-operations | auvik_username, auvik_api_key | username + api_key |
| Kaseya Spanning | it-operations | spanning_admin_email, spanning_api_token | admin_email + api_token |
| Vanta | security | vanta_client_id, vanta_client_secret | client_id + client_secret |
| KnowBe4 | security | knowbe4_api_key | api_key |
| ThreatLocker | security | threatlocker_api_key | api_key |
| Blumira | security | blumira_jwt_token (or blumira_client_id + blumira_client_secret) | jwt_token OR client_id + client_secret |
| CIPP | microsoft-365 | cipp_base_url, cipp_api_key (or cipp_tenant_id + cipp_client_id + cipp_client_secret) | base_url + (api_key OR tenant_id + client_id + client_secret) |
| Paylocity | hr | paylocity_client_id, paylocity_client_secret, paylocity_company_id | client_id + client_secret + company_id |
| PandaDoc | finance | pandadoc_api_key | api_key |
| Pax8 | finance | pax8_mcp_token | mcp_token |

## Provisioning flow

For each connector a department needs:

1. **Check if the connector is already provisioned.** Read the org config's
   `connectors.provisioned` list. If the connector is listed as `enabled`, it
   is ready.
2. **If not provisioned, guide setup.** Tell the user:
   - Which `userConfig` keys to set (from the table above)
   - Where to get each credential (vendor portal path)
   - That optional base-url keys can stay blank to use the vendor default
   - To set keys via `/plugin config` on the atlas plugin
3. **Verify.** After the user sets the keys, recheck and confirm the connector
   is enabled.
4. **Record.** Update the org config's `connectors.provisioned` list.

## Base URL handling

Every vendor connector has a documented default base URL. The `*_base_url`
userConfig keys are optional and default to the vendor's documented endpoint.
Only set a base URL for staging/sovereign-cloud shards. See `.env.template` for
the per-vendor defaults.

## Guardrails

- Never invent credential values. Collect them from the operator.
- Only collect the keys a chosen connector actually needs; do not over-ask.
- Leaving an optional base-url key blank is correct and expected.
- Credentials are never stored in the org config or echoed back in chat.
- The connector's own `*_status` tool (runs without credentials) reports the
  configured-vs-missing state.