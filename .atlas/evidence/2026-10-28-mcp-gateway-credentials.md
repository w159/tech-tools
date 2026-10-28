# Evidence: MCP gateway connector credential wiring and live per-connector verification (2026-10-28)

Observed behaviour, captured from the running system and the vault, on
2026-10-28. Nothing here is inferred. No secret, token, password or API
key value is reproduced anywhere in this file - only names, lengths,
status codes and vendor error text.

Deployment under test: Container App `gwh-mcp-gateway` in resource group
`gwh-mcp-gateway-rg`, revision `gwh-mcp-gateway--0000005`, broker mode,
upstream IdP Entra, tenant `f00db7e5-ade5-49b2-b9cd-8813b81ef30a`. Public
base URL: `https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io`.

## 1. Key Vault secret list

`az keyvault secret list --vault-name gwh-mcp-gateway-kv --query "[].name" -o tsv`

29 vendor secrets (names only, no values):

```
auvik-username
auvik-region
cw-manage-company-id
cw-manage-public-key
cw-manage-private-key
cw-manage-client-id
cw-manage-url
falcon-client-id
falcon-client-secret
falcon-base-url
knowbe4-api-key
knowbe4-region
ninjaone-client-id
ninjaone-client-secret
ninjaone-region
panos-host
panos-api-key
panos-verify-tls
paylocity-client-id
paylocity-client-secret
paylocity-company-id
spanning-admin-email
spanning-platform
spanning-api-url
threatlocker-api-key
threatlocker-organization-id
threatlocker-base-url
vanta-client-id
vanta-client-secret
```

Plus the pre-existing broker secrets: `broker-upstream-client-secret`,
`broker-signing-jwks`, `broker-cookie-keys`, `audit-hmac-key`,
`policy-yaml`.

Each container secret is a Key Vault reference
(`keyvaultref:https://gwh-mcp-gateway-kv.vault.azure.net/secrets/<name>`),
resolved through the user-assigned identity `gwh-mcp-gateway-id`, which
holds **Key Vault Secrets User** on the vault - confirmed by
`az containerapp secret list -g gwh-mcp-gateway-rg -n gwh-mcp-gateway`
showing `keyVaultUrl` + `identity` on every vendor secret, not a plain
value.

## 2. Container env list

`az containerapp show -g gwh-mcp-gateway-rg -n gwh-mcp-gateway --query "properties.template.containers[0].env[].name" -o tsv`

UPPER_CASE connector env vars present, each a `secretRef` (not a literal):
`AUVIK_USERNAME`, `AUVIK_REGION`, `CW_MANAGE_COMPANY_ID`,
`CW_MANAGE_CLIENT_ID`, `CW_MANAGE_URL`, `CW_MANAGE_PUBLIC_KEY`,
`CW_MANAGE_PRIVATE_KEY`, `FALCON_CLIENT_ID`, `FALCON_CLIENT_SECRET`,
`FALCON_BASE_URL`, `KNOWBE4_API_KEY`, `KNOWBE4_REGION`,
`NINJAONE_CLIENT_ID`, `NINJAONE_CLIENT_SECRET`, `NINJAONE_REGION`,
`PANOS_HOST`, `PANOS_API_KEY`, `PANOS_VERIFY_TLS`, `PAYLOCITY_CLIENT_ID`,
`PAYLOCITY_CLIENT_SECRET`, `PAYLOCITY_COMPANY_ID`, `SPANNING_ADMIN_EMAIL`,
`SPANNING_PLATFORM`, `SPANNING_API_URL`, `THREATLOCKER_API_KEY`,
`THREATLOCKER_ORGANIZATION_ID`, `THREATLOCKER_BASE_URL`,
`VANTA_CLIENT_ID`, `VANTA_CLIENT_SECRET`.

A lowercase-named env var (e.g. a stray `falcon-client-secret`) is
dropped silently by the gateway's prefix allowlist
(`mcp_servers/mcp-gateway/src/backends.ts`, `ALLOWED_COMMON_ENV` +
`envPrefixes` from `catalog/catalog.json`, matched with
`key.startsWith(p)`) - this was hit and fixed during this work by
renaming the env var to UPPER_CASE; the underlying Key Vault secret name
stays lowercase-hyphen.

