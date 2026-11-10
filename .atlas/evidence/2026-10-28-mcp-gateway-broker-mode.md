# Evidence: MCP gateway broker-mode cutover and live Entra sign-in (2026-10-28)

Observed behaviour, captured from the running system. Every block is the
output of the command shown above it, on 2026-10-28. Nothing here is
inferred.

Deployment under test: Container App `gwh-mcp-gateway` in resource group
`gwh-mcp-gateway-rg`, revision `gwh-mcp-gateway--fix1`, image
`gwhmcpgateway.azurecr.io/mcp-gateway@sha256:35cef7299e72545f24f67cd81e0c8416c7e9f31dab2314e292cdeae53e48d528`.
Public base URL: `https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io`.
Repo commit: `902c7718` on branch `claude/gateway-broker-mode-main`.

## 1. The MCP endpoint requires a token, and says where to get one

`curl -sS -D- -o /dev/null -X POST $BASE/mcp`

```
HTTP/2 401
x-request-id: 3aa75606-ae68-4173-a045-6b4029bc39bf
content-type: application/json
www-authenticate: Bearer resource_metadata="https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/.well-known/oauth-protected-resource/mcp", scope="mcp"
```

Note: this request came from a host outside the old Anthropic egress range
and was answered by the application, not blocked by the platform - the
per-source allowlist is gone.

## 2. Protected resource metadata points at the gateway's own issuer

`curl -sS $BASE/.well-known/oauth-protected-resource/mcp`

```
{"resource":"https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/mcp","authorization_servers":["https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io"],"bearer_methods_supported":["header"],"scopes_supported":["mcp"]}
```

## 3. The gateway is its own authorization server

`curl -sS $BASE/.well-known/oauth-authorization-server`

```json
{
  "issuer": "https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io",
  "authorization_endpoint": "https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/auth",
  "token_endpoint": "https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/token",
  "jwks_uri": "https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/jwks",
  "registration_endpoint": "https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/reg",
  "grant_types_supported": ["implicit", "authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
  "code_challenge_methods_supported": ["S256"]
}
```

Dynamic client registration is advertised, so a client needs no
pre-registered client id.

## 4. Service health

`curl -sS $BASE/health`

```
{"status":"ok","backends":["auvik","blumira","cipp","connectwise","falcon","knowbe4","ninjaone","panos","paylocity","sonicwall","spanning","threatlocker","vanta"]}
```

## 5. The running revision

`az containerapp revision list -g gwh-mcp-gateway-rg -n gwh-mcp-gateway`

```
gwh-mcp-gateway--fix1 | RunningAtMaxScale | traffic=100 | gwhmcpgateway.azurecr.io/mcp-gateway@sha256:35cef7299e72545f24f67cd81e0c8416c7e9f31dab2314e292cdeae53e48d528
```

## 6. Ingress is open to any source

`az containerapp ingress show -g gwh-mcp-gateway-rg -n gwh-mcp-gateway`

```json
{ "external": true, "targetPort": 8080, "transport": "Auto", "allowInsecure": false, "ipSecurityRestrictions": [] }
```

## 7. The Entra app carries exactly the six gateway roles

`az rest --method GET --uri "https://graph.microsoft.com/v1.0/applications/6e2bbb0f-613f-4512-8a35-e78f2c68a140"`

```
company enabled=true allowed=User
planning enabled=true allowed=User
hr enabled=true allowed=User
accounting enabled=true allowed=User
compliance enabled=true allowed=User
it enabled=true allowed=User
```

The 26 flat `<Vendor>.Read/Write` roles and the orphaned `TypeSafe` pair
are gone.

## 8. Each role is held by a real group

`az rest --method GET --uri ".../servicePrincipals/617900da-.../appRoleAssignedTo"`,
joined with the app's role ids

```
compliance -> Compliance Department (Group)
accounting -> Internal Accounting Department (Group)
it -> AdminAgents (Group)
accounting -> Accounting (Group)
planning -> Planning & Implementation (Group)
hr -> Human Resources Department (Group)
it -> Information Technology Department (Group)
company -> All Domain Users (Group)
```

