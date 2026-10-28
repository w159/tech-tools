# MCP gateway live state and broker-mode migration (2026-10-28)

Verified live on 2026-10-28 with `az`, `az rest` (Microsoft Graph) and
`curl`. Read-only checks plus the approved writes of this migration.

## Before (the deployment that was replaced)

| Thing | State |
|---|---|
| Container App | `gwh-mcp-gateway` in `gwh-mcp-gateway-rg`, revision `--0000002`, direct mode (`ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `MCP_RESOURCE_URL`) |
| Image | `mcp-gateway@sha256:b8eca63d…` (2026-09-29) |
| Ingress | allow only `160.79.104.0/21` (Anthropic egress) -> every request from any other source got a platform **403 RBAC: access denied** |
| Entra app | `c6e1bf1e-2520-4f1d-b329-8f0f05de34a6` / SP `617900da-7b8e-48a0-96b0-f35fdae83ec8`, 26 flat `<Vendor>.Read/Write` app roles (incl. an orphan `TypeSafe` pair), `identifierUris=null`, no `requiredResourceAccess`, no Graph app permissions on the SP |
| Assignments | 2 app role assignments, both to user `ea3f3030` (DA Jerry Morgan): the default zero-id role and `NinjaOne.Read`. **No group held any role.** |
| Groups | 124 security-enabled groups in the tenant, 560 groups total; 0 with a gateway role |
| Custom domain | `mcp.henssler.com` does not resolve (DNS is at `henssler.com`'s own nameservers `dcs-001/dcs-azure/dcs-002`) |
| Sign-ins | none. No one had ever signed in through a Claude connector against this gateway. |

## After (this migration)

| Thing | State |
|---|---|
| Mode | broker. The gateway is its own OAuth 2.1 AS; Entra is the upstream IdP |
| Base URL | `https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io` (the Container Apps hostname; the custom domain is still unbound) |
| Revision | `gwh-mcp-gateway--broker-0`, image `mcp-gateway@sha256:f04e3d44…` |
| Ingress | `ipSecurityRestrictions: []` - reachable from any source; access control is Entra sign-in + role grant |
| Policy | `policy.yaml` in Key Vault secret `policy-yaml`, mounted at `/mnt/policy/policy.yaml` |
| Entra roles | 6: `it`, `compliance`, `accounting`, `hr`, `planning`, `company` (the 26 flat roles were pruned) |
| Group assignments | 8: Information Technology Department + AdminAgents -> `it`; Compliance Department -> `compliance`; Accounting + Internal Accounting Department -> `accounting`; Human Resources Department -> `hr`; Planning & Implementation -> `planning`; All Domain Users -> `company` |
| Graph permissions | `Application.Read.All`, `GroupMember.Read.All`, `User.Read.All` on the gateway service principal (needed by the refresh-time membership check) |
| Consent | tenant-wide (`AllPrincipals`) for `openid profile offline_access User.Read` on Graph and `access_as_user` on the gateway app |
| Client secret | new credential `mcp-gateway` (key id `968b6a0b…`, expires 2027-10-28), value stored only in Key Vault as `broker-upstream-client-secret` |
| Secrets in Key Vault | `broker-upstream-client-secret`, `broker-signing-jwks`, `broker-cookie-keys`, `audit-hmac-key`, `policy-yaml` + the 12 vendor secrets |

HTTP surface after the change (all from this machine, outside the old
Anthropic range, so the answers are not blocked by the platform):

```
POST /mcp                                   -> 401, WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp", scope="mcp"
GET  /.well-known/oauth-protected-resource/mcp -> {"resource":".../mcp","authorization_servers":["<base>"],"scopes_supported":["mcp"]}
GET  /.well-known/oauth-authorization-server   -> issuer, /auth, /token, /jwks, registration_endpoint (DCR), code_challenge_methods_supported ["S256"]
GET  /health                                -> 200 {"status":"ok","backends":[13 connectors]}
```

## Verified HTTP response of a real browser sign-in

A live browser sign-in (Entra SSO, no human prompt) reached the gateway's own
consent screen, the consent was accepted, an authorization code came back -
and the token endpoint then failed closed with audit reason
`membership_check_unavailable`. Two defects, both now recorded in the
findings ledger:

- `GW-001` - the consent form POST is answered 403 in every real browser:
  `Referrer-Policy: no-referrer` on the consent page makes Chrome send
  `Origin: null`, and the CSRF guard accepts only an undefined Origin or an
  exact base URL match.
- `GW-002` - the membership check cannot get a Graph token inside the
  container: the managed identity holds no Graph application permissions and
  there is no fallback to the application's client credentials, so the check
  fails closed and no token is ever issued.

## Still open (not fixed by this migration)

- 7 of 13 connectors have no credentials in Key Vault: auvik, blumira, cipp,
  falcon, paylocity, spanning, sonicwall. Their tools are visible to the
  entitled roles but every call fails upstream.
- `mcp.henssler.com` is not bound; the gateway answers on the Container Apps
  hostname.
- Broker state (authorization codes, refresh tokens, DCR clients) is in
  process memory, so the app must stay at 1 replica and a restart ends
  sessions.
- The service principal keeps one assignment with the default zero-id role for
  user `ea3f3030`; it grants nothing and was left in place.
- The Entra client secret expires 2027-10-28.
