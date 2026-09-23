# MCP gateway: Entra ID authentication and role-based access

Status: in progress. Sections marked UNVERIFIED have not been exercised end to end.

## Why a gateway

Users get one connector in Claude and one Entra sign-in for every vendor tool
they are entitled to. Access is decided by Entra app roles in the token and
enforced on the server, so it holds for any MCP client, not only for Claude's
own per-role connector settings. Claude's role grants (Organization settings >
Roles > Connectors) still apply on top and can narrow further; they cannot
widen past what the gateway allows.

## Flow

1. The Claude org Owner adds a custom connector: URL `https://mcp.henssler.com/mcp`,
   Advanced settings: OAuth Client ID `c6e1bf1e-2520-4f1d-b329-8f0f05de34a6`,
   Client Secret from Key Vault secret `claude-connector-client-secret`
   (vault `gwh-mcp-gateway-kv`). Supplying the client ID skips dynamic client
   registration, which Entra does not support.
2. Claude calls `/mcp` unauthenticated, gets `401` with
   `WWW-Authenticate: Bearer resource_metadata=...`.
3. Claude reads `/.well-known/oauth-protected-resource/mcp`, which names
   `https://login.microsoftonline.com/<tenant>/v2.0` as the authorization server,
   and uses Entra's OpenID discovery.
4. The user signs in to Entra (SSO; silent if already signed in). Entra issues a
   v2 access token with `aud` = the app ID and `roles` = the user's app roles.
   Users with no role assignment are refused at sign-in (assignment required).
5. The gateway validates issuer, audience, tenant, signature (Entra JWKS), and
   expiry, then filters tools by role.

The gateway has no `/authorize`, `/token`, or `/register` endpoints. The user's
browser talks to Entra directly, so ingress can be restricted to Anthropic's
egress range.

## Roles

Assign Entra groups (not individuals) to the enterprise application
"Henssler MCP Gateway" with one of these roles per vendor:

| Vendor | Read role | Write role |
|---|---|---|
| Auvik | Auvik.Read | Auvik.Write |
| Blumira | Blumira.Read | Blumira.Write |
| CIPP | CIPP.Read | CIPP.Write |
| ConnectWise | ConnectWise.Read | ConnectWise.Write |
| CrowdStrike Falcon | Falcon.Read | Falcon.Write |
| KnowBe4 | KnowBe4.Read | KnowBe4.Write |
| NinjaOne | NinjaOne.Read | NinjaOne.Write |
| PAN-OS | PanOS.Read | PanOS.Write |
| Paylocity | Paylocity.Read | Paylocity.Write |
| Spanning | Spanning.Read | Spanning.Write |
| ThreatLocker | ThreatLocker.Read | ThreatLocker.Write |
| Vanta | Vanta.Read | Vanta.Write |

Read exposes only tools the vendor server annotates `readOnlyHint: true`.
Write exposes every tool on that vendor. A tool with no annotation needs Write
(fails closed, same rule as `mcp_servers/_shared/annotate-tool.ts`).

## Vendor credentials

Upstream vendor APIs (ConnectWise, NinjaOne, and so on) authenticate with
service credentials, not per-user delegation, so the gateway holds one set per
vendor in Key Vault and the Entra role decides who may use them. Each vendor
child process receives only its own env prefix (for example `NINJAONE_*`), never
another vendor's secrets. The audit log records which Entra user invoked which
tool, which is the per-user accountability the upstream API cannot provide.

## Network

- Ingress: Container Apps, custom domain `mcp.henssler.com`, IP allowlist
  `160.79.104.0/21` (Anthropic outbound, from
  https://platform.claude.com/docs/en/api/ip-addresses, checked 2026-09-23).
  Recheck that page periodically; Anthropic lists phased-out ranges there.
- Entra's identifier URI must equal the connector URL, and must be on a verified
  domain. `henssler.com` is verified in the tenant.

## Compliance notes (FTC Safeguards Rule, Reg S-P, GLBA)

- Access control: least privilege by vendor and by read/write, assignment required.
- Authentication: Entra (MFA and Conditional Access apply to the sign-in).
- Audit: one JSON line per tool call to Log Analytics (365 day retention), with
  Entra object ID and UPN. Arguments and results are not logged because they can
  carry nonpublic personal information.
- Secrets: Key Vault with RBAC and purge protection; accessed by managed identity.

## Known limits

- Blumira keeps navigation state per MCP session. Through the stateless gateway
  all users share one child, so one user's `blumira_navigate` changes what
  others see. Fix: expose Blumira's tools flat, or keep a child per user.
- Enterprise Managed Auth (Claude's "Managed authorization", silent connection
  via an identity assertion) needs an authorization server that accepts the
  RFC 7523 jwt-bearer grant. Entra does not accept that grant for this purpose,
  so members use "Individually" (one interactive Entra sign-in per connector).

## Remaining setup (UNVERIFIED)

- DNS at the henssler.com registrar: CNAME `mcp` to the container app FQDN and
  TXT `asuid.mcp` with the environment's verification ID.
- Load vendor secrets into Key Vault and reference them as container app secrets.
- In Claude: add the connector (step 1 above), then set per-role connector
  permissions under Organization settings > Roles.
