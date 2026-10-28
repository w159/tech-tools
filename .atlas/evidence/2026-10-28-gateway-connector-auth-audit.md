# Evidence: per-connector gateway auth truth (2026-10-28)

Live audit of the running MCP gateway and its Azure resources. No secret, token,
cookie or key value is reproduced here - only names, HTTP status codes and vendor
error text.

Deployment under test: Container App `gwh-mcp-gateway` in `gwh-mcp-gateway-rg`
(subscription Henssler Azure `d10ed4e7-8973-4fb6-aa90-1d31b8be10b3`), broker mode,
upstream IdP Entra (tenant `f00db7e5-ade5-49b2-b9cd-8813b81ef30a`), Key Vault
`gwh-mcp-gateway-kv`, public base URL
`https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io`.

Method: the credential the CONTAINER holds was read from the vault into an env var
(`az keyvault secret show --query value -o tsv`, value never printed) and each
connector's own `<vendor>_status` logic was run against it, plus a direct vendor
call with the body redacted. A vault secret merely existing was never treated as
proof of authentication.

## 1. Verdict per connector

| Connector | Credential delivered to the container | Vendor auth result | Verdict |
|---|---|---|---|
| auvik | AUVIK_USERNAME / AUVIK_API_KEY / AUVIK_REGION | `Auth check: OK (HTTP 200)`; `GET /v1/authentication/verify` -> 200 | WORKING |
| connectwise | all five CW_MANAGE_* | `configured: true`; `cw_test_connection` -> version v2025.1.10771, cloudRegion NA | WORKING |
| falcon | FALCON_CLIENT_ID / CLIENT_SECRET / BASE_URL | `falcon_status {state: OK, authenticated: true, 27 modules, 145 tools}`; token mint -> 201; `QueryDevicesByFilter` -> 200 with 131 hosts | WORKING |
| ninjaone | NINJAONE_CLIENT_ID / CLIENT_SECRET / REGION | `Auth check: OK (HTTP 200)` | WORKING |
| paylocity | PAYLOCITY_CLIENT_ID / CLIENT_SECRET / COMPANY_ID | `Auth check: OK (HTTP 200)`; token mint -> 200 (expires_in 3600) | WORKING (role-gated to the `hr` grant) |
| spanning | SPANNING_ADMIN_EMAIL / PLATFORM / API_URL / API_TOKEN | `Auth check: OK (HTTP 200)` | WORKING |
| threatlocker | THREATLOCKER_API_KEY / ORGANIZATION_ID / BASE_URL | `Auth check: OK (authenticated; pending approvals: 1)` | WORKING |
| knowbe4 | KNOWBE4_API_KEY / KNOWBE4_REGION | `FAILED HTTP 401: Invalid Token`; `GET /v1/account` -> 401 `{"message":"Invalid Token"}` | REJECTED by the vendor |
| vanta | VANTA_CLIENT_ID / CLIENT_SECRET | `Vanta token mint failed: 401`; `POST /oauth/token` -> 401 `Unauthorized` | REJECTED by the vendor |
| blumira | none - no BLUMIRA_* env var exists | `Credentials: NOT CONFIGURED`; container log `[WARN] Missing credentials {hasJwtToken:false,hasClientId:false}` | UNCONFIGURED |
| cipp | none - no CIPP_* env var exists | `CIPP_BASE_URL: MISSING (required)`; container log `[WARN] Missing CIPP credentials...` | UNCONFIGURED |
| sonicwall | none - no SONICWALL_* env var exists | `Credentials: NOT CONFIGURED` | UNCONFIGURED |
| panos | PANOS_API_KEY / PANOS_HOST / PANOS_VERIFY_TLS | credential valid (`panos_status` -> HTTP 200, `panos_version` -> sw 11.1.13-h6, PA-460), but in-container fetch to 10.8.254.3 -> `UND_ERR_CONNECT_TIMEOUT`; and no `panos` grant in the published policy | UNREACHABLE from Azure + ungranted |

