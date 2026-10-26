# SonicWall (SonicOS API) connector design contract

Source of truth for the `sonicwall` atlas connector. Every implementer working on
`mcp_node/node-sonicwall` or `mcp_servers/sonicwall-mcp` codes against this file.
It mirrors `docs/architecture/panos-connector-design.md`; where this file is silent, do what
panos does.

Grounded in the vendor's own Swagger UI dump for SonicOS API 7.3.2-7010 (OAS 3.0,
2879 operations, 1043 tags; inventory extracted to
`mcp_servers/sonicwall-mcp/sonicos-endpoints.json`), the SonicOS 7 API Reference
Guide on sonicwall.com, and the SonicWall KBs cited inline. Research notes with
the per-claim citations: `.atlas/.run/sonicos/research-sonicos-api*.md`
(ephemeral; the verified facts are restated here).

## Scope decided with the user (2026-10-21)

- Surface: curated core domains plus ONE grounded generic request tool backed by
  the endpoint inventory. About 55 to 65 tools.
- Write posture: every POST/PUT/PATCH/DELETE on SonicOS is staged into the
  pending config; nothing takes effect until `POST /config/pending`. The
  connector keeps that split: mutating tools stage, `sonicwall_config_commit` is
  a separate explicit call. Writes never auto-commit.
- Auth: username and password from plugin userConfig or `.env`. The server logs
  in itself (`POST /auth`, HTTP Basic over HTTPS), keeps the session in process
  memory, and re-authenticates on 401 or expiry. Session override is OFF by
  default and configurable.
- Out of scope for v1: TFA/TOTP login (`POST /tfa`), CHAP, Digest session
  security, VPN writes, SonicPoint, switch controller, firmware/restart,
  import/export of config files.

## The API, in five facts

1. Base URL is `https://{host}[:{port}]/api/sonicos`. The swagger server line
   carries a `/v7.3.2-7010` segment, but every vendor doc and KB uses the
   unversioned path, so the connector does too. Default port 443. Appliances
   ship a self-signed certificate, so a `verifyTls` toggle exists; it defaults
   to true and is never disabled silently.
2. Headers on every call: `Accept: application/json`,
   `Content-Type: application/json`. Credentials travel only in the
   `Authorization` header (Basic) or a JSON body (TFA/CHAP), never in a URL.
3. One admin configures at a time. A single SonicOS API session is allowed; a
   second login without `override` fails, and `override: true` preempts the
   human admin. That is why override defaults to false.
4. Writes are staged. `GET /config/pending` shows the staged delta,
   `POST /config/pending` commits (CLI `commit`), `DELETE /config/pending`
   discards. The pending config is lost when the session ends, by logout or by
   idle timeout. Some logins land in non-config mode: `POST /config-mode` claims
   config mode (and preempts when `override` is set), `POST /non-config-mode`
   releases it. Non built-in admins may need `POST /start-management` first.
5. The response envelope is
   `{"status":{"success":bool,"cli":{...},"info":[{"level","code","message"}]}}`.
   It is guaranteed on every POST/PUT/DELETE and on every error; a successful
   GET returns the resource JSON with no wrapper. HTTP map (KB
   "List of error codes for SonicOS API calls"): 400 `E_INVALID_API_CALL`,
   `E_INVALID_FXN_ARG`, `E_EXISTS`, `E_NO_MATCH`, `E_SYNTAX`, `E_RANGE`; 401
   `E_UNAUTHORIZED`, `E_MAX_LOGIN_ATTEMPTS`, `E_USER_LOCKOUT`; 403
   `E_ACCESS_DENIED`, `E_DISABLED` (also "API disabled"); 404 `E_NOT_FOUND`;
   405 `E_READ_ONLY`, `E_NON_CONFIG`, `E_UNLICENSED`, `E_HA_IDLE`; 500
   `E_ERROR`, `E_TIME_OUT`, `E_LOST_CONN`; 503 session limit. 200 can carry
   `E_WARNING`, `E_NO_CHANGE`, `E_TEST_FAILED`.

### The failure mode the client must not have

