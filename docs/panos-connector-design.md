# PAN-OS connector design contract

Source of truth for the `panos` atlas connector. Every implementer working on
`mcp_node/node-panos` or `mcp_servers/panos-mcp` codes against this file.

Grounded in `mcp_servers/panos-mcp/PAN-OS XML API.postman_collection.json`
(71 requests) plus the live PAN-OS documentation cited inline.

## Scope decided with the user

- Write posture: full candidate-config writes plus a **separate, explicit** commit tool. Writes never auto-commit.
- Topology: Panorama-fronted. One credential set reaches Panorama; `target=<serial>` routes any call to a managed firewall. Omitting `target` also works against a standalone firewall.
- Surface: config + op + commit + logs + version, PAN-OS REST for objects and policies, reports, export/import, content/software update lifecycle, certificate lifecycle.

Out of scope for v1: `type=user-id` (IP-to-user mapping, dynamic address/user groups).

## The two APIs, and which one owns what

PAN-OS exposes two HTTP APIs on the same appliance.

| API | Path | Owns |
|---|---|---|
| XML | `/api/?type=...` | config tree, op commands, commit, logs, reports, export/import, updates, certificates |
| REST (JSON) | `/restapi/{version}/{Category}/{Resource}` | address objects, services, tags, security/NAT rules |

Rule: **anything with a REST resource goes over REST.** A model authoring an
xpath string from memory writes to the wrong node silently; the REST API is
schema'd per object type and rejects a bad shape. XML config tools exist for
everything REST does not cover, and they are grounded (see Safety).

