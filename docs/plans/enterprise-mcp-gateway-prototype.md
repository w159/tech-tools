# Enterprise MCP gateway: prototype build plan

Design: `docs/architecture/enterprise-mcp-gateway.md` (D1-D7, acceptance
tests 1-9). This file is the implementation spec the build follows. Target:
`mcp_servers/mcp-gateway/` evolved in place. Local only, no cloud resources.

## Done before this plan

- `src/policy.ts` rewritten: `effectOf`, `parsePolicy` (strict, policy.yaml
  v1), `compatPolicy` (legacy `<Vendor>.Read/.Write`), `mergePolicies`,
  `resolveRoles`, `decide` (default deny, deny_tools wins, reason strings
  `no_grant`, `deny_tools:<role>:<pattern>`, `effect_not_granted:<effect>`,
  `grant:<role>`), `hasAnyGrant`, `accessMatrix`, `GATEWAY_CONNECTOR`.
- `src/backends.ts` rewritten: `BackendSpec` from catalog JSON,
  `parseCatalog`/`loadCatalog`, `isInstalled`, `childEnv`, `Backend`,
  `BackendPool` (shared child for stateless, per-user child for
  `stateful: true`, idle reap, LRU cap), `CLIENT_INFO` (`mcp-gateway`).
- `src/audit.ts` new: `AuditLogger` (schema `mcp-gw.audit/1`, `argsHmac`
  over `canonicalJson`, in-memory ring for local search), `requestIdFrom`.
- `catalog/overrides.json`, `scripts/gen-catalog.mjs`,
  `catalog/catalog.json` (13 connectors, `--check` mode for CI).

Old tests (`policy.test.ts`, `backends.test.ts`, `auth.test.ts`,
`http.test.ts`) target the old API and are ported, keeping every original
behavior (acceptance test 9).

## Slice A: core resource server (direct mode)

### src/auth.ts (replace)

```ts
export class AuthError extends Error { status: 401 | 403 }
export interface Identity {
  userKey: string;          // "<issuer>|<sub>"
  sub: string;              // Entra: oid; else sub
  email?: string;           // email ?? preferred_username ?? upn
  name?: string;
  idp: string;              // payload.idp ?? opts.idp
  tenant?: string;
  clientId?: string;        // client_id ?? azp ?? appid
  roles: readonly string[]; // gateway roles
}
export interface TokenVerifierOptions {
  issuer: string; audiences: string[]; keyResolver: JWTVerifyGetKey;
  tenant?: { claim: string; equals: string };
  rolesFor: (claims: JWTPayload) => string[];
  idp: string;
}
export function remoteJwks(jwksUri: string): JWTVerifyGetKey;
export async function verifyAccessToken(token: string, opts: TokenVerifierOptions): Promise<Identity>;
```

jose `jwtVerify` with issuer, audience list, clockTolerance 60. Any verify
failure -> `AuthError(401)`; never log the token. Tenant pin -> 401 on
mismatch. Missing subject -> 401.

### src/config.ts (replace)

`loadConfig(env)` returns a frozen `GatewayConfig`:

| Env | Meaning |
|---|---|
| `GATEWAY_MODE` | `broker` or `direct`. Default `direct` when `ENTRA_TENANT_ID` is set (keeps the existing deployment working with no env change), else required |
| `PUBLIC_BASE_URL` | Canonical https origin. MCP resource = `<base>/mcp`. Back-compat: if absent and `MCP_RESOURCE_URL` set, base = its origin and resource = its canonical value |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` | Direct-mode shorthand: issuer `https://login.microsoftonline.com/<tid>/v2.0`, JWKS `.../discovery/v2.0/keys`, audiences `[clientId, api://clientId, resource]`, tenant pin `tid`, scope `<resource>/access_as_user` |
| `DIRECT_ISSUER`, `DIRECT_JWKS_URI`, `DIRECT_AUDIENCES` (comma list), `DIRECT_TENANT_CLAIM`, `DIRECT_TENANT`, `DIRECT_SCOPE` | Generic direct mode for any JWT-issuing IdP |
| `POLICY_FILE` | policy.yaml path. Absent -> compat profile only. Present -> its rules plus the compat profile when `POLICY_COMPAT=1` |
| `CATALOG_FILE` | default `<gateway dir>/catalog/catalog.json` resolved from the module location |
| `BACKENDS_ROOT` | default `/app/mcp` |
| `ENABLED_BACKENDS` | comma list; default every installed catalog entry |
| `AUDIT_HMAC_KEY` | secret for `args_hmac`; absent -> ephemeral key and one startup warning on stderr |
| `STATEFUL_IDLE_MS` (default 900000), `STATEFUL_MAX_CHILDREN` (default 50) | pool limits |
| `PORT` (8080), `HOST` (0.0.0.0) | listener |

