# Connect Claude to the gateway

Read-only. Prints instructions; creates nothing.

## 1. Find the gateway URL

The MCP endpoint is the gateway origin plus `/mcp`.

- `az deployment group show -g <rg> -n <deployment> --query properties.outputs.gatewayBaseUrl.value -o tsv`
- Or read `PUBLIC_BASE_URL` from the running Container App configuration.

Print: `MCP server URL: <base>/mcp`. Check it answers: an unauthenticated `curl -i <base>/mcp` returns 401 with a `WWW-Authenticate` header that points at the protected resource metadata. If it does not, stop and tell the admin the gateway is not ready.

## 2. Add the org connector (Claude Team or Enterprise)

An organization Owner does this once:

1. Organization settings > Connectors > Add.
2. Choose Custom.
3. Name: for example `Company MCP Gateway`.
4. URL: `<base>/mcp`.
5. Save.

Members then open Customize > Connectors and click Connect. They see a Microsoft sign-in and MFA, and no consent prompt, because the setup procedure pre-authorized the app for the organization. Roles and connectors they see come from their directory group membership.

Individual plans: Settings > Connectors > Add custom connector, same name and URL.

## 3. Claude Code

```bash
claude mcp add --transport http company-gateway <base>/mcp
```

Then run `/mcp` inside Claude Code and sign in.

## 4. Check the connection

Ask the user to connect, then follow `audit.md` for the last hour. Expected events: `token_issued`, then `tools_listed`. An `auth_failed` event means the sign-in was rejected; its `reason` field says why.

If a user sees a consent prompt or gets no tools: the user is in no mapped group (see `setup.md`, group assignment), the group is nested (app roles do not flow through nested groups; assign leaf groups), or the user must sign out and in again after a group change.

## 5. Enterprise Managed Auth

Goal: users in a Claude Enterprise organization reach the gateway without a separate sign-in per connector, because the organization's identity provider vouches for them.

Gateway side (see `mcp_servers/mcp-gateway/README.md`):

- The gateway accepts the OAuth 2.0 JWT bearer grant (RFC 7523, `urn:ietf:params:oauth:grant-type:jwt-bearer`). The client presents a signed assertion JWT and receives a gateway access token.
- The assertion is accepted only if its issuer is on the trusted-issuer allowlist `BROKER_TRUSTED_ASSERTION_ISSUERS`: a JSON list of `{issuer, jwks_uri, tenant?}`. The gateway checks signature, audience, expiry and the optional tenant, then maps claims to roles through `policy.yaml`. Policy stays the only authority.
- Every grant is audited: `token_issued` with actor, idp and client id.

Admin steps: decide the issuer, add it through the Bicep `extraEnv` parameter (show the what-if and get a yes, per `setup.md`), and make sure the assertion carries the claim `policy.yaml` matches on.

Not verified: which identity providers can act as the assertion issuer for Claude Enterprise Managed Auth, and the exact admin console configuration. Do not promise either. Check Anthropic's current Enterprise documentation and the gateway README first.
