# Enterprise MCP gateway: design

Status: APPROVED 2026-10-27; a local prototype is built (see
`docs/plans/enterprise-mcp-gateway-prototype.md`). Prior art it evolves: `mcp_servers/mcp-gateway`
(0.1.0, Entra-only resource server, 18 passing tests) and its deployment
record `docs/architecture/mcp-gateway-design.md`.

## Goal

One remote MCP endpoint that every connector in this marketplace can sit
behind. An organization deploys it into its own Azure or Google Cloud
project. Users sign in with the organization's IdP (Entra ID, Google
Workspace, or any OIDC IdP). Admins decide, by IdP role or group, which
connectors and which classes of tool each person may use. Every call is
attributed to a person and lands in the cloud's log store, with ready-made
queries for review.

A plugin in this marketplace does the deployment and admin setup for the
organization, so an admin runs a skill instead of hand-building cloud
resources.

## What exists today and what it lacks

`mcp_servers/mcp-gateway` already does the core proxy well: stateless
Streamable HTTP, RFC 9728 metadata, Entra JWT validation with `jose`,
per-vendor `<Vendor>.Read` / `<Vendor>.Write` app roles, fail-closed
read/write split on `readOnlyHint`, per-vendor env allowlisting for child
processes, and a JSON audit line per call with no arguments or results.

Gaps, each confirmed in source:

| Gap | Where |
|---|---|
| Entra only: issuer, JWKS and PRM are hard-coded to `login.microsoftonline.com` | `src/auth.ts:30,44`, `src/http.ts:21` |
| Access rules are code, not config: adding a connector or a role needs a code change and a rebuild | `src/backends.ts:25-43`, `src/policy.ts` |
| No Google support. Google's OAuth has no DCR, no CIMD, opaque access tokens, and no group claims, so "IdP as the authorization server" cannot work for Google | Google discovery doc fetched 2026-10-27: no `registration_endpoint`, no `client_id_metadata_document_supported` |
| Entra as the AS has no DCR or CIMD, so every MCP client needs a pre-registered client ID typed in by hand, and silent Enterprise Managed Auth is impossible (Entra does not accept the RFC 7523 grant for this) | `mcp-gateway-design.md` Known limits |
| One shared child process per vendor for all users: stateful servers leak state across users (Blumira navigation) | `mcp-gateway-design.md` Known limits |
| Audit goes to stdout only, has no schema version, request ID, IdP, client ID, or effect class, and there are no saved queries | `src/gateway.ts:95-117` |
| No IaC. The deployment was built by hand with `az`, and the build script hard-codes one organization's subscription and registry | `scripts/acr-build.sh:21-23` |
| Not packaged: no plugin, skill, or agent knows the gateway exists | repo-wide grep |
| Branded to one organization in code (`henssler-mcp-gateway` client/server names) | `src/backends.ts:100`, `src/http.ts:55` |

## Decisions

### D1. Where it lives

- Runtime stays at `mcp_servers/mcp-gateway` and is evolved in place, same
  as every other server source in this repo. No parallel copy.
- The admin side is an enterprise mode of the `armada` plugin
  (`plugins/armada/enterprise/` plus the `armada-enterprise` skill): deploy,
  policy, audit and connect procedures, and the IaC templates. It uses the
  connector bundles in `plugins/armada/mcp/` and nothing in `atlas`. A
  separate plugin was rejected: the gateway fronts the same connectors armada
  ships, so one plugin keeps one install and one place for org setup.

### D2. Auth: the gateway runs its own authorization server, federated to the IdP

Two modes, chosen by config:

**Broker mode (new default).** The gateway is both the MCP resource server
and an OAuth 2.1 authorization server. It never authenticates users itself:
`/authorize` hands the browser to the organization's IdP with standard
OIDC (code + PKCE), takes the ID token back, resolves the user's roles and
groups once, then issues its own short-lived JWT access token whose `aud`
is exactly the gateway's MCP URL.