Whether SonicOS ever answers HTTP 200 with `success:false` is not confirmed in
the docs, and `E_TEST_FAILED` rides on 200. The client therefore throws
`SonicwallApiError` whenever `status.success === false` OR any `info[].level ===
"error"`, regardless of HTTP status, and treats `E_WARNING` / `E_NO_CHANGE` as
success with the info array attached. This is the invariant the client test file
exists to hold, exactly as panos holds its "HTTP 200 failure" rule.

## Environment contract

| Var | Required | Default | Meaning |
|---|---|---|---|
| `SONICWALL_HOST` | yes | none | Firewall hostname / IP. No scheme, no path. Required with no vendor default for the same reason as `PANOS_HOST`: the base URL is the appliance. |
| `SONICWALL_USERNAME` | yes | none | Admin user. Use a dedicated least-privilege API admin, not the built-in `admin`, so audit entries are attributable. |
| `SONICWALL_PASSWORD` | yes | none | Admin password. Sent only in the Basic `Authorization` header over HTTPS. |
| `SONICWALL_PORT` | no | `443` | Management HTTPS port. |
| `SONICWALL_VERIFY_TLS` | no | `true` | Set `false` only for an appliance still on its factory self-signed certificate; `sonicwall_status` reports it as a warning. |
| `SONICWALL_SESSION_OVERRIDE` | no | `false` | When `true`, login and config-mode preempt whichever admin currently holds the session. Off by default so automation never silently boots a human out of the console. |

Six keys, in `.mcp.json` as `CFG_SONICWALL_*` mapped from `${user_config.sonicwall_*}`,
and in `plugin.json` userConfig with `sensitive: true` on the password. Every
optional value passes through the shared `cleanEnv` placeholder stripper so an
unresolved `${user_config.x}` falls through to the default.

## node-sonicwall client contract

`mcp_node/node-sonicwall`. Zero runtime dependencies (global `fetch` on Node 20).
Layout and tooling copy `mcp_node/node-panos` (tsup dual ESM/CJS, vitest,
`package.json` `file:` consumption from the server).

```ts
export interface SonicwallConfig {
  host: string;
  username: string;
  password: string;
  port?: number;              // default 443
  verifyTls?: boolean;        // default true
  sessionOverride?: boolean;  // default false
  timeoutMs?: number;         // default 60_000
  fetch?: typeof fetch;       // injectable for tests
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SonicwallInfo { level: string; code: string; message: string }
export interface SonicwallStatus {
  success: boolean;
  cli?: { depth?: number; mode?: string; command?: string; configuring?: boolean;
          pending_config?: boolean; restart_required?: string };
  info: SonicwallInfo[];
}

export class SonicwallClient {
  constructor(cfg: SonicwallConfig);

  // Raw call. Logs in on first use; retries exactly once after a 401 by
  // logging in again. Throws SonicwallApiError per the invariant above.
  request<T = unknown>(method: Method, path: string, opts?: {
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    accept?: 'application/json' | 'text/plain';
  }): Promise<T>;

  // Session lifecycle (all explicit; request() calls login() lazily).
  login(): Promise<SonicwallStatus>;        // POST /auth (Basic), then POST /start-management (tolerated failure), stores bearer token if the body carries one
  logout(): Promise<void>;                  // DELETE /auth; never throws
  session(): { loggedIn: boolean; bearer: boolean; lastActivity?: number; relogins: number };

  // Config lifecycle.
  configMode(): Promise<SonicwallStatus>;   // POST /config-mode (body {override} when sessionOverride)
  nonConfigMode(): Promise<SonicwallStatus>;// POST /non-config-mode
  pending(): Promise<unknown>;              // GET /config/pending
  commit(opts?: { bestEffort?: boolean }): Promise<SonicwallStatus>;  // POST /config/pending[/best-effort]
  discard(): Promise<SonicwallStatus>;      // DELETE /config/pending

  // Convenience: the REST resources the curated domains use.
  list(resource: string): Promise<unknown>;                             // GET /<resource>
  get(resource: string, key: 'name' | 'uuid', id: string): Promise<unknown>;
  create(resource: string, body: unknown): Promise<SonicwallStatus>;    // POST /<resource>
  update(resource: string, key: 'name' | 'uuid', id: string, body: unknown, opts?: { patch?: boolean }): Promise<SonicwallStatus>;
  remove(resource: string, key: 'name' | 'uuid', id: string): Promise<SonicwallStatus>;
}

export class SonicwallApiError extends Error {
  readonly httpStatus: number;
  readonly code: string | undefined;     // first error-level E_* code, else first info code
  readonly info: SonicwallInfo[];
  readonly responseText: string;
}
```