REST requires a `location` query parameter on every call: `vsys` (+ `vsys=vsys1`)
on a firewall, `device-group` (+ `device-group=<name>`) on Panorama. Also valid:
`shared`, `panorama-pushed`, `template`, `predefined`.
Reference: [Work With Objects (REST API)](https://docs.paloaltonetworks.com/ngfw/api/pan-os-rest-api-use-cases/work-with-address-objects-rest-api).

## Authentication

The API key travels in the **`X-PAN-KEY` HTTP header**, never as `?key=` in the
query string. A key in a URL lands in proxy logs, access logs, and shell
history; under the FTC Safeguards Rule and Reg S-P that is an avoidable
exposure. Reference: [API Authentication and Security](https://docs.paloaltonetworks.com/pan-os/11-1/pan-os-panorama-api/about-the-pan-os-xml-api/structure-of-a-pan-os-xml-api-request/api-authentication-and-security).

Key generation (`type=keygen`) is a **POST** with the credentials in the body,
not a GET with them in the URL, for the same reason. The postman collection
shows the GET form; do not copy it.

## Base URL: the AGENTS.md section 3 exception

`AGENTS.md` section 3 requires a hardcoded, optional default base URL. PAN-OS
publishes none, because the base URL *is* the target appliance. `PANOS_HOST` is
therefore a **required** config value, and `manifest.json` must say so in the
description rather than leaving a future reader thinking the invariant was
broken by accident.

## Environment contract

| Var | Required | Default | Meaning |
|---|---|---|---|
| `PANOS_HOST` | yes | none | Panorama or firewall hostname / IP. No scheme, no path. |
| `PANOS_API_KEY` | yes* | none | API key. *Optional if username+password are set and `panos_keygen` is used. |
| `PANOS_USERNAME` | no | none | Admin user, only for `panos_keygen`. |
| `PANOS_PASSWORD` | no | none | Admin password, only for `panos_keygen`. |
| `PANOS_TARGET` | no | none | Default managed-firewall serial when talking through Panorama. |
| `PANOS_VERIFY_TLS` | no | `true` | Set `false` only for an appliance still serving a self-signed certificate; that disables certificate verification for the host, so the link is no longer protected against interception. Live validation needed it (factory cert, subject == issuer). |
| `PANOS_REST_VERSION` | no | `v11.1` | REST API version segment. |

Every optional value passes through the `cleanEnv` placeholder-stripping helper
already used in `mcp_servers/vanta-mcp/src/utils/client.ts`, so an unresolved
`${user_config.x}` from the MCP host falls through to the default.

## node-panos client contract

`mcp_node/node-panos`, one runtime dependency: `fast-xml-parser`, configured
with exactly four options and no others:

| Option | Value | Why |
|---|---|---|
| `attributeNamePrefix` | `'@'` | parsed attributes read as `@name` / `@status` and match PAN-OS REST's own JSON conventions |
| `ignoreAttributes` | `false` | `status` and `code` are attributes; dropping them would drop the error contract |
| `parseTagValue` | `false` | see below |
| `parseAttributeValue` | `false` | see below |

The two `parse*Value: false` options are a **contract, not a tuning knob**.
`fast-xml-parser` coerces digit-looking text to `number` by default (its `strnum`
behavior; confirmed against the installed `fast-xml-parser` 4.5.7 type
declarations, not from recollection). PAN-OS serials, software versions, job
ids, and error codes are *identifiers*, not quantities: coercion drops leading
zeros, so `<serial>023009014025</serial>` parses as the number `23009014025`.
Every Panorama-routed call addresses a firewall by `target=<serial>`, so a serial
read from the appliance and handed straight back as `target` would address
nothing at all. A client that coerces values is therefore wrong, not merely
untidy. `mcp_node/node-panos/src/xml.ts:12` carries both options and the reason.

```ts
export interface PanosConfig {
  host: string;
  apiKey: string;
  target?: string;            // default serial for Panorama-routed calls
  verifyTls?: boolean;        // default true
  restVersion?: string;       // default 'v11.1'
  timeoutMs?: number;         // default 60_000
}

export class PanosClient {
  constructor(cfg: PanosConfig);

  // --- XML API ---
  request(params: Record<string, string | undefined>, opts?: { method?: 'GET' | 'POST'; body?: FormData }): Promise<unknown>;
  op(cmd: string, opts?: { target?: string }): Promise<unknown>;
  config(action: ConfigAction, params: ConfigParams): Promise<unknown>;
  commit(opts?: { cmd?: string; action?: 'partial' | 'all'; target?: string }): Promise<{ jobId?: string }>;
  logs(params: LogParams): Promise<unknown>;
  report(params: ReportParams): Promise<unknown>;
  exportFile(params: ExportParams): Promise<{ contentType: string; bytes: number; text?: string }>;
  importFile(params: ImportParams, file: { name: string; content: Buffer | string }): Promise<unknown>;
  version(): Promise<unknown>;

  // --- REST API ---
  rest: {
    list(category: string, resource: string, loc: RestLocation): Promise<unknown>;
    get(category: string, resource: string, name: string, loc: RestLocation): Promise<unknown>;
    create(category: string, resource: string, name: string, body: unknown, loc: RestLocation): Promise<unknown>;
    update(category: string, resource: string, name: string, body: unknown, loc: RestLocation): Promise<unknown>;
    remove(category: string, resource: string, name: string, loc: RestLocation): Promise<unknown>;
  };

  // --- jobs ---
  jobs: {
    status(id: string): Promise<JobStatus>;
    wait(id: string, opts?: { timeoutMs?: number; pollMs?: number }): Promise<JobStatus>;
  };
}

export async function keygen(args: { host: string; user: string; password: string; verifyTls?: boolean }): Promise<string>;

export class PanosApiError extends Error {
  readonly code: string | undefined;   // PAN-OS error code attribute
  readonly httpStatus: number;
  readonly responseText: string;
}
```

`ConfigAction` is the literal union from the collection:
`'show' | 'get' | 'set' | 'edit' | 'delete' | 'rename' | 'clone' | 'move' | 'override' | 'multi-move' | 'multi-clone' | 'complete'`.

### The failure mode the client must not have

PAN-OS answers an authorization failure, a bad xpath, and a malformed element
with **HTTP 200** and `<response status="error" code="403">`. A client that
checks only `res.ok` reports every one of those as a success.

`request()` therefore throws `PanosApiError` whenever the parsed
`response.@status` is not `"success"`, regardless of HTTP status. This is the
one piece of non-trivial logic in the library and it carries the test below.

## Server contract

`mcp_servers/panos-mcp` mirrors `vanta-mcp` exactly: `src/index.ts` transport
bootstrap, `src/server.ts` with progressive disclosure (status + navigate until
credentials resolve), `src/utils/{client,logger,types}.ts`, `src/domains/` with
one module per domain exporting a `DomainHandler` (`getTools()`,
`handleCall()`), lazily loaded through `src/domains/index.ts`.

### Domains and tools

| Domain | Tools |
|---|---|
| `config` | `panos_config_show`, `panos_config_get`, `panos_config_complete`, `panos_config_set`, `panos_config_edit`, `panos_config_delete`, `panos_config_rename`, `panos_config_clone`, `panos_config_move`, `panos_config_override`, `panos_config_multi_move`, `panos_config_multi_clone` |
| `commits` | `panos_commit`, `panos_commit_all`, `panos_job_status`, `panos_job_wait` |
| `operations` | `panos_op`, `panos_version`, `panos_system_info`, `panos_devices_list`, `panos_globalprotect_users`, `panos_globalprotect_disconnect`, `panos_keygen` |
| `logs` | `panos_logs_query`, `panos_logs_retrieve` |
| `reports` | `panos_report_dynamic`, `panos_report_predefined`, `panos_report_custom`, `panos_report_get` |
| `files` | `panos_export`, `panos_export_tech_support`, `panos_import_file`, `panos_import_certificate` |
| `objects` | `panos_objects_list`, `panos_objects_get`, `panos_objects_create`, `panos_objects_update`, `panos_objects_delete` |
| `policies` | `panos_policies_list`, `panos_policies_get`, `panos_policies_create`, `panos_policies_update`, `panos_policies_delete`, `panos_policies_move` |
| `updates` | `panos_updates_check`, `panos_updates_download`, `panos_updates_install`, `panos_software_check`, `panos_software_download`, `panos_software_install`, `panos_system_reboot` |
| `certificates` | `panos_cert_generate`, `panos_cert_renew`, `panos_cert_revoke`, `panos_cert_export`, `panos_cert_import`, `panos_cert_set_trusted_root`, `panos_cert_set_forward_trust` |
| `navigation` | `panos_status`, `panos_navigate` |

`objects` and `policies` are five and six tools rather than one set per object
type because the REST paths are uniform. Both take a `resource` argument with
an enum: objects covers `Addresses`, `AddressGroups`, `Services`,
`ServiceGroups`, `Tags`, `ApplicationGroups`, `ExternalDynamicLists`; policies
covers `SecurityRules`, `NATRules`, `DecryptionRules`,
`ApplicationOverrideRules`, `AuthenticationRules`.

Every tool accepts an optional `target` (managed-firewall serial) that overrides
`PANOS_TARGET`.

### Credential bootstrap

`panos_keygen` lives in the `operations` domain. It is the one tool that must be
reachable *without* an API key, otherwise an operator who has only
`PANOS_USERNAME` / `PANOS_PASSWORD` can never mint one through this server.

The `ListTools` progressive-disclosure gate is therefore:

- `host` absent -> `panos_status` + `panos_navigate` only
- `host` set, `apiKey` absent, `username` + `password` set -> status + navigate + `panos_keygen`
- `host` + `apiKey` set -> the full tool set

`panos_keygen` returns the minted key to the caller and does **not** persist it;
the operator puts it in `PANOS_API_KEY`. Its description must say so, and must
warn that the returned key is a long-lived credential appearing in the
conversation transcript.

## Rule move goes over XML, not REST

`panos_policies_move` is the one policy tool that does NOT use the REST API.
Palo Alto's public REST documentation does not specify a move endpoint or its
parameter names; the XML API's `type=config&action=move` with `where` and `dst`
is documented and present in the postman collection ("Move configuration").

So `panos_policies_move` builds the rule's xpath from `location` + `resource` +
rule name **in code** and calls `client.config('move', ...)`. The xpath is
constructed by the connector, never authored by the model, so the grounding rule
still holds. Revisit if Palo Alto documents a REST move.

## RestLocation field names

`RestLocation` uses PAN-OS's own wire spelling: `location`, `vsys`,
`'device-group'` (hyphenated), `template`, `target`. Tool arguments exposed to
the model use camelCase (`deviceGroup`) and each domain's `buildLocation()` maps
them onto the hyphenated wire keys. Do not invent a `templateStack` field;
`RestLocation` has none.

## Safety rules, non-negotiable

1. **Every mutating tool's description starts with `DESTRUCTIVE:`**, per `AGENTS.md:114`. That covers all of set/edit/delete/rename/clone/move/override, every REST create/update/delete, commit, commit_all, install, reboot, cert revoke, and GlobalProtect disconnect.
2. **The prefix and the machine-readable annotations come from one decision.** Rule 1 on its own is not enough, and this connector proved it: the prefix rule was fully satisfied while **22 of the 32 `DESTRUCTIVE:`-prefixed tools shipped annotated `readOnlyHint: true`** - `panos_commit`, `panos_config_set` and `panos_software_install` among them (commit `5db9bfe`). `readOnlyHint` is the flag a client reads to decide it may run a tool without asking, so the prose warned the operator while the machine-readable half invited unattended execution of exactly what the prose warns about. A tool therefore declares its effect class at its declaration site by going through exactly one of **four** wrappers in `src/domains/_helpers.ts` - `readOnlyTool()`, `destructiveTool()`, `credentialIssuingTool()`, `unknownEffectTool()` - and those wrappers set both the `DESTRUCTIVE: ` description prefix and the `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` annotations. The prose a human reads and the flags a client automates on therefore cannot drift apart. Nothing infers an effect class from a tool's *name*: a name-pattern classifier defaults to "read" for every name it fails to match, which is how a mutating tool ends up advertising `readOnlyHint: true` - safe to auto-run - while its own description says `DESTRUCTIVE`. A tool that goes through none of the four wrappers is annotated **mutating**, never read-only, and `annotate()` complains on stderr naming the tool (`src/annotate-tool.ts:79-88`); stdout is the JSON-RPC channel, so the complaint cannot go there. `panos_op` is the one `unknownEffectTool`: its `<cmd>` is arbitrary, so it fails closed to the mutating annotations while keeping its own unprefixed description, because a blanket `DESTRUCTIVE: ` would claim every op command mutates when its description already spells out the hazard. Mutating tools carry `idempotentHint: false` - a second commit pushes whatever landed in the candidate config meanwhile, a second install or reboot takes the box down again - so a client must not treat a retry as free. `openWorldHint` is `true` on every class, read included: every call leaves the process for an appliance whose state this connector does not own. The fleet-wide version of this rule is `docs/standards/connector-safety-signals.md`.
3. **Writes never commit.** `panos_config_set` and friends touch the candidate config only. The description of each says so and names `panos_commit` as the separate step.
4. **Grounding before writing.** Every xpath-taking write tool's description ends with: "Ground the xpath with `panos_config_show` or `panos_config_complete` before calling this. Do not compose an xpath from memory." `panos_config_complete` exists precisely so the model can enumerate valid children of a node.
5. **`panos_system_reboot` also carries `VISIBLE-TO-OTHERS:`** - it drops traffic for every user behind the firewall.
6. **Credential errors are actionable**, naming the env var and the doc page, never a stack trace - and, equally binding, a hint never blames credentials for a failure that is not a credential failure. See the error-surface contract under "As shipped".
7. `panos_status` runs without credentials and reports what is configured.
8. **`panos_keygen` is credential-issuing, which is its own class.** It mints a long-lived PAN-OS API key and returns it into the transcript. Neither of the other classes is honest about that: `readOnlyTool()` would advertise it as safe to run unattended, and `destructiveTool()` would claim it destroys something. `credentialIssuingTool()` (`CREDENTIAL_ISSUING_ANNOTATIONS`, `src/annotate-tool.ts:62-67`) sets `readOnlyHint: false` because issuance is a real side effect, `destructiveHint: false` because nothing on the appliance is destroyed or overwritten, `idempotentHint: true` because PAN-OS returns the same key for the same credentials, and `openWorldHint: true` as on every class here. It carries **no `DESTRUCTIVE:` prefix**: it is not destructive, and its description already warns that the key lands in the transcript. Do not add one to make the prefix count match the annotated-mutating count - `panos_op` and `panos_keygen` are exactly why those two numbers differ (32 prefixed, 34 annotated-mutating), and the annotations being stricter than the prose is the allowed direction. `panos_keygen` was found by asking what the fleet harness's prose/annotation agreement check *cannot* see: agreement only catches disagreement, so an unmarked tool annotated read-only passes vacuously. The probe for that blind spot is `.atlas/.run/vacuous-check.mjs`, a heuristic that produces candidates for review rather than verdicts; three of its four fleet candidates were false positives and this was the real one.

## The check

One assert-based test file in `mcp_node/node-panos/tests/client.test.ts` over
captured response shapes: 9 tests as of the live-validation run, the six
original shapes plus three identifier-preservation guards, each written
failing-first against the coercing parser. It must cover, at minimum:

- `<response status="success">` with a payload -> parsed object returned
- `<response status="error" code="403">` served with **HTTP 200** -> `PanosApiError` thrown with `code === '403'`
- `<response status="success"><result/></response>` (empty result) -> no throw, empty result
- a commit response -> job id extracted
- the API key appears in the `X-PAN-KEY` header and **not** in the request URL
- an identifier read off the wire stays a string: `<serial>023009014025</serial>` parses to `"023009014025"` and **not** to the number `23009014025`
- digit-only `sw-version` and `family` values stay strings for the same reason
- the `code` attribute on an error envelope is read as a string, so `code === '403'` holds rather than `code === 403`

`AGENTS.md:95` names `node test-mcp-tools.mjs panos` for the boot and tool-count
check. That harness now exists at the repo root and panos is one of the
connectors it probes: it asserts BOOT, a tool-count FLOOR, prose/annotation
AGREEMENT and tool SHAPE from a credential-less `tools/list`, and panos reports
`60 (60)` tools, 32 marked mutating, 34 annotated mutating, 0 mismatches. The
fleet contract it enforces is `docs/standards/connector-safety-signals.md`.

It does not replace `mcp_servers/panos-mcp/tests/boot-probe.mjs`
(`npm run test:boot`), which stays because it asserts what a credential-less
fleet probe cannot see. That probe drives the bundled server over MCP stdio and
asserts:

- no credentials -> `panos_status` + `panos_navigate` only
- host + username/password, no key -> those two plus `panos_keygen`
- host + key -> the full tool set
- unresolved `${user_config.*}` placeholders -> treated as absent, not as a host
- every mutating tool carries `DESTRUCTIVE:`, and no read tool does, with exactly two pinned exceptions: `panos_op` and `panos_keygen` are listed by name against their **exact four annotation flag values**, so a listed exception cannot quietly drift on the flags that were not the reason it was listed
- `panos_status` reports the key as `configured (<n> chars)` when one is set and `not set` when it is absent or unresolved, and **no 6-or-more-character prefix of the configured key appears anywhere in that output**

That is the whole test burden; no broader suite.

## As shipped

60 tools. Verified by `npm run test:boot` against
`plugins/atlas/mcp/panos/server.mjs`: 2 tools with no credentials, 3 in the
bootstrap state, 60 with a key, 32 of them `DESTRUCTIVE:`-prefixed, and
`panos_system_reboot` reading `DESTRUCTIVE: VISIBLE-TO-OTHERS: ...`.

By effect class, which is how a client sees them: 26 `readOnlyTool`, 32
`destructiveTool`, 1 `credentialIssuingTool` (`panos_keygen`), 1
`unknownEffectTool` (`panos_op`) - 60 exactly, with no tool left unclassified.
The probe prints this as `read=26, mutating=32, unprefixed-mutating=2`, its
last bucket holding the two tools annotated non-read-only without a prefix. The
32 `DESTRUCTIVE:`-prefixed count and the 32 `destructiveTool` annotations are
the same 32 tools, because both come from the same wrapper. `panos_op` and
`panos_keygen` are annotated non-read-only without carrying the prefix, which is
why the prefix count is 32 against 34 annotated-mutating rather than 34 and 34.

Log types come from the collection's own `log-type` parameter description on the
"Retrieve logs" request, not from a recalled list: `traffic`, `threat`, `config`,
`system`, `hipmatch`, `wildfire`, `url`, `data`, `corr`, `corr-detail`,
`corr-categ`, `user-id`, `auth`, `gtp`, `external`, `iptag`. Note `hipmatch` has
no hyphen while `user-id` does.

Export categories are limited to those a real request in the collection uses.
`panos_import_file` leaves `category` a free string because only `anti-virus` is
confirmed there.

### Proven against live hardware, 2026-09-17

The connector reached a real appliance for the first time on 2026-09-17.
Redacted evidence: `.atlas/evidence/2026-09-17-panos-live-validation.md`.

| Field | Value |
|---|---|
| Model | PA-460 |
| PAN-OS | 11.1.13-h6 |
| Topology | standalone firewall, `multi-vsys: off` - **not** Panorama |
| TLS | self-signed, subject == issuer, so `PANOS_VERIFY_TLS=false` was required |
| REST version | the `v11.1` default matched the appliance release |

14 of 14 read-only steps passed, driven through the shipped bundle exactly as
`plugins/atlas/.mcp.json` launches it
(`node --import plugins/atlas/mcp/_env/load.mjs plugins/atlas/mcp/panos/server.mjs`),
not through `dist/` and not by calling the client library directly.
`tools/list` returned 60 tools with a real key present.

Tool classes exercised: navigation (`panos_status`); operations
(`panos_version`, `panos_system_info`, `panos_op`); config reads
(`panos_config_show`, and `panos_config_complete`, which means the grounding
tool the safety rules depend on is proven, not assumed); REST reads
(`panos_objects_list`, `panos_policies_list`, including an empty list that
correctly did not read as a failure); logs (`panos_logs_query`,
`panos_logs_retrieve`); reports (`panos_report_dynamic`, `panos_report_get`);
and jobs (`panos_job_status` / `panos_job_wait` on commit job 28 ->
`FIN` / 100 / `OK`).

**The HTTP-200-with-`status="error"` path is confirmed on real firmware**, not
just on captured shapes: a nonexistent xpath, a malformed xpath, and a REST call
with `location=device-group` against a firewall that has no device groups all
surfaced as errors rather than as false successes.

**Every mutating tool remains unexercised against hardware.** Config
set/edit/delete/rename/clone/move/override, every REST create/update/delete,
`panos_commit`, `panos_commit_all`, content and software download/install,
`panos_system_reboot`, certificate generate/renew/revoke/import, and
`panos_globalprotect_disconnect` were deliberately not called: the appliance is
the user's live production firewall, the user was away from keyboard, and the
safety contract requires approval at the point of risk for each of those calls.
Their request shapes are grounded in the collection and the vendor docs. That is
not the same as proven, and this section does not claim it is.

### Two PAN-OS behaviors the live run pinned down

Neither is visible in the postman collection, both cost real debugging time, so
both are contract rather than trivia.

**1. Log-query and report job ids are a separate namespace from the job table.**
`panos_logs_query` and `panos_report_dynamic` / `_predefined` / `_custom` return
ids that are *not* in `<show><jobs>`. `panos_job_status` on such an id answers
PAN-OS code 7 (Object not present) - and so does a hand-built
`<show><jobs><id>NNN</id></jobs></show>` issued through `panos_op`, which is what
proves the behavior belongs to PAN-OS rather than to command construction on
this side. A log id is retrieved with `panos_logs_retrieve`, a report id with
`panos_report_get`. `panos_job_status` and `panos_job_wait` see only job-table
jobs - commits, content/software download and install, tech-support export - and
their descriptions now say so (`src/domains/commits.ts:39`, `:51`), as do the
enqueueing tools (`src/domains/logs.ts:38`; `src/domains/reports.ts:29`, `:50`,
`:66`). Code 7 on a job-table tool also carries the namespace hint
(`src/utils/panos-error.ts:143`).

**2. `show devices` is Panorama-only.** On a standalone firewall,
`panos_devices_list` answers PAN-OS code 17 (Invalid command) with perfectly
valid credentials, in the same session where thirteen other calls succeed. The
same holds for `commit-all`. That is a topology fact about the appliance, not a
credential fault and not a connector fault, and the error surface must classify
it as such (`src/utils/panos-error.ts:124`).

Vendor meanings taken verbatim from Palo Alto's published table,
[PAN-OS XML API error codes](https://docs.paloaltonetworks.com/ngfw/api/getting-started/pan-os-xml-api-error-codes),
not from recollection. The "observed" column separates what the live run
actually produced from what is documented-but-unseen, because a code this
connector has never received is a mapping on trust:

| Code | Vendor meaning | Failure class | Observed live | Where it arises |
|---|---|---|---|---|
| 6 | Bad Xpath | `xpath-object` | yes (as an error; code not captured separately from 7) | malformed xpath on a config read |
| 7 | Object not present | `xpath-object` | yes | nonexistent xpath; a log/report id handed to `panos_job_status` |
| 16 | Unauthorized | `auth-role` | no | admin role without API access for an area - never a bad key |
| 17 | Invalid command | `unsupported-command` | yes | `show devices` on a standalone firewall |
| 18 | Malformed command | `malformed` | no | unparseable `cmd` / `element` XML |
| 22 | Session timed out | `session` | no | expired PAN-OS session, retryable |

### Error-surface contract

One module owns turning a PAN-OS failure into a tool error:
`mcp_servers/panos-mcp/src/utils/panos-error.ts`. It maps **vendor code ->
vendor meaning -> failure class -> canonical error code -> hint**
(`PANOS_ERROR_CODES` at `:54`, the `PanosFailureClass` union at `:29`), pulls the
appliance's own `<msg>` - or the REST half's JSON `message` - out of the response,
and picks the hint from the failure class rather than from the call site.

The rules:

- Every PAN-OS failure path in all ten domain modules reports through
  `panosToolError`: 30 call sites across `src/domains/*.ts`, plus one in
  `src/server.ts`.
- The generic shared `toolErrorFromCatch` is **deliberately unreachable from a
  domain**. `src/domains/_helpers.ts:22-27` re-exports `panosToolError` and
  pointedly does not re-export the generic classifier, so a domain cannot fall
  back to it by accident; `panos-error.ts` is its only caller.
- **A hint must never blame credentials for a non-credential failure.** Only the
  `auth-credential` class (HTTP 401/403, and XML code 403) may name
  `PANOS_API_KEY` or `panos_keygen`. `auth-role` (16) says the opposite in as
  many words: do not regenerate the key, grant the admin role API access.
  `unsupported-command`, `xpath-object`, `malformed`, `session`,
  `operation-refused`, and `rest-request` each state that the request
  authenticated successfully. The live run caught the old surface handing
  "Check PANOS_HOST and PANOS_API_KEY are set correctly" to a code-17 topology
  mismatch, which is how an operator is sent to rotate a working credential.
- The appliance's own explanation is never discarded. `PanosApiError` carries
  `httpStatus`, not `.status`, which is exactly why the shared classifier used to
  fall through to its plain-`Error` branch and throw away `responseText` - where
  the `<msg>` lives. The PAN-OS mapping duck-types those fields
  (`src/utils/panos-error.ts:279`) so a bundled and a linked copy of `node-panos`
  both classify. A status-error response with no code now reads
  `PAN-OS returned status="error" with no error code - No such node` instead of a
  bare `PAN-OS API error`.
- `panos_status` reports the key as `configured (<n> chars)` and never echoes any
  part of its value; the boot probe asserts no 6-or-more-character prefix of the
  configured key appears in that output.

## Propagation checklist (AGENTS.md section 2)

- [x] `mcp_node/node-panos/src/` client + tests (9/9 passing: the six original response-shape tests plus three identifier-preservation guards added by the live run)
- [x] `mcp_servers/panos-mcp/src/domains/*.ts` (ten handlers plus navigation)
- [x] `mcp_servers/panos-mcp/src/utils/panos-error.ts` - the vendor-code -> failure-class -> hint mapping every domain reports through
- [x] `mcp_servers/panos-mcp/src/annotate-tool.ts` + the three effect-class wrappers in `src/domains/_helpers.ts` - one decision per tool drives both the `DESTRUCTIVE:` prefix and the `readOnlyHint`/`destructiveHint`/`idempotentHint` annotations; 27 read / 32 mutating / 1 passthrough, nothing unclassified, and name-pattern inference is gone
- [x] `mcp_servers/panos-mcp/manifest.json` user_config (seven keys, matching `plugin.json`)
- [x] `mcp_servers/panos-mcp/package.json` at 0.2.0 (was 0.1.0; the user-visible error text, tool descriptions, and `panos_status` output all changed)
- [x] `npm run build` + `bundle:atlas` -> `plugins/atlas/mcp/panos/server.mjs` (392,960 bytes, rebuilt after the annotation change; two earlier figures in this repo's history - "377 KB" and 394,516 bytes - are both stale, the first predating the live-run fixes and the second predating the annotation fix)
- [x] `npm run pack:mcpb` -> `panos-mcp.mcpb`, gitignored by `.gitignore:397` (30,884,839 bytes, 3022 entries). Both digests of that same file, algorithm named because a bare "shasum" invites a future reader to read a mismatch into two different algorithms: `shasum -a 1` = `47234788344b483b7db4a82187d5240777452acd`, `shasum -a 256` = `f8d48f51f3d8ad276734fdc9c8e9510ec8b61ff01a327b89c78a3adb7ebaf2b3`.
- [ ] MCP `serverInfo.version` still reads `0.1.0`. That string is a literal at `src/server.ts:21` rather than read from `package.json`, so it survived the annotation rebuild: `grep -o 'name:"panos-mcp",version:"[^"]*"' plugins/atlas/mcp/panos/server.mjs` still returns `0.1.0` in the current bundle. Deliberately deferred to its own change rather than folded into a safety fix: correcting it forces a fresh `build` + `bundle:atlas` + `pack:mcpb`, which moves the size and both digests two lines above. Those figures should move once, on purpose, with the version bump - not as a side effect of an unrelated commit. Until then the 0.2.0 bump is metadata-only, and this box stays unticked rather than being quietly counted as done.
- [x] `plugins/atlas/.mcp.json` server entry with seven `CFG_PANOS_*` values
- [x] `plugins/atlas/.claude-plugin/plugin.json` user_config block
- [x] `README.md` connector row
- [x] `.env.template`
- [x] `tests/boot-probe.mjs` stands in for the absent `test-mcp-tools.mjs`
- [x] Boot probe passes, including through `_env/load.mjs` with `CFG_` names only, and now also asserts that no 6-or-more-character prefix of the configured API key appears anywhere in `panos_status` output
- [x] Live read-only validation against a PA-460 on 11.1.13-h6, 14/14 steps: `.atlas/evidence/2026-09-17-panos-live-validation.md`
- [ ] Any mutating tool against live hardware. Deliberately not attempted; see "As shipped" for why.

Two boxes on this list were previously ticked for things that were not true, and
that is recorded rather than quietly re-ticked. The `.mcpb` box claimed a fresh
pack while the archive predated the source it was built from - it only became
true after the live-run fixes were rebuilt and repacked. The bundle-size box
carried a stale figure from an earlier build. A `[x]` here means a command was
run and its output read, not that the step was intended.

The `CFG_` case matters on its own: `.mcp.json` injects `CFG_PANOS_*`, and
`plugins/atlas/mcp/_env/load.mjs` strips the prefix. It does so generically for
any `CFG_` key rather than from a per-vendor list, but the probe exercises that
path anyway, because a connector that loads with bare env names and silently
shows two tools under the real plugin invocation is the exact failure
`docs/CHANGELOG.md:1521` records for three earlier connectors.
