---
name: harbor-connect
description: 'Prints the gateway URL and the steps to add the gateway as a Claude custom connector, and explains how Enterprise Managed Auth works with the gateway jwt-bearer grant and trusted-issuer allowlist. Use after the gateway is deployed, or when an admin asks how users connect Claude to it.'
when_to_use: connecting Claude (web, desktop, Claude Code) to a deployed gateway, or planning Enterprise Managed Auth
allowed-tools: Read, Bash
argument-hint: '[gateway base URL, or blank to read it from deployment outputs]'
---

# harbor-connect

Read-only. Prints instructions; creates nothing.

## 1. Find the gateway URL

The MCP endpoint is the gateway origin plus `/mcp`.

- Azure: `az deployment group show -g <rg> -n <deployment> --query properties.outputs.gatewayBaseUrl.value -o tsv`
- Google Cloud: `terraform -chdir=<infra/gcp copy> output -raw gateway_base_url`
- Or read `PUBLIC_BASE_URL` from the running service configuration.

Print: `MCP server URL: <base>/mcp`. Check it answers: an unauthenticated
`curl -i <base>/mcp` should return 401 with a `WWW-Authenticate` header that
points at the protected resource metadata. If it does not, stop and tell the
admin the gateway is not ready.

## 2. Add the custom connector

Microsoft Learn documents the Claude side for custom remote MCP servers
(Settings > Connectors > Add custom connector). Steps, by plan:

Team and Enterprise (an Owner or Primary Owner does this once):
1. Organization Settings > Connectors > Add.
2. Choose Add custom connector.
3. Name: for example `Company MCP Gateway`.
4. MCP Server URL: `<base>/mcp`.
5. Add. Members then open Settings > Connectors and press Connect, which sends
   them through the identity provider sign-in.

Individual plans: Settings > Connectors > Add > Add custom connector, same
name and URL.

Direct mode only: when the identity provider issues tokens itself (no broker),
the connector needs an OAuth client id from that provider, and the provider
must list Claude's callback URLs as redirect URIs:
`https://claude.ai/api/mcp/auth_callback` and
`https://claude.com/api/mcp/auth_callback`. In broker mode the redirect URI
registered with the identity provider is the gateway's own callback, set by
harbor-setup.

Claude Code: `claude mcp add --transport http company-gateway <base>/mcp`, then
`/mcp` inside Claude Code to sign in.

## 3. Check the connection

Ask the user to connect, then run the harbor-audit skill for the last hour.
Expected events: `token_issued`, then `tools_listed`. An `auth_failed` event
means the sign-in was rejected; its `reason` field says why.

## 4. Enterprise Managed Auth

Goal: users in a Claude Enterprise organization reach the gateway without a
separate sign-in prompt per connector, because the organization's identity
provider vouches for them.

How the gateway side is built (see mcp_servers/mcp-gateway/README.md):

- The gateway accepts the OAuth 2.0 JWT bearer grant (RFC 7523,
  `urn:ietf:params:oauth:grant-type:jwt-bearer`). The client presents a signed
  assertion JWT in place of an interactive login and receives a gateway access
  token.
- The assertion is accepted only if its issuer is on the trusted-issuer
  allowlist, `BROKER_TRUSTED_ASSERTION_ISSUERS`: a JSON list of
  `{issuer, jwks_uri, tenant?}`. The gateway fetches signing keys from
  `jwks_uri`, checks signature, audience, expiry, and the optional tenant, and
  then maps the assertion's claims to roles through `policy.yaml` exactly as it
  does for an interactive sign-in. Policy is the only authority; the allowlist
  only decides whose assertions are believed.
- Every grant is audited like any other: `token_issued` with the actor, idp and
  client id.

What the admin does:
1. Decide which issuer will sign assertions (the organization's identity
   provider as configured in Claude Enterprise).
2. Add that issuer to `BROKER_TRUSTED_ASSERTION_ISSUERS` through the Bicep
   `extraEnv` parameter or the Terraform `extra_env` variable. Use the
   harbor-setup skill to show the plan and apply.
3. Make sure the assertion carries the claim that `policy.yaml` subjects match
   on (for example `roles`), or add subjects rules for the claims it does carry
   (harbor-policy).

Not verified: which identity providers can act as the assertion issuer for
Claude Enterprise Managed Auth, and the exact configuration in the Claude admin
console. Do not promise either. Check Anthropic's current Enterprise
documentation and the gateway README before telling an admin it will work with
their identity provider.