### Session rules the client must implement

- **Lazy login.** `request()` calls `login()` when no session exists. Login is
  `POST /auth` with `Authorization: Basic base64(user:pass)` and, when
  `sessionOverride` is true, body `{"override": true}`. If the 7.3.2+ bearer
  check is on, the `/auth` response body carries a bearer token; the client
  looks for a string under keys `token` / `bearer_token` / `access_token` at the
  top level or inside `status`, stores it, and sends `Authorization: Bearer
  <token>` on every later call. Without a token it keeps sending Basic. Any
  `set-cookie` headers from `/auth` are replayed as `Cookie` (Node fetch keeps
  no jar). Then it attempts `POST /start-management`; a failure there is
  recorded in `session()` but not thrown, because built-in admins do not need it.
- **One retry on 401.** A 401 on any call other than `/auth` triggers one
  `login()` and one retry. A second 401 throws. The retry counter is exposed by
  `session().relogins` so `sonicwall_status` can report it.
- **Re-login loses pending config.** When a retry login happens, the thrown or
  returned result carries a warning string `session re-established; any
  uncommitted pending config was discarded by the firewall` so the model does
  not assume staged writes survived.
- **Config mode before writes.** `create/update/remove`, `commit`, `discard`
  call `configMode()` once per session before the first write; a later
  `E_NON_CONFIG` (405) triggers one more `configMode()` and one retry.
- **Logout on exit.** The server registers `SIGINT`/`SIGTERM`/`beforeExit`
  handlers that call `logout()` so the single admin slot is released.
- **Redaction.** `SonicwallApiError.message` and `responseText` never contain
  the password, the Basic header, or the bearer token; the client scrubs the
  Authorization header value and any `password` / `tfa` / `psk` /
  `shared_secret` JSON values before storing `responseText`.
- **Identifiers stay strings.** The client never coerces response values; JSON
  is parsed as-is and UUIDs / names are passed back verbatim.

## Server contract

`mcp_servers/sonicwall-mcp` mirrors `panos-mcp`: `src/index.ts` transport
bootstrap, `src/server.ts` with progressive disclosure, `src/utils/{client,logger,
types,sonicwall-error}.ts`, `src/annotate-tool.ts`, `src/domains/` with one module
per domain exporting a `DomainHandler`, `src/domains/_helpers.ts` carrying the
four effect-class wrappers (`readOnlyTool`, `destructiveTool`,
`credentialIssuingTool`, `unknownEffectTool`), `tests/boot-probe.mjs`,
`tsup.bundle.config.ts` writing `plugins/atlas/mcp/sonicwall/server.mjs`,
`scripts/pack-mcpb.js`, `manifest.json`.

### Progressive disclosure gate

- `host` or `username` or `password` absent: `sonicwall_status` and
  `sonicwall_navigate` only.
- all three set: the full tool set.

There is no credential-issuing tool: SonicOS has no API-key mint. The
`credentialIssuingTool` wrapper still exists in `_helpers.ts` (the fleet
contract expects the four wrappers) and is simply unused.

### Domains and tools

Resource enums use the SonicOS wire path segment so the model never composes a
path. `objects` resources are keyed by `name`; `policies` resources by `uuid`.