Why this mode, with the source for each reason:

- Works with any OIDC IdP, including Google, because the gateway only needs
  an ID token from the IdP, not an MCP-compatible AS.
- MCP clients connect with zero pre-registration. The MCP 2025-11-25 spec
  says clients and AS SHOULD support Client ID Metadata Documents and MAY
  support DCR; Claude uses CIMD when the AS advertises
  `client_id_metadata_document_supported: true` and `none` in
  `token_endpoint_auth_methods_supported`, else DCR (Claude connector auth
  docs).
- Enables silent sign-in for whole organizations ("automatic for admins"):
  Claude's Enterprise Managed Auth posts an IdP-signed identity assertion
  to the AS token endpoint with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`;
  the AS must list that grant in `grant_types_supported`, keep a per-tenant
  allowlist of trusted issuers, and reject anything else with
  `invalid_grant` (Claude Enterprise Managed Auth docs). Entra as AS cannot
  do this; a gateway-owned AS can.
- Uniform tokens: every downstream check reads one claim set regardless of
  IdP.

Implementation: `oidc-provider` (panva), not hand-written OAuth. It ships
DCR, PKCE, RFC 8707 resource indicators with JWT access tokens
(`features.resourceIndicators`, `accessTokenFormat: 'jwt'`), CIMD
(`features.clientIdMetadataDocument`, marked experimental, with SSRF
protection on the fetch), and `registerGrantType` for the jwt-bearer grant
(Context7 `/panva/node-oidc-provider`, read 2026-10-27).

Spec duties this mode takes on, and how:

| MCP 2025-11-25 requirement | How |
|---|---|
| PRM with `authorization_servers` | Points at the gateway's own issuer, listed first (Claude uses only the first entry) |
| Validate `aud` is this server; reject other tokens | `aud` must equal the canonical MCP URL; issuer must be the gateway |
| MUST NOT pass the client's token through | Backends never see it; they use service credentials |
| Proxy with static upstream client MUST get user consent per dynamically registered client | Consent screen on first use per client, showing client name and redirect host |
| PKCE S256 advertised | `code_challenge_methods_supported: ["S256"]` |
| Refresh token rotation for public clients | oidc-provider `rotateRefreshToken` on |
| Claude Code loopback redirect on any port | Port-agnostic match for `localhost` and `127.0.0.1` |

**Direct mode (compat).** Today's behavior: Entra is the AS, the gateway is
only a resource server. Kept so the existing deployment keeps working
unchanged; generalized from Entra-only to any issuer that mints JWT access
tokens with roles or groups.

### D3. Who may use what: one policy file, default deny

Roles come from the IdP. The policy maps them to connectors and effect
classes. Effect class comes from each tool's MCP annotations, which every
server in this repo already sets through `_shared/annotate-tool.ts`, and
which fail closed:

- `read`: `readOnlyHint: true`
- `write`: not read-only and not destructive
- `destructive`: `destructiveHint: true`, or no annotation at all

```yaml
# policy.yaml, versioned in the org's repo, loaded at startup
version: 1
subjects:                      # IdP claim -> gateway role
  - role: helpdesk
    when: { claim: roles, equals: "Gateway.Helpdesk" }        # Entra app role
  - role: netops
    when: { claim: groups, equals: "netops@example.com" }     # Google group
  - role: auditor
    when: { claim: roles, equals: "Gateway.Auditor" }
grants:
  - role: helpdesk
    connectors: [connectwise, ninjaone]
    effects: [read, write]
  - role: netops
    connectors: [panos, sonicwall, auvik]
    effects: [read, write, destructive]
    deny_tools: ["panos_commit*"]          # deny always wins
  - role: auditor
    connectors: [gateway]                  # the gateway's own audit tools
    effects: [read]
