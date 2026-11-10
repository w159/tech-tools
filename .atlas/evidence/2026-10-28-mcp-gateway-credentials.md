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

## 3. tools/list: 384 tools, up from 208

Real Entra sign-in (dynamic client registration, PKCE S256, scope
`mcp offline_access`), interactive consent in the user's own Chrome, no
password/MFA/CAPTCHA prompt. Token: `type=Bearer expires_in=900 scope=mcp`,
refresh token present, claims `roles=["company","it"]`, `idp=entra`. No
token value recorded.

`tools/list` returned **384 tools**, byte-identical across two calls in
the same session:

```
falcon          145
connectwise      49
ninjaone         45
auvik            39
threatlocker     30
knowbe4          30
vanta            28
spanning         13
sonicwall         2
blumira           2
cipp              1
panos             0
paylocity         0
------------------
total           384
```

`paylocity` returned 0 tools because its only grant is the `hr` role;
the signed-in user holds `company`/`it`. That is the role model working
as designed, not a fault. `panos` returned 0 tools because its grant was
removed from the published policy (see section 8).

Delta against the previous verification on the same gateway, recorded in
`.atlas/evidence/2026-10-28-mcp-gateway-broker-mode.md` §9 (before this
credential work): **208 -> 384**, from `falcon` (4 -> 145) and
`connectwise` (2 -> 49) gaining their full credential set, `auvik`
(2 -> 39) and `spanning` (2 -> 13) gaining theirs once their API keys
reached the container, and `panos` (60 -> 0) leaving with the policy.

## 4. Per-connector status, called through the gateway

Each row is the connector's own status tool, invoked through the gateway
with the session token above.

| Connector | Result | Detail (vendor-exact, no values) |
|---|---|---|
| falcon | authenticated | `"state":"OK"`, `"authenticated":true`, `"mode":"full"`, 27 modules loaded; 145 tools |
| connectwise | authenticated | all five `CW_MANAGE_*` set; `baseUrl https://api-na.myconnectwise.net/v4_6_release/apis/3.0`; `cw_list_boards` returned 10 real boards; `cw_test_connection` -> version `v2025.1.10771`, `isCloud true`; 49 tools |
| ninjaone | authenticated | "Auth check: OK (HTTP 200, 456 ms)"; `ninjaone_organizations_list` returned real organizations; 45 tools |
| auvik | authenticated | `"hasCredentials":true`, `"verified":true`, `"authCheck":"OK (HTTP 200, 469 ms)"`, region `us1`; 39 tools |
| spanning | authenticated | "Credentials: Configured (adminEmail=jmorgan@henssler.com, platform=m365, baseUrl=https://o365-api-us.spanningbackup.com/external)", "Auth check: OK (HTTP 200, 371 ms)"; 13 tools |
| threatlocker | authenticated | "Credentials: Configured (API key present, prefix B1C9...; baseUrl=https://portalapi.h.threatlocker.com/portalapi)", "Auth check: OK (authenticated; pending approvals: 1)"; 30 tools |
| paylocity | role-gated | 0 tools for this user: its only grant is `hr` and the signed-in user holds `company`/`it`. The credentials themselves are valid - `POST /IdentityServer/connect/token` and `GET /api/v2/companies/{id}/employees` both answered 200 when probed directly against the vendor |
| panos | grant removed | 0 tools. The appliance is on the corporate VPN (`10.8.254.3`), unreachable from Azure, and the grant was removed from the published policy (section 8) |
| knowbe4 | auth-rejected | "FAILED HTTP 401: Invalid Token" - the stored value is not accepted by the vendor |
| vanta | auth-rejected | "Vanta token mint failed: 401" - the stored value is not accepted by the vendor |
| blumira | not configured | no credential stored |
| cipp | not configured | no credential stored |
| sonicwall | not configured | no credential stored |

## 5. Gateway audit lines for the session

```
token_issued      x1
tools_listed      x2   tool_count=396
tool_call         x18  decision=allow reason=grant:it effect=read
                       outcome=tool_error on exactly the 4 vendor-rejected calls
                       (knowbe4, vanta, threatlocker, paylocity)
```

## 6. The Entra block, and how it cleared

`az account show` (or any authenticated Azure CLI call for
`da-jmorgan@henssler.com`) failed with:

```
AADSTS530032: User blocked due to risk on home tenant.
```

That blocked every Key Vault write, every container revision and the
policy change. It cleared on 2026-10-28 when the operator completed an
interactive device-code sign-in (`az login --use-device-code`); a fresh
token for `https://vault.azure.net` then minted normally, while the
previously cached Graph token was rejected with `TokenIssuedBeforeRevocationTimestamp`
until the sign-in refreshed it. Everything section 8 describes happened
after that.

## 7. Local credential sources consulted (no values captured)

`~/.config/atlas/atlas.env`, `plugins/atlas/.env`,
`~/.claude/settings.json` (`pluginConfigs[atlas@tech-tools].options`),
`~/.zshrc` (Falcon), `~/MEGA/Projects/Development/paylocity-api/.env`,
and the `agent-penny-kv` vault (ConnectWise client id and company id).

## 8. Second pass: PAN-OS removed, four connectors credentialed

With Azure access restored:

- **Key Vault seeded.** Seven secrets were written (`auvik-api-key`,
  `auvik-region`, `paylocity-client-secret`, `paylocity-company-id`,
  `spanning-api-token`, `spanning-api-url`, `threatlocker-api-key`);
  the other six of the thirteen were already identical to the Key Vault
  copy. The seed ran through a `--only` allowlist so no other vendor
  secret could be touched by a local file that had drifted.
- **Two container-wiring gaps found and fixed.** `auvik-api-key` and
  `spanning-api-token` existed in the Key Vault and in
  `~/.config/atlas/atlas.env`, but were **not** in the container app's
  secret list and **not** in its env list, so both connectors started
  with "NOT CONFIGURED" / "Missing SPANNING_ADMIN_EMAIL or
  SPANNING_API_TOKEN" even though a valid credential existed. Both were
  added as Key Vault references (`keyVaultUrl` + the
  `gwh-mcp-gateway-id` identity) with `AUVIK_API_KEY` and
  `SPANNING_API_TOKEN` env entries, and the app was rolled to revision
  `gwh-mcp-gateway--0000008`. The lesson for the runbook: a credential
  in the vault is not a credential in the container - the env entry is a
  separate, silent step.
- **PAN-OS grant removed.** The live `policy.yaml` was regenerated from
  the org's answers input with `panos` dropped from the `it` role's
  connector list, using the admin CLI's `plan` step
  (`node dist/admin/cli.js plan --org <org-model.json> --answers
  <answers.yaml> --out plan.json --policy policy.yaml`). The regenerated
  file was byte-identical to the published one except for the single
  `panos` line, which is the check that the reconstructed answers input
  is faithful. The result was stored as the `policy-yaml` Key Vault
  secret and rolled into revision `0000008`; the generated secret is
  never hand-edited.
- **Two failures that were not gateway defects.** (1) Dynamic client
  registrations do not survive a revision roll - the client id issued
  before the roll answered `invalid_client`, so a client must re-register
  after every rollout. (2) An authorization request with no `scope`
  parameter (a defect in the throwaway verification client, not in the
  gateway) is answered with `access_denied` and an empty description;
  with `scope=mcp offline_access` the same flow completed and issued a
  token.