| Domain | Tools | Class |
|---|---|---|
| `navigation` | `sonicwall_status`, `sonicwall_navigate` | read |
| `session` | `sonicwall_logout` | mutating (releases the admin slot) |
| `system` | `sonicwall_version` (GET /version), `sonicwall_system_status` (GET /reporting/status/system), `sonicwall_security_services_status` (GET /reporting/status/security-services), `sonicwall_interfaces_status` (GET /reporting/status/interfaces), `sonicwall_license_status` (GET /reporting/license), `sonicwall_api_settings` (GET /administration/global/sonicos-api), `sonicwall_logged_in_users` (GET /user/status/logged-in/all) | read |
| `config` | `sonicwall_config_pending` (GET /config/pending), `sonicwall_config_commit` (POST /config/pending, `bestEffort` flag selects /best-effort), `sonicwall_config_discard` (DELETE /config/pending), `sonicwall_config_mode` (POST /config-mode), `sonicwall_non_config_mode` (POST /non-config-mode) | pending: read; the rest mutating |
| `objects` | `sonicwall_objects_list`, `sonicwall_objects_get`, `sonicwall_objects_create`, `sonicwall_objects_update` (PUT, or PATCH with `patch: true` where the inventory has PATCH), `sonicwall_objects_delete`; `resource` enum: `address-objects/ipv4`, `address-objects/ipv6`, `address-objects/fqdn`, `address-objects/mac`, `address-groups/ipv4`, `address-groups/ipv6`, `service-objects`, `service-groups`, `zones`, `schedules` | list/get read; rest mutating |
| `policies` | `sonicwall_policies_list`, `sonicwall_policies_get`, `sonicwall_policies_create`, `sonicwall_policies_update`, `sonicwall_policies_delete`; `resource` enum: `access-rules/ipv4`, `access-rules/ipv6`, `security-policies/ipv4`, `security-policies/ipv6`, `nat-policies/ipv4`, `nat-policies/ipv6`, `route-policies/ipv4`, `route-policies/ipv6` (keyed by uuid; `access-rules` has no PATCH, so `patch: true` is rejected there with a clear error) | list/get read; rest mutating |
| `interfaces` | `sonicwall_interfaces_list` (GET /interfaces/ipv4), `sonicwall_interfaces_get` (GET /interfaces/ipv4/name/{NAME}/vlan/{VLANID}/tunnel/{TUNNELID}; vlan and tunnel default `0`), `sonicwall_interfaces_ipv4_status` (GET /reporting/interfaces/ipv4/status), `sonicwall_interfaces_statistics` (GET /reporting/interfaces/ipv4/statistics) | read |
| `vpn` | `sonicwall_vpn_policies_list` (GET /vpn/policies/all), `sonicwall_vpn_site_to_site_list` (GET /vpn/policies/ipv4/site-to-site), `sonicwall_vpn_site_to_site_get` (GET .../name/{NAME}), `sonicwall_vpn_tunnel_status` (GET /reporting/tunnel-interfaces/vpn/status), `sonicwall_ssl_vpn_sessions` (GET /reporting/ssl-vpn/sessions) | read |
| `logs` | `sonicwall_log_view` (GET /reporting/log/view), `sonicwall_audit_log_view` (GET /log/audit/view), `sonicwall_audit_log_settings` (GET /log/audit/base), `sonicwall_syslog_servers` (GET /log/syslog/syslog-servers), `sonicwall_export_log_csv` (GET /export/log/csv), `sonicwall_export_audit_csv` (GET /export/audit/csv) | read |
| `generic` | `sonicwall_request` | unknown-effect (passthrough) |

That is 41 tools including the generic one (2 + 1 + 7 + 5 + 5 + 5 + 4 + 5 + 6 + 1).
The boot probe records the shipped count (41: 29 read, 11 mutating, 1
unprefixed-mutating) and the fleet harness floor is 41.

### The generic tool, grounded

`sonicwall_request {method, path, query?, body?, confirm?}`:

- `path` must match a row of the inventory
  (`sonicos-endpoints.json`, `{method, path, tag}` with `{PARAM}` templating:
  a request path matches when every literal segment matches and every `{X}`
  segment is non-empty). An unmatched path is rejected with the three nearest
  inventory rows as the hint.