## 9. A real Entra sign-in, end to end

Run by an independent verifier against the live gateway, using the MCP SDK
client with dynamic client registration and PKCE S256, and the user's own
Chrome for the interactive sign-in. The client script sends
`scope=mcp offline_access`; without a scope oidc-provider ends the
authorization with `access_denied` ("no scope was granted").

Observed:

- The browser completed the Microsoft sign-in with no MFA, CAPTCHA or
  password prompt (an existing Entra session), landed on the gateway's own
  consent screen, and the consent POST was accepted - no 403.
- Token issued: `token ok type=Bearer expires_in=900 scope=mcp`, with a
  refresh token present. No token value is reproduced here.
- `tools/list` returned **208 tools**, byte-identical across two independent
  sign-ins, spread over exactly the connectors the caller's roles grant:
  panos 60, ninjaone 45, threatlocker 30, knowbe4 30, vanta 28, falcon 4,
  spanning 2, sonicwall 2, connectwise 2, blumira 2, auvik 2, cipp 1.
  **Zero paylocity tools** - paylocity is granted only to the `hr` role.
- Two read-only calls against the real NinjaOne backend returned data:
  `ninjaone_organizations_list` -> `isError=false` (GWH/HPM/CPA) and
  `ninjaone_devices_list` with `{"organization_id": 1}` -> `isError=false`.
- Gateway audit lines for the session (`az containerapp logs show -g
  gwh-mcp-gateway-rg -n gwh-mcp-gateway --revision gwh-mcp-gateway--fix1
  --tail 120`): `token_issued` x3, `tools_listed` (`tool_count` 208) x3,
  `tool_call` x7 with `decision=allow`, `reason=grant:it`, roles
  `["company","it"]`.

### Connector-side failures observed in the same session

These reproduce identically through the same MCP servers running locally, so
they are credential and network problems, not gateway regressions:
knowbe4 `401 Invalid Token`; vanta `401`; threatlocker `440 TOKEN_REVOKED`;
`panos_system_info` timed out after 60 s (the PAN-OS host is the LAN
address 192.168.1.1, unreachable from Azure); connectwise exposes only
`cw_status` and `cw_test_connection` because the container's `CW_MANAGE_*`
set is incomplete; auvik, blumira, cipp, falcon, paylocity, spanning and
sonicwall report `MISSING_CREDENTIALS` because no credential for them is
stored in Key Vault.

## 10. The two defects this verification found, and their fixes

Both were reproduced against the live gateway before the fix and are
recorded as `GW-001` and `GW-002` in `.atlas/.run/findings.json`.

- **GW-001** - the consent form POST was answered 403 in every real
  browser: the page sent `Referrer-Policy: no-referrer`, so Chrome sent
  `Origin: null`, and the CSRF guard accepts only an undefined Origin or an
  exact base URL match. Proven with CDP `requestWillBeSentExtraInfo`
  (`origin=null`, `sec-fetch-site=same-origin`). Fixed by sending
  `Referrer-Policy: same-origin` on the consent page
  (`src/broker/interactions.ts`); the origin check is unchanged and still
  rejects a foreign Origin and `Origin: null`.
- **GW-002** - the token endpoint failed closed with audit reason
  `membership_check_unavailable`: the membership check used only the managed
  identity as its Graph token source and that identity holds no Graph
  application permissions. Fixed by falling back to the application's client
  credentials, with one retry on a 401/403 from Graph
  (`src/broker/entra-membership.ts`, `src/broker/provider.ts`). Fail-closed
  on a revoked user is unchanged.
- Also fixed: the admin tool's `discover` sent `Accept: application/json` to
  Graph's `/$count` endpoint, which only speaks `text/plain`, so discovery
  failed with HTTP 415 (`src/admin/discover.ts`).

## 11. Test suite

`cd mcp_servers/mcp-gateway && npx tsc --noEmit && npm test`

```
Test Files  17 passed (17)
     Tests  223 passed (223)
```

`fallow audit --base origin/main` on the branch: `verdict: pass`,
`dead_code_introduced 0`, `complexity_introduced 0`.