## 3. tools/list: 396 tools, up from 208

Real Entra sign-in (dynamic client registration, PKCE S256, scope
`mcp offline_access`), interactive consent in the user's own Chrome, no
password/MFA/CAPTCHA prompt. Token: `type=Bearer expires_in=900 scope=mcp`,
refresh token present, claims `roles=["company","it"]`, `idp=entra`. No
token value recorded.

`tools/list` returned **396 tools**, byte-identical across two calls in
the same session:

```
falcon          145
panos            60
connectwise      49
ninjaone         45
threatlocker     30
knowbe4          30
vanta            28
spanning          2
sonicwall         2
auvik             2
blumira           2
cipp              1
paylocity         0
------------------
total           396
```

`paylocity` returned 0 tools because its only grant is the `hr` role;
the signed-in user holds `company`/`it`. That is the role model working
as designed, not a fault.

Delta against the previous verification on the same gateway, recorded in
`.atlas/evidence/2026-10-28-mcp-gateway-broker-mode.md` §9 (before this
credential work): **208 -> 396**, entirely from `falcon` (4 -> 145) and
`connectwise` (2 -> 49) gaining their full credential set.

## 4. Per-connector status, called through the gateway

Each row is the connector's own status tool, invoked through the gateway
with the session token above.

| Connector | Result | Detail (vendor-exact, no values) |
|---|---|---|
| falcon | authenticated | `"state":"OK"`, `"authenticated":true`, `"mode":"full"`; `falcon_search_hosts` returned real host data |
| connectwise | authenticated | all five `CW_MANAGE_*` set; `baseUrl https://api-na.myconnectwise.net/v4_6_release/apis/3.0`; `cw_list_boards` returned 10 real boards; `cw_test_connection` -> version `v2025.1.10771`, `isCloud true` |
| ninjaone | authenticated | "Auth check: OK (HTTP 200, 456 ms)"; `ninjaone_organizations_list` returned real organizations |
| panos | unreachable | "Auth check: FAILED: timed out after 10s" - `PANOS_HOST` is a private address (`10.8.254.3`) on the corporate VPN, unreachable from Azure |
| knowbe4 | auth-rejected | "FAILED HTTP 401: Invalid Token" |
| vanta | auth-rejected | "Vanta token mint failed: 401" |
| threatlocker | auth-rejected | "440 TOKEN_REVOKED: no ThreatLocker instance (b-h) recognizes this API key ... Mint a new API User token; tools will fail until then." |
| paylocity | auth-rejected (vendor) | `invalid_client` on `POST https://api.paylocity.com/IdentityServer/connect/token` |
| auvik | not configured | "NOT CONFIGURED" |
| blumira | not configured | "NOT CONFIGURED" |
| cipp | not configured | "NOT CONFIGURED" |
| sonicwall | not configured | "NOT CONFIGURED" |
| spanning | not configured | "SKIPPED (no credentials)" |

## 5. Gateway audit lines for the session

```
token_issued      x1
tools_listed      x2   tool_count=396
tool_call         x18  decision=allow reason=grant:it effect=read
                       outcome=tool_error on exactly the 4 vendor-rejected calls
                       (knowbe4, vanta, threatlocker, paylocity)
```

## 6. Open blocker reproduced during this verification

`az account show` (or any authenticated Azure CLI call for
`da-jmorgan@henssler.com`):

```
AADSTS530032: User blocked due to risk on home tenant.
```

Consequence: no Key Vault secret can be rotated, no container app
revision can be rolled, and the `panos` grant cannot be removed from
`policy.yaml` from this machine until the account's risk is cleared in
Entra ID Protection. This is an identity-platform block on the operator
account, not a defect in the gateway or its wiring - every connector
documented above as authenticated stayed authenticated for the whole
session.

## 7. Local credential sources consulted (no values captured)

`~/.config/atlas/atlas.env`, `plugins/atlas/.env`,
`~/.claude/settings.json` (`pluginConfigs[atlas@tech-tools].options`),
`~/.zshrc` (Falcon), `~/MEGA/Projects/Development/paylocity-api/.env`,
and the `agent-penny-kv` vault (ConnectWise client id and company id).