- Hard-deny regardless of `confirm`: paths starting with `/restart`,
  `/restart-sonicos`, `/import/`, `/cloud-backup-boot`, `/local-backup-boot`,
  `/administration/password`, `/administration/unbind-totp-key`,
  `/log/clear-log`, `/access-rules/restore-defaults`, `/auth`, `/tfa`,
  `/direct-mode`, any path containing `factory-default` or `/all-` (the delete-all
  endpoints), DELETE on any path ending `/all` (for example `/vpn/policies/all`),
  and `/export/current-config` (full config including secrets).
- Any non-GET requires `confirm: true`; the result appends the reminder that the
  change is staged and `sonicwall_config_commit` is a separate call.
- The description ends: "Ground the path with `sonicwall_navigate` first. Do
  not compose a path from memory."

`sonicwall_navigate {domain?, search?}` returns the curated domain list, and with
`search` the matching inventory rows (method, path, tag), capped at 50, so the
model can discover a path before calling `sonicwall_request`.

### Error-surface contract

`src/utils/sonicwall-error.ts` is the one module that turns a SonicOS failure
into a tool error. It maps vendor code -> failure class -> hint, keeps the
appliance's own `info[].message`, and never blames credentials for a
non-credential failure:

| Class | Codes / conditions | Hint names |
|---|---|---|
| `auth-credential` | HTTP 401 `E_UNAUTHORIZED` on `/auth`; `E_MAX_LOGIN_ATTEMPTS`, `E_USER_LOCKOUT` | `SONICWALL_USERNAME` / `SONICWALL_PASSWORD`, and that Basic auth must be enabled under Device > Settings > Administration > SonicOS API |
| `auth-session` | 401 after a successful login, or a 401 whose response carries `Authentication-Info: Digest` | session security (RFC-7616) or the bearer check; the request authenticated, the session did not persist |
| `session-conflict` | 503 session limit, `E_ACCESS_DENIED` on `/auth` or `/config-mode` when another admin is logged in | `SONICWALL_SESSION_OVERRIDE` |
| `api-disabled` | 403 `E_DISABLED` | enable the SonicOS API in the admin UI |
| `non-config` | 405 `E_NON_CONFIG`, `E_READ_ONLY` | `sonicwall_config_mode`; the request authenticated successfully |
| `not-found` | 404 `E_NOT_FOUND`, 400 `E_NO_MATCH` | ground with list/navigate |
| `bad-request` | 400 `E_INVALID_API_CALL`, `E_INVALID_FXN_ARG`, `E_SYNTAX`, `E_RANGE`, `E_EXISTS`, 406, 413, 414 | request shape; the request authenticated successfully |
| `appliance` | 500 family, `E_HA_IDLE`, `E_UNLICENSED`, `E_LOST_CONN` | retry / appliance state |
| `transport` | fetch failure, TLS failure, timeout | `SONICWALL_HOST`, `SONICWALL_PORT`, `SONICWALL_VERIFY_TLS` |

`sonicwall_status` runs without credentials, reports host, port, username,
password as `configured (<n> chars)`, TLS verification, override setting, and
(with credentials) the live result of `GET /version` plus `session()`. It never
echoes any part of the password or token; the boot probe asserts no 6-or-more
character prefix of the password appears in its output.

## Safety rules, non-negotiable

1. Every mutating tool's description starts with `DESTRUCTIVE:` and goes through
   `destructiveTool()`; read tools through `readOnlyTool()`; `sonicwall_request`
   through `unknownEffectTool()`. Nothing infers effect from a tool name. An
   unwrapped tool is annotated mutating and named on stderr.
2. Writes never commit. Every mutating description says the change is staged and
   names `sonicwall_config_commit`.
3. `sonicwall_config_commit` carries `VISIBLE-TO-OTHERS:` as well, since a commit
   changes traffic handling for everyone behind the firewall; so does
   `sonicwall_config_mode` when override is on (it evicts a human admin).
4. Grounding before writing: every write tool's description tells the model to
   `_get` the existing object first and reuse its shape; body shapes are passed
   through verbatim, the connector does not invent wrappers beyond what the
   vendor docs show (`{"address_objects":[{"ipv4":{...}}]}` on the collection,
   `{"address_object":{"ipv4":{...}}}` on a name/uuid route). The implementer
   must not hardcode field names beyond the wrapper key.
