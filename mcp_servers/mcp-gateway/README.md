# mcp-gateway

One remote MCP endpoint (Streamable HTTP, stateless) in front of the vendor MCP
servers in `plugins/armada/mcp`. Each backend runs as a stdio child process.
The gateway is an OAuth 2.1 resource server: it validates access tokens, maps
token claims to gateway roles, applies a default-deny policy per connector and
effect class (read, write, destructive), and writes one audit line per
decision. Design: `docs/architecture/enterprise-mcp-gateway.md`. Admin tooling:
`plugins/armada` (enterprise mode, skill `armada-enterprise`).

## Modes

| Mode | Who issues access tokens | Selected by |
|---|---|---|
| `direct` | Your identity provider; the gateway only validates | `GATEWAY_MODE=direct`, or `ENTRA_TENANT_ID` set and `GATEWAY_MODE` unset |
| `broker` | The gateway (oidc-provider). It federates sign-in to one upstream OIDC IdP, accepts IdP-signed identity assertions (jwt-bearer grant, typ `oauth-id-jag+jwt`), and issues its own short-lived JWT access tokens | `GATEWAY_MODE=broker` |

Broker endpoints (under `PUBLIC_BASE_URL`): `/.well-known/oauth-authorization-server`,
`/reg` (dynamic client registration), `/auth`, `/token`, `/interaction/callback`
(the redirect URI to register with the upstream IdP). PKCE with S256 is
required. Resource metadata: `/.well-known/oauth-protected-resource/mcp`.
Health: `GET /health`.

## Environment variables

Secrets are marked **secret**: keep them in a secret store, never in the repo,
an image layer or a shell history. Error messages name a variable, never its value.

### Common

| Variable | Default | Meaning |
|---|---|---|
| `GATEWAY_MODE` | see Modes | `broker` or `direct` |
| `PUBLIC_BASE_URL` | required | Public origin, no path. https, or http on loopback. All external URLs derive from it |
| `MCP_RESOURCE_URL` | none | Legacy alternative to `PUBLIC_BASE_URL` |
| `POLICY_FILE` | none | Path to `policy.yaml`. Loaded at startup; changes need a restart |
| `POLICY_COMPAT` | off | `1` adds the built-in `<Vendor>.Read` / `<Vendor>.Write` app-role profile |
| `BACKENDS_ROOT` | `/app/mcp` | Directory holding the vendor bundles |
| `CATALOG_FILE` | `../catalog/catalog.json` next to `dist/` | Connector catalog |
| `ENABLED_BACKENDS` | every installed catalog entry | Comma-separated connector ids |
| `AUDIT_HMAC_KEY` | random per process | **secret.** Keys `args_hmac`; set it to compare hashes across restarts |
| `STATEFUL_IDLE_MS` | `900000` | Idle time before a stateful backend child is stopped |
| `STATEFUL_MAX_CHILDREN` | `50` | Cap on stateful children per user |
| `TOKEN_CLOCK_TOLERANCE_SECONDS` | `5` | Clock skew allowed when validating token times, 0 to 300 (was 60 before 0.3.0) |
| `PORT` | `8080` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |

Vendor credentials (`VANTA_*`, `CW_MANAGE_*`, and so on) are passed to the
matching backend only, by the `envPrefixes` in the catalog. **secret.**

### Broker mode