Tally: 7 WORKING, 2 REJECTED, 3 UNCONFIGURED, 1 UNREACHABLE.

## 2. Vault to container wiring

```
az containerapp show --name gwh-mcp-gateway -g gwh-mcp-gateway-rg --query "{env:properties.template.containers[0].env,volumes:properties.template.volumes}" -o json
```
- 35 env secretRefs + 1 volume secretRef (the mounted `policy.yaml`).
- 0 container secretRefs without a vault secret - every mounted reference resolves.
- 4 vault secrets are not referenced by the gateway container:
  `claude-connector-client-secret`, `dynamics-connector-client-secret`,
  `dynamics-connector-jwt-signing-key`, `dynamics-connector-pp-client-secret`. They
  belong to the sibling `gwh-dynamics-connector` app, whose own secretRefs
  (`client-secret`, `jwt-signing-key`) are not names in this vault - that app's
  vault wiring is a separate item, and the app itself is running.
- Every connector-prefixed env var the container mounts is read by that backend
  (checked against `process.env.<NAME>` in each `plugins/armada/mcp/<v>/server.mjs`);
  no dead env var. Absent vars are all optional with vendor defaults
  (`*_BASE_URL`, `PANOS_USERNAME`, `FALCON_MEMBER_CID`, ...).

## 3. Gateway surface

```
curl -s https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/health
-> {"status":"ok","backends":["auvik","blumira","cipp","connectwise","falcon","knowbe4",
    "ninjaone","panos","paylocity","sonicwall","spanning","threatlocker","vanta"]}

POST /mcp without a token -> HTTP 401 {"error":"invalid_token"}
  WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp", scope="mcp"
```
13 backends start; the broker's own AS metadata and protected-resource metadata
both answer 200. A token cannot be minted without a browser: the gateway is its own
AS, `az account get-access-token` against it fails with `AADSTS500011`, and the
broker's `client_credentials` grant answers 401 `invalid_client` (the upstream Entra
app exposes only the delegated `access_as_user` scope). So the live `/mcp`
tools/list tool count for a role-scoped token was not re-measured here.

Per-connector tools/list with the container-held credentials: auvik 39, blumira 2,
cipp 1, connectwise 52, knowbe4 30, ninjaone 45, panos 60, paylocity 16,
sonicwall 2, spanning 14, threatlocker 30, vanta 28, falcon 145 = 464 connector
tools, plus 2 gateway audit tools.

## 4. Azure resources

All in `gwh-mcp-gateway-rg`, all `Succeeded`:
`gwh-mcp-gateway` (Container App, running, 1 replica),
`gwh-dynamics-connector` (Container App, running),
`gwh-mcp-gateway-env2` (managed environment),
`gwh-mcp-gateway-kv` (Key Vault, 40 secrets),
`gwh-mcp-gateway-id` and `gwh-dynamics-connector-id` (user-assigned managed
identities), `gwhmcpgateway` (Container Registry),
`gwh-mcp-gateway-law` (Log Analytics workspace).

Custom domain `mcp.henssler.com`: `nslookup` -> NXDOMAIN, and
`az containerapp hostname list` -> `[]` (no binding). Not blocking - the gateway is
reachable on its generated FQDN.

## 5. Corrections to earlier readings

- Paylocity works. An earlier "token endpoint network error / fetch failed" was an
  unencoded secret in the probe, not a vendor rejection.
- The local plugin connectors in a plain session are not the gateway. The local
  `atlas.env` holds stale values for several vendors (falcon AUTH_FAILED, knowbe4
  401, threatlocker 440, vanta 401, others unconfigured) while the gateway's vault
  holds partly different, working values. Local status output must never be quoted
  as the gateway's result.

## 6. What a caller sees

Working backends still expose tools only to a role that holds the grant: paylocity's
only grant is `hr`, and panos has none. A role-scoped token saw 208 tools before
the credential pass and 384 after it; the catalogue itself exposes 466.