Broker-only env is listed in Slice B. Validation errors list every missing
or invalid variable in one message.

### src/gateway.ts (replace)

```ts
export interface ToolCallResult { isError?: boolean; [k: string]: unknown }
export class Gateway {
  constructor(pool: BackendPool, policy: Policy, audit: AuditLogger, opts?: { auditorTools?: boolean });
  init(): Promise<void>;
  listTools(identity: Identity, requestId: string): Promise<Tool[]>;
  callTool(identity: Identity, name: string, args: Record<string, unknown> | undefined, requestId: string): Promise<ToolCallResult>;
  catalogSnapshot(): Map<string, Tool[]>;
}
```

- init: lists every enabled stateless connector once, and each stateful
  connector through a throwaway child that is closed afterwards. Duplicate
  tool names across connectors -> throw an Error naming both connectors. A
  connector that fails to list is logged to stderr and skipped.
- listTools: for each connector where `hasAnyGrant`, tools from the shared
  index (stateful: from the user's own child via `pool.get(id, userKey)`),
  filtered by `decide(...).allow`, plus gateway tools when allowed. Emits one
  `tools_listed` event with `tool_count`.
- callTool: resolve tool -> connector from the index (stateful: the user's
  listing). Unknown tool -> `isError` "Unknown tool" and a `tool_call` deny
  event with reason `unknown_tool`. Deny -> `isError` text
  `Access denied: <tool> (<reason>)`, audited. Allow -> proxied; outcome
  `ok`, `tool_error` (result.isError), or `backend_error` (throw; error
  rethrown). Every `tool_call` event carries request_id, actor, client_id,
  roles, connector, tool, effect, decision, reason, outcome, duration_ms,
  args_hmac. Never args or results.
- Gateway tools under connector `gateway`, both `readOnlyHint: true,
  destructiveHint: false`:
  - `gateway_access_report`: returns `accessMatrix(policy, catalogSnapshot())` as JSON text.
  - `gateway_audit_search`: input `{ actor?, connector?, decision?, event?, limit? (<=200) }`, searches `audit.recent(...)`. Its description says it covers this process's recent events only and that the cloud log store is the system of record.

### src/http.ts (replace)

`createHttpServer(deps)`, deps = `{ config, gateway, verify: (token) => Promise<Identity>, audit, health: () => object, prm: () => object, wwwAuthenticateScope: string, fallback?: (req, res) => void }`.

- Every response gets `X-Request-Id` from `requestIdFrom(req.headers["x-request-id"])`.
- `GET /health` -> 200 `{ status: "ok", backends: [...] }`.
- `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` -> PRM JSON.
- `POST /mcp`: no/invalid bearer -> 401 `{error:"invalid_token"}` with
  `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/mcp", scope="<scope>"`
  and an `auth_failed` audit event (reason only, never the token). Identity
  with zero gateway roles -> 403 `{error:"insufficient_scope"}` with
  `WWW-Authenticate: Bearer error="insufficient_scope", scope="<scope>", resource_metadata="..."`,
  audited as `auth_failed` reason `no_roles`. Else stateless Streamable HTTP
  as today (one Server + transport per request, `enableJsonResponse: true`,
  `sessionIdGenerator: undefined`), server info `{ name: "mcp-gateway", version: "0.2.0" }`.
- `GET`/`DELETE /mcp` -> 405. Body over 1 MB -> 413.
- Any other path -> `deps.fallback` if set (broker mode mounts oidc-provider there), else 404.
- Origin for PRM URLs comes from config (`PUBLIC_BASE_URL`), never from the Host header.

### src/index.ts (replace)

Wire config -> catalog -> pool -> policy -> audit -> gateway.init() ->
verifier -> http. Interval `pool.reapIdle()` every 60 s (unref).
SIGTERM/SIGINT close http and `pool.closeAll()`. Header comment describes
the product generically (no organization names).

### Tests for Slice A (vitest, `src/*.test.ts`)

Port all 18 original behaviors, then add:

1. No token -> 401 + `resource_metadata` (acceptance 1).
2. Wrong issuer, wrong audience, tenant mismatch, expired -> 401 (acceptance 2).
3. User whose grants cover connector A only: connector B tools absent from
   tools/list; calling a B tool -> isError deny; a `tool_call` audit line
   with decision deny reason `no_grant` (acceptance 3).
4. Read-only grant: write and destructive tools hidden and denied with
   `effect_not_granted:write` / `:destructive` (acceptance 4). deny_tools
   beats a broad grant.
5. Allowed call proxied; audit line matches schema; `args_hmac` present and
   equal for `{a:1,b:2}` vs `{b:2,a:1}`; the serialized line contains
   neither argument values nor result text (acceptance 5).
8. Stateful connector: two users -> two backend instances from the factory;
   same user twice -> one; idle reap closes it; cap evicts LRU (acceptance 8).
- policy: parsePolicy rejects unknown keys, unknown connector, unknown
  effect, grant role without subject; effectOf table; compat profile.
- catalog: `node scripts/gen-catalog.mjs --check` passes; parseCatalog
  expands `${BACKENDS_ROOT}` and rejects duplicate ids.
- Duplicate tool names across two connectors make `gateway.init()` throw.
- One integration test spawns a real fixture stdio MCP server
  (`src/test-fixtures/fixture-server.mjs`: tools `fx_read` read, `fx_write`
  write, `fx_delete` destructive, built with the MCP SDK `McpServer`)
  through a real `Backend`, and one real armada bundle
  (`plugins/armada/mcp/vanta/server.mjs`, no credentials) listing its tools
  through a real `Backend`.

Gate: `npx tsc --noEmit` clean and `npm test` green.

## Slice B: broker mode (gateway as authorization server)

New `src/broker/` using `oidc-provider` 9.12.2 (exact pin; its
`lib/helpers/grants.js` is unversioned) and `openid-client` 6.8.8.

Env: `BROKER_UPSTREAM_ISSUER`, `BROKER_UPSTREAM_CLIENT_ID`,
`BROKER_UPSTREAM_CLIENT_SECRET`, `BROKER_UPSTREAM_KIND` (`entra`, `google`,
`oidc`), `BROKER_SIGNING_JWKS` (private JWKS JSON, required in broker mode),
`BROKER_COOKIE_KEYS` (comma list, required),
`BROKER_TRUSTED_ASSERTION_ISSUERS` (JSON list of `{issuer, jwks_uri, tenant?}`
for jwt-bearer), `BROKER_ACCESS_TOKEN_TTL` (900), `BROKER_REFRESH_TOKEN_TTL`
(28800), `GOOGLE_GROUPS_LOOKUP` (`1` to resolve Google groups).

- Issuer = `PUBLIC_BASE_URL`; resource = `<base>/mcp`; resource scope `mcp`.
- `features.registration` (DCR, public clients allowed; clientDefaults
  `application_type: native` so loopback redirects match on any port;
  `token_endpoint_auth_method: none` default).
- `features.clientIdMetadataDocument` (CIMD).
- `features.resourceIndicators`: `defaultResource` = resource,
  `useGrantedResource` true, `getResourceServerInfo` returns scope `mcp`,
  audience = resource, `accessTokenFormat: 'jwt'`, TTL from env; any other
  resource -> InvalidTarget.
- PKCE S256 only. `rotateRefreshToken` on. `issueRefreshToken` when the
  client may use `refresh_token`.
- `extraTokenClaims`: `roles` (gateway roles), `email`, `idp`, `tenant`
  from the account store.
- Account store persisted through the provider adapter (model
  `GatewayAccount`), so a future Cosmos/Firestore adapter covers it.
- Interactions at `/interaction/:uid`: login prompt -> redirect upstream
  with openid-client (PKCE, state, nonce; pending state in adapter model
  `UpstreamLogin`, 10 min TTL). Callback `/interaction/callback` ->
  `authorizationCodeGrant` -> claims (+ Google groups via Cloud Identity
  `groups/-/memberships:searchTransitiveGroups` with query
  `member_key_id == '<email>' && 'cloudidentity.googleapis.com/groups.discussion_forum' in labels`,
  token from the metadata server, when `GOOGLE_GROUPS_LOOKUP=1`) ->
  `resolveRoles` -> account upsert -> `interactionFinished({login})`.
  Consent prompt -> HTML page naming the client and its redirect host, form
  POST `/interaction/:uid/confirm` or `/abort`. Every interpolated value
  HTML-escaped.
- jwt-bearer grant (`urn:ietf:params:oauth:grant-type:jwt-bearer`, ID-JAG):
  header `typ` `oauth-id-jag+jwt`; `iss` in the trusted list (else
  `invalid_grant`); signature via that issuer's JWKS; `aud` = our issuer;
  `client_id` claim = authenticated client; `resource`, if present, = ours;
  `exp`/`iat` checked; `jti` single use (adapter model `AssertionJti`).
  Roles resolved from the assertion claims. Issues an access token for the
  MCP resource.
- Audit: `token_issued` from provider events.
- PRM in broker mode: `authorization_servers: [issuer]`,
  `scopes_supported: ["mcp"]`; WWW-Authenticate scope `mcp`.
- Resource-server verifier in broker mode: issuer = ours, audience =
  resource, keys = our public JWKS, roles from the `roles` claim.

Tests:
6. Full round trip: in-process mock upstream OIDC IdP (jose-signed ID
   tokens, `/authorize` auto-approves a fixed test user), MCP SDK client
   `auth()` with an `OAuthClientProvider` doing DCR + PKCE + resource; test
   code follows redirects with a cookie jar, posts consent, gets a token,
   then `tools/list` and `tools/call` through the gateway; refresh rotates.
   Discovery advertises `client_id_metadata_document_supported: true`,
   `none` auth, S256, jwt-bearer.
7. jwt-bearer: allowlisted issuer -> access token that works on `/mcp`;
   unlisted issuer, wrong aud, replayed jti -> `invalid_grant`.

### Slice B as built: deviations

- Upstream callback hand-off. oidc-provider's `_interaction` cookie is scoped
  to `/interaction/<uid>`, so `/interaction/callback` (the fixed upstream
  redirect URI) cannot read it. The callback validates `state`, exchanges the
  code, resolves roles and stores the result in `UpstreamLogin`, then redirects
  to `/interaction/<uid>/continue?s=<state>`, which has the cookie, checks the
  record belongs to that interaction, deletes it (single use) and calls
  `interactionFinished`.
- Consent cancel is `POST /interaction/:uid/abort` (the example uses GET).
  Both POSTs reject a cross-origin `Origin` header. The page sets no
  `form-action` CSP because browsers apply it to the redirect after the POST.
- Roles are resolved at upstream sign-in (or per assertion) and stored on the
  account; refresh does not re-query the IdP. The refresh chain is capped by
  `ttl.Grant = BROKER_REFRESH_TOKEN_TTL`, sessions last 8 h and login is
  `remember: false`, so a role change reaches the user at the next sign-in.
- A user who resolves to zero gateway roles is refused at sign-in
  (`access_denied`, audit `auth_failed` reason `no_roles`) and at the
  jwt-bearer grant (`invalid_grant`).
- `clientDefaults.grant_types` is `authorization_code, refresh_token,
  jwt-bearer`, so clients that omit `grant_types` can use the assertion grant.
  Clients that list their own grant types must include it.
- `tenant` on a trusted assertion issuer is matched against the assertion's
  `tenant` (or `tid`) claim. Assertions older than 10 minutes by `iat` are
  refused even when `exp` is later.
- Rejection detail goes to the audit log as a reason code only; the client
  always sees `invalid_grant` / "grant request is invalid".
- Google groups: the metadata server token request has no `scopes` parameter
  (the Compute Engine docs do not document one), so the VM service account
  itself must carry a Cloud Identity groups scope. A lookup failure is logged
  and sign-in continues without groups, so access fails closed.
- An upstream ID token with `email_verified: false` loses its email, so a
  policy rule on email cannot match it.
- Storage is the in-memory adapter (`src/broker/adapter.ts`); state is lost on
  restart and is not shared between replicas. CIMD is enabled and advertised
  but not exercised end to end (the fetch needs a public https client_id URL).
- `token_issued` audit events carry a generated `request_id`: the provider
  event has no request context.
- `src/broker/oidc-provider.d.ts` is a small type shim (no types ship with
  oidc-provider and no new package is allowed). `src/http.ts` needed no change:
  the existing `fallback`, `verify`, `prm` and `wwwAuthenticateScope` slots
  carry everything. The old "broker mode not built yet" config test was
  replaced by a missing-variables test.

## Slice C: package, container, plugin

- `Dockerfile`: copy `catalog/`, keep the staged-context rule, no `.env`.
- `scripts/acr-build.sh`: registry, resource group and subscription come
  from env or flags with no organization defaults; refuses to run without
  them.
- Local container run with the fixture IdP as evidence.
- `plugins/armada/` enterprise mode: skill `armada-enterprise` with
  references `setup`, `policy`, `audit`, `connect`, and `enterprise/` holding
  `infra/azure` (Bicep), `infra/gcp` (Terraform, not yet supported),
  `queries/` (KQL + Cloud Logging).
  Templates validated (bicep build, terraform validate), never applied.
- Marketplace entry, CHANGELOG, README.