| Variable | Default | Meaning |
|---|---|---|
| `BROKER_UPSTREAM_ISSUER` | required | Upstream OIDC issuer URL (discovery is lazy) |
| `BROKER_UPSTREAM_CLIENT_ID` | required | Client id registered at the upstream IdP |
| `BROKER_UPSTREAM_CLIENT_SECRET` | required | **secret.** |
| `BROKER_UPSTREAM_KIND` | `oidc` | `entra`, `google` or `oidc` |
| `BROKER_SIGNING_JWKS` | required | **secret.** Private JWKS, first key signs. Generate with `npm run -s gen-jwks` (one RS256 key) |
| `BROKER_COOKIE_KEYS` | required | **secret.** Comma-separated, each at least 32 characters; list two to rotate |
| `BROKER_TRUSTED_ASSERTION_ISSUERS` | none | JSON list of `{issuer, jwks_uri, tenant?}` whose ID-JAG assertions the jwt-bearer grant accepts |
| `BROKER_ACCESS_TOKEN_TTL` | `900` | Seconds |
| `BROKER_REFRESH_TOKEN_TTL` | `28800` | Seconds. Also caps the whole refresh chain (grant lifetime) |
| `ENTRA_MEMBERSHIP_CHECK` | off | `1` re-resolves roles from Graph on every refresh (see Refresh-time membership check); only with `BROKER_UPSTREAM_KIND=entra` |
| `ENTRA_TENANT_ID` | from `BROKER_UPSTREAM_ISSUER` | Tenant GUID for the Graph token; needed only when the issuer URL carries no tenant |
| `ENTRA_SP_OBJECT_ID` | looked up by app id | Object id of the app's service principal. Skips one Graph lookup |
| `ENTRA_MEMBERSHIP_CACHE_SECONDS` | `300` | How long a resolved membership is reused |
| `ENTRA_MEMBERSHIP_FAIL_OPEN` | off | `1` lets a refresh succeed when Graph cannot be reached or answers an error (audited) |
| `ENTRA_GRAPH_BASE_URL` | `https://graph.microsoft.com/v1.0` | Graph endpoint; change for national clouds or tests |
| `ENTRA_AUTHORITY_HOST` | `https://login.microsoftonline.com` | Token endpoint host for the client credentials flow |
| `ENTRA_MANAGED_IDENTITY_CLIENT_ID` | system-assigned | Client id of a user-assigned managed identity to use for Graph |
| `IDENTITY_ENDPOINT`, `IDENTITY_HEADER` | set by Azure | Set both or neither. When present the managed identity gets the Graph token; otherwise the app's client secret does. Container Apps sets them when a managed identity is enabled |
| `GOOGLE_GROUPS_LOOKUP` | off | `1` resolves Google groups at sign-in; only with `BROKER_UPSTREAM_KIND=google` |

### Direct mode

Either the Entra pair, or the generic set (not both):

| Variable | Meaning |
|---|---|
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` | GUIDs. Issuer, JWKS, audiences and tenant check derive from them |
| `DIRECT_ISSUER`, `DIRECT_JWKS_URI`, `DIRECT_AUDIENCES` | Generic IdP; audiences comma-separated |
| `DIRECT_TENANT_CLAIM`, `DIRECT_TENANT` | Optional tenant check; set both or neither |
| `DIRECT_SCOPE` | Default `mcp` |

## policy.yaml

```yaml
version: 1
subjects:                 # IdP claim -> gateway role (exact, case-sensitive)
  - role: helpdesk
    when: { claim: roles, equals: "Gateway.Helpdesk" }
grants:                   # default deny
  - role: helpdesk
    connectors: [vanta]   # connector ids, "*", or "gateway" (audit tools)
    effects: [read]       # read | write | destructive
    deny_tools: ["vanta_navigate"]   # optional globs ("*" only); beats every allow