5. Credentials and tokens never appear in a URL, a log line, or an error.
6. `verifyTls=false` is reported as a warning by `sonicwall_status`.
7. `sonicwall_logout` exists so an operator can release the admin slot without
   killing the server.

## The check

`mcp_node/node-sonicwall/tests/client.test.ts` (vitest, injected `fetch`), written
failing-first, covers at minimum:

- login sends `Authorization: Basic ...` to `POST /api/sonicos/auth` and nothing
  credential-shaped in the URL
- a bearer token in the `/auth` body is sent as `Authorization: Bearer` on the
  next call; without one, Basic is still sent
- a 401 on a resource call triggers exactly one re-login and one retry; two 401s
  throw `SonicwallApiError` with `httpStatus === 401`
- HTTP 200 with `status.success === false` throws; HTTP 200 with
  `E_WARNING` returns
- an `info[].level === "error"` entry throws even when `success` is missing
- GET returns the raw resource JSON; POST returns the parsed status envelope
- `create()` on a fresh session calls `POST /config-mode` once before the write,
  and a 405 `E_NON_CONFIG` re-enters config mode once
- `commit({bestEffort:true})` hits `/config/pending/best-effort`
- `SonicwallApiError.responseText` and `.message` contain neither the password
  nor the Basic header value
- identifiers stay strings (`"uuid":"0123"` is not coerced)

`mcp_servers/sonicwall-mcp/tests/boot-probe.mjs` (`npm run test:boot`) drives the
bundled server over MCP stdio in three credential states (nothing, host only,
full), asserts the progressive-disclosure gate, that unresolved
`${user_config.*}` placeholders degrade to the no-credential state, that every
`DESTRUCTIVE:` tool is annotated mutating and every read tool `readOnlyHint:
true`, that `sonicwall_request` rejects a hard-denied path and an
unlisted path without credentials being touched, and that no 6+ character
prefix of the password appears in `sonicwall_status` output. The fleet harness
`node test-mcp-tools.mjs sonicwall` at the repo root must also pass.

Live validation against hardware is a separate, later step and is not claimed by
this document.

## Propagation checklist (AGENTS.md section 2)

- [x] `mcp_node/node-sonicwall/src/` client + tests (evidence: S2-U1 19 tests; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`)
- [x] `mcp_servers/sonicwall-mcp/src/` (domains, helpers, annotate-tool, error map, navigation + inventory) (evidence: S2-U2; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`)
- [x] `mcp_servers/sonicwall-mcp/sonicos-endpoints.json` (inventory, committed; the 9.5 MB swagger HTML is not) (evidence: S2-U2, 2877 rows; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`)
- [x] `mcp_servers/sonicwall-mcp/manifest.json` user_config (six keys, matching `plugin.json`) (evidence: S2-U2; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`)
- [x] `npm run build` + `bundle:atlas` -> `plugins/atlas/mcp/sonicwall/server.mjs` (evidence: S2-U2, bundle 1,019,315 bytes; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`)
- [x] `plugins/atlas/.mcp.json` server entry with six `CFG_SONICWALL_*` values (evidence: S2-U3; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`)
- [x] `plugins/atlas/.claude-plugin/plugin.json` userConfig block (evidence: S2-U3; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`)
- [x] `.env.template` block (evidence: S2-U3; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`)
- [x] `plugins/atlas/skills/atlas-setup/references/vendors.md` and `connectors.md` rows (evidence: S2-U3; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`)
- [x] `README.md` and `docs/README.md` connector rows (evidence: S2-U3; only docs/README.md has a connector table, root README.md has none; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`)
- [x] `plugins/atlas/scripts/test_connectors_wiring.py` covers sonicwall (evidence: S3 wiring test OK; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`)
- [x] `tests/boot-probe.mjs` passes through `_env/load.mjs` with `CFG_` names only (evidence: S3 boot probe PASS; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md`)
- [ ] `docs/CHANGELOG.md` entry, plugin version bump, `.claude-plugin/marketplace.json`
