# Evidence: the CIPP connector moved to a URL-only remote MCP server (2026-10-28)

Observed behaviour against the live CIPP instance
`https://cippvtfwq.azurewebsites.net`. No secret, token or cookie value is
reproduced here - only endpoints, status codes and error text.

## 1. The instance already speaks the MCP OAuth model

```
GET https://cippvtfwq.azurewebsites.net/.well-known/oauth-protected-resource
```
```json
{"resource":"https://cippvtfwq.azurewebsites.net/api/ExecMcp",
 "authorization_servers":["https://cippvtfwq.azurewebsites.net"],
 "scopes_supported":["openid","profile","offline_access",
   "https://cippvtfwq.azurewebsites.net/user_impersonation"],
 "bearer_methods_supported":["header"]}
```

```
GET https://cippvtfwq.azurewebsites.net/.well-known/oauth-authorization-server
```
```json
{"issuer":"https://cippvtfwq.azurewebsites.net",
 "authorization_endpoint":"https://login.microsoftonline.com/f00db7e5-.../oauth2/v2.0/authorize",
 "token_endpoint":"https://login.microsoftonline.com/f00db7e5-.../oauth2/v2.0/token",
 "registration_endpoint":"https://cippvtfwq.azurewebsites.net/api/PublicMcpRegister",
 "grant_types_supported":["authorization_code","refresh_token"],
 "code_challenge_methods_supported":["S256"],
 "token_endpoint_auth_methods_supported":["none","client_secret_post","client_secret_basic"]}
```

```
GET /api/ExecMcp            -> 401
www-authenticate: Bearer realm="cippvtfwq.azurewebsites.net",
  authorization_uri="https://login.microsoftonline.com/f00db7e5-.../oauth2/v2.0/authorize",
  resource_id="d9fa5c31-e298-4adb-bfb7-99dcc09fd2af",
  scope="openid profile offline_access https://cippvtfwq.azurewebsites.net/user_impersonation",
  resource_metadata="https://cippvtfwq.azurewebsites.net/.well-known/oauth-protected-resource/api/ExecMcp"
```

## 2. Dynamic client registration, no client id and no secret

```
POST https://cippvtfwq.azurewebsites.net/api/PublicMcpRegister
{"client_name":"cipp-live-check","redirect_uris":["http://localhost:64166/callback"],
 "grant_types":["authorization_code","refresh_token"],"response_types":["code"],
 "token_endpoint_auth_method":"none","scope":"openid profile offline_access"}
```
```json
HTTP 201
{"client_id":"a0b18b3a-2064-457f-ab94-1fdb5c11ca80",
 "redirect_uris":["http://localhost:64166/callback"],
 "token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"]}
```

## 3. Sign-in and token exchange (the recipe the connector must use)

Authorize request that worked:

```
scope=openid profile offline_access https://cippvtfwq.azurewebsites.net/user_impersonation
resource omitted
redirect_uri=http://localhost:<port>/callback
code_challenge_method=S256
```

```
callback ok code=1.AQQA...
token ok type=Bearer expires_in=5179
  scope=https://cippvtfwq.azurewebsites.net/user_impersonation refresh=yes
```

Two rejections worth remembering (both reproduced in the browser):

| request | Entra answer |
|---|---|
| `resource=https://cippvtfwq.azurewebsites.net/api/ExecMcp` (the value the protected-resource metadata advertises) | `AADSTS9010010: The resource parameter provided in the request doesn't match with the requested scopes` |
| `scope=... api://d9fa5c31-.../user_impersonation` | `AADSTS500011: The resource principal named api://d9fa5c31-... was not found in the tenant` |
| `redirect_uri=http://127.0.0.1:<port>/callback` | `AADSTS50011: The redirect URI ... does not match the redirect URIs configured for the application` |

## 4. Where the MCP call itself stops

```
POST /api/ExecMcp  (Authorization: Bearer <token>)
```
```
Access to this CIPP API endpoint is not allowed, the user does not have the required permission
```

The sign-in and the token are correct; the signed-in account does not hold a CIPP role that covers
the MCP endpoint. CIPP's own rule: a connector that signs a user in runs with that user's CIPP
role. Fixing it is a CIPP-side role assignment, not a connector change.

## 5. The change in this repository

- `plugins/armada/.mcp.json`: `"cipp": { "type": "http", "url": "${user_config.cipp_mcp_url}" }`.
  The URL is substituted from the plugin's user config directly: `CFG_*` names only exist inside a
  stdio entry's `env` block, and an `http` entry has neither an env block nor the `_env/load.mjs`
  loader that promotes them.
- `plugins/armada/.claude-plugin/plugin.json`: one `cipp_mcp_url` field replaces the five CIPP
  credential fields.
- `mcp_servers/mcp-gateway/catalog/overrides.json`: `cipp` keeps its gateway launch line and env
  prefix, so the gateway's backend is untouched.
- `mcp_servers/mcp-gateway/scripts/gen-catalog.mjs`: reads remote (`type: http`) entries.

```
node scripts/gen-catalog.mjs --check   -> catalog/catalog.json is current
npx tsc --noEmit                       -> clean
npm test                               -> Test Files 17 passed (17), Tests 223 passed (223)
```