```

Effect class comes from each tool's MCP annotations and fails closed: no
annotations or no `destructiveHint:false` on a mutating tool means
`destructive`. Unknown keys, roles or connectors stop startup. A starting
point is `plugins/armada/enterprise/templates/policy.example.yaml`.

## Audit

One JSON line per event on stdout, schema `mcp-gw.audit/1`. Events:
`auth_failed`, `token_issued`, `tools_listed`, `tool_call`. Fields: `ts`,
`request_id`, `event`, `actor` (`sub`, `email`, `idp`, `tenant`), `client_id`,
`roles`, `connector`, `tool`, `effect`, `decision` (`allow`/`deny`), `reason`,
`outcome` (`ok`, `tool_error`, `backend_error`, `timeout`), `duration_ms`,
`args_hmac`, `tool_count`. Tool arguments, results and tokens are never logged;
`args_hmac` is an HMAC-SHA-256 of the canonical arguments. The tool
`gateway_audit_search` reads only the last 1000 events of the current process.

## Refresh-time membership check

With `ENTRA_MEMBERSHIP_CHECK=1` (Entra upstream) every token-endpoint grant (the sign-in
code exchange and each refresh) asks
Graph again who the user is, using application permissions
`Application.Read.All`, `GroupMember.Read.All` and `User.Read.All`. The admin
tool grants them (below). The token comes from the managed identity when
`IDENTITY_ENDPOINT` and `IDENTITY_HEADER` are set, else from the app's client
credentials. Results are cached for `ENTRA_MEMBERSHIP_CACHE_SECONDS`.

What revokes access: the user is disabled or deleted, an Entra "Revoke sessions"
(`signInSessionsValidFromDateTime`) is later than the user's upstream sign-in, or no app role of the
gateway app reaches the user (directly or through an assigned group) and the
policy then resolves to no role. A changed set of roles is
stamped into the new access token. Revocation takes effect at the next refresh,
at most one access token lifetime later (`BROKER_ACCESS_TOKEN_TTL`), plus the
cache time.

Fail-closed is the default. If Graph or the token source cannot be reached, or
Graph answers an error, the refresh fails with `invalid_grant` and the client
signs in again. This includes a throttled (HTTP 429) Graph. Set
`ENTRA_MEMBERSHIP_FAIL_OPEN=1` to let such a refresh through; it is audited.

Audit events (`auth_failed`, `reason` field): `membership_revoked` (refresh
refused, `outcome` `backend_error`) and `membership_check_unavailable`
(`outcome` `backend_error` when refused, `ok` when let through by fail-open).
Lines hold no user ids, group ids or tokens beyond the usual actor fields.

## Admin setup tool

`dist/admin/cli.js` (after `npm run build`) turns a directory into the Entra
state the gateway needs. It reads `GRAPH_TOKEN`, else the Azure CLI. `discover`
and a `provision` dry run only read.

```bash
node dist/admin/cli.js discover --out org-model.json
node dist/admin/cli.js plan --org org-model.json --answers answers.yaml --out plan.json --policy policy.yaml
node dist/admin/cli.js provision --plan plan.json
node dist/admin/cli.js provision --plan plan.json --apply [--prune] [--managed-identity-principal-id <id>]
```

`plan` is offline and writes `plan.json` and a `policy.yaml` that loads in the
gateway. `provision --apply` creates or updates the app registration, app
roles, group assignments, tenant-wide consent for the delegated scopes and the
Graph application permissions above (for the gateway service principal, or,
with `--managed-identity-principal-id`, for that managed identity only).
`provision` rejects a plan whose permission ids differ from the built-in ones,
or whose consent type or resource app id is not `AllPrincipals` / a GUID. It is
idempotent and deletes nothing without `--prune`. Walkthrough:
`plugins/armada/skills/armada-enterprise/references/setup.md`.

## Run locally

```bash
npm install
npm run build
GATEWAY_MODE=broker PUBLIC_BASE_URL=http://127.0.0.1:8080 HOST=127.0.0.1 \
  POLICY_FILE=./policy.yaml BACKENDS_ROOT=../../plugins/armada/mcp \
  BROKER_UPSTREAM_ISSUER=https://idp.example.com BROKER_UPSTREAM_CLIENT_ID=... \
  BROKER_UPSTREAM_CLIENT_SECRET=... BROKER_SIGNING_JWKS="$(npm run -s gen-jwks)" \
  BROKER_COOKIE_KEYS="$(openssl rand -hex 24)" AUDIT_HMAC_KEY="$(openssl rand -hex 24)" \
  npm start
```

Container (build context is the repo root):

```bash
docker build -f mcp_servers/mcp-gateway/Dockerfile -t mcp-gateway:dev .
```

For a registry build that never uploads the monorepo, use
`scripts/acr-build.sh <registry> <resource-group> <subscription>` (or set
`ACR_REGISTRY`, `ACR_RESOURCE_GROUP`, `ACR_SUBSCRIPTION`); it has no defaults.
After editing `overrides.json`, run `node scripts/gen-catalog.mjs` (`--check`
verifies it is current).

## Test

```bash
npx tsc --noEmit
npm test
```

## Limits

- State (sessions, grants, refresh tokens, used assertion ids) is in memory:
  run exactly one replica until a persistent adapter ships. A restart signs
  everyone out.
- Roles are resolved at sign-in and stamped into the token. Removing a role
  takes effect at the next sign-in; the refresh chain is capped by
  `BROKER_REFRESH_TOKEN_TTL` (default 8 hours).
- Client ID Metadata Documents (CIMD) are advertised in metadata but not
  exercised end to end; the oidc-provider feature is experimental.
- Which identity providers can mint the ID-JAG assertions the jwt-bearer grant
  needs is not verified.