```

Rules: no grant means deny; `deny_tools` beats any grant; `tools/list`
returns only what the caller may call, so the model never sees tools it
cannot use. A built-in compat profile maps today's `<Vendor>.Read` /
`<Vendor>.Write` app roles so the existing deployment needs no policy edit.

Group lookup happens once at sign-in, not per request: Entra `roles` claim
(app roles, assigned to groups, which avoids the 200-group overage limit
per Microsoft Learn "Configure group claims and app roles in tokens");
Google via the Cloud Identity Groups API (`searchTransitiveGroups`) with the
gateway's service account. Roles are resolved at sign-in and stamped into the gateway token; a refresh
reuses them. Consequence to accept: removing someone from a group takes effect
at their next sign-in, bounded by `BROKER_REFRESH_TOKEN_TTL` (default 8 hours),
which caps the refresh chain.

The `armada-enterprise` skill prints a who-can-call-what matrix from the policy and the
live tool catalog before any policy change ships.

### D4. Connector isolation

- Each connector runs as its own stdio child with only its own env prefix
  (kept from today).
- Connectors declared `stateful: true` in the catalog (Blumira today) get a
  child per user, reaped after an idle timeout. Others share one child.
  Fixes the cross-user state leak.
- The catalog moves from code to a JSON file generated from
  `plugins/armada/.mcp.json`, so a new connector added to armada shows up
  in the gateway without a gateway code change.
- Duplicate tool names across connectors fail startup loudly instead of one
  silently shadowing the other.

### D5. Secrets

- Vendor service credentials: Azure Key Vault or Google Secret Manager,
  injected per connector. Azure: Container Apps Key Vault references via a
  user-assigned managed identity with Key Vault Secrets User (Microsoft
  Learn "Manage secrets in Azure Container Apps"). Google: Cloud Run secret
  env vars from Secret Manager.
- The gateway's token-signing key: a private JWK held in the same vault,
  two keys during rotation. oidc-provider needs the private key in process,
  so KMS-held keys are out for v1.
- AS state (grants, refresh tokens, DCR clients): a pluggable adapter.
  In-memory for local dev only. Production: Cosmos DB serverless on Azure,
  Firestore on Google. Both bill per use; neither is created without the
  owner's yes.
- Upstream IdP tokens are used once to read identity, then dropped.

### D6. Audit and log insights

One JSON line per event on stdout. Container Apps sends stdout to
`ContainerAppConsoleLogs_CL` in Log Analytics (Microsoft Learn "Monitor
logs in Azure Container Apps"); Cloud Run sends it to Cloud Logging.
Schema `mcp-gw.audit/1`:

| Field | Meaning |
|---|---|
| `schema`, `ts`, `request_id` | version, time, correlation ID (also returned to the client as a header) |
| `event` | `auth_failed`, `token_issued`, `tools_listed`, `tool_call` |
| `actor.sub`, `actor.email`, `actor.idp`, `actor.tenant` | who |
| `client_id` | which MCP client (Claude, Claude Code, VS Code...) |
| `roles` | gateway roles that matched |
| `connector`, `tool`, `effect` | what, and its read/write/destructive class |
| `decision`, `reason` | allow or deny, and the rule that decided |
| `outcome`, `duration_ms` | ok, tool_error, backend_error, timeout |
| `args_hmac` | keyed hash of the arguments: proves two calls were identical without storing their content |

Never logged: arguments, results, tokens. Same NPI rule as today.

Insights ship with the plugin: KQL queries and an Azure Monitor workbook;
Cloud Logging saved queries and log-based metrics. Questions they answer:
who ran destructive tools this week, denials by user, unused grants,
error rate by connector, first-time client IDs. The same queries are also
exposed as two read-only gateway tools (`gateway_audit_search`,
`gateway_access_report`) behind the `auditor` role, so an auditor can ask
Claude instead of opening a portal.

For tamper resistance: optional export to a retention-locked store (Log
Analytics data export to immutable Blob, or a Cloud Logging bucket with a
locked retention policy). Off by default; it costs money.

### D7. Deploy path

| | Azure | Google Cloud |
|---|---|---|
| Runtime | Container Apps, min 1 replica | Cloud Run, min 1 instance |
| IaC | Bicep | Terraform |
| Identity | user-assigned managed identity | service account |
| Secrets | Key Vault (RBAC) | Secret Manager |
| Logs | Log Analytics workspace | Cloud Logging |
| State | Cosmos DB serverless | Firestore |
| Image | built from a staged context (today's `acr-build.sh` rule), parameterized, no hard-coded subscription | same, Artifact Registry |

`armada-enterprise` procedures (`references/setup.md`, `policy.md`,
`audit.md`, `connect.md`), in run order. Azure first; Google Cloud is not yet
supported. Each shows a plan (dry-run `provision`, `what-if`) and waits for
the admin's yes before creating anything:

1. `setup`: ask the admin one question at a time, discover the directory,
   map groups to roles and connectors, generate `policy.yaml`, create the
   Entra app registration with app roles and group assignments (admin tool),
   deploy the infrastructure.
2. `policy`: edit grants, print the who-can-call-what matrix, roll out.
3. `audit`: run the saved insight queries.
4. `connect`: print the URL and the steps to add the gateway as a Claude
   custom connector, and, for Claude Enterprise, how to turn on Enterprise
   Managed Auth.

## Prototype scope (after approval)

Local only. No cloud resources.

- Mock upstream OIDC IdP in-process (stands in for Entra and Google).
- Real `oidc-provider` AS, real MCP SDK client doing the full OAuth flow
  (DCR, PKCE, resource), real armada connector bundles as backends in their
  no-credentials mode plus one fixture server with read, write and
  destructive tools.
- Container image built and run locally with Docker.
- Bicep and Terraform templates validated (`bicep build`, `terraform
  validate`), not applied.

Acceptance tests, each written to fail first:

1. `POST /mcp` with no token: 401 with `resource_metadata`.
2. Token with wrong issuer or wrong audience: 401.
3. User with no grant for a connector: its tools absent from `tools/list`;
   a direct call is denied and audited.
4. Read-only grant: write and destructive tools hidden and denied.
5. Allowed call: proxied to the real backend, result returned, audit line
   matches schema `mcp-gw.audit/1` with no argument content.
6. Full OAuth round trip with the MCP SDK client: register, sign in at mock
   IdP, consent, token, call.
7. jwt-bearer grant: assertion from an allowlisted issuer gets a token; an
   unlisted issuer gets `invalid_grant`.
8. Stateful connector: two users get two child processes.
9. Direct (compat) mode: today's 18 tests still pass.

## Risks and unknowns

- CIMD in oidc-provider is marked experimental. Fallback is DCR, which
  Claude also uses.
- Enterprise Managed Auth needs Claude Team or Enterprise and an IdP that
  issues the assertion. Okta's Cross App Access is documented as a beta;
  whether Entra or Google issue these assertions today is UNVERIFIED.
- Google group lookup needs the gateway's service account granted group
  read in the Workspace admin console. Not tested.
- Cloud Run's stdout JSON field mapping is not yet verified against Google
  docs; checked before the GCP template is written.

## Sources read for this design (2026-10-27)

- MCP authorization spec 2025-11-25: modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- Claude connector authentication: claude.com/docs/connectors/building/authentication
- Claude Enterprise Managed Auth: claude.com/docs/connectors/building/enterprise-managed-auth
- Google OIDC discovery: accounts.google.com/.well-known/openid-configuration
- Microsoft Learn: app roles vs groups and group overage; Container Apps Key Vault references; Container Apps log monitoring
- oidc-provider docs via Context7 (`/panva/node-oidc-provider`); MCP TypeScript SDK 1.32.2 via Context7
- microsoft/mcp-gateway README (Kubernetes-only, per-adapter `requiredRoles`, no Google)
