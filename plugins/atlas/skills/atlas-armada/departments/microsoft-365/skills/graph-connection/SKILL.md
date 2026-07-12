---
name: graph-connection
description: "Use this skill when connecting a self-hosted Microsoft Graph MCP server to a customer tenant - registering the multi-tenant Entra app, supplying tenantId/clientId/clientSecret, and (the part everyone misses) granting per-tenant admin consent for the required delegated permissions out of band. Also covers the read-only design and the 100 calls/min/user rate limit."
when_to_use: "When setting up, troubleshooting, or explaining the Microsoft Graph MCP connection - Entra app registration, redirect URI, client secret, admin consent failures, or 'why is the tenant returning no data'"
allowed-tools: Read, Glob, Grep, Bash, mcp__microsoft-docs__microsoft_docs_search, mcp__microsoft-docs__microsoft_docs_fetch, mcp__microsoft-graph__*
---

# Connecting a Microsoft Graph MCP server

A self-hosted Microsoft Graph MCP server exposes read-only Microsoft Graph access as MCP tools (`microsoft_graph_suggest_queries`, `microsoft_graph_get`, `microsoft_graph_list_properties`). Getting it working against a customer tenant is a three-part job: register a multi-tenant Entra app, supply its credentials to the server, and - the step that breaks most onboardings - grant per-tenant admin consent **out of band**.

Read this whole skill before connecting. The admin-consent requirement is non-obvious and the failure mode (a connection that authenticates fine but returns nothing) looks like a different bug.

## How the connection works

- The server authenticates as a confidential client using credentials you provide: each tenant operator registers **its own** multi-tenant Entra app and supplies `tenantId`, `clientId`, and `clientSecret`.
- The Entra authority used is `organizations` (the multi-tenant work/school endpoint).
- The token minted is a **delegated** token scoped to Microsoft Graph. Every call runs **as the signed-in user**, so the data the server returns is the intersection of what the user is allowed to see (their Entra roles) and what scopes the app was granted.

## Step 1 - Register the multi-tenant Entra application

In the partner/operator tenant you control, register a multi-tenant app:

1. **Entra admin center -> Identity -> Applications -> App registrations -> New registration.**
2. **Supported account types:** *Accounts in any organizational directory (multitenant)*. This is required - the authority is `organizations`, and you need the app to be consentable in each customer tenant.
3. **Platform:** add a **Web** platform with a **redirect URI**. Use the redirect URI (OAuth callback) the MCP server exposes for the authorization-code flow. A Web platform is required because this is a confidential client doing an authorization-code flow.
4. **Certificates & secrets -> New client secret.** Record the secret **value** (not the secret ID) immediately - it is shown only once. Set a calendar reminder before it expires; an expired secret produces `invalid_client` on reconnect.
5. Note the **Application (client) ID** and your **Directory (tenant) ID** from the app's Overview page.
6. **API permissions:** add the **delegated** Microsoft Graph permissions the server needs for the directory data you intend to read (for example `User.Read.All`, `Directory.Read.All`, `AuditLog.Read.All`). These are delegated permissions, not application permissions.

## Step 2 - Supply the credentials to the server

1. Configure the MCP server with the three values from Step 1: **`tenantId`**, **`clientId`**, **`clientSecret`**.
2. Complete the OAuth sign-in. The server runs the authorization-code flow against the `organizations` authority and stores the resulting delegated token.

At this point the *connection* exists - but it will still return no data until Step 3 is done for each customer tenant.

## Step 3 - Grant per-tenant admin consent (the step everyone misses)

**This is the single most common reason a Graph MCP connection "works" but returns nothing.**

The delegated directory permissions are admin-restricted. The OAuth flow in Step 2 authenticates the user and mints a token, but it does **not** by itself grant the tenant-wide consent those permissions need. A **Global Administrator in each customer tenant** must grant admin consent **out of band** - once per customer tenant, before the connection can read that tenant's directory.

Have the customer's Global Admin open the admin-consent URL and approve:

```
https://login.microsoftonline.com/{customer-tenant-id}/adminconsent?client_id={your-client-id}
```

- `{customer-tenant-id}` - the customer's Entra tenant ID (or their primary domain).
- `{your-client-id}` - the Application (client) ID of the app from Step 1.

After the admin approves, the app gets a service principal in the customer tenant with the delegated permissions consented tenant-wide. Calls for that tenant will now return data.

If you skip this: `microsoft_graph_get` and `microsoft_graph_suggest_queries` calls will fail or return empty for that tenant even though the connection shows healthy and the token mints fine. Symptom is consent/permission errors (`AADSTS65001` or similar) or a successful auth that yields no directory data.

Repeat Step 3 for every customer tenant you want to query. Steps 1 and 2 are one-time per operator; Step 3 is per customer tenant.

## Operational limits

- **Read-only.** The server only issues `GET` requests to Microsoft Graph. There is no write path - by design.
- **Rate limit:** 100 calls/min/user, enforced by the MCP server, on top of standard Microsoft Graph service throttling. The `suggest_queries -> get` workflow is deliberately call-efficient; lean on it rather than fanning out many speculative `get` calls.
- **Licensing:** the MCP server itself adds no license cost, but the caller still needs the right Entra licenses for the data they touch. Example: querying Privileged Identity Management (PIM) data requires **Microsoft Entra ID P2** on the tenant and the caller.

## Quick troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Connection authenticates but every query returns empty/permission error | Per-tenant admin consent (Step 3) not granted for that customer tenant |
| `invalid_client` on connect or reconnect | Client secret expired or the secret **ID** was pasted instead of the secret **value** |
| Redirect URI mismatch error during sign-in | The Web platform redirect URI in the app registration doesn't match the MCP server's callback URL |
| Works for one tenant, not another | Admin consent granted for the first tenant only - run Step 3 again per tenant |
| PIM / privileged-role data missing | Tenant or caller lacks Microsoft Entra ID P2 |

## References

See `references/microsoft-graph-api.md` for the underlying Microsoft Graph citations (auth endpoints, token scopes, consent flows) this skill relies on.
