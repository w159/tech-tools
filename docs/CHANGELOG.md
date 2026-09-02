# Changelog

## [5.22.0] - 2026-09-02

### Fixed
- Node MCP atlas bundles now inject `createRequire` so ESM self-contained builds no longer crash on dynamic `require` (auvik/cipp init failures).
- Progressive credential-gated tool disclosure verified unconfigured for all 11 connectors (status/navigate shell only).
- CIPP HTTP ListTools uses per-request gateway credentials when present; stdio remains env-gated to `cipp_status`.
- Rebuilt knowbe4/connectwise/auvik/cipp and remaining node connector bundles into `plugins/atlas/mcp/*/server.mjs`.

## 2026-09-01 -- ThreatLocker connector rebuilt around names: hostnames, users, files, policies, never GUIDs

Marketplace `3.11.0`; atlas `5.21.0`; threatlocker-mcp `1.4.0`; node-threatlocker `1.1.0`.

Once auth worked (previous entry), the user tested the tools from a second
session and every data call still returned nothing or errored, and the tools
that did answer led with GUIDs. The requirement stated then: never make a human
reference an ID; address devices, users, applications, and policies by name.

Contract fixes, each traced to a live probe against instance `h` and the public
swagger at `portalapi.h.threatlocker.com/swagger/public/swagger.json` (88 paths,
97 DTOs; the `/swagger/v1` document is empty):

- `buildSearchBody` in node-threatlocker was the shared root cause: it emitted
  six pagination fields and dropped everything else. Approvals never sent
  `statusId` (500), audit never sent `startDate`/`endDate` (417), check-ins
  never sent `computerId`. Replaced by per-resource bodies built from the
  swagger DTOs (`ComputerParameterDto`, `ApprovalRequestParametersDto`,
  `ActionLogParamsDto`, `ComputerCheckinParametersDto`).
- `ActionLogGetByParametersV2` needs the `usenewsearch: true` header (500
  without it) and dates without fractional seconds; `HttpClient.request` now
  accepts per-request headers. `ActionLogGetAllForFileHistoryV2` needs
  `hostname` or `computerId` beside `fullPath` (417 with the path alone).
- `ComputerGroupGetGroupAndComputer` returns a picker tree, never `.groups`;
  the dropdown endpoint returns the flat `{label, value, numericValue}` list
  and is what the groups tools read now. `OrganizationGetForMoveComputers`
  returns `{label, value}` too, so the old `.organizations || []` was always
  empty. `ApprovalRequestGetCount` takes `includeChildOrganizations` as a
  query parameter.
- Audit `action` filter: `actionId 99` is the documented "Any Deny"; verified
  live it returns only Deny rows across action types. `actionId 1` is Permit.
- Audit filters, probed one by one against 50 baseline rows: top-level
  `hostname` filters; top-level `username` and `fullPath` are silently ignored
  (identical row set, or zero rows). The Advanced Search list
  (`paramsFieldsDto`, `filterType 1`) is what filters `username` (partial
  tolerated), `fullPath`, `applicationName`, and `policyName`, all exact; no
  filterType produced a substring match. The tool exposes `path`,
  `application`, `policy` as exact server-side filters and `contains` as a
  labeled client-side substring over the fetched page.
- `computers_list group:` resolves the group name to its GUID through the
  dropdown list (the DTO rejects a name with 400) so the filter is server-side
  and `totalDevices` is the true group count (Workstations: 141 of 148).
  `mode:` maps to the DTO `action` field, verified live (Secure 128, Learning
  20).

Name-first surface (`mcp_servers/threatlocker-mcp/src/utils/resolve.ts`):

- `resolveComputer` turns a hostname (case-insensitive exact match on hostname
  or computer name) into the row, and `resolveApprovalRequest` turns hostname
  plus a path fragment into exactly one request. Zero or several matches return
  NOT_FOUND with the candidate names; approve is destructive and fails closed.
- Default summaries carry names only: computers `hostname, user, OS, group,
  organization, mode, lastCheckin, agentVersion, deniesLast7Days`; approvals
  `requestedAt, hostname, user, file, organization, status, requestor, reason`;
  audit `time, hostname, user, action, actionType, application, policy, path`.
  GUIDs and hashes sit behind `full:true`. Every list is prefixed with a
  one-line summary (`totalDevices` from the per-row `totalRows`,
  `pendingApprovals`, the audit window). Approval status and OS enums are
  translated both ways. Elicitation prompts on list tools are gone (the
  `elicitation.ts` module was deleted); approvals default to Pending, audit to
  the last 24 hours.
- New tool `threatlocker_computers_maintenance_modes`. Tool names unchanged.

Evidence: end-to-end stdio run of the rebuilt bundle against instance `h` with
the real key, 24 checks, all passing on the final run: `tools/list` 19 tools;
`Auth check: OK`; `computers_list` -> `{"totalDevices":148,...}` with five
name-only rows and no GUID in the output; `computers_get` by lowercased
hostname returns make/model and serial; unknown hostname -> `NOT_FOUND` with
the search hint; check-ins, maintenance modes, groups (6, with OS names),
organizations (`Henssler Financial`), pending count `1`, approvals list
Pending and Approved with status names, `approvals_get` and permit
application resolved by hostname plus `pathContains`, audit search over 48h
with no id fields in default rows, Deny filter returns only Deny rows, audit
by hostname returns only that host, file history by hostname plus path (25
events), `audit_get` from a `full:true` id, and INVALID_ARGS on a bad status
and a bad date. Unit: `_shared` 67 pass; node-threatlocker pagination 3 pass;
wiring 9 pass; fake-key smoke and no-key status PASS.

## 2026-09-01 -- ThreatLocker 440 TOKEN_REVOKED is an auth failure, and the hint now says what it means

Marketplace `3.10.1`; atlas `5.20.1`; threatlocker-mcp `1.3.1`.

Report: every `threatlocker_*` tool returned `HTTP 440 {"error":"TOKEN_REVOKED"}`
and the user read the wording as a connector bug. Investigation against the
ThreatLocker docs (`threatlocker.kb.help/getting-started-with-threatlocker-portalapis/`)
and the live API showed the wiring is correct and the credential is not:
`node-threatlocker` sends the raw token in `Authorization` and the org GUID in
`managedOrganizationId`, exactly as documented, and the portal answers
`440 TOKEN_REVOKED` for any token it does not recognize (a zero-filled token and
the literal string `not-a-token` get the same body; no header at all gets 403).
The configured key received the same 440 on every reachable instance (b through h).

- `mcp_servers/_shared/error-envelope.ts`: HTTP 440 now classifies as `FORBIDDEN`
  instead of falling through to `INVALID_ARGS`. Test added in
  `_shared/__tests__/response-quality.test.ts`.
- `mcp_servers/threatlocker-mcp/src/domains/_helpers.ts`: a local
  `toolErrorFromCatch` wrapper replaces the per-call-site "verify the env vars
  are set" hint with a 440-specific one: the token is unknown to ThreatLocker
  (expired after the inactivity window, deleted, mistyped, or the organization
  Auth Key pasted in place of an API User token), how to mint a new API User
  token, check the instance letter, and restart the server since credentials
  are read at launch.
- `threatlocker_status` now makes one authenticated call (pending approval
  count) and reports `Auth check: OK (...)` or `Auth check: FAILED HTTP 440
  TOKEN_REVOKED: ...`, with `isError` set on failure. "Configured" only ever
  meant a value was present, and a session read it as "reachable" and told the
  user the connector worked when the very next call was rejected. Status also
  prints the first four characters of the loaded key,
  so the credential a server actually loaded is visible in one call. That is how
  the second defect surfaced: the running server was sending a key (prefix
  `CB23`, already failing on 2026-08-26) that exists in neither
  `plugins/atlas/.env` nor settings.json `pluginConfigs` (both hold the newer
  `6507` value the dashboard saved on 2026-08-28). `threatlocker_api_key` is
  `sensitive: true` in `plugin.json`, and Claude Code stores sensitive
  userConfig in secure storage, not settings.json
  (`code.claude.com/docs/en/plugins-reference.md`, user configuration). On this
  Mac that is the Keychain item `Claude Code-credentials`, whose
  `pluginSecrets["atlas@tech-tools"].threatlocker_api_key` still holds the old
  `CB23` token. The installed plugin (cache `5.20.0`) ships no `.env`, so
  `ATLAS_ENV_FILE` points at nothing and the `CFG_` fallback is what Claude Code
  substituted from Keychain. Net: the dashboard credentials form writes to two
  places the installed plugin never reads for sensitive fields. Not changed in
  this entry; recorded as an open item.
- `mcp_servers/threatlocker-mcp/tsup.bundle.config.ts` is the reproducible
  recipe for `plugins/atlas/mcp/threatlocker/server.mjs` (noExternal, minified,
  `@shared` aliased); the bundle is rebuilt from it.

Evidence: `node --experimental-strip-types --test mcp_servers/_shared/__tests__/response-quality.test.ts`
-> 67 pass, 0 fail (66/1 before the envelope change). Stdio smoke against the
rebuilt bundle with a fake key: `threatlocker_status` shows `prefix 0000...`,
`threatlocker_computer_groups_list` returns `code: FORBIDDEN`, `HTTP 440`, hint
starting `HTTP 440 TOKEN_REVOKED: ThreatLocker does not recognize this token`.
`pytest plugins/atlas/scripts/test_connectors_wiring.py` -> 9 passed.
Follow-up in the same day, shipped as marketplace `3.10.2`; atlas `5.20.2`;
threatlocker-mcp `1.3.2`; node-threatlocker `1.0.4`.

Resolution, found after the user minted a third token and it still got 440: the
organization lives on ThreatLocker instance `h`, and the connector's default base
URL assumes instance `g`. A token is only known to the instance that issued it,
and every other instance answers the same `440 TOKEN_REVOKED`, so a wrong
instance letter is indistinguishable from a dead token. Probing the new key
against `b` through `h`: `h` returned `200` (pending count `1`), all others 440.

- `threatlocker_status` now probes every instance on a 440 and names the one that
  accepts the key, with the exact `THREATLOCKER_BASE_URL` to set. The 440 hint
  leads with the instance-letter cause and points at status.
- `plugin.json` `threatlocker_base_url` description, `plugins/atlas/.env.example`,
  and the `_shared/base-url.ts` vendor table now say the `g` default is not
  universal and how to find the instance letter.
- The user's `threatlocker_base_url` plugin option was set to instance `h`.
  A `/reload-plugins` is needed for the running server to pick it up.

With auth working, the first real calls exposed two response-shape bugs in
`mcp_node/node-threatlocker` (now `1.0.4`), invisible while every call was 440:

- `unwrapPaginatedResponse` only looked for `items` / `data` / `results`
  envelopes, but the PortalAPI `*GetByParameters` endpoints (Computer,
  ApprovalRequest, ComputerCheckin, verified live) return a bare JSON array with
  the total repeated on every row as `totalRows`. Every list tool returned `[]`
  against a tenant with 148 devices. Arrays are now unwrapped and `total` comes
  from `totalRows`. Unit test: `tests/unit/pagination.test.ts`.
- `getPendingCount` read `response.count`; the endpoint returns a bare number.
- `threatlocker_computers_list` summary used field names the API does not send
  (`hostName`, `computerGroup`, `policyStatus`); it now maps `computerId`,
  `hostname`, `operatingSystem`, `lastCheckin`, `group`, `action`,
  `organization`, and `totalRows`.

Evidence (rebuilt bundle, real key, instance `h`): `threatlocker_status` ->
`Auth check: OK (authenticated; pending approvals: 1)`, `isError: false`;
`threatlocker_computers_list` -> rows with hostName, OS, group, `policyStatus:
"Secure"`. At the `g` default the same bundle reports `FAILED HTTP 440 ... but
instance "h" accepts this key. Set THREATLOCKER_BASE_URL=...h...`.
`vitest run tests/unit/pagination.test.ts` (setup file bypassed: the library's
`msw` dev dependency is not installed in this checkout, so the pre-existing
suite cannot load) -> 3 passed.

## 2026-09-01 -- CrowdStrike Falcon joins the bundled connectors

Marketplace `3.10.0`; atlas `5.20.0`.

Falcon is the eleventh bundled connector and the first Python one. CrowdStrike's
`falcon-mcp` 0.18.0 source is vendored at `plugins/atlas/mcp/falcon/` with no
`.git`, no submodule, and no remote, so nothing fetches from CrowdStrike's
repository again; runtime dependencies still resolve from PyPI against the
vendored `uv.lock`.

- Every other connector is a Node ESM bundle, so this needed a second launch
  shape: `uv run --project mcp/falcon python mcp/_env/load.py falcon_mcp.server`.
  The new `mcp/_env/load.py` is the Python twin of the Node env preloader, with
  the same precedence (`.env` beats `CFG_*`, empty or unexpanded values never
  promote). Empty-value suppression carries more weight here: a blank
  `FALCON_BASE_URL` would otherwise beat the vendored server's own default in
  `os.environ.get(key, default)`.
- Connector discovery, the wiring test, the dashboard connector list and its Test
  button now recognize a Python connector (`mcp/<name>/pyproject.toml`) alongside
  a Node bundle, through the new `atlas_control.connector_entry()`.
- Four userConfig keys, all defaulting to `""`: `falcon_client_id`,
  `falcon_client_secret`, `falcon_base_url`, `falcon_member_cid`.

Evidence: `atlas_control.test_connector("falcon")` completed an MCP initialize
plus `tools/list` handshake -- Falcon MCP Server 0.18.0, 144 tools, 1091 ms --
with no credentials set, confirming inert-by-default still holds. Suites green:
`plugins/atlas/scripts` 611 tests OK, `plugins/atlas/hooks` 624 tests OK
(skipped=3). The user-scope `falcon-mcp` entry in `~/.claude.json` was removed so
the plugin connector is the only Falcon server.

## 2026-08-29 -- Dashboard becomes a control plane, not just a viewer

Marketplace `3.9.0`; atlas `5.19.0`.

The dashboard could observe sessions and take credentials, and nothing else. It
now configures atlas and surfaces the rest of the install.

- **Behavior** page: the `ATLAS_*` knobs the hooks read, each showing the
  `file:line` that reads it. Writes land in `~/.claude/settings.json` `"env"`,
  verified as the block Claude Code exports into hook subprocesses.
- **Ecosystem** page: hook wiring with a present/missing verdict per binding, 48
  installed plugins with enable toggles, 26 MCP servers (plugin and user scope)
  with enable / add / remove, and the skills, agents and output styles reachable
  here.
- **Connectors**: editable non-secret values, a real connection test against the
  connector's own bundle, a per-connector enable switch, bulk `.env` import and
  redacted export.
- New `plugins/atlas/scripts/atlas_control.py` plus 21 tests. Full suite green:
  611 scripts tests, 624 hooks tests (77 of them the atlas contract suite).

Evidence and the API table: `plugins/atlas/skills/atlas-orchestrate/references/dashboard-api.md`.


## 2026-08-28 -- Atlas multi-session dashboard + version bump

- Marketplace `3.7.0`; atlas `5.17.0`; armada `1.1.1`; programmer `0.1.1`.
- Atlas dashboard: shared UI at `http://127.0.0.1:7421/` for concurrent agent terminals (project/session switcher).
- Kimi dual-manifest packaging removed earlier the same day.


## 2026-08-28 -- Remove Kimi Code CLI dual-manifest support

Removed all Kimi marketplace / dual-manifest packaging from this repo. The tech-tools marketplace is Claude Code only (atlas, armada, programmer via `.claude-plugin/marketplace.json`).

Deleted:
- root `.kimi-plugin/` (marketplace.json, import-plan.json, import-report.json)
- root `kimi.plugin.json`
- `plugins/atlas/.kimi-plugin/`, `plugins/armada/.kimi-plugin/`, `plugins/programmer/.kimi-plugin/`

Updated living docs (README, plugins/README, AGENTS.md, docs/AGENTS.md, .gitignore) and tests that required claude/kimi version parity.


Newest entry on top. Dates are ISO 8601 (YYYY-MM-DD).

---

## 2026-08-20 -- atlas ran on Bash and kept no todo list: both were Claude Code auto mode

Two complaints, one cause. Neither was an atlas regression: `permissionMode:
"auto"` is recorded in 201 session transcripts, earliest 2026-07-21, a month
before the 5.15.0 refactor that got blamed.

**Auto mode injects a bash-first steer.** It lands after CLAUDE.md and after the
output style, so it outranks `assets/rules/mcp-tools.md`:

> Do your work through the Bash tool wherever it can accomplish the job: read
> files with cat, head, or sed -n, search with grep and find, and make file
> changes with sed, heredocs, or short scripts, rather than using the dedicated
> Read, Edit, or Write tools.

Tool census over the last eight sessions matches the directive exactly - MCP is
reached for only where Bash cannot do the job:

| Session | Bash | MCP |
|---|---|---|
| hyper_plugins `eddacb2c` | 24 | 0 |
| hyper_plugins `0dd963bf` | 106 | 0 |
| tech-tools `e9d694ab` | 29 | 0 |
| thfg-crowdstrike `d50e88dd` | 1 | 14 |

The switch, in the 2.1.237 bundle: `bashFirst = hasBash && hasEdit/Write &&
TYo()`, where `TYo()` returns `G.CLAUDE_CODE_THRIFTY_SONIC` verbatim when that
env var is defined, otherwise the `tengu_thrifty_sonic` gate. The emitter returns
nothing when `steerOnly` is set but `bashFirst` is not, so falsifying `TYo()`
removes the block. Fix, applied to `~/.claude/settings.json` env:

    "CLAUDE_CODE_THRIFTY_SONIC": "false"

Auto mode stays on. Probe (`claude -p --permission-mode auto --model opus`,
asking whether the system prompt contains "Do your work through the Bash tool"):

    before                 -> YES
    THRIFTY_SONIC=""       -> YES   (empty string reads as unset)
    THRIFTY_SONIC=0        -> NO
    THRIFTY_SONIC=false    -> NO
    from settings.json     -> NO    (no inline env var)
    permission-mode default (control) -> NO

`tengu_thrifty_sonic` is an undocumented experiment gate. A CLI upgrade can
rename or drop it and silently restore the steer, so re-run that probe after
upgrades.

**Auto mode also strips `TodoWrite` from the toolset.**

    claude -p --permission-mode auto    --model opus  -> TodoWrite absent
    claude -p --permission-mode default --model opus  -> TodoWrite present
    CLAUDE_CODE_AUTO_MODE_EDIT_REMOVAL=false / =0     -> still absent

No override restores it. The atlas todo contract therefore named a tool that
could not be called on any auto-mode run, which is the whole of `todoWrite=0`
across 14 consecutive hyper_plugins transcripts. It was never a discipline
failure. `plugins/atlas/output-styles/atlas-orchestrator.md` now names the
absence and gives an executable fallback - a one-line `LEDGER | 3/5 | now: ... |
left: ...` under the status header - with the verified-only rule intact.
`OrchestrationContract.test_todo_contract_degrades_when_todowrite_is_absent`
locks it in; 77 contract tests pass.

**What was checked and found fine.**

- `outputStyle: "concise"` does not suppress the atlas style. The style declares
  `force-for-plugin: true` and applies on top wherever the plugin is enabled;
  probing a live auto-mode session from the repo returns YES for both
  "Atlas Orchestrator" and the new "LEDGER |". No settings change was needed.
- serena is healthy. The `unhealthy` record in `mcp-health-cache.json` expired
  2026-08-05 and came from `--project-from-cwd` resolving into a deleted
  worktree. `~/.serena/serena_config.yml` lists 5 projects, 0 missing, and a live
  `find_symbol("main", plugins/atlas/hooks/completion_gate.py)` returns lines
  420-553.
- The session reported as hung was not. `eddacb2c` finished at 12:08:08 with a
  full `ATLAS | verify` message and a `turn_duration` of 340108 ms; the spinner
  screenshot was taken about 20 seconds early.

**One real trap worth remembering.**
`~/.claude/plugins/cache/tech-tools/atlas/5.15.0` is a copy of `plugins/atlas`,
not a link - different inodes. Editing the repo does not change what a running
session loads until the plugin is reinstalled. That is a genuine
"my change did nothing" cause, independent of everything above.

Evidence: `.atlas/.run/2026-08-20-tooling-diagnosis.md`, `.atlas/.run/findings.json`
batch `2026-08-20-tooling`.

---

## 2026-08-19 -- ninjaone-mcp 1.8.0: five endpoints were wrong, and the 404s read as a permissions problem

An agent reported that the NinjaOne connector "can only list scripts" and that
the API app's permissions needed updating. Neither was true. Five endpoints
were transcribed wrong, and the error envelope told the agent to blame
credentials for every failure including a 404.

**The five wrong endpoints**, each checked against `NinjaRMM-API-v2.json`:

| Tool | 1.7.0 sent | The spec says |
|---|---|---|
| `ninjaone_scripts_list` | `GET /v2/scripts` | `GET /v2/automation/scripts` -- `/v2/scripts` does not exist |
| `ninjaone_devices_script_run` | body `{scriptId, parameters, runAs}` | `{type: SCRIPT\|ACTION, id, uid, parameters, runAs}` |
| `ninjaone_devices_reboot` | `POST /v2/device/{id}/reboot` | `POST /v2/device/{id}/reboot/{NORMAL\|FORCED}` -- mode is a path segment |
| `ninjaone_devices_inventory` kind=`scripting-options` | `/v2/device/{id}/scripting-options` | `/v2/device/{id}/scripting/options` |
| `ninjaone_devices_maintenance` | `POST /maintenance`, no body | `PUT /maintenance` with a required `end` |

Windows service start/stop/restart were also wrong: the SDK called
`/windows-service/{name}/start`, `/stop` and `/restart`, none of which exist.
The spec has one `POST /windows-service/{serviceId}/control` with the verb in
the body.

Live red evidence, this session, against the installed 1.7.0 bundle:

```
ninjaone_scripts_list
-> {"code":"NOT_FOUND","message":"ninjaone_scripts_list failed: HTTP 404",
    "hint":"Verify NINJAONE_CLIENT_ID, NINJAONE_CLIENT_SECRET, and NINJAONE_REGION are set."}
```

That hint is the second defect. Every handler passed a fixed credentials hint
regardless of status, so an agent reading a wrong-path 404 concluded the API
app lacked permissions and told the user to change them. `toolErrorFromCatch`
in `mcp_servers/_shared/error-envelope.ts` now overrides the hint on
`NOT_FOUND` with an explicit "this is NOT a credentials or permissions failure,
do not tell the user to change API permissions", keeping the caller's hint
appended. This applies to all ten connectors at source. Only the ninjaone bundle was rebuilt this session, so the
other nine pick the change up on their next rebuild.

**New capability.** 39 tools to 45, and the existing tools reach far more of the
API:

- `ninjaone_devices_patch_run` -- OS and third-party patch scan and apply
  (`POST /v2/device/{id}/patch/{os|software}/{scan|apply}`), the four endpoints
  that make patching actionable rather than read-only.
- `ninjaone_devices_service_control` -- START/STOP/PAUSE/RESTART a Windows service.
- `ninjaone_devices_search` -- free-text lookup by hostname, user or IP, so an
  agent can resolve a name to the numeric `device_id` every other tool needs.
- `ninjaone_activities_list` -- the tenant-wide activity log, which is where a
  script's actual result lands.
- `ninjaone_tasks_list` -- scheduled tasks.
- `ninjaone_vulnerability_scan_groups` -- scan groups. Scope note stated in the
  tool description: the public v2 API exposes scan-group configuration only,
  not per-device CVE findings. Real vulnerability posture comes from
  `os-patches` (severity=CRITICAL), `software-patches` and `antivirus-threats`.
- `ninjaone_devices_inventory` -- 9 kinds to 15, adding `software-patches`,
  `os-patch-installs`, `software-patch-installs`, `jobs`, `policy/overrides`,
  `windows-services`, and the corrected `scripting/options`. Patch kinds now
  forward `status`, `type` and `severity`, which were previously undeclared.
- `ninjaone_queries_run` -- 13 query names to all 24 in the spec, adding
  `antivirus-threats`, `device-health`, `software-patches`,
  `software-patch-installs`, `raid-controllers`, `raid-drives`, `backup/usage`,
  the detailed and scoped custom-field variants, and `windows-services`. Each
  is described in one line on the tool schema so an agent can pick one without
  reading the REST docs, and `severity`/`type`/`productName`/`productState`
  filters are forwarded.
- `ninjaone_devices_script_run` -- gained `type` and `action_uid`, so built-in
  actions (the "run a command" surface) are reachable, not just catalog scripts.
- `ninjaone_devices_reboot` -- gained `mode`.
- `ninjaone_devices_maintenance` -- gained `end`, `start`, `disabled_features`
  and `reason`; `action=start` without `end` is now rejected locally instead of
  being refused by the API.

**A third inert-parameter defect, same class as the two recorded in `6df018c`.**
`ninjaone_devices_list` declared `device_class` and `online`, logged them, and
never sent them: `/v2/devices` accepts no such params, so a
`device_class=WINDOWS_SERVER` request returned the whole tenant and read like a
scoped answer. Its `cursor` param was inert for the same reason, since that
endpoint pages by `after` (last device ID). All three filters now compile into
one `df` expression, `cursor` is replaced by `after`, and `device_filter` lets a
caller write the df directly. A regression test pins the compiled expression.

Tool descriptions were rewritten to say what an agent should reach for and in
what order: which tool yields the ID the next one needs, when a fleet query
beats a per-device loop, and that a script run returns when queued rather than
when finished.

**SDK** (`mcp_node/node-ninjaone` 1.4.0 -> 1.5.0): the five path/body fixes,
`controlService` replacing the three phantom per-verb methods, plus
`getScriptingOptions`, `runPatchAction`, `getActiveJobs`, `getPolicyOverrides`,
`resetPolicyOverrides`, `getDashboardUrl`, `search`, `listDetailed`,
`automation.listTasks`, and a new `VulnerabilityResource`.
`getInventoryByKind` now forwards query params and accepts multi-segment tails.

**Docs.** `docs/vendors/ninjaone/api-reference.md` listed `/scripts`, the
`{scriptId}` body and `POST /maintenance` -- the code was written from that
table, so the table was corrected and the 16 missing endpoints added.

Evidence:

- Red: the live `ninjaone_scripts_list` 404 above, against installed 1.7.0.
- `mcp_node/node-ninjaone`: `npm run typecheck` clean, `npm test` 111 passed
  (was 94). 17 new msw tests assert one spec-verified path per endpoint;
  `onUnhandledRequest: 'error'` means a drifted path fails the suite.
- `mcp_servers/ninjaone-mcp`: `npm run typecheck` clean, `npm test` 162 passed /
  11 failed. The same 11 fail on `6df018c` with this change stashed (response-
  shaper and credential-resolution assertions, unrelated); baseline was 142
  passed / 11 failed.
- `mcp_servers/_shared`: 66 passed / 0 failed, including two new tests pinning
  the 404 hint override.
- `plugins/atlas/mcp/ninjaone/server.mjs` rebuilt with esbuild (bundled ESM,
  minified, no `node_modules`). Copied alone into an empty directory it
  completes an MCP initialize handshake as `ninjaone-mcp 1.8.0` and returns 45
  tools, with `ninjaone_devices_inventory` offering 15 kinds and
  `ninjaone_queries_run` 24 queries.
- `python3 -m pytest plugins/atlas/scripts/test_connectors_wiring.py
  plugins/atlas/hooks/test_atlas_contract.py -q`: 82 passed, 3 skipped.

UNVERIFIED - needs user retest: no live API call was made against the corrected
paths. The MCP server in this session still runs the old 1.7.0 bundle until
Claude Code restarts, and the write paths (script run, reboot, patch apply,
service control, maintenance) must not be smoke-tested against production
endpoints. After a restart, `ninjaone_scripts_list` should return the script
catalog instead of HTTP 404.

---

## 2026-08-19 -- atlas 5.14.0: the plugin talked too much and tracked too little

Released as atlas 5.14.0 (`plugins/atlas/.claude-plugin/plugin.json:3`).

**Noise.** Every routine event had a voice, and none of it was actionable.
`format_after_edit.py` printed "auto-formatted X with ruff" on every successful
edit; `prompt_optimizer.py` printed a two-line colored stderr banner on every
optimized prompt; `session_boot.py` opened each session with eight lines of
methodology recital plus a status line for claude-mem, context-mode, and
ponytail *whether present or absent*, capped at 9000 characters. Volume is not
neutral: a user who learns atlas output is skimmable stops reading the one line
that is a real blocker.

The rule is now uniform, and an advisory hook says nothing on the happy path.
`format_after_edit.py:118-121` returns silently on success. The optimizer banner is
opt-in via `ATLAS_OPTIMIZE_VERBOSE` (was opt-out via `ATLAS_OPTIMIZE_QUIET`) and
is one line when it fires (`hooks/prompt_optimizer.py:458-489`).
`session_boot.py:466-486` emits one posture line plus a single `Setup gap:` line
naming only what is missing, capped at 3000 chars with the memory snapshot cut
at 700 on a record boundary. `dispatch_tripwire.py` and `docs_drift_watch.py`
keep their content and lose their padding. Measured: the boot block went from
~5k chars to 1,744.

**The todo list.** The orchestrator had no user-visible progress surface and no
mechanical guard against dropping a stage. `TodoWrite` is now mandatory in
`plugins/atlas/skills/atlas-orchestrate/SKILL.md:92-109`: the stage map mirrors
into it at plan time, an item flips to `completed` only when its
`findings.json` entry reads `verified`, and re-reading the list is close-out
step 1. `TodoWrite` and `AskUserQuestion` were added to the skill's
`allowed-tools`, since mandating a forbidden tool is a dead rule.

**Mid-run steering.** A user message arriving during a wave is classified before
it is acted on (`SKILL.md:111-123`): a correction stops the affected work now,
new scope is inserted into the todo list at its dependency position, a process
change applies from the next wave. Ambiguity routes to `AskUserQuestion`.

**Worktree close-out.** Waves with more than one writer get
`isolation: "worktree"`, and a worktree containing changes does not clean itself
up. The done gate (`SKILL.md:174-192`) now requires committing inside a dirty
worktree first, merging into the local branch, removing the tree, then
*offering* the push. Pushing on atlas's own initiative was never allowed and is
now stated where the gate can be read.

**Enforcement, not prose.** The todo, worktree, and docs-drift rules above
would otherwise have been markdown that only a compliant model obeys. Three
mechanisms now carry them, all fail-open like every sibling condition:

- **Condition (i), todo drain.** `completion_gate.py` reads `transcript_path`
  for the run's most recent `TodoWrite` tool_use. TodoWrite rewrites the whole
  list every call, so the last one is current state. A run that shipped code and
  still holds non-`completed` items is blocked. A run with no todo list at all
  passes: (i) enforces draining a list, not creating one, and demanding a todo
  list for a two-line change is the busywork this plugin exists to avoid.
- **Condition (j), worktree close-out.** `dispatch_tripwire.py` records
  `isolation: "worktree"` on any dispatch via the new `runs.used_worktrees`
  column, and the gate blocks when that flag is set *and* `git worktree list`
  still shows trees beyond the main one. Scoped to this run's own dispatches on
  purpose: a gate that fires on the user's long-lived worktrees is the false
  positive that teaches people to ignore gates.
- **Condition (f) cross-check.** (f)'s signal is `run_changed_paths`, fed by
  tool calls carrying a `file_path`. A docs file written by a Bash-invoked
  script produces none, so a run whose docs were genuinely current was blocked
  for drift twice while shipping this very release. The gate now cross-checks
  `git` before blocking. The suppression is one-directional (it can only prevent
  a false block); the cost is that stale docs edits from an earlier session can
  mask real drift, which is the cheaper failure.

The (f) fix carries a red->green capture on live session state
(`.atlas/evidence/2026-08-19-gate-f-cross-check.md`): the same payload, same
session, same docs state, blocked by installed 5.13.0 on `(f)` and passing
silently on the repo copy. Conditions (i) and (j) were inert during that capture
and stay fixture-verified only.

Mid-run steering classification stays instruction-layer: no hook can tell a
correction from new scope, because that is a judgment about intent.

Each mechanism is pinned by fixture-driven tests (`OpenTodosTest`,
`LeftoverWorktreeTest`, `GateConditionIJTest`, `DocsMovedInGitTest`,
`WorktreeFlagTest`) and each was mutation-checked: disabling the condition in
the hook makes its test fail.

**Subagent tiers and colors.** `docs-auditor` and `naming-glossary-audit`
dropped to haiku; both read and report, neither renders a judgment. `verifier`
and `completeness-critic` stay sonnet/medium on purpose, because cheapening the
adversarial pass works against the reason the noise was cut. Colors are assigned
by role family (cyan discovery, blue planning, green code writes, purple docs
writes, pink runtime testing, yellow/orange probe and audit, red verdict) and
pinned to Claude Code's eight-color palette. That palette is a closed set, not a
style preference: the frontmatter value is a key into the CLI's own color map
(`{red:"red",...,purple:"magenta",orange:"colour208",pink:"colour205",cyan:"cyan"}`,
confirmed by grepping the shipped binary), so a value outside it misses the map
and the dispatch renders uncolored. `ui-runtime-tester` had been set to
`magenta`, which appears in that map only as a value (what `purple` resolves to)
and never as a key, so it was rendering uncolored. Moved to `pink`.

**Verification.** `hooks/test_atlas_contract.py` gained `NoiseContract` and
`OrchestrationContract` (11 checks) so the next hook that narrates itself, or a
dropped todo/worktree rule, fails the suite. Full run:
`python3 -m pytest -q` in `plugins/atlas/hooks` -> 578 passed, 3 skipped, 67
subtests. The 3 skips are `InstalledParityContract`, which is inert until the
plugin is reinstalled at 5.14.0.

**Known gap.** Nothing above is live until the plugin reinstalls; the running
copy is 5.13.0.

---

## 2026-08-18 -- atlas 5.13.0: the NinjaOne connector listed tools it could not call

Released as atlas 5.13.0 (`plugins/atlas/.claude-plugin/plugin.json:3`,
`.kimi-plugin/plugin.json:3`), ninjaone-mcp 1.7.0, node-ninjaone 1.4.0.

**Root cause of "tools that do not work."** `mcp_servers/ninjaone-mcp/src/index.ts`
routed `tools/call` through four hardcoded `name.startsWith("ninjaone_<domain>_")`
branches and answered `Unknown tool` to everything else. Any tool whose name does
not encode its own domain was listed by `tools/list` and uncallable. Replaced with
`getDomainForTool()` (`src/index.ts:74-93`), a name -> domain index built from the
handlers' own `getTools()` at first call. `src/__tests__/flattened-navigation.test.ts`
now pins routability rather than naming.

**Coverage.** `mcp_node/node-ninjaone` covered five resources; everything in
`docs/vendors/ninjaone/api-reference.md:81-158` had no client code. Added
`resources/queries.ts`, `resources/automation.ts`, `resources/directory.ts`, and
extended `resources/devices.ts` with per-device inventory, `runScript`,
`startMaintenance`, `cancelMaintenance`. All wired onto `NinjaOneClient`
(`src/client.ts`). Tool count 26 -> 39; near-identical endpoints collapse behind
an enum (`ninjaone_queries_run` covers all 13 `/v2/queries/*`,
`ninjaone_devices_inventory` covers 9 per-device paths) rather than one tool each.

**Verified behaviors.** Tenant scoping builds `df: "org = <id>"`, never
`organizationId` -- those endpoints have no such parameter, so passing one filters
nothing while returning a whole-tenant result that reads scoped. Unparseable
`installed_after` / `installed_before` drop the filter instead of sending `NaN`.
`ninjaone_devices_activities` now actually sends its `activity_type` as `type`
(`api-reference.md:79`); the property was declared and never read.

**Annotations.** `src/annotate-tool.ts` classified by name pattern:
`ninjaone_devices_maintenance` fell through to the read-only default while
mutating state, and `ninjaone_queries_run` was marked a write because its name
contains "run". Explicit overrides plus `src/__tests__/annotations.test.ts`,
which fails if a mutation-implying name lands in the read class.

**Supersedes 5.12.0's placement.** `ninjaone_devices_os_patch_installs` moved
from the devices domain to queries and shares one routing path with
`ninjaone_queries_run`. The duplicate client methods
`devices.getOsPatchInstalls` / `listOsPatchInstalls` and their orphaned
`unwrapQueryResults` helper are removed (node-ninjaone 1.4.0).

**Deliberately unshaped.** NinjaOne apidocs are JS-rendered and return nothing, so
response field names for the new endpoints are unverifiable. Records pass through
without summary functions rather than being narrowed against guessed names.

**Fixed: node-ninjaone's suite could not run.** Nine test files, a vitest
config, an empty `scripts` block, and no `msw` or `vitest` in devDependencies.
Added both plus `@vitest/coverage-v8` and the missing scripts; the 82 existing
tests pass unchanged. New `tests/integration/resources.test.ts` asserts that
`queries`, `automation`, and `directory` are reachable on `NinjaOneClient` and
that each method hits its documented path, which is the failure mode this
release hit. Suite: 94 passed.

**Evidence.** `tsc --noEmit` clean. Suite 142 passed / 11 failed vs a pre-change
baseline of 94 / 11 -- 48 tests added, zero new failures; the 11 are pre-existing
mock-shape mismatches. Isolated bundle handshake against
`plugins/atlas/mcp/ninjaone/server.mjs`: ninjaone-mcp 1.7.0, 39 tools, all 35
domain tools reached a handler with zero `Unknown tool`.

**Open.** No new endpoint has been exercised against the live API.


## 2026-08-18 -- atlas 5.12.0: NinjaOne OS patch history

Released as atlas 5.12.0 (`plugins/atlas/.claude-plugin/plugin.json:3`,
`.kimi-plugin/plugin.json:3`), ninjaone-mcp 1.6.3, node-ninjaone 1.3.0.

The NinjaOne connector could not answer patch questions. Its four domains
(devices, organizations, alerts, tickets) wrap no part of the `/v2/queries/*`
API, and the only fallback, `ninjaone_devices_activities`, truncates at the
40,000-char response cap while saturated with remote-session records, so it
cannot reach back a week on a busy device.

- New tool `ninjaone_devices_os_patch_installs`
  (`mcp_servers/ninjaone-mcp/src/domains/devices.ts`). With `device_id` it hits
  `/v2/device/{id}/os-patch-installs`; without one it hits
  `/v2/queries/os-patch-installs`. Filters: `status` (INSTALLED/FAILED),
  `installed_after`, `installed_before`, `organization_id` or `device_filter`,
  `limit`, `cursor`. Requires the `monitoring` API scope.
- Tenant-wide scoping goes through NinjaOne's `df` device filter, not
  `organizationId`, which those endpoints do not accept. The tool builds
  `df: "org = <id>"`; an explicit `device_filter` overrides it. Pinned by test.
- `installed_after` / `installed_before` accept ISO 8601 or epoch seconds. An
  unparseable value drops the filter instead of sending NaN, so a typo cannot
  return an empty result that reads as a real answer.
- Patch records are returned unshaped. NinjaOne's apidocs pages are JS-rendered
  and the response schema could not be verified, so nothing narrows the record
  to guessed field names.
- SDK: `devices.getOsPatchInstalls()` and `devices.listOsPatchInstalls()`
  (`mcp_node/node-ninjaone/src/resources/devices.ts`), both normalizing the bare
  array and `{ cursor, results }` envelope shapes to an array.

Evidence: `npm run typecheck` clean. `vitest src/__tests__/domains/devices.test.ts`
18 passed, 2 failed; both failures reproduce on `81af28f` with the change stashed
and are unrelated response-shaper assertions. `plugins/atlas/mcp/ninjaone/server.mjs`
rebuilt (esbuild, bundled ESM, minified, no `node_modules`); copied alone into an
empty directory it completes an MCP initialize handshake as ninjaone-mcp and
returns 27 tools, up from 26, including the new tool with all ten schema
properties.

Not fixed here: `ninjaone_devices_activities` declares an `activity_type`
property that its handler never reads, so the filter is inert.

---

## 2026-08-18 -- atlas 5.11.0: cut the terminal noise, make decisions block

Released as atlas 5.11.0 (`plugins/atlas/.claude-plugin/plugin.json:3`,
`.kimi-plugin/plugin.json:3`).

**The boot banner was the noise, and it was measurable.** `hooks/session_boot.py`
emitted 9,820 bytes on every SessionStart. 10,874 chars of that was the memory block,
because `scripts/atlas_memory.py:load_snapshot()` injected the whole of MEMORY.md, whose
cap is 20,000 chars. The content: ~40 lines of `Tool 'Write' errored 2x in
agent-a870d7a4169e4bb8b`, six near-identical copies of one user correction filed once per
subagent scope, and fragments cut mid-word. New `filter_for_recall()` filters injection
only and never the file -- drops tool-error telemetry and junk scopes (`agent-<hex>`,
`.run`, `.atlas`), collapses near-duplicates by normalizing away the `(project)` qualifier,
and caps at 8 entries / 1,200 chars newest-first. Measured after: SessionStart 9,820 ->
3,649 bytes, memory block 10,874 -> 1,068 chars.

**The junk was still being written.** `hooks/memory_capture.py` refuses subagent scopes,
never captures tool-error tallies (the counts stay in atlas_db for atlas-audit; recall was
their only consumer), truncates on a word boundary, and is unbound from `SubagentStop` in
`hooks/hooks.json` -- per-dispatch capture is what produced one copy per agent, and the
parent `Stop` already resolves subagent sessions.

**Two Stop hooks narrated their own bookkeeping.** `memory_capture` announced "captured N
memory fact(s)" on every Stop. additionalContext on Stop costs a whole model turn to say
nothing, the same defect `nudge.py` carried until 5.9.0. Silent on success now.

**Decisions stop the line.** `output-styles/atlas-orchestrator.md` asked for a
`DECISION NEEDED:` label and only "preferred" AskUserQuestion; a label scrolls past in a
fast-moving terminal. A decision that gates the next step now MUST go through
AskUserQuestion and wait, up to three batched into one call. Prose is reserved for an FYI
decision that does not gate the work and names the default already taken.
`skills/atlas-orchestrate/SKILL.md` closes the other lost path: a subagent returning
`DECISION NEEDED:` makes AskUserQuestion the orchestrator's very next action, before
further dispatch or synthesis.

Verification: `python3 -m pytest plugins/atlas/hooks plugins/atlas/scripts -q` -- 1136
passed. New coverage: `RecallFilterTest` (8), `QuietTerminalContract` (5, including a hard
byte ceiling on SessionStart so this cannot creep back), `DecisionsAreBlockingContract` (2).

---

## 2026-08-18 -- atlas 5.10.0: no nested subagents, and stop sending a squad after a one-file change

Released as atlas 5.10.0 (`plugins/atlas/.claude-plugin/plugin.json:3`,
`.kimi-plugin/plugin.json:3`). Both rules were asserted in prose and enforced nowhere.

**Subagents launched subagents.** No agent definition listed `Agent` or `Task` in
`disallowedTools`, and no hook denied a nested dispatch. A nested agent is invisible to
the orchestrator that owns the task: its dispatch is never counted toward verifier
coverage, its verdict never reaches `findings.json`, its context is unreachable. Fixed in
two independent layers so a change to either alone cannot reopen the hole: all 12 specs in
`plugins/atlas/agents/` now carry `Agent, Task` in `disallowedTools` plus a "You do not
dispatch" section, and `hooks/dispatch_tripwire.py:123` denies any `Agent`/`Task` whose
`transcript_path` is a `subagents/` transcript. That deny runs before the `ATLAS_TRIPWIRE`
kill switch (a structural invariant is not a taste setting) and before any DB call, because
a subagent's session_id has no run row and everything downstream of `current_run_id()`
returns early.

**Every task cost two subagents.** Law 5 (`skills/atlas-orchestrate/SKILL.md:111`) required
an `atlas:verifier` dispatch to pair each implementer, "no exceptions, no it is trivial",
and completion-gate condition (g) enforced exactly that. A one-file change with a passing
test still needed a second agent, which contradicts atlas's own doctrine that verification
is a test run, not a subagent. Condition (g) is now
`max(0, unpaired_implementer_dispatches - verified_findings_stamped_this_run)`
(`hooks/completion_gate.py`): a `verified` entry written during the run pairs an
implementer exactly like a verifier dispatch, scoped to the run window so an inherited or
undated entry earns nothing. `SKILL.md` gains a wave-sizing ladder.

**The orchestrator still never does the work.** Right-sizing is about how many subagents,
never about working inline. The deny tier got tighter, 8 inline ops to 6
(`hooks/dispatch_tripwire.py:32`). Tightening is safe because the count now excludes the
orchestrator's own `docs/` and `.atlas/` writes via
`atlas_db.unsanctioned_inline_ops_since_last_dispatch` -- counting those was a latent
deadlock, since the completion gate orders exactly those writes at closeout and the
tripwire would have denied them.

Verification: `python3 -m pytest plugins/atlas/hooks plugins/atlas/scripts -q` -- 1129
passed. New coverage: `NestedSubagentDenyTest` (7), `TestRunPairsAnImplementerTest` (5),
`UnsanctionedInlineOpsTest` (5), `NoNestedSubagentsContract` (4),
`RightSizedDelegationContract` (4).

---

## 2026-08-18 -- atlas 5.9.0: the four atlas-side defects the usage-insight report measured

Released as atlas 5.9.0 (`plugins/atlas/.claude-plugin/plugin.json:3`,
`.kimi-plugin/plugin.json:3`). Source: `~/.claude/usage-data/report-2026-08-18-075202.html`,
6,284 messages across 369 sessions, 2026-07-02 to 2026-08-17.

**1. The verifier had no write path for its verdict.**
`plugins/atlas/agents/verifier.md:7` declares `disallowedTools: [Write, Edit, MultiEdit,
NotebookEdit]`, and the file never mentioned `findings.json`. The completion gate's
condition (b) (`plugins/atlas/hooks/completion_gate.py:85`) reads
`.atlas/.run/findings.json` for `status: "verified"`. The contract required a file the
agent was structurally prevented from writing and never told about, so verdicts came back
as prose and the gate re-tripped. Fixed with `plugins/atlas/scripts/atlas_finding.py` (a
Bash-invocable atomic append the verifier can actually run), a MANDATORY final step in
`agents/verifier.md:72`, and a `PreToolUse`/`PostToolUse` bracket around every `*verifier*`
dispatch in `hooks/dispatch_tripwire.py:227` that flags a returned verifier which added no
row.

**2. Closeout gates turned a handoff request into a fresh dispatch wave.** The gate's block
text led with "dispatch atlas:completeness-critic", and `atlas-handoff` had no preflight.
`hooks/completion_gate.py:250` now orders remediation smallest-first (write the unwritten
record inline; dispatch only for evidence that does not exist yet; never start a dispatch
that cannot finish), and `skills/atlas-handoff/SKILL.md:19` gains a Step 0 gate preflight
ahead of the summary body.

**3. Stale MCP credentials ate whole sessions.** New
`plugins/atlas/hooks/connector_credential_watch.py`, wired `PostToolUse` on `mcp__.*`
(`hooks/hooks.json`): on the first 401/403, or a 400 whose body names the token, from any
MCP tool, inject one instruction to restart the server rather than sweep the remaining
endpoints. Once per server per session, advisory only, `ATLAS_CONNECTOR_WATCH=off`.

**4. nudge.py announced its own success on Stop.** additionalContext on Stop prompts
another model turn. `hooks/nudge.py` is now silent on the success path.

Also closed here (moved out of `docs/ROADMAP.md`): the "[active] Reinstall after the
5.6.0 bump" item. `InstalledParityContract` no longer skips -- all three assertions run
and pass against the installed 5.9.0 cache.

Verification: `python3 -m pytest plugins/atlas/hooks plugins/atlas/scripts -q` -- 1082
passed. New coverage: `scripts/test_atlas_finding.py` (9),
`hooks/test_connector_credential_watch.py` (11), `VerifierVerdictBracketTest` in
`hooks/test_dispatch_tripwire.py` (6), and
`hooks/test_atlas_contract.py::InsightRemediationContract` (7 permanent invariants pinning
each fix).

---

## 2026-08-11 -- atlas 5.8.0: subagents fell back to Bash grep because serena died first

Released as atlas 5.8.0 (`plugins/atlas/.claude-plugin/plugin.json:3`, `.kimi-plugin/plugin.json:3`).

Measured across the 12 most recent recorded subagent transcripts under
`~/.claude/projects/*/subagents/`: 378 Bash calls (190 `cd`, 61 `grep`, 25 `cat`, 15 `sed`)
against 8 successful MCP calls. All 9 serena calls failed. Zero lean-ctx calls in any run.
Three of the twelve never called `ToolSearch` at all. The agents were not ignoring their
tools - they were taking a documented fallback that fired on every single dispatch.

Three defects in series:

- The mandated batched `ToolSearch("select:...")` named serena only. serena failed on the
  target repo (`KeyError: 'languages'`), and since nothing else had been loaded, `Bash grep`
  was the only reader left. lean-ctx sat in the agents' tool tables but never in the line
  that loads a schema (`plugins/atlas/agents/*.md`).
- 5.7.1 taught agents to recognize the broken `.serena/project.yml` and fall back; nothing
  ever repaired the file, so the fallback fired forever.
- A dispatch could omit its TOOLS block and nothing objected.

Fixes: one batched `ToolSearch` per agent spanning lean-ctx + serena + context-mode with an
explicit serena-down ladder to `ctx_search`/`ctx_read`
(`plugins/atlas/agents/*.md`); `heal_serena_project()` in
`plugins/atlas/hooks/session_boot.py` appends the required `languages:` key at SessionStart
(idempotent, never creates an absent config, fails open); a PreToolUse deny in
`plugins/atlas/hooks/dispatch_tripwire.py` for an `atlas:*` dispatch that orders no
`ToolSearch`, bound via `hooks.json` on `Agent|Task`; and the same block in
`skills/atlas-orchestrate/references/subagent-kit.md`. 10 contract tests added; full hook
suite 500 passed.

---

## 2026-08-11 -- atlas 5.7.1: serena was never activating a project

Released as atlas 5.7.1 (`plugins/atlas/.claude-plugin/plugin.json:3`, `.kimi-plugin/plugin.json:3`).

5.7.0 made every agent name serena's tools correctly and serena still did nothing. Two
configuration defects sat in series underneath it:

- serena 1.6 made `languages:` a `ProjectConfig` field with no default. Every
  `.serena/project.yml` on this machine predates the rename and carries only
  `language_servers:`, so `serena_config.py:569` raises `KeyError: 'languages'`, the project
  is skipped at load, and every symbol tool answers `No active project`.
- `~/.mcp.json:57` - the entry the session actually reads - launched the server with
  `--context claude-code` and no `--project`, so nothing activated even where the yml was
  valid.

Together they produced the always-empty status bar, the `tools/list`-then-silence logs, and a
29% serena tool error rate (against 4.6% for context-mode and 6.8% for lean-ctx) that read as
a bad tool rather than a bad config.

The first determination, "the native `LSP` tool subsumes serena, remove it", was wrong and is
recorded as such. `LSP` takes `(filePath, line, character)` and returns locations;
`find_symbol` takes a name and returns a body. Serena's symbol-edit tools have no native
equivalent, and its `claude-code` context excludes `read_file`, `search_for_pattern` and four
others by construction, so it never overlapped lean-ctx or context-mode at all.

Changed: all 12 agents load the symbol toolset in one up-front `ToolSearch`; the dispatch
brief carries a `NON-INTERACTIVE` clause overriding serena's `interactive` default mode, which
tells subagents to ask the user questions they cannot ask; `lsp-and-symbols.md` and
`capability-routing.md` document the serena-vs-`LSP` split and the active-project
preconditions; three contract tests enforce all of it. Full detail in
`.atlas/findings/2026-08-11-serena-never-activated.md`.

Known gap: ~40 other `.serena/project.yml` files on the machine still lack `languages:`; the
sweep was declined. Repos with no project.yml are unaffected.

---

## 2026-08-06 -- atlas 5.7.0: subagents call the MCP tools, at the right tier

Released as atlas 5.7.0 (`plugins/atlas/.claude-plugin/plugin.json:3`, `.kimi-plugin/plugin.json:3`), marketplace 3.6.0.

**The defect.** Atlas subagents were told to "use `serena`" and to "route noisy output through `context-mode`" in prose. Those are deferred MCP tools: the schema is not in a subagent's tool list until it calls `ToolSearch`, so an agent looking for a tool literally named `serena` finds nothing and falls back to `Grep` + `Read` without saying so. `lean-ctx` and `claude-mem` appeared in no agent body at all. Three agents (`schema-inventory.md:4`, `rls-privilege-audit.md:4`, `naming-glossary-audit.md:4`) additionally carried a `tools:` frontmatter allowlist, which excludes every `mcp__*` tool by construction, so the routing could not have worked there even if the names had been right.

**The fix, agent side.** All 12 agents in `plugins/atlas/agents/` now carry a tool-routing table ahead of their Method section: need, exact callable tool name, and what it replaces. The names are real (`ctx_compose`, `get_symbols_overview`, `find_symbol`, `find_referencing_symbols`, `replace_symbol_body`, `get_diagnostics_for_file`, `ctx_callgraph`, `ctx_search`, `ctx_batch_execute`, `ctx_execute_file`, `ctx_fetch_and_index`, `query-docs`, claude-mem `search`/`timeline`/`get_observations`), each agent gets only the rows its job needs, and every agent is told to `ToolSearch` for schemas first and to search by keyword because server prefixes differ per install. The three `tools:` allowlists are removed; `disallowedTools` already carried the read-only guarantee.

**The fix, tier side.** `effort` is a real plugin-agent frontmatter key (`low`/`medium`/`high`/`xhigh` or an integer, confirmed against the CLI's own validator strings) and is the only reasoning-depth lever available to a subagent - there is no `thinking` key. Every agent now declares one. Sonnet is the ceiling for `atlas:*`: `rls-privilege-audit` drops from opus, and the `SKILL.md` tier table no longer routes `planner`, `completeness-critic`, or critical `verifier` work to opus. Effort is `low` for the nine roles that execute a spec the orchestrator already wrote and `medium` for the three that render an independent verdict against evidence they were not handed. The rationale is stated where it can act: a subagent that appears to need a bigger model is an underspecified prompt, and the fix is the prompt.

**The fix, orchestrator side.** The routing table in `capability-routing.md` already existed and did not change behavior, because nothing required the orchestrator to put those names into a dispatch. The enforcement point moved into the prompt feed: `subagent-kit.md`'s dispatch spec now has a required `TOOLS` block, `prompt-optimization.md` makes naming exact tools a per-dispatch rule with the failure mode spelled out, and `capability-routing.md` gains a Step 2b table of the names to paste, plus the claude-mem worker-runtime argument shapes that caused its historical error rate. `subagent-kit.md` also now warns that a fork inherits the parent's model and effort, so an agent file's `model: sonnet` / `effort: low` do not apply to a forked dispatch.

**Contract test.** `plugins/atlas/hooks/test_atlas_contract.py` gains `AgentTierContract` (7 tests) rather than a verifier subagent: every agent declares a valid `effort`; no agent exceeds sonnet; only `verifier`, `completeness-critic`, and `rls-privilege-audit` get `medium`; no agent carries a `tools:` allowlist; every agent names a `ToolSearch` instruction and at least one context-mode/lean-ctx tool; the five code-facing agents name a serena symbol tool.

Evidence: `python3 -m pytest plugins/atlas/hooks/test_atlas_contract.py -q` -> **31 passed, 48 subtests passed in 2.03s**. Negative control: setting `planner` to `model: opus` and stripping its `effort` line fails 3 of the 7 new tests (`effort tier drift: ['planner.md: None (want low)']`), restored after.

Not addressed: nothing enforces at runtime that a dispatched subagent actually called an MCP tool. The contract test proves the instruction is present and callable, not that the model obeyed it. Per-dispatch tool-use telemetry already lands in `~/.atlas/atlas.db`; measuring MCP-tool share per agent from it is the follow-up.

---

## 2026-08-06 -- armada 1.1.0: setup you can actually run, branding first

Released as armada 1.1.0 (`plugins/armada/.claude-plugin/plugin.json:3`, `.kimi-plugin/plugin.json:3`), marketplace 3.5.0.

**The defect.** Claude Code discovers only `plugins/<p>/skills/<name>/SKILL.md`, `plugins/<p>/commands/*.md` and `plugins/<p>/agents/`. armada had no `commands/` directory at all and exactly one skill directory, so its 123 department commands and 156 department skills -- all nested under `skills/armada/departments/` -- were invisible. The single visible skill opened with an `## Elicitation` section instructing it to ask an `AskUserQuestion` (org setup / department onboarding / brand enforcement / connector provisioning) before doing anything, and there was no skill to route any of those answers to. `/armada` therefore asked a question, had nowhere to send the answer, and burned the turn.

**The fix: three setup skills promoted to the discoverable level, in run order.** `armada-brand` (step 1) detects org name, logo, colors, voice and commit style from `package.json`, `README.md`, theme files and `git log`, asks at most one question covering only what it could not detect, and writes the `org:` and `branding:` blocks of `.atlas/org-config.yaml`, merging rather than truncating. `armada-department` (step 2) refuses to run before branding exists, resolves a department name (with aliases), reads the real `skills/` and `commands/` listings out of the plugin tree, and writes `.atlas/departments/<dept>.yaml` from the existing seed template; with no argument it prints the 11-department table with live state and stops. `armada-connect` (step 3) reports which vendor connectors are live in-session versus missing credentials, and names the exact `userConfig` keys -- credentials stay on the atlas plugin and are never accepted in chat.

**Departments activate by config, not by copying.** Department skills and commands stay in the plugin tree as the department agent's reference library; the yaml is the activation record. One copy of the content, so it cannot drift from the plugin, and nothing is written into the user's `.claude/`. The department files are not slash commands in a project, and the root skill and new README now say so instead of implying otherwise.

**The root `armada` skill no longer elicits.** Its `## Elicitation` section is gone, `allowed-tools` is read-only (`Read, Glob, Grep, Bash`), and its job is a state scan that ends in exactly one recommended next command.

**Contract test.** `plugins/armada/tests/test_armada_contract.py` (14 tests) locks the invariants that broke: the four setup skills resolve as `skills/<name>/SKILL.md`, dir names match frontmatter names, names are unique, the root skill contains no `AskUserQuestion` and declares no write tools, every `${CLAUDE_PLUGIN_ROOT}/...` path cited in any skill resolves to a real file (this caught a bad seed path during authoring), all 11 department dirs have their agent, and the two manifests agree on version while declaring no credentials.

Evidence: `python3 plugins/armada/tests/test_armada_contract.py` -> **14 tests, OK**. Against the pre-change tree the same assertions fail: `git show HEAD:plugins/armada/skills/armada/SKILL.md | grep -c AskUserQuestion` -> `1`, `git ls-tree --name-only HEAD plugins/armada/skills/` -> `plugins/armada/skills/armada` (one skill), `git ls-tree HEAD plugins/armada/commands/` -> empty.

Not addressed: the per-department `.mcp.json` files under `skills/armada/departments/*/` are equally undiscovered (only a plugin-root `.mcp.json` loads). Connectors work today because atlas declares them; armada's copies are dead files.

---

## 2026-08-06 -- atlas 5.6.0: the carried gaps closed, and the gate's own blind spot with them

Released as atlas 5.6.0 (`plugins/atlas/.claude-plugin/plugin.json:3`, `.kimi-plugin/plugin.json:3`). Every item below was a gap this repo had recorded and left open, either in ROADMAP or as an honest caveat inside an earlier CHANGELOG entry. Evidence: `.atlas/evidence/2026-08-06-atlas-5.6.0-gap-closure.md`.

**The one pre-existing test failure, explained and fixed.** `scripts/test_connectors_wiring.py` still discovered connectors by globbing `*.mcpb`, a layout the 2026-07-31 release replaced with vendored ESM bundles. Discovery returned an empty dict, so three of its four bundle tests passed vacuously and `test_every_mcp_server_has_a_bundle` failed. Discovery now keys on `mcp/<name>/server.mjs`; a new `test_connectors_are_discoverable_at_all` fails loudly if discovery ever goes empty again, and `test_mcp_server_runs_vendored_bundle_through_env_preloader` asserts the real `node --import ${CLAUDE_PLUGIN_ROOT}/mcp/_env/load.mjs .../server.mjs` shape instead of the retired `launch.sh` contract. 9 passed.

**Gate-block persistence (`facets.gate_block_count` was permanently NULL).** `completion_gate.py` now writes one `friction_events` row per block (category `gate_block`, weight = number of failed conditions, snippet naming them: `conditions: a,b,f`), and `chronicle_facet.py` counts them into the facet. Wiring it surfaced a second defect: `_sync_friction_events` deleted *every* friction_events row for the session before re-mirroring `signals`, which silently erased both the new `gate_block` rows and `memory_capture`'s `memory_drop` rows -- neither of which any signal can reinsert. The delete is now scoped to the categories that hook actually owns (`chronicle_facet.py:_sync_friction_events`).

**The gate's no-telemetry blind spot.** Conditions (a), (b), (f) and (g) key off the atlas_db run-write signal, which could not distinguish "this run wrote no files" from "nothing was ever recorded". A session whose telemetry never landed therefore got a gate that enforced only "the docs files exist" -- the skipped-reads-as-passed failure mode, previously asserted as a KNOWN GAP in `test_atlas_contract.py`. `_run_written_paths` now falls back to the git working tree when the run has zero `events` AND zero `tool_calls`; a run that logged activity and reports no writes is still trusted, so the dirty-tree false block the 2026-08-06 entry below fixed stays fixed. Both halves are asserted (`test_no_telemetry_falls_back_to_git_condition_f`, `test_gate_trusts_a_run_row_that_reports_no_writes`).

**SECURITY: ten more secret shapes were trackable inside allowlisted folders.** The 2026-08-05 entry closed the ordering bug but explicitly did not claim full coverage. Probing with `git check-ignore` found `*.pgdump`, `*.dmp`, `*.rdb`, `*.bacpac`, `*.sqlite`, `*.sqlite3`, `*.db`, `*.jceks`, `*.keytab` and `*.p7b` still trackable under `docs/`, `.atlas/` and `plugins/`; the shapes that entry named as unverified (`*.jks`, `*.keystore`, `*.p8`, `id_ecdsa`, `.git-credentials`, `secrets.yml`) were in fact already covered. All ten are now in the terminal block. No tracked file matches any new pattern (`git ls-files` verified), and `docs/CHANGELOG.md`, `README.md` and `.atlas/findings/INDEX.md` remain trackable. A new `GitignoreSecretContract` probes 24 paths on every test run so this cannot regress silently.

**`skill_factory.py` deleted.** 5.5.0 unwired `auto_skill.py` but left the script that actually wrote the SKILL.md files sitting in `scripts/`, callable by anything, and `atlas-setup` still verified its presence as a deployment step. Both the script and `test_skill_factory.py` are gone, `atlas-setup` no longer checks for it, and `test_no_script_writes_a_skill_either` asserts no script under `scripts/` writes a SKILL.md (reading one is still fine -- the asset auditor inventories them).

**Facet enrichment is a command, not a prose step.** `atlas_doctor.py --enrich-facet <session_id> '<json>'` validates keys against `atlas_db.FACET_COLUMNS` and writes the LLM-judged columns; unknown columns, non-object payloads and unparseable JSON all exit 2. The judgment stays the model's; the write is now deterministic and testable.

**Manifest and README drift corrected.** Both plugin manifests still advertised `auto-skill` and "automatic skill creation from session transcripts"; the Kimi manifest claimed 22 skills and 16 task skills (real: 21 and 14) and 11 hooks (real: 12, and `docs_drift_watch.py` was never listed). The plugin README repeated the same auto-skill claim and a 22-skill count.

Evidence: `cd plugins/atlas && python3 -m pytest hooks scripts -q` -> **1028 passed, 3 skipped, 56 subtests passed**. The 3 skips are `InstalledParityContract` (installed cache at 5.5.0 vs manifest 5.6.0); they un-skip and pass after reinstall.

---

## 2026-08-06 -- Stop-hook noise: stop gating research-only runs and stop narrating passes, stop injecting nudge into subagent replies

A user-reported transcript showed a chain of Stop-hook messages each forcing another assistant turn, burying the actual decision point. Three defects fixed:

- **`completion_gate.py` conditions (a) evidence and (b) verified-finding no longer apply to a run that shipped zero non-docs code.** A prior run answered a question (no code shipped) and was still blocked on "no verified finding" -- the model then edited `findings.json` purely to satisfy the gate, inventing a schema key and corrupting the ledger. (a) and (b) now reuse the exact `_nondocs_changed` run-write signal already computed for (f)/(g): both are skipped when this run's own activity wrote no non-docs files. Conditions (c)/(d)/(e)/(h) (docs files existing, ROADMAP reconciled) are unaffected and still evaluated unconditionally. When code did ship this run, (a)/(b) block exactly as before.
- **The gate no longer narrates a pass.** It previously emitted `[atlas] completion_gate: this run wrote zero non-docs files, so conditions (f)... and (g)... were not evaluated this Stop` as `additionalContext` on every zero-code-change Stop -- in a long session this fired every single turn, pure noise that invited a reply. The gate is now silent on every pass; it speaks only when it blocks. (Telemetry/logging of the same signal, if any is later added, is a separate concern from what reaches the model.)
- **`nudge.py` removed from the `SubagentStop` binding in `plugins/atlas/hooks/hooks.json`** (now `Stop` only). The self-improvement nudge injected "capture the reusable lesson / confirm docs match" into a dispatched subagent's context immediately before it composed its final response; four of six dispatched agents in the reported session answered that prompt instead of returning their deliverable, each costing a full resume round trip. A subagent reports its lesson to its orchestrator in the deliverable -- it has no business writing to the ledger on its own. `ingest_session.py` was confirmed to emit nothing into the model's context on `SubagentStop` (silent DB mirroring only), so it was left untouched as instructed. `memory_capture.py` was also left untouched per explicit scope, but investigation found it does **not** match the "captures silently" assumption: it emits an `additionalContext` summary of what it captured on both `Stop` and `SubagentStop` (`memory_capture.py:413-422`) -- a real instance of the same class of noise this fix targeted for `nudge.py`, flagged here rather than silently changed.

`plugins/atlas/hooks/test_completion_gate.py` gained tests: a run with zero non-docs changes and no evidence/findings passes the gate with empty stdout; the same run still blocks on missing evidence/findings once it has shipped code; a DB read error on the run-write query fails open to a silent pass rather than a warn. `plugins/atlas/hooks/test_nudge.py` gained a `hooks.json`-binding test asserting `nudge.py` is present under `Stop` and absent under `SubagentStop`.

Evidence: `python3 -m pytest plugins/atlas/hooks -q` -> 467 passed (was 460), 8 subtests passed, 0 failures. This entry's `.atlas/.run/findings.json` record is `needs-verification`, not self-certified `verified` -- an independent verifier owns promoting it.

## 2026-08-06 -- docs_drift_watch.py: session-scoped debounce, cached git calls, atomic state writes

An independent verifier confirmed the mechanical claims in the entry below but found three defects in `plugins/atlas/hooks/docs_drift_watch.py`, fixed in this pass:

- **Debounce was repo-global, not session-scoped.** The state file at `.atlas/.run/docs_drift_watch.json` carried no session identity, so a fresh session could inherit a prior session's streak and stay silent through its first drifting edits -- breaking the module's own "first drifting edit always warns" guarantee. Fixed: the state file now stores the `session_id` from the PostToolUse payload; a differing or missing `session_id` resets the streak to 0 before it increments.
- **The git subprocess ran on every qualifying edit, debounce or not.** Measured ~38ms avg / 46ms max per edit (two `git diff` calls plus one `git rev-parse`) on a near-empty repo. Fixed: the git result is cached in the same state file, keyed on `time.monotonic()`, and reused for `GIT_CACHE_TTL_SECONDS = 2` (no config knob). Re-measured on the same kind of repo: ~20.8ms avg / ~34.3ms max per edit. Bailing out before any git call on `docs/`/`.atlas/` paths, no-`docs/`-root, and `ATLAS_GATE=off` was already in place and unaffected. The tradeoff: within the 2s window a burst of edits can report a slightly stale non-docs file count; the drift/no-drift boolean itself is unaffected because same-direction bursts (all-docs or all-non-docs) don't change that outcome mid-burst.
- **State writes were not atomic.** `_save_state` did a bare `path.write_text(...)`; a crash mid-write could corrupt the file. Fixed: write to a temp file in the same directory, then `os.replace()` onto the target (atomic on POSIX), with temp-file cleanup on any failure. A lost increment under concurrent invocations remains an accepted, fail-open tradeoff.

`plugins/atlas/hooks/test_docs_drift_watch.py` gained 6 tests: differing/missing/same `session_id` streak handling, git-cache reuse-then-refresh (call counted via monkeypatch, no real sleep), docs/`.atlas` paths never reaching git, and atomic replace leaving no partial file on a simulated write failure. One pre-existing test (`test_drift_cleared_then_reintroduced_warns_again`) now sleeps past the 2s cache TTL where it needs to observe a real git-state change made moments earlier -- a direct consequence of the new cache, not a flaky test.

Evidence: `python3 -m pytest plugins/atlas/hooks -q` -> 460 passed (was 454), 0 failures. `pyright` on both touched files -> 0 errors, 0 warnings (the one pre-existing `memory_capture.py:84` error is untouched and unrelated). This entry's `.atlas/.run/findings.json` record is `needs-verification`, not self-certified `verified` -- an independent verifier owns promoting it.

## 2026-08-06 -- Inline docs-drift warning (PostToolUse), so completion_gate's Stop check is a backstop, not the first notice

`completion_gate.py` condition (f) only ever fires at Stop -- often many edits after the moment code drifted from `docs/`. New PostToolUse hook `plugins/atlas/hooks/docs_drift_watch.py` (matcher `Edit|Write|MultiEdit`) surfaces the same signal inline, immediately after the edit that caused it.

- `_find_root`, `_docs_drift`, and `_git_changed_paths` were extracted out of `completion_gate.py` into a new shared module, `plugins/atlas/hooks/docs_drift.py` (public names `find_root`, `docs_drift`, `git_changed_paths`). `completion_gate.py` imports and re-aliases them to their old underscored names, so its own tests and public behavior are unchanged (verified: `test_completion_gate.py` unmodified, still green).
- `docs_drift_watch.py` is a silent no-op when: no project root with `docs/` is found, `ATLAS_GATE=off`, the edited file is itself under `docs/`, or under `.atlas/`. Otherwise it computes drift via the shared helper and warns once, naming the count of non-docs files changed and the instruction to dispatch `atlas:docs-curator` before Stop.
- Debounced via run-scoped state at `.atlas/.run/docs_drift_watch.json` (own file, distinct from `atlas_db`): warns on the first drifting edit, then every 5th one after, and resets the streak the moment a `docs/` file reappears in the diff so a later regression warns again immediately. Fails open on any error, including an unreadable/corrupt state file.
- Wired into `plugins/atlas/hooks/hooks.json` under `PostToolUse`, alongside the existing `format_after_edit.py` entry. Hook count corrected from 12 to 13 in `plugins/atlas/README.md` and `docs/architecture/atlas-plugin-map-2026-07-17.md` (the latter was also missing `chronicle_facet.py` from its table; folded in while touching the count).

Evidence: `python3 -m pytest plugins/atlas/hooks -q` -> 454 passed (was 445 before this change; 9 new tests in `test_docs_drift_watch.py`), 0 failures. `pyright plugins/atlas/hooks/` -> 1 pre-existing, unrelated error in `memory_capture.py:84` (confirmed present before this change), 0 errors in any file touched by this entry.

## 2026-08-05 -- Chronicle/insights schema, atlas-doctor self-improvement skill, and two root-cause fixes for a learning stall

**Released as atlas 5.4.0** (`plugins/atlas/.claude-plugin/plugin.json:3`), marketplace 3.2.0
(`.claude-plugin/marketplace.json:5`), commit `da0f90e`. Manifest descriptions in both files
were corrected to the verified counts: 21 skills (`atlas-doctor` was missing) and 12 hooks
(`chronicle_facet` was missing); they had read 20 and 11. Per-plugin release notes live in
`plugins/atlas/CHANGELOG.md`.

Root-cause investigation (`.agents/notes/atlas-self-improvement-rootcause.md`) found that atlas's own capture pipeline worked but consumption of what it captured was dead: `improvements` was 24 days stale, `asset_verdicts` 27 days stale, and lessons written to `MEMORY.md` after 2026-07-16 were silently discarded. This entry ships the schema and skill that let atlas mine, review, and apply its own findings, plus fixes for both silent-drop causes.

- Added three tables to `plugins/atlas/scripts/atlas_db.py`: `facets` (`atlas_db.py:43-52`, one deterministic+LLM-enriched insight row per session, primary key `session_id`), `friction_events` (`atlas_db.py:57-60`, categorized friction events), and `findings` (`atlas_db.py:62-67`, doctor-produced findings with a `UNIQUE fingerprint` and a `status` lifecycle of `open|accepted|rejected|applied|verified|regressed`). `improvements` extended additively with `finding_id`, `metric`, `baseline_value`, `target_value`, `measure_after_runs`, `remeasured_at`, `remeasured_value`, `verdict` (`atlas_db.py:165-172,613-620`). `facets` and `findings` are deliberately left out of `TELEMETRY_TABLES` (`atlas_doctor.py:40-53`) so they are never row-capped like per-event telemetry. Verified: migrating a copy of the live 119MB `~/.atlas/atlas.db` left all 12 pre-existing tables' row counts identical and `improvements` kept its 38 rows.
- New Stop hook `plugins/atlas/hooks/chronicle_facet.py` (191 lines) writes one deterministic `facets` row per session from data `ingest_session.py` already stored, and mirrors this session's `signals` into `friction_events` via `FRICTION_CATEGORY_BY_SIGNAL` (`chronicle_facet.py:24-29`). Writes NULL, not a fabricated 0, for counts on a session that was never ingested. Wired into the Stop chain in `plugins/atlas/hooks/hooks.json` (line 85), after `ingest_session.py`, before `memory_capture.py`.
- New skill `plugins/atlas/skills/atlas-doctor/SKILL.md`: an interactive self-improvement loop, promoted out of `atlas-setup` into its own skill. Five phases: enrich pending facets, mine findings, ask the user per finding (apply/skip/modify), apply accepted changes as real edits, record a baseline and re-measure later.
- `plugins/atlas/scripts/atlas_doctor.py`: added a `MINERS` registry of 8 miners (`atlas_doctor.py:925-933`: `memory_capture_silent_drop`, `doctor_hook_stale_verdicts`, `gate_block_silences_capture`, `facet_uningested_hardcoded_zero`, `inline_dispatch_ratio_high`, `verifier_coverage_low`, `tool_error_rate_high`, `recurring_friction`); a new CLI (`--mine`, `--list-findings`, `--set-status`, `--baseline`, `--remeasure`, `--pending-facets`, `--json`); and `record_hook_verdict()` (`atlas_doctor.py:460`) wired into the `--hook` path (`atlas_doctor.py:1233`), which fixes cause 2 below. Verified end to end: `mine` -> `set-status` -> `baseline` -> `remeasure` produced a real `improved` verdict; re-running `--mine` did not duplicate findings (fingerprint-keyed upsert).
- `completion_gate.py` conditions (f) docs-drift and (g) verifier-coverage rescoped from the whole git working tree to only the files this run wrote, via the `atlas_db` run signal (`completion_gate.py:346-370`, helpers `_run_written_paths`/`_docs_drift`/`_unpaired_implementer_dispatches` at `completion_gate.py:450-488`). A dirty tree inherited from a previous session no longer blocks a run that touched nothing; (f) now WARNs instead of blocking when a run wrote zero non-docs files (`completion_gate.py:376-393`).

### Root cause 1: `stop_hook_active` was silencing atlas's own telemetry, not just its retry loops

`atlas_hook_guard.should_run()` gained a `kind` parameter, `"capture"` or `"emit"` (default `"emit"`), documented at `atlas_hook_guard.py:140-159`. The `stop_hook_active` short-circuit (`atlas_hook_guard.py:162`) now suppresses only `kind="emit"` hooks (nudge/auto_skill/completion_gate re-emitting a message or block decision, which is what the guard was built to stop). `ingest_session.py:29`, `memory_capture.py:329`, and `chronicle_facet.py:155` all now pass `kind="capture"`. Root cause: whenever `completion_gate` blocked, Claude Code re-fired Stop with `stop_hook_active=true`, and the old unconditional guard silenced every atlas Stop hook on that retry -- so the gate's false-positive blocks (the whole-tree drift check fixed above) had been switching off atlas's own capture hooks since late July. See `.atlas/findings/2026-08-05-stop-hook-active-silenced-capture-hooks.md`.

### Root cause 2: `MEMORY.md`'s 4000-byte cap silently discarded every lesson since 2026-07-16

`plugins/atlas/scripts/atlas_memory.py`: `WORKING_CAP_CHARS` raised from `4_000` to `20_000` (`atlas_memory.py:53`), with rotation to a dated `archive/<NAME>-<YYYY-MM>.md` file (`atlas_memory.py:76-79`) instead of outright rejection when the cap is still hit. Root cause: the user's real `MEMORY.md` sat at 4058 bytes against the old 4000-byte cap, so `atlas_memory.add()` returned `success=False` with no error surfaced, and `memory_capture.py` silently swallowed it. Verified: a forced rotation of 50 entries produced 41 live + 10 archived + 1 new with zero entries lost; the user's actual 4058-byte file gains a new entry cleanly with the original content untouched. Companion fix: `plugins/atlas/hooks/memory_capture.py` added `_record_drop()` (`memory_capture.py:280-296`) and else-branches at both `atlas_memory.add()` call sites (`memory_capture.py:387,397`) so an unstorable lesson is now recorded to `friction_events` (category `memory_drop`) and surfaced on stderr instead of vanishing. Verified: the `mine_memory_capture_silent_drop` miner reported this defect before the fix and reports no finding after. See `.atlas/findings/2026-08-05-memory-cap-silently-dropped-lessons.md`.

### Decision: anonymized feedback exporter built, then removed

An exporter meant to share anonymized session facets/findings was built (`atlas_feedback.py`, `test_atlas_feedback.py`), then deleted this session at the user's direction after an adversarial verifier proved it leaked the user's vendor stack (MCP connector UUIDs, vendor tool names, internal skill codenames) into what was meant to be a shareable export. See `docs/decisions/no-anonymized-feedback-exporter-without-designed-in-redaction.md`. The underlying facets/findings data keeps accumulating, so the exporter can be rebuilt later with anonymization designed in rather than retrofitted.

Evidence: `python3 -m pytest scripts hooks -q` from `plugins/atlas` -> 1045 passed, 1 pre-existing failure (`test_connectors_wiring::test_every_mcp_server_has_a_bundle`, confirmed unrelated by reproducing it on a clean stashed tree).

Known gaps, not shipped this run -- see ROADMAP:
- Gate-block persistence (which condition fired, to `atlas.db`) is not implemented; `facets.gate_block_count` stays NULL.
- Phase 1 facet enrichment has no deterministic CLI flag; it is an LLM judgment driven by the `atlas-doctor` skill reading `--pending-facets`.
- No unit test yet asserts a memory drop is recorded to `friction_events`.

### SECURITY: secret-pattern re-exclusions sat above the allowlist, so every `!docs/**`/`!.atlas/**` rule re-admitted them -- pre-existing, not introduced this session

`.gitignore`'s Section 3 secret patterns (`*.key`, `*.pem`, `id_rsa`, `credentials.json`, etc., `.gitignore:66-91` before the fix) sat above Section 4's allowlist (`!docs/`, `!.atlas/`, and their per-subdir `!docs/<subdir>/**` / `!.atlas/<subdir>/**` entries). Because later `.gitignore` rules win, every one of those allowlist entries silently re-admitted the secret patterns underneath it. This was **pre-existing** and dated back to whenever the per-subdir allowlist entries were added (see the 2026-07-17 canonical-structure-scaffolding and 2026-07-31 `.mcpb` entries above); it was not caused by this session's `docs/decisions/` addition, which merely inherited the same flaw. It affected every allowlisted secret-adjacent folder identically, confirmed for `docs/audits/` and `docs/specs/` as well as `docs/decisions/`, not just the folder this session happened to be writing to.

Verified with `git check-ignore` **before** the fix -- all trackable (i.e. the bug was live):
`docs/decisions/secret.key`, `docs/decisions/foo.pem`, `docs/decisions/id_rsa`, `docs/decisions/credentials.json`, `docs/audits/secret.key`, `docs/specs/id_rsa`. Only `.env` variants were safe, because they alone had a dedicated post-allowlist re-exclusion block (`**/.env` family).

Fix (`.gitignore:341-371`): added a "Global secret re-exclusion (MUST stay after the allowlist)" block immediately before the `plugins/atlas/.env` re-exclusion, mirroring the existing `**/.env` pattern for the rest of the secret set (`**/*.key`, `**/*.pem`, `**/*.p12`, `**/*.pfx`, `**/*.crt`, `**/*.cer`, `**/*.der`, `**/*.asc`, `**/*.gpg`, `**/id_rsa`, `**/id_ed25519`, `**/*_rsa`, `**/*_ed25519`, `**/credentials.json`, `**/secrets.json`, `**/secrets.yaml`, `**/service-account*.json`, `**/firebase-adminsdk*.json`, `**/.netrc`, `**/.npmrc`, `**/.pypirc`, `**/*.tfstate`, `**/*.tfstate.*`).

Verified after the fix: all 8 probe paths (`docs/decisions/{secret.key,foo.pem,id_rsa,credentials.json}`, `docs/audits/secret.key`, `docs/specs/id_rsa`, `plugins/atlas/private.pem`, `.atlas/findings/id_rsa`) -> IGNORED. Real docs still trackable (`docs/CHANGELOG.md`, the new ADR, `.atlas/findings/INDEX.md`). `git ls-files | wc -l` -> 1650, with no already-tracked file matching the new patterns.

Not comprehensively verified: an atlas verifier is separately auditing pattern coverage for secret shapes this list may still miss (e.g. `*.jks`, `*.keystore`, `*.p8`, `id_ecdsa`, `.git-credentials`, `secrets.yml` vs `secrets.yaml`). This entry covers only what was checked above; it does not claim all secret shapes are now blocked. See `.atlas/findings/2026-08-05-gitignore-secret-patterns-above-allowlist.md`.

---

## 2026-07-31 -- All 10 atlas MCP connectors were dead on arrival; replaced .mcpb launchers with vendored ESM bundles

`.gitignore` had `*.mcpb`, so the 10 vendored MCP connector bundles were never committed. An installed plugin's `mcp/<name>/` folder held only `extract.sh` and `launch.sh`; `launch.sh` called `extract.sh <name>`, which had no `<name>.mcpb` to find, so no server ever started and zero `mcp__plugin_atlas_*` tools existed in any session. Separately, `.mcpb` is a Claude Desktop installation format that Claude Code plugins cannot execute natively (`code.claude.com/docs/en/plugins-reference.md`), so the extract-and-exec wrapper was never going to work as a plugin mechanism.

- Replaced the `.mcpb` + `launch.sh` + `extract.sh` mechanism with one self-contained ESM bundle per server: `plugins/atlas/mcp/<key>/server.mjs`, built with tsup `noExternal:[/.*/]`, no `dist/`, no `node_modules/`. Removed the 4 domain subfolders (`hr`, `it-operations`, `microsoft-365`, `security`), the 8 shell scripts, and the 10 `.mcpb` bundles; layout is now one folder per connector key (auvik, blumira, cipp, connectwise, knowbe4, ninjaone, paylocity, spanning, threatlocker, vanta). `plugins/atlas/mcp/` went from 31 MB to 4.3 MB.
- `plugins/atlas/.mcp.json`: all 10 entries rewired from `bash .../launch.sh` to `command: "node"`, `args: ["--import", "${CLAUDE_PLUGIN_ROOT}/mcp/_env/load.mjs", "${CLAUDE_PLUGIN_ROOT}/mcp/<key>/server.mjs"]` (e.g. `plugins/atlas/.mcp.json:99-105` for ninjaone).
- Added `plugins/atlas/mcp/_env/load.mjs`, a dependency-free ESM preloader: loads `ATLAS_ENV_FILE` (default `${CLAUDE_PLUGIN_ROOT}/.env`) with override semantics, then promotes `CFG_<NAME>` to `<NAME>` only when `<NAME>` is unset, non-empty, and not an unexpanded `${...}` literal (`load.mjs:5-34`). Never writes to stdout, since stdout is reserved for JSON-RPC. `.env` now takes precedence over the plugin's `userConfig` Keychain values (which remain as fallback), because node's `--env-file` does not override variables already present in the environment, so `userConfig` would otherwise always win. Added `plugins/atlas/.env.example` covering all 40 credential variables, commented, no values.
- `.gitignore:307-314`: added `!plugins/atlas/mcp/` + `!plugins/atlas/mcp/**` (re-included after the generic `dist/`/`node_modules/` excludes) so the bundles actually ship; `plugins/atlas/.env` explicitly re-excluded at `.gitignore:339-340`, `.env.example` stays tracked. `*.mcpb` rule retained.
- Marketplace metadata: removed the stray root `marketplace.json`, which duplicated all 3 plugins and produced 6 cards for 3 plugins in the plugin browser. `plugins/programmer/.claude-plugin/plugin.json:5` author corrected `"Jerry"` -> `"w159"`. Corrected stale counts in `.claude-plugin/marketplace.json:4,13`: "22 plainly named skills" -> 20, "16 task skills" -> 14.

Known limitation, recorded honestly: Claude Code has no per-MCP-server enable/disable, only plugin-level `defaultEnabled` (`plugins-reference.md:509-518`). All 10 servers load together; those without credentials sit in a reduced diagnostic mode.

Evidence (independently verified by a fresh-context verifier): all 10 servers complete an MCP initialize handshake and return `tools/list` (auvik-mcp 0.4.2, 39 tools; blumira-mcp 1.1.5, 2 credential-gated; cipp-mcp 0.2.2, 43; connectwise-manage-mcp 1.5.2, 2 without credentials / 52 with; kaseya-spanning-backup-mcp 1.1.3, 14; mcp-server-knowbe4 1.1.2, 30; ninjaone-mcp 1.6.2, 26; paylocity-mcp 0.1.4, 16; threatlocker-mcp 1.3.0, 18; vanta-mcp 0.2.3, 28), all exit cleanly. `ninjaone/server.mjs` copied alone into an empty temp dir ran and returned its full 26-tool list with no `node_modules` present. All 10 bundles confirmed git-addable; `plugins/atlas/.env` confirmed ignored. 40 `userConfig` keys reconcile exactly across `plugin.json`, `.mcp.json`, and `.env.example` with none renamed, dropped, or orphaned. Credential precedence verified in all four cases (`.env` beats `CFG_`, `CFG_` used when `.env` omits, unexpanded `${user_config.x}` not promoted, empty `CFG_` not promoted). Preloader stdout-safety verified against malformed input, a missing file, and a directory passed instead of a file: zero stdout bytes in every case, never throws.

Not yet verified: this has not been proven working from an installed plugin cache, since that requires this commit to be pushed first.

---

## 2026-07-29 -- Marketplace renamed atlas -> tech-tools (repo rename follow-up)

The GitHub repo was renamed from `w159/atlas` to `w159/tech-tools` (confirmed via `gh api repos/w159/atlas -q .full_name` returning `w159/tech-tools`, the old URL now a live redirect). This is a naming-inconsistency fix, not the "marketplace source mismatch" the 2026-07-28 entry and ROADMAP had guessed at: `atlas_doctor.py` derives its expected repo straight from the `atlas` plugin's own `repository` field in `plugin.json`, and that field still read the pre-rename URL.

- Marketplace catalog name changed `atlas` -> `tech-tools` in `.claude-plugin/marketplace.json:3`. Plugin references now read `atlas@tech-tools`, `programmer@tech-tools`, `armada@tech-tools`. The two Kimi-schema catalogs (`marketplace.json`, `.kimi-plugin/marketplace.json`) have no top-level marketplace name field to change (schema `"version": "2"`, `id`/`displayName`/`source` per plugin); their per-plugin `source` URLs were repointed from `w159/atlas` to `w159/tech-tools`.
- Plugin identities are unchanged: `atlas`, `programmer`, and `armada` still each carry `"name": "<plugin>"` in their own `plugin.json` / Kimi manifest. Only the `repository` and `homepage` URLs in all six plugin manifests (`.claude-plugin/plugin.json` and `.kimi-plugin/plugin.json` for each of the three plugins), the two armada `department-config.json` files (security-compliance, microsoft-365), and doc links in `README.md` / `plugins/README.md` were repointed to `github.com/w159/tech-tools`.
- `plugins/atlas/scripts/atlas_doctor.py`: added `LEGACY_REPO_ALIAS = "w159/atlas"`; the `marketplace-source` check now accepts either the current `expected_repo` (derived from the plugin's own `repository` field, now `w159/tech-tools`) or the legacy pre-rename URL, since GitHub's redirect means an unmigrated install is not actually broken. Still a warning-only check in `--hook` mode, never a hard failure. New test: `test_legacy_pre_rename_repo_url_accepted_as_marketplace_source` in `test_atlas_doctor.py`.
- Corrects `docs/ROADMAP.md`: the open item describing this as an `atlas_doctor` "marketplace-source repair" / mismatch has been resolved and removed from Backlog; it was this same naming inconsistency, not a fork or a real source-of-truth problem.

Evidence: `python3 -m pytest plugins/atlas/scripts/test_atlas_doctor.py -q` -> 36 passed. Every `*.json` file in the repo still parses (`python3 -c "import json,glob; [json.load(open(f)) for f in glob.glob('**/*.json', recursive=True) if '.git' not in f and 'node_modules' not in f]"`).

---

## 2026-07-28 -- atlas 5.2.0: shared Stop-hook guard module with a session circuit breaker

The point fix earlier this date (`ab67df4`) patched `memory_capture.py` directly. The user pushed back that this was insufficient: the invariant "a Stop hook must not re-emit identical feedback forever" was still hand-implemented inconsistently across five hooks, and any new hook would inherit nothing. This release is the structural answer: one shared module plus a session-wide circuit breaker that can see the Stop chain thrashing as a whole, which no per-hook throttle can do.

- New module `plugins/atlas/scripts/atlas_hook_guard.py` (about 218 lines). API: `read_payload()`, `should_run(payload, hook_name, window_seconds=None)`, `emit(payload, hook_name, message)`. Per-session JSON state at `~/.atlas/hookstate/<session_id>.json`, overridable via `ATLAS_HOOKSTATE_DIR` for tests. Tracks `last_run` per hook, `stop_events` for the breaker, and emitted message hashes (sha256, first 16 hex chars).
- Circuit breaker: `STOP_BURST_LIMIT = 5`, `STOP_BURST_WINDOW = 120` seconds. More than 5 Stop events inside 120 seconds trips it for the rest of the session, silencing every atlas Stop hook. Writes one line to stderr, never stdout (stdout output would itself become hook feedback and could re-enter the loop it is meant to stop).
- All five Stop hooks rewired to the guard, each keeping its previous throttle window now expressed through it: `nudge.py` 900s, `auto_skill.py` 600s, `memory_capture.py` 900s; `ingest_session.py` and `completion_gate.py` carry no throttle of their own (breaker only).
- Design decision: `completion_gate.py` uses `should_run()` only, not `emit()`. Its definition-of-done block message is meant to repeat identically every Stop until the conditions are actually met; content-hash dedupe would silently defeat the gate. Only the breaker can silence it. Verified: three consecutive subprocess calls returned the identical block; a 7-call burst silenced it at call 6 via the breaker.
- `memory_capture.py` keeps its separate fact-level seen-marker (`~/.atlas/.memory_capture_seen`) unchanged. That marker is about facts; the guard's dedupe is about messages. Two different mechanisms, both retained deliberately.
- Version bumped 5.1.1 -> 5.2.0 in `plugins/atlas/.claude-plugin/plugin.json:3` and `plugins/atlas/.kimi-plugin/plugin.json:3` (minor bump: new capability plus a bug fix, no breaking change). No marketplace manifest carries a per-plugin atlas version (`.claude-plugin/marketplace.json` entries hold only name, source, description, category, keywords; the Kimi registries hold only id, displayName, source), so those two plugin manifests are the entire version surface. The registry's own `3.1.0` in `.claude-plugin/marketplace.json` is unrelated and was correctly left alone.

Evidence: 23 passed in `test_atlas_hook_guard.py`; 129 passed across the five wired hook suites; 562 passed in `plugins/atlas/scripts`; 427 passed in `plugins/atlas/hooks`; ruff clean on all touched files. Incident replay end to end against the real `memory_capture.py` hook, same session, 4 calls about 1 second apart: call 1 emitted `additionalContext`, calls 2, 3, and 4 emitted nothing, exit 0 throughout. Breaker probe on a 13-second cadence: allowed, allowed, allowed, allowed, allowed, then blocked at Stop 6 (t=65s); after tripping, `should_run` returned False for all five hook names. Breaker probe on a legitimate slow cadence, 5 Stops over 10 minutes: never trips. Breaker is per-session: tripping session A does not silence session B. Fail-open held under ten adversarial probes, including corrupt JSON state, the state path being a directory, a chmod 000 state dir, malformed stdin, a missing `session_id`, and a poisoned schema; no exception escaped any of them.

Known pre-existing operational issue, not introduced by this work: `atlas_doctor.py` reports the plugin's marketplace source pointing at `w159/tech-tools` where it expects `w159/atlas`. See ROADMAP.

---

## 2026-07-28 -- Fixed endless Stop-hook self-improvement loop that burned a usage limit

A Claude Code session entered an endless Stop-hook loop: every turn re-emitted "[atlas] Self-improvement: captured 1 memory fact(s) and 0 project fact(s) from this session..." roughly every 13 seconds until the usage limit was exhausted. Root cause was two-fold: `memory_capture.py` had no loop guard and its per-cwd fact string defeated its own dedupe, and `session_ingest.py`'s signal detector could promote the hooks' own announcement text into a durable `user_correction` signal, which then kept `_should_capture()` returning true forever.

- `plugins/atlas/hooks/memory_capture.py`: added the `stop_hook_active` early-exit guard (`memory_capture.py:316-317`), mirroring the existing pattern at `plugins/atlas/hooks/completion_gate.py:319-320`. The same guard was added to `plugins/atlas/hooks/ingest_session.py:25`, `plugins/atlas/hooks/auto_skill.py:69`, and `plugins/atlas/hooks/nudge.py:90` -- previously only `completion_gate.py` checked this payload flag.
- `memory_capture.py`: replaced the per-cwd formatted-string dedupe with a content-hash seen-marker. `_hash_key()` (`memory_capture.py:60`) hashes the raw signal snippet, not the per-cwd formatted fact string, so a varying subagent working-directory label can no longer defeat the dedupe. The seen-hash set is persisted at `~/.atlas/.memory_capture_seen` and loaded before any output is built (`memory_capture.py:357`), so a fully-deduped batch now exits silently.
- `memory_capture.py`: added a 900-second throttle (`CAPTURE_WINDOW_SECONDS`, `memory_capture.py:25,44`) with a marker file at `~/.atlas/.atlas_memory_capture`, mirroring `nudge.py`'s existing throttle pattern. The `ATLAS_MEMORY_CAPTURE=off` kill switch is unchanged.
- `plugins/atlas/scripts/session_ingest.py`: `detect_signals()` previously ran its CORRECTION/ADMISSION regexes against any user-role transcript text with no filter, so the hooks' own output could be promoted into a durable `user_correction` signal (the CORRECTION regex matches "you never...", and the hooks emit "You NEVER edit the target codebase yourself"). Added `MACHINE_MARKERS` and `_is_machine_authored()`; `detect_signals()` now returns no signal for machine-authored text. Known accepted cost: this is a wholesale suppression -- a genuine human correction that shares a message with pasted hook output is a false negative.
- Test coverage: `python3 -m pytest plugins/atlas/hooks/test_memory_capture.py plugins/atlas/hooks/test_ingest_session.py plugins/atlas/hooks/test_auto_skill.py plugins/atlas/hooks/test_nudge.py -q` -> 84 passed (confirmed by direct run: memory_capture 30, ingest_session 15, auto_skill 10, nudge 29). New `MemoryCaptureLoopGuardTest` (`test_memory_capture.py:611`) fails against pre-fix code. Live subprocess proof: first hook invocation emits `hookSpecificOutput.additionalContext`, an identical second invocation emits nothing, exit 0. `session_ingest` fix: 94 passed; 3 of 4 new tests fail against pre-fix code; the real incident announcement string now yields `[]` from `detect_signals()`.

`plugins/atlas/scripts/session_ingest.py`: `_is_machine_authored()`'s substring match on the `[atlas]` marker also swallowed ordinary human prose that happened to contain it (for example "the [atlas] plugin is broken, you never verified the fix"). Narrowed to a per-line, start-anchored check: `any(line.lstrip().startswith("[atlas]") for line in text.splitlines())`. `"[atlas]"` was removed from the substring-anywhere `MACHINE_MARKERS` tuple, which now holds only `"hook feedback:"` and `"Self-improvement: captured"`. `NOISE_PREFIXES` and `_is_real_prompt` were untouched. Diff: 45 insertions, 0 deletions. Evidence: 97 passed in `test_session_ingest.py`, ruff clean, the four pre-existing filter tests still pass unmodified. Verifier probe confirmed real hook output still suppressed in five forms (plain, indented, buried on line 3, "Stop hook feedback:" prefixed, last line with no trailing newline), and confirmed genuine human prose naming the plugin now correctly mints a `user_correction` again; prefixes such as `[atlas-orchestrate]` and `[atlassian]` are correctly not suppressed because the anchor requires the closing bracket.

`plugins/atlas/scripts/session_ingest.py`: the line-start anchor above was still defeated by markdown-blockquoted hook output, since `lstrip()` strips whitespace but not markdown quote markers (a line like `> [atlas] Definition-of-done gate: ... you never ran the tests` was not suppressed). Fixed by adding `_QUOTE_PREFIX = re.compile(r"^[\s>]*")` and a helper `_strip_quote_prefix(line)` (`session_ingest.py:157-165`); `_is_machine_authored()` now applies `_strip_quote_prefix(line).startswith("[atlas]")` instead of `line.lstrip().startswith("[atlas]")` (`session_ingest.py:179-182`). The docstring was corrected so it no longer overclaims what is caught. `MACHINE_MARKERS` behavior, `NOISE_PREFIXES`, `_is_real_prompt`, and the `detect_signals` call site were untouched; `NOISE_PREFIXES` and `_is_real_prompt` confirmed byte-identical to HEAD. Diff: 66 insertions, 0 deletions. Pre-fix reproduction confirmed the bug (`detect_signals` returned `[('user_correction', 1.5, '> [atlas] Definition-of-done gate: ...')]`); post-fix it returns `[]`. Evidence: 101 passed in `test_session_ingest.py`, ruff clean. Adversarial verifier probe: all blockquote forms suppressed (`>`, `>>`, `> >`, leading whitespace then `>`, `>` with no space, hook line buried on line 3 of a blockquoted paste, and the full real incident string); genuine human corrections still fire, including the two closest calls, "> means greater than, and you never explained that" and "> atlas plugin you never ran the tests" (no brackets); a 2000-space, 5000-char line caused no crash or slowdown since the anchored `[\s>]*` does not backtrack. Verifier closing verdict: the blockquote gap is closed without opening a false-positive hole.

Accepted trade-off, by design, pre-dating this fix: suppression in `_is_machine_authored()` is wholesale. Any message containing a machine marker anywhere is suppressed entirely, so a genuine human correction that shares a message with pasted hook output is a false negative. This is deliberate, pinned by `test_correction_wholesale_suppressed_when_sharing_a_message_with_hook_output`, and was judged cheaper than a signal that never expires.

---

## 2026-07-22 -- Kimi marketplace installation fixed: all 3 plugins now installable

Fixed Kimi marketplace installation by adding missing `.kimi-plugin/plugin.json` manifests for armada and programmer plugins, and adding repo root `kimi.plugin.json` and `.kimi-plugin/marketplace.json` with GitHub source URLs.

- Added `plugins/armada/.kimi-plugin/plugin.json` (v1.0.0) - Armada org deployment plugin manifest
- Added `plugins/programmer/.kimi-plugin/plugin.json` (v0.1.0) - Programmer plugin manifest  
- Added root `kimi.plugin.json` (v2) listing all 3 plugins with local paths: `./plugins/atlas`, `./plugins/armada`, `./plugins/programmer`
- Added `.kimi-plugin/marketplace.json` with GitHub URLs for all 3 plugins: `https://github.com/w159/atlas/tree/main/plugins/atlas`, `https://github.com/w159/atlas/tree/main/plugins/armada`, `https://github.com/w159/atlas/tree/main/plugins/programmer`
- Root `marketplace.json` also updated with GitHub URLs (was using local paths)
- All 3 plugins (atlas v5.1.1, armada v1.0.0, programmer v0.1.0) now installable via Kimi marketplace

Evidence: `kimi.plugin.json:1-8`, `.kimi-plugin/marketplace.json:1-8`, `marketplace.json:1-8`, `plugins/armada/.kimi-plugin/plugin.json:1-11`, `plugins/programmer/.kimi-plugin/plugin.json:1-11`

---

## 2026-07-21 -- README updated with accurate inventory and marketplace 3.1.0

Documentation sync: README.md updated to reflect real skill and plugin counts, marketplace version bump, and structural additions.

- Corrected skill count: 22 → 20 (README.md:16, 37, 164). Two skills were consolidated or removed in the v5.1.1 plugin release but README had not been synced.
- Bumped marketplace catalog version: 3.0.0 → 3.1.0 (README.md:19-20, 27, 382).
- Corrected plugin manifest file path reference: `plugins/atlas/.claude-plugin/plugin.json:3` → `:2` (README.md:19).
- Added marketplace catalog path reference: `.claude-plugin/marketplace.json:5` (README.md:20).
- Added "Other plugins in this marketplace" section (README.md:300-321) documenting the three plugins now shipped in the unified catalog:
  - `atlas` (v5.1.1) - core agent and skill framework
  - `armada` (v1.0.0) - organizational deployment (11 departments, 156 skills)
  - `programmer` (v0.1.0) - Pragmatic Programmer auditor with 2 skills and 89-concept glossary
- Updated quickstart instructions to name all three plugins in the marketplace listing (README.md:76-84).
- Added "Prerequisites and configuration" clarification that `programmer` is optional and independent (README.md:424-426).
- Fixed repository layout tree: added `programmer/` to plugin section (README.md:396).
- Fixed malformed closing `</div>` tag (README.md:473).

---

## 2026-07-21 -- Added `programmer` plugin (Pragmatic Programmer auditor) to the marketplace

Moved the standalone `pragmatic-programmer` plugin into the `atlas` marketplace as a new plugin named `programmer`, with skills namespaced `tpp-*`.

- New plugin at `plugins/programmer/`: 2 skills (`tpp-audit`, `tpp-principles`, renamed from `pragmatic-audit`/`pragmatic-principles`), 1 agent (`tpp-auditor`, renamed from `pragmatic-auditor`), 1 UserPromptSubmit hook, and an 89-concept glossary under `skills/tpp-principles/references/concepts/`.
- Renamed internal cross-references throughout `agents/tpp-auditor.md`, `skills/tpp-audit/SKILL.md`, `skills/tpp-audit/references/dimensions.md`, `README.md`, and `LICENSE` to match the new `tpp-*` naming.
- Registered `programmer` in `.claude-plugin/marketplace.json`: version `3.0.0` → `3.1.0`, plugin added with `source: ./plugins/programmer`, `category: developer-tools`.
- Verified by two independent `atlas:verifier` passes: first pass REFUTED on a stale `LICENSE:3` path reference (`skills/pragmatic-principles/references/concepts/` → `skills/tpp-principles/references/concepts/`); fixed and re-verified CONFIRMED on all 9 checks. Full evidence: `.atlas/evidence/2026-07-21-programmer-plugin-move.md`.

---

## 2026-07-21 -- Removed atlas-m365 and atlas-vendor-assessment skills

Deleted two unused auto-trigger skills from the atlas plugin: `plugins/atlas/skills/atlas-m365/` and `plugins/atlas/skills/atlas-vendor-assessment/`, including their SKILL.md and references. Neither had callers; `atlas-m365` overlapped with armada's own M365 coverage, `atlas-vendor-assessment` was a niche security-evaluation skill.

- Atlas plugin skill count: 22 → 20 (16 → 14 task skills). Verified via `plugins/atlas/skills/atlas-setup/scripts/plugin-health.py plugins/atlas` → `skills: actual=20, PASS`.
- Updated: `plugins/atlas/README.md`, `plugins/atlas/.claude-plugin/plugin.json` (description), `plugins/atlas/skills/atlas/SKILL.md`, `plugins/atlas/skills/atlas-setup/SKILL.md`, `plugins/atlas/skills/atlas-setup/references/manual-vs-auto-map.md`, `plugins/atlas/skills/atlas-setup/references/skill-routing.md`, `plugins/atlas/skills/atlas-setup/templates/reference_files/README.md`, root `README.md`.
- Full record: `.atlas/findings/2026-07-21-remove-m365-vendor-assessment.md`.

---

## 2026-07-17 -- Residual Dependabot alerts cleared, mcp_servers/_shared restored, commit adace06

Follow-up to the 711fb10 remediation below. Closes both defects that entry tracked as out
of scope, plus the minimatch ReDoS residual, via a simpler path than originally planned.

- Restored `mcp_servers/_shared/` (deleted by `56d1a9f`, 9 files: `error-envelope.ts`,
  `response-shaper.ts`, `base-url.ts`, `annotate-tool.ts`, `pack-mcpb.js`, `package.json`,
  `tsconfig.json`, `ADOPTION.md`, `__tests__/response-quality.test.ts`). The `@shared/*`
  imports in `mcp_servers/threatlocker-mcp/src/domains/_helpers.ts:15,21,26` (same pattern
  in `blumira-mcp` and `vanta-mcp`) now resolve; `npm run build` verified passing in each of
  the three previously-broken servers. Resolves ROADMAP item "Bug: blumira-mcp,
  threatlocker-mcp, vanta-mcp fail to build."
- Added npm `overrides` across all 17 `mcp_servers/*` and `mcp_node/*` projects:
  - `esbuild ^0.28.1` - clears the dev-only esbuild low left over from 711fb10, repo-wide
    (e.g. `mcp_servers/blumira-mcp/package.json`, `mcp_node/node-blumira/package.json`).
  - `minimatch ^3.1.2` (resolves to 3.1.5) - clears the ReDoS high in
    `connectwise-manage-mcp`, `knowbe4-mcp`, `ninjaone-mcp`, and `cipp-mcp` without the
    eslint-9 / `@typescript-eslint` 8 migration the 711fb10 entry and ROADMAP originally
    called for (`mcp_servers/connectwise-manage-mcp/package.json`,
    `mcp_servers/cipp-mcp/package.json`). Resolves ROADMAP item "Tech debt: eslint 9 /
    @typescript-eslint 8 migration to clear minimatch ReDoS residual" by pinning the
    transitive instead of the major-version migration.
  - `tmp ^0.2.4` - clears the `cipp-mcp` / `blumira-mcp` `tmp` advisory pulled in via
    `@anthropic-ai/mcpb` (`mcp_servers/cipp-mcp/package.json`,
    `mcp_servers/blumira-mcp/package.json`).
- Result: every one of the 17 projects now reports `npm audit` = 0 vulnerabilities. No
  source edits beyond the `_shared` restore; `node_modules` symlink convention preserved.
- Not fixed here, remains open in ROADMAP: the vitest 4 / `node_modules.nosync.noindex`
  symlink test-glob issue (unrelated to dependency pins or the `_shared` restore).

---

## 2026-07-17 -- Dependency remediation: 17 Node MCP projects (Dependabot), commit 711fb10

Remediated GitHub Dependabot alerts across 10 `mcp_servers/*` and 7 `mcp_node/*`
Node projects. Baseline before this commit: 344 open alerts (16 critical, 82 high,
199 medium, 47 low). Two changes only, `package.json` + `package-lock.json` per
project; no source files touched (`git show --stat 711fb10`, 32 files changed,
27872 insertions(+), 86960 deletions(-)):

- Removed unused `semantic-release` + `@semantic-release/*` dev tooling from every
  project that carried it. No `.github/workflows` in this repo invokes it; its
  bundled npm dragged in vulnerable `sigstore`, `tar`, `handlebars`, and
  `minimatch` transitively.
- Bumped `vitest` from 1.x/2.x to `4.1.10` in projects with real tests (clears the
  critical vitest advisory plus the vulnerable `vite`/`esbuild` chain it pulled
  in); dropped `vitest` entirely from projects with no tests.
- Runtime dependencies re-resolved in-range via clean lockfile regeneration.

Result: per-project `npm audit` after the change drops to 1 low (residual
dev-only `esbuild` advisory `GHSA-g7r4-m6w7-qqqr`) for most projects. Verified
residual exceptions, confirmed by `npm audit` on 2026-07-17:
- `connectwise-manage-mcp`, `knowbe4-mcp`, `ninjaone-mcp`: 6 high each, a
  `minimatch` ReDoS chain via `@typescript-eslint/eslint-plugin` `^6`
  (`@typescript-eslint/utils` 6.16.0-7.5.0) - needs an eslint 9 /
  `@typescript-eslint` 8 major migration to clear (tracked in ROADMAP).
- `cipp-mcp`: 11 vulnerabilities (4 low, 7 high) via `@inquirer/prompts` <=6.0.1
  pulled in by `@anthropic-ai/mcpb`.
- `blumira-mcp`: 6 vulnerabilities (5 low, 1 high), same `@anthropic-ai/mcpb`
  chain.

Two pre-existing defects were found during verification and are explicitly out
of scope for this remediation (not fixed here, tracked in ROADMAP):
1. `mcp_servers/_shared/` was deleted in commit `56d1a9f` and never restored.
   `blumira-mcp`, `threatlocker-mcp`, and `vanta-mcp` still import `@shared/*`
   (e.g. `mcp_servers/threatlocker-mcp/src/domains/_helpers.ts:15,21,26`) with no
   local fallback, so `npm run build` fails for all three (reproduced:
   `cd mcp_servers/threatlocker-mcp && npm run build` -> esbuild "Could not
   resolve ... mcp_servers/_shared/response-shaper.js" and 2 more, 3 errors).
2. `vitest` 4's default file glob follows the `node_modules ->
   node_modules.nosync.noindex` symlink convention used in this repo and picks
   up test files belonging to vendored packages inside it. Reproduced:
   `cd mcp_servers/threatlocker-mcp && npm test -- --run` -> 15 of 184 test files
   fail, all under `node_modules.nosync.noindex/zod/...` and
   `node_modules.nosync.noindex/node-threatlocker/...`
   (`mcp_servers/threatlocker-mcp/vitest.config.ts` has no `exclude` override).

---

## 2026-07-17 -- Full audit remediation and marketplace truth pass (v5.1.1)

Follow-up to the entry below: the remaining defects in
`atlas-audit-2026-07-17.md` were reproduced, fixed, and verified
(972 passed, 0 failed). Root `SKILL.md` moved to `skills/atlas/`
(the root file never loaded; /atlas now works), skill factory output
redirected to `~/.claude/skills/`, trigger flags reconciled
(22 skills: 2 manual, 20 auto), CLI exit codes hardened, prompt-optimizer
timeout wired, and every stale count/version/path in README.md,
plugins/README.md, plugin manifests, and atlas-setup references corrected.
Audit-review verdicts recorded in `atlas-audit-2026-07-17-review.md`.
Detail: `plugins/atlas/CHANGELOG.md` 5.1.1.

---

## 2026-07-17 -- Security/correctness remediation from atlas-audit CODE 2026-07-17

Findings from `docs/audits/atlas-audit-2026-07-17/report.md` (baseline: 967 tests passing).
Verified: `python3 -m pytest plugins/atlas/ -q` -> 973 passed, 8 subtests passed.

**Hook contract fix (H1-H4):** `additionalContext` was emitted as a bare top-level JSON key,
which Claude Code drops silently; report H1 traced this to
`test_session_boot.py` asserting on `data["additionalContext"]` at top level instead of the
real contract shape (report.md:40). Now nested under `hookSpecificOutput` with the firing
`hookEventName`, restoring the SessionStart injection path:
- `plugins/atlas/hooks/session_boot.py:419-421` (`hookEventName: "SessionStart"`)
- `plugins/atlas/hooks/auto_skill.py:86`
- `plugins/atlas/hooks/memory_capture.py:291`
- `plugins/atlas/hooks/nudge.py:137`
- `plugins/atlas/hooks/test_session_boot.py` (19 assertions across the file rewritten to read
  `data["hookSpecificOutput"]["additionalContext"]` / `["hookEventName"]`, e.g. line 92, 115)

**atlas_memory.py data-loss and injection fixes (H5-H6):**
- `_read_file` (`plugins/atlas/scripts/atlas_memory.py:99`) no longer swallows a read error
  and then overwrites the file on the next write.
- `add()` (`atlas_memory.py:189`) now runs entries through `_sanitize_entry`
  (`atlas_memory.py:121`, called at `atlas_memory.py:191` and in `apply_batch` at
  `atlas_memory.py:325,330`) to collapse newlines and strip control chars, closing a
  stored-prompt-injection path into `~/.atlas/memory/MEMORY.md` that SessionStart re-injects.
- Regression tests added in `plugins/atlas/scripts/test_atlas_memory.py` (67 insertions).

**Other CODE-audit fixes, each with a regression test in the suite above:**
- `atlas_context_optimizer.py` `disable_skill` (`plugins/atlas/scripts/atlas_context_optimizer.py:260`):
  fixed frontmatter corruption where the closing `---` was glued onto the last field,
  producing invalid YAML.
- `skill_factory.py` `_build_skill_md` (`plugins/atlas/scripts/skill_factory.py:76`): the
  `description` field is now escaped via `json.dumps` (comment at line 72) so an embedded
  quote cannot break the generated `SKILL.md` frontmatter.
- `atlas_curator.py` `_skill_activity_time` (`plugins/atlas/scripts/atlas_curator.py:103`):
  now skips the curator's own `.stale`/`.pinned` marker files
  (`CURATOR_MARKER_FILES` at `atlas_curator.py:39`), fixing an infinite
  mark-stale/reactivate oscillation that had prevented the 90-day archive path from ever
  firing.
- `prompt_optimizer.py`: env ints/floats now parsed defensively via `_env_num`
  (`plugins/atlas/hooks/prompt_optimizer.py:80-84`) so a non-numeric env value falls back to
  the default instead of crashing the never-block hook; the CSI regex
  (`prompt_optimizer.py:68`) was broadened from `[0-9]*` to `[0-9;]*` so multi-param ANSI
  color codes (e.g. `38;5;108m`) are matched and stripped instead of leaking into cleaned
  text, with a matching `try`/`except` guard at `prompt_optimizer.py:103-106`.

**Build break fix:** commit `56d1a9f` deleted the top-level `mcp_servers/_shared/`
(`error-envelope.ts`, `response-shaper.ts`, `base-url.ts`, etc.), leaving `auvik-mcp`'s
imports at `mcp_servers/auvik-mcp/src/tools/shared.ts:12,17` and
`mcp_servers/auvik-mcp/src/tools/status.ts:5` dangling. Restored a per-server
`mcp_servers/auvik-mcp/src/_shared/` (`base-url.ts`, `response-shaper.ts`,
`error-envelope.ts`) and repointed the imports from `../../../_shared/...` to
`../_shared/...`, matching the per-server pattern already in use by
`connectwise-manage-mcp/src/_shared/` and `cipp-mcp/src/_shared/`.

## 2026-07-17 -- atlas canonical project structure: full scaffold/repair + enforcement across all surfaces

`atlas-setup` previously only seeded a handful of `docs/` and `.atlas/` subfolders and left
new/refreshed root files, `docs/api`, and several `.atlas/` subfolders (`decisions/`,
`understand-anything/`, `graphify/`, orientation `.atlas/CLAUDE.md`/`.atlas/AGENTS.md`) out of
scope, so repos scaffolded by an older run silently missed structure the rest of the fleet
(docs-curator, docs-auditor, session_boot advisory, atlas-gitignore) already assumed existed.
This change makes the canonical structure one definition, scaffolded/repaired idempotently, and
enforced consistently everywhere it is read.

- Canonical structure definition expanded and mirrored byte-identical in both docs-ssot
  references: root README/AGENTS/CLAUDE.md; project-adaptive `docs/` tree (base subfolders
  plus `docs/api` only when an API signal is detected); full `.atlas/` tree including dated
  `.atlas/findings/`, `.atlas/audits/`, `.atlas/decisions/`, `.atlas/archive/`,
  `.atlas/understand-anything/`, `.atlas/graphify/`, and orientation `.atlas/CLAUDE.md` +
  `.atlas/AGENTS.md`; the zero-trust `.gitignore` contract; learning-loop and
  tooling-activation sections.
  (`plugins/atlas/skills/atlas-loop/references/docs-ssot.md` (275 lines),
  `plugins/atlas/skills/atlas-orchestrate/references/docs-ssot.md` (275 lines, byte-identical
  mirror))
- `scaffold_docs.py` scaffolds and repairs the full tree idempotently: `DURABLE_ENTRIES`
  (`plugins/atlas/skills/atlas-setup/scripts/scaffold_docs.py:45`), `ATLAS_ENTRIES`
  (`scaffold_docs.py:90`), project-adaptive API detection via `detect_api()`
  (`scaffold_docs.py:331`, signals at `scaffold_docs.py:154-167`), and `.gitignore` seeding via
  `ensure_gitignore()` (`scaffold_docs.py:367`). New `templates/` dir at
  `plugins/atlas/skills/atlas-setup/templates/` (root README/AGENTS/CLAUDE.md, `docs/`,
  `.atlas/decisions/`, `.atlas/findings/`, `.atlas/graphify/`,
  `.atlas/understand-anything/`, `docs/api/`, `endpoints.md`). New
  `plugins/atlas/skills/atlas-setup/scripts/test_scaffold_docs.py` (207 lines, 13 tests, all
  passing); superseded the stale duplicate at `plugins/atlas/scripts/test_scaffold_docs.py`
  (deleted).
- `atlas-setup` `SKILL.md` (264 lines), `references/install.md` (154 lines), and
  `references/recommendation-engine.md` (154 lines) rewritten for full-structure onboarding,
  always-repair routing, structural-completeness recommendation, and tech-stack tooling
  activation (claude-mem, context-mode, ponytail, gate hooks) recorded to `.atlas/decisions/`.
- `docs-curator` agent now owns and enforces the structure: `.gitignore` hygiene
  (`plugins/atlas/agents/docs-curator.md:35`), structure-completeness check that recommends
  `atlas-setup` rather than silently inventing missing paths (`docs-curator.md:36`), archive
  discipline into `.atlas/archive/` (`docs-curator.md:37`), knowledge-graph refresh
  (`docs-curator.md:38`). `docs-auditor` agent (34 lines) is read-only and audits the full
  `.atlas/` structure completeness (`plugins/atlas/agents/docs-auditor.md:22`) and
  `.gitignore` zero-trust drift via `git check-ignore` outcomes (`docs-auditor.md:23`).
- `session_boot.py` SessionStart advisory now checks the full 25-path canonical set, advisory
  and non-blocking (`plugins/atlas/hooks/session_boot.py:185`).
- `atlas-gitignore` zero-trust seed allowlists the full `.atlas/` tree, including the
  un-ignore-parent-then-reignore-contents pattern for `.atlas/.run/` so only
  `.atlas/.run/findings.json` survives
  (`plugins/atlas/skills/atlas-gitignore/templates/gitignore.seed:107-145`); the validator
  checks structural pairing plus live `git check-ignore` outcomes against the docs-ssot path
  set (`plugins/atlas/skills/atlas-gitignore/scripts/validate_gitignore.sh:1-44`);
  `plugins/atlas/skills/atlas-gitignore/SKILL.md` (58 lines) updated to match.
- `atlas-orchestrate` references corrected to the `.atlas/` split layout: archive moves to
  `.atlas/archive/`, not `docs/archive/`
  (`plugins/atlas/skills/atlas-orchestrate/references/scaffolding.md:31-57`,
  `plugins/atlas/skills/atlas-orchestrate/references/session-lifecycle.md:22,68-90`).
- Root `AGENTS.md` Section 0 (`AGENTS.md:5-36`) states atlas/armada are products developed in
  this repo, not tools to run here; `plugins/README.md:3-6` points to it; new
  `docs/plugin-development-scope.md` (148 lines) records the scope rule in `docs/`.
- Regression fixed same-day: `plugins/atlas/skills/atlas-setup/SKILL.md:73` carried a dead
  `references/docs-ssot.md` link that failed `test_no_dangling_skill_references`; reworded to
  a descriptive pointer, restoring `test_skill_agent_conformance.py` to 13/13.

- This repo's own root `.gitignore` had drifted from the expanded contract above: it
  allowlisted only `.atlas/evidence/` and `.atlas/audits/` (`.gitignore:237-241` before this
  fix), so `.atlas/findings/`, `.atlas/decisions/`, `.atlas/archive/`,
  `.atlas/understand-anything/`, `.atlas/graphify/`, `.atlas/self-improvement/`,
  `.atlas/memory/`, `.atlas/nudge/`, `.atlas/CLAUDE.md`, and `.atlas/AGENTS.md` were all
  silently gitignored - `git check-ignore -q .atlas/findings/INDEX.md` returned rc=0
  (ignored) before the fix. Added the missing `!.atlas/<subfolder>/` + `!.atlas/<subfolder>/**`
  allowlist pairs (`.gitignore:237-259`, docs-curator `.gitignore` hygiene duty at
  `plugins/atlas/agents/docs-curator.md:35`). After the fix, `git check-ignore -q` on
  `.atlas/findings/INDEX.md` returns rc=1 (not ignored, tracked).

Verified: `python3 -m pytest plugins/atlas/skills/atlas-setup/scripts/test_scaffold_docs.py -q`
-> 13 passed; `python3 -m pytest plugins/atlas/hooks/test_session_boot.py -q` -> 33 passed;
`python3 -m pytest plugins/atlas/hooks/test_completion_gate.py -q` -> 53 passed;
`python3 -m pytest plugins/atlas/scripts/test_skill_agent_conformance.py -q` -> 13 passed.
Live proof in a scratch temp dir: `scaffold_docs.py <tmpdir>` produced "OK: full docs/ +
.atlas/ + root canonical structure is in place" (9/9 `docs/` entries, 11/11 `.atlas/` entries,
root files, seeded `.gitignore`); `git check-ignore -q` on the resulting repo confirmed
`docs/CHANGELOG.md` and `.atlas/findings/INDEX.md` are NOT ignored (rc=1),
`.atlas/.run/STATE.md` IS ignored (rc=0), and `.atlas/.run/findings.json` is NOT ignored
(rc=1, i.e. tracked) - the zero-trust contract behaves exactly as documented. The root
`.gitignore` fix above was confirmed the same way against the real repo (not the scratch
dir). Note: `bash plugins/atlas/skills/atlas-gitignore/scripts/validate_gitignore.sh
.gitignore` still FAILs on pre-existing, session-unrelated em dashes in `.gitignore` comment
prose - tracked as a new ROADMAP backlog item, not fixed here (out of scope for this
change). Independent verifier evidence for this change, including the same scratch-dir
proof and an idempotency re-run (second pass: zero `seeded:` lines, all `keep existing:`),
is recorded at `.atlas/evidence/2026-07-17-atlas-canonical-structure/verification.md`. One
pre-existing, unrelated test failure noted there
(`test_skill_factory.py::test_cli_auto`, KeyError on `created` with no DB) is out of scope:
`skill_factory.py` was not touched this session.

## 2026-07-16 -- atlas plugin 5.1.0: connector wiring repaired, path conventions unified

Full details and per-fix evidence: `plugins/atlas/CHANGELOG.md` (5.1.0 entry)
and `.atlas/evidence/2026-07-16-atlas-5.1.0-wiring-repair.md`.

- `plugins/atlas/.mcp.json` moved from `.claude-plugin/` to the plugin root so
  the manifest's `mcpServers: "./.mcp.json"` actually resolves; all 10
  connector servers were silently unregistered before this.
- Agent evidence writes (`ui-runtime-tester`, `db-prober`) redirected from
  `docs/evidence/` to `.atlas/evidence/` to match the completion gate.
- Operating-contract fallback in 14 skills anchored at
  `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md`.
- Deleted git-tracked legacy run markers `plugins/atlas/docs/.run/*.active`
  (pre-5.0 layout; made the completion gate grade the wrong root).
- Em dash sweep (18 lines), rename residue in atlas-launch/atlas-audit,
  absolute-path and unanchored-path fixes in atlas-wiki/atlas-db-audit,
  plugin CHANGELOG 5.1.0 entry added to match the manifest version.
- Verified: `python3 -m pytest hooks scripts -q` -> 960 passed; independent
  atlas:verifier pass recorded in `.atlas/.run/findings.json`.

## 2026-07-15 -- SSOT correction: atlas-internal content moved from docs/ to .atlas/

The previous `.atlas/docs/` → `docs/` refactor (2026-07-14) moved paths but left
atlas-internal content in `docs/` - the exact dual-SSOT problem it was supposed
to solve. This correction moves all atlas-internal content to `.atlas/` and
restores the correct split: `docs/` is the project wiki (CHANGELOG, ROADMAP,
dynamic subfolders including graphify results); `.atlas/` is atlas's auditable
self-improvement surface (evidence, audits, plans, specs, architecture, lessons,
wiki, nudge, self-improvement, memory, .run state).

- Moved `docs/audits/` → `.atlas/audits/` (2 audit trees, 29 files).
- Moved `docs/evidence/` → `.atlas/evidence/` (6 files, merged with existing 9).
- Moved `docs/lessons/` → `.atlas/lessons/` (1 file).
- Moved `docs/plans/` → `.atlas/plans/` (11 files).
- Moved `docs/specs/` → `.atlas/specs/` (1 file).
- Moved `docs/architecture/` → `.atlas/architecture/` (1 file).
- Moved `docs/superpowers/` → `.atlas/plans/` + `.atlas/specs/` (4 files).
- Deleted `docs/.run/` (stale, untracked; `.atlas/.run/` is the live location).
- Deleted `docs/self-improvement/` (empty).
- `docs/` now holds only: CHANGELOG.md, ROADMAP.md, AGENTS.md, README.md,
  standards/ (18 files). Vendored upstream clones (aider/, claude-code/, cline/,
  etc.) remain in docs/ pending a separate cleanup decision.
- Updated `scaffold_docs.py`: `ATLAS_ENTRIES` expanded from 3 to 11 subdirs
  (evidence, audits, plans, specs, architecture, lessons, wiki, nudge,
  self-improvement, memory, .run). `DURABLE_ENTRIES` remains minimal
  (CHANGELOG.md, ROADMAP.md) - the wiki grows dynamically.
- Rewrote `docs-ssot.md` (atlas-orchestrate + atlas-loop): new contract with
  correct split. docs/ = project wiki (dynamic); .atlas/ = self-improvement
  surface (auditable tracking, skill generation/disabling, subagent management).
- Updated `atlas-launch` SKILL.md + references: `docs/audits/` → `.atlas/audits/`.
- Updated `atlas-orchestrate` SKILL.md: `docs/plans/` → `.atlas/plans/`.
- Fixed 14 stale `.atlas/docs/` references in `.atlas/architecture/skills-mastery.md`
  and `.atlas/plans/skills-mastery-rebuild.md`.
- Added 4 new tests in `test_scaffold_docs.py`:
  `test_legacy_atlas_docs_with_only_run_marker_proceeds` (Bug 1 regression),
  `test_legacy_atlas_docs_empty_dir_proceeds`, `test_scaffold_creates_minimal_docs_and_full_atlas`,
  `test_no_atlas_internal_dirs_in_docs`.

## 2026-07-14 -- fix: flaky `test_orchestration_with_no_capture_nudges_to_capture` (test isolation)

- What changed: `plugins/atlas/hooks/test_nudge.py:115-124` now mocks
  `nudge._check_memory_captured` and `nudge._check_skill_created` to `False`
  around its `_run_main` call, matching the pattern already used in the three
  sibling tests below it in the same file.
- Why: the two `nudge.py` functions (`nudge.py:46-57`, `:60-75`) read real
  global state under `~/.atlas/memory/MEMORY.md` and `~/.atlas/skills/*/SKILL.md`.
  Any process touching either within 60 seconds (e.g. `auto_skill.py`'s
  skill-factory) flipped this test's "nudge to capture" assertions to fail.
  `nudge.py` itself was not modified -- test-only fix.
- Evidence: `.atlas/evidence/nudge-test-isolation-fix.md`. `pytest
  plugins/atlas/hooks/test_nudge.py -v` -> 29 passed; `pytest
  plugins/atlas/hooks/ -q` -> 428 passed, 8 subtests passed. Independent
  `atlas:verifier` reproduced the original failure via `git stash` against a
  faked `~/.atlas/skills/__verify_tmp_skill__/SKILL.md`, then confirmed the
  fix eliminates it. Verdict: verified (`.atlas/.run/findings.json`, batch
  `nudge-test-isolation-fix`).

## 2026-07-14 -- docs consolidation: `.atlas/docs/` retired, `docs/` is the sole project-documentation SSOT

`.atlas/docs/` and `docs/` had drifted into two independent, partially-overlapping copies
of CHANGELOG.md, ROADMAP.md, AGENTS.md, and the durable subfolders (architecture/, plans/,
specs/, features/, wiki/, reference_files/, lessons/) -- exactly the duplication this entry
closes. Per explicit instruction: `.atlas/` never contains a `docs/` subdirectory again;
project documentation, wiki, ROADMAP.md, and CHANGELOG.md live solely under `docs/` and its
subdirectories; `.atlas/` is reserved for atlas's own self-improvement, evidence, findings,
`.run/` state, audits, and coding-agent-relevant details.

- Moved: `.atlas/docs/architecture/skills-mastery.md` -> `docs/architecture/skills-mastery.md`;
  `.atlas/docs/plans/skills-mastery-rebuild.md` -> `docs/plans/skills-mastery-rebuild.md`.
- Relocated (atlas-internal, not project docs): `.atlas/docs/evidence/` -> `.atlas/evidence/`;
  `.atlas/docs/.run/` -> `.atlas/.run/`; `.atlas/docs/audits/` -> `.atlas/audits/`.
- Unique entries from `.atlas/docs/CHANGELOG.md` (2026-07-13, 2026-07-14) and
  `.atlas/docs/ROADMAP.md` (zero-defect-loop Z1-Z9, live item L1) merged below/into
  `docs/ROADMAP.md`; unique orientation sections (Stack, Architecture, Conventions, Commands)
  from `.atlas/docs/AGENTS.md` merged into `docs/AGENTS.md`.
- `.atlas/docs/` deleted entirely (was: AGENTS.md, CHANGELOG.md, ROADMAP.md, and 7
  boilerplate-only `README.md` placeholders under architecture/, audits/, features/, lessons/,
  plans/, reference_files/, specs/, wiki/ -- content-free, not migrated).
- Every `.atlas/docs/*` path reference across `plugins/atlas/skills/**` (SKILL.md files,
  `references/*.md`, `templates/*`) and `plugins/armada/skills/armada/references/org-config-schema.md`
  rewritten: durable/project paths now read `docs/*`; atlas-internal paths now read
  `.atlas/evidence/`, `.atlas/audits/`, `.atlas/.run/`.
- Evidence: `find .atlas -type d -name docs` -> empty (no `.atlas/**/docs/` directory exists);
  `grep -rl '\.atlas/docs' plugins .atlas docs README.md .gitignore` -> no matches outside
  historical CHANGELOG prose (append-only logs are not rewritten).
- Verdict: done -- directory structure and every live skill/reference path updated; independent
  verification pending a fresh `atlas:verifier` pass (see ROADMAP.md).

## 2026-07-14 -- atlas-orchestrate -- README.md self-contradiction fix: version-counter split and duplicate-SSOT claim clarified

- What changed: root README.md:26-32 added a clarifying paragraph after the marketplace/plugin
  version mentions, stating the marketplace wrapper version (`3.0.0`,
  `.claude-plugin/marketplace.json:3`) and the plugin version (`5.0.0`,
  `plugins/atlas/.claude-plugin/plugin.json:3`) are two independent counters bumped together
  in commit `ad7313c`, not a stale reference. This entry's own claim of a `.atlas/docs/` vs
  `docs/` split is superseded by the 2026-07-14 consolidation entry above: the two directories
  are no longer independent SSOTs, `docs/` is now the only one.
- Evidence: `cat .claude-plugin/marketplace.json` -> `"version": "3.0.0"`; `cat
  plugins/atlas/.claude-plugin/plugin.json` -> `"version": "5.0.0"`; `git log --oneline -1
  -S'"version": "3.0.0"' -- .claude-plugin/marketplace.json` -> `ad7313c` (same commit as the
  plugin's 5.0.0 bump, confirming two counters moved together, not drift).
- Verdict: done -- docs-only prose change, no source code touched.

## 2026-07-14 -- atlas:docs-curator -- README.md fleet section rewritten with detailed skills/agents/hooks/architecture tables

- What changed: root README.md:238-380 replaced the old thin skills-table/agent-list/hooks-prose
  under "## The atlas fleet" with four detailed tables sourced from an atlas:explorer inventory
  pass: 21 skills (Skill/Path/Description/When-to-Use), 12 agents
  (Agent/Role/Model/Color/Tool-Restrictions), hooks (Event/Handlers/Purpose/Evidence). Added a
  new "## Architecture & design principles" section: single-source-of-truth list, 5 key design
  laws, testing/quality-gate table, stack/commands table.
- Evidence: `grep -c "&amp;" README.md` -> `0` (no stray HTML-entity artifacts from the source
  inventory); `wc -l README.md` -> 428 lines (was 345 before the edit).
- Verdict: done -- docs-only/prose change, no source code touched.

## 2026-07-13 -- atlas:docs-curator -- zero-defect hardening complete: all batches verified, coverage 17%->98% hooks / 63%->99% scripts

- Final state (fresh gates this session): hooks `Ran 365 tests in 4.012s, OK`; scripts `Ran 502
  tests in 0.659s, OK` (867 total, up from 495). Coverage: hooks TOTAL 3962 63 98%; scripts
  TOTAL 6708 40 99%. `ruff check plugins/atlas/hooks plugins/atlas/scripts` -> `All checks
  passed!`. `npx pyright plugins/atlas/hooks plugins/atlas/scripts` -> `0 errors, 0 warnings,
  0 informations`. Coverage bars MET (lines/functions/branches/statements all >=85).
- Batches verified (findings.json: 14/14 "verified"): 1, 2a, 2b, 2c, lint-zero, 3a, 3b, 4
  (folded into 4a-1/4a-2/4b-1/4b-2), 4a-1 (6 zero-coverage hooks -> 96%), 4a-2 (4 partial hooks
  -> 97-100%), 4b-1 (5 lowest scripts -> 99-100%), 4b-2 (7 mid scripts -> 99-100%),
  pyright-cleanup (pyrightconfig.json extraPaths + 18 test errors cleared), dry-rounds (K=3
  consecutive clean + bars met).
- Batch 3a (frontmatter): 10 SKILL.md files fixed (missing closing `---`) and
  `test_valid_frontmatter` added. Evidence: `.atlas/evidence/batch-3a-verification.md`.
- Batch 3b (pyright types): `plugins/atlas/scripts/test_session_ingest.py:614` int-iterable,
  `plugins/atlas/scripts/verify_install_hooks.py:41-42` ModuleSpec|None,
  `plugins/atlas/scripts/atlas_db.py:656-658` Literal['agent'] resolved; pyrightconfig
  import-resolution added. Evidence: `.atlas/evidence/batch-3b-verification.md`.
- Batch 4a/4b (coverage): 4 false-green test files fixed (test_dispatch_tripwire, test_nudge,
  test_session_boot_db, test_prompt_classifier); tests added for previously untested
  hooks/scripts. Per-batch evidence: `.atlas/evidence/batch-4a-1/4a-2/4b-1/4b-2-verification.md`.
- pyright-cleanup: pyrightconfig.json extraPaths (atlas_db/scaffold_docs/atlas_memory
  import-resolution), 18 test errors cleared. Evidence:
  `.atlas/evidence/pyright-cleanup-verification.md`.
- Law 5 (verifier on every shipping change) enforced throughout: every batch closed by a fresh
  atlas:verifier pass captured in findings.json and the evidence files above.
- LIVE ACTION ITEM (not closed): the installed marketplace plugin (5.0.0) is stale vs this
  working tree. See ROADMAP.md.
- Verdict: done -- see ROADMAP.md for the still-open live action item.

## 2026-07-12 -- README rewrite follow-up: correct the 12-plugin catalog mismatch

The README rewritten in the v5.0.0 entry above still described a 12-plugin Claude Code
catalog that no longer matches the repo. The new README (344 lines) corrects four
load-bearing facts to match the on-disk state, supersedes the v5.0.0 README claim.

- The Claude Code marketplace lists 2 plugins (`atlas`, `armada`), not 12
  (`.claude-plugin/marketplace.json:8-29`).
- The Kimi manifest ships 12 plugins but does not list `armada`: it is `atlas` plus
  11 legacy domain clusters (`.kimi-plugin/marketplace.json:4-63`).
- The `mcp_servers/` directory has 11 entries: `_shared/` plus 10 vendor folders
  (Auvik, Blumira, CIPP, ConnectWise Manage, Kaseya Spanning, KnowBe4, NinjaOne,
  Paylocity, ThreatLocker, Vanta).
- The `plugins/` directory on disk holds 2 plugin folders (`atlas`, `armada`);
  the 11 Kimi-manifest entries reference legacy plugin folders that are not in
  the active Claude Code marketplace.

Caught by an atlas:completeness-critic sweep after the v5.0.0 README rewrite.
The new README is 344 lines and is not US-ASCII: it contains 21 em-dashes
(U+2014) on lines 66, 68, 70, 74, 81, 83, 87, 88, 90, 94, 97, 99, 101, 102,
220, 223, 226, 229, 234, 331, 333 (`README.md`, verified with `rg -n '[--]'`).
This supersedes the "Manifests made honest" line at `docs/CHANGELOG.md:26` of
the v5.0.0 entry. The earlier "343 lines, US-ASCII, 0 banned chars" claim in
this entry and the matching sub-bullet at `plugins/atlas/CHANGELOG.md:44` were
wrong; follow-up still needed to replace the 21 em-dashes per `writing-style.md`
and correct the plugin changelog sub-bullet.

---

## Atlas v5.0.0 -- skill consolidation: mythology retired, 21 plain names, armada split out, runtime-evidence gate (2026-07-12)

Driven by forensics on a 4.7-hour production session export (38 subagent
dispatches, exactly 1 skill auto-invocation, zero self-improvement actions):
the mythological names never routed, the fleet was 3x its working set, and
verifiers CONFIRMED changes the running app contradicted (backend gates ran
against in-memory SQLite while the dev DB sat at migration rev 129).

- Renames: atlas-metis -> atlas-orchestrate, atlas-chronos -> atlas-loop,
  atlas-odysseus -> atlas-ux-test.
- Merges: athena + ariadne + argus -> atlas-audit (code/architecture/self
  modes); olympus + hephaestus + hermes + doctor -> atlas-setup
  (onboard/install/connectors/repair modes). atlas-nestor deleted.
- armada moved to its own plugin (`plugins/armada`, v1.0.0) with the 11
  department agents; new marketplace entry; atlas keeps 12 core agents.
- Verifier doctrine: `verified` now requires runtime parity (live UI pass or
  migration-parity check), not just green suites; atlas-orchestrate's
  definition-of-done gained the same fourth condition, and Law 2 now forces
  worktree isolation or serialization for concurrent writers.
- Manifests, README, and setup references rewritten for the honest 21-skill
  inventory (`plugins/atlas/.claude-plugin/plugin.json:3` version 5.0.0).

## Atlas v4.0.0 -- skills mastery rebuild: 184-skill fleet rebuilt and verified (2026-07-11)

Full atlas skills mastery rebuild. The 184-skill fleet (28 top-level plus
156 armada across 11 departments) was rebuilt to the Claude Code Skills
Mastery Framework standard. 23 agents. 2 manual skills
(atlas-olympus, atlas-doctor, `disable-model-invocation: true`); the other
26 top-level are auto-trigger; all 156 armada are auto-trigger behind
atlas-armada. All 11 armada departments were rebuilt and independently
verified by fresh atlas:verifier passes (CONFIRMED each). S10 content
fixes (em-dash removal, manual-vs-auto-map 184/28, plugin.json 184
count) verified. Version 3.3.0 -> 4.0.0
(`plugins/atlas/.claude-plugin/plugin.json:3` version 4.0.0).

- Mastery framework standard applied to every skill: three-layer
  progressive disclosure (L1 metadata, L2 SKILL.md under 500 lines, L3
  references/scripts/templates loaded on demand). Authoritative spec at
  `plugins/atlas/skills/atlas-olympus/references/mastery-framework.md`.
- Gate flips: 2 manual, 26 auto. Verified by grep for
  `disable-model-invocation` across `plugins/atlas/skills/*/SKILL.md`
  (returns only atlas-doctor and atlas-olympus). The manual-vs-auto map
  at `plugins/atlas/skills/atlas-olympus/references/manual-vs-auto-map.md`
  lists 28 top-level (2 manual, 26 auto) and all 156 armada.
- atlas-wiki producer skill added (top-level now 28, total 184):
  `plugins/atlas/skills/atlas-wiki/SKILL.md` (198 lines, auto-trigger),
  ships `scripts/check_wiki_freshness.sh` (emits FRESH, MISSING, STALE).
- Inert `triggers:` field removed from all armada skills; keywords
  folded into `description` and `when_to_use`.
- S7 armada all 11 departments CONFIRMED: design, productivity, data,
  it-ops, support, finance, hr, security, engineering, m365, product.
- S10 content fixes verified: 3 security SKILL.md
  (audit-forensics, evidence-gap-hunter, framework-audit-readiness)
  gained L2 read-directive to `references/audit-rubric.md`; 5 engineering
  Sentry skills (sentry-api-patterns, sentry-issue-triage,
  sentry-error-investigation, sentry-release-health,
  sentry-seer-root-cause) had allowed-tools corrected to
  `mcp__io_github_getsentry_sentry-mcp__*` (real server key
  `io.github.getsentry/sentry-mcp`); manual-vs-auto-map updated to 28
  top-level; pre-existing em-dash at
  `metis/references/multi-stage-planning.md:79` replaced with ASCII.
- 9 reserved placeholder directories (advisory, not deleted): 3 hr
  (new-hire-flow, pay-rate-audit, roster-snapshot), 5 finance
  (ramp-api-patterns, ramp-bill-vendor-reconciliation,
  ramp-card-controls, ramp-reimbursement-review, ramp-spend-triage),
  1 engineering (sonarqube-quality-gate).
- Evidence: `.atlas/docs/.run/findings.json` (S1-S8 and S10 all status
  "verified"). See `plugins/atlas/CHANGELOG.md` 4.0.0 entry for the full
  per-wave breakdown.

## Atlas v3.1.3 -- close the rest of the Windows invalid-path class (2026-07-10)

An independent atlas:verifier (agentId a10e294b3d3b68c55) confirmed the 3.1.2 fix
line by line but flagged that the "fixes the root cause" framing was overstated:
the same defect was still live in three writers the 3.1.2 commit never touched.
3.1.3 closes them. Version 3.1.2 -> 3.1.3
(`plugins/atlas/.claude-plugin/plugin.json:3`).

- Canonical slug rule added to `atlas-metis/references/docs-ssot.md` "Naming
  conventions": one filesystem-safe algorithm (Windows-reserved set `< > : " / \
  | ? *`, reserved device names) covering every `<slug>`/`<id>`/`<scope>` the
  docs SSOT defines - `docs/plans/<slug>.md`, `docs/features/<feature-slug>.md`,
  `docs/runs/<id>/`, evidence dirs, ADRs, lessons. This is load-bearing for all
  atlas-metis output, so a raw `frontend:auth` task name flowing into a plan
  path would have reproduced the identical checkout failure.
- `atlas-chronos/SKILL.md` loop-creation (`loops/<id>.md`) and
  `session-lifecycle.md` run-archive (`docs/runs/<id>/`) now require a
  filesystem-safe id and point to the canonical rule.
- Verifier verdict recorded at `docs/.run/findings.json` (status verified),
  including the hole and its closure.

## Atlas v3.1.2 -- filesystem-safe audit filenames (2026-07-10)

atlas-ariadne and atlas-athena wrote per-feature and per-finding files from
raw, model-chosen names. When a name carried a colon (e.g.
`charts/frontend:public-site-and-auth.md`), Git on Windows rejected the entire
checkout with `error: invalid path`, blocking everyone from syncing the repo.
The generators now slug every filename before writing. Version 3.1.1 -> 3.1.2
(`plugins/atlas/.claude-plugin/plugin.json:3`); commit `940087e`.

- Slug rule added to `plugins/atlas/skills/atlas-ariadne/SKILL.md:84-95`
  ("Filename safety"): lowercase; replace any character outside `a-z 0-9 . _ -`
  (the Windows-reserved set `< > : " / \ | ? *` plus spaces) with `-`; collapse
  and trim; guard reserved device names and slug collisions. The human-readable
  name still heads the file, so nothing is lost.
- Inline reminders at both write points (`SKILL.md:40` charts, `:66` handoffs)
  plus slugged placeholders in the output tree.
- `plugins/atlas/skills/atlas-athena/SKILL.md:87` carries the matching constraint
  at its `handoffs/<finding-id>.md` write point (same latent exposure).
- `build_hub.py` ruled out as a source: it only reads existing handoff files via
  `os.listdir` (`build_hub.py:118`) and writes fixed names; the fix is in the
  orchestrator prompts, not the script.
- Observed-behavior proof: the documented slug rule applied to all seven real
  colon filenames from the git error produces Windows-valid, colon-free,
  collision-free names; edge-case guards (reserved device name, all-reserved
  string, whitespace-only) fire. Evidence:
  `docs/evidence/2026-07-10-cartographer-slug-fix.md`. Independently confirmed by
  atlas:verifier (`docs/.run/findings.json`).
- Scope: fixes the generator only. Files already committed to
  `gwh-firstrespondersapp` still need renaming (colon -> hyphen) from a
  macOS/Linux checkout; Windows cannot check that branch out to fix in place.

## Atlas v3.1.1 -- phase glyphs in the status header (2026-07-10)

The `ATLAS | <phase> | <state>` output-style header gained a per-phase emoji so
the current engine stage reads at a glance in the terminal
(`plugins/atlas/output-styles/atlas-orchestrator.md`). Scoped ASCII exception:
the eight header glyphs are permitted; prose stays emoji-free. Commit `a9ba716`.

## Atlas v3.1.0 -- enforcement teeth, fork doctrine, sextant multi-agent chronicle, de-overlap (2026-07-09)

Full overhaul of the atlas plugin as the load-bearing orchestration layer. Every
shipping change carries an independent atlas:verifier record in
`docs/.run/findings.json`; regression 115/115 tests green; version bumped
3.0.2 -> 3.1.0 (`plugins/atlas/.claude-plugin/plugin.json:3`).

- Arm-early classifier: `prompt_optimizer.py` now classifies each UserPromptSubmit
  and arms the orchestration flag for substantive engineering prompts (error
  signal / strong verb / common-verb-with-code-anchor tiers), injecting a one-line
  engine nudge; trivial prompts untouched; `ATLAS_ENGINE_ARM=off` escape
  (`plugins/atlas/hooks/prompt_optimizer.py:297-398`). Broke the chicken-and-egg
  where the flag was only ever set after a dispatch happened. Looped back once:
  the first verifier refuted the initial point-scoring design with conversational
  false positives; the two-tier rework re-verified clean with one accepted,
  documented residual (dual-use verbs like "audit"/"debug").
- Tripwire deny tier: `dispatch_tripwire.py` gains a PreToolUse path that denies
  the 9th undelegated inline op (`DENY_THRESHOLD = 8`) and any inline
  Edit/Write/MultiEdit to non-docs production paths, orchestration-flagged
  sessions only, using the documented `permissionDecision: "deny"` form;
  `ATLAS_TRIPWIRE_HARD=off` disables only the deny tier; the PostToolUse advisory
  at 4 is unchanged (`plugins/atlas/hooks/dispatch_tripwire.py:26,57-64,70`;
  `plugins/atlas/hooks/hooks.json` PreToolUse registration).
- Completion gate condition (g): Law 5 machine-enforced - Stop is blocked when
  code changed and `atlas_db.unpaired_implementer_dispatches(conn, run_id) > 0`,
  naming the count and atlas:verifier (`plugins/atlas/hooks/completion_gate.py:290-354`).
- Verifier coverage re-sourced: `derive_run_metrics` computes `verifier_coverage`
  from the `dispatches` table (agent_type pairing; NULL when zero implementer
  dispatches) instead of the mismatch-prone `tool_calls` targets
  (`plugins/atlas/scripts/atlas_db.py:342-411`).
- Fork routing doctrine: `subagent-kit.md` documents `subagent_type: "fork"`
  (full-history inheritance, prompt-cache reuse, `CLAUDE_CODE_FORK_SUBAGENT=1`,
  dispatch-time only, no nested forks) routed to planner/completeness-critic/
  docs-curator/synthesis; verifier and explorer stay fresh-context per Law 5
  (`plugins/atlas/skills/atlas-metis/references/subagent-kit.md:60-82`). The env
  var was enabled globally in `~/.claude/settings.json` (user-approved, verified
  against live docs). Exercised live this run: the completeness critique and this
  docs reconciliation both ran as forks.
- Output style resurrected: `atlas-orchestrator.md` gains `force-for-plugin: true`
  (auto-applies when the plugin is enabled) and was trimmed 66 -> 49 lines with a
  fork-vs-fresh section; zero claude.ai behavior-prompt content
  (`plugins/atlas/output-styles/atlas-orchestrator.md:1-5`).
- Observer-session pollution fixed and purged: `is_synthetic_session` excludes
  `.claude-mem/observer-sessions` transcripts at ingest
  (`plugins/atlas/scripts/session_ingest.py:204-214`), and
  `purge_observer_sessions` removed the existing 14,078 polluted session_logs
  rows plus 98,940 child rows from the live DB (backup taken; runs/dispatches
  untouched) - before/after capture in `docs/evidence/2026-07-09-observer-purge.md`.
- Sextant chronicles codex: `session_logs` gains an `agent` column (default
  'claude', idempotent migration) and a generic adapter registry with a codex
  JSONL adapter; the gated real backfill ingested 170 codex sessions (68
  observer-cwd files correctly excluded; claude rows byte-identical; idempotency
  proven) - `docs/evidence/2026-07-09-codex-backfill.md`. Known limitation
  documented: codex token deltas are only partially persisted (undercount), see
  `plugins/atlas/skills/atlas-argus/SKILL.md:270-280`.
- De-overlap wave: 33 of 40 frontmatter descriptions rewritten to tight unique
  triggers (plugin.json description 1548 -> 281 chars, sextant 1177 -> 447,
  atlas-prompt 648 -> 157); zero duplicate or first-60-char-identical
  descriptions; atlas-nestor command is routes-only; docs-auditor is the sole
  owner of docs-drift; verifier confirmed every diff touched exactly the
  description line. Two weakened triggers (m365 "Graph", doctor symptom clause)
  were caught by the verifier and restored.
- Docs synced to the new enforcement reality: engine SKILL.md, hooks-automation.md
  ("seven conditions"), plugin README hook table, and the sextant public-API list
  all reconciled against the shipped code by a dedicated pass, then re-verified
  claim-by-claim against the implementation.

## Unreleased -- atlas harden: agent-roster cleanup, spec conformance, routing, marketplace repoint (2026-07-07)

Audit: `docs/audits/atlas-harden-2026-07-07/` (orientation, decisions, per-stage
reports, red baseline, green-gate cross-check, final report). No plugin.json version
bump in this pass - release timing left to Jerry.

- Removed the five `ux-*` agent specs (`ux-cartographer`, `ux-persona`, `ux-fuzzer`,
  `ux-accuracy-oracle`, `ux-reporter`) and `api-usage-map`, guarded by a pre-delete grep
  for live skill/command dispatches (`docs/audits/atlas-harden-2026-07-07/stage-removals.md:13-41`).
  UX testing's canonical owner is now `atlas-odysseus`; `ux-test-swarm.md` collapsed
  to an 11-line pointer at that skill (`stage-removals.md:75-78`). Struck all
  references to the six removed names from `plugins/atlas/README.md` (roster count
  corrected 18 -> 12), `output-styles/atlas-orchestrator.md`,
  `skills/atlas-metis/SKILL.md`, and `skills/atlas-odysseus/references/personas.md`
  (`stage-removals.md:46-84`).
- Added three routing rows to
  `plugins/atlas/skills/atlas-metis/references/capability-routing.md` for
  atlas-hephaestus (project boot/onboarding), atlas-metis's own self-entry
  (orchestration), and atlas-nestor (skill selection); annotated 12 built-in/global
  agent-type mentions (`codebase-explorer`, `Explore`, `Plan`, `debugger`, etc.) with a
  `*` footnote marking them as not shipped under `plugins/atlas/agents/`
  (`docs/audits/atlas-harden-2026-07-07/stage-routing.md:6-14`).
- Added named-field Report-back sections to the three agent specs that lacked one
  (`naming-glossary-audit.md`, `rls-privilege-audit.md`, `schema-inventory.md`) and
  explicit hallucination-control grounding language ("I don't know" is a valid
  result, cite what was actually read, unproven gaps stay `[unverified]`) across all
  12 remaining agent specs
  (`docs/audits/atlas-harden-2026-07-07/stage-conformance.md:7-36`).
- Repointed the tech-tools marketplace registration from the stale
  `henssler-financial/tech-tools` fork to canonical `w159/tech-tools` via
  `atlas_doctor.py --fix`, which rewrote `known_marketplaces.json`'s source URL and
  reset the marketplace clone's git remote/HEAD; doctor now reports `HEALTHY - atlas`
  with 0 problems (`docs/audits/atlas-harden-2026-07-07/stage-marketplace.md:37-105`).
- Hardened repo-root `.gitignore`: added a re-exclusion for `**/.in_use/` (and
  `**/.in_use/**`) after the `!plugins/**` allowlist, the one dev-runtime pattern of
  four checked that was not already covered
  (`docs/audits/atlas-harden-2026-07-07/stage-gitignore.md:19-39`).
- Deleted untracked dev caches (`plugins/atlas/.pytest_cache`,
  `plugins/atlas/.ruff_cache`, `plugins/atlas/scripts/.claude`) and the empty
  `plugins/atlas/references/` directory; no tracked file was affected
  (`docs/audits/atlas-harden-2026-07-07/stage-removals.md:96-107`).
- Known residue carried into the audit's final report for owner follow-up (not fixed
  in this pass; see `docs/audits/atlas-harden-2026-07-07/final-report.md` section 4):
  a prior commit (`d1be66b`) already baked the local-relative-path marketplace scheme
  into `.kimi-plugin/marketplace.json` before this session's revert step ran, so the
  intended revert was a no-op and reverting it now requires a history-changing commit
  outside this audit's authority; and the Magic/Plaid credential strings previously
  flagged in `.kimi-plugin/import-plan.json`'s git history remain unrotated and
  unrewritten.

## Atlas v2.6.0 -- vendor connectors single-sourced to domain plugins (2026-07-03)

All 10 vendor `.mcpb` bundles atlas carried in `plugins/atlas/mcp/` were confirmed
byte-identical (SHA-256) to the copies already shipped by the four domain plugins that
own each vendor - it-operations (auvik, connectwise-manage, ninjaone, spanning),
security-compliance (blumira, knowbe4, threatlocker, vanta), microsoft-365 (cipp), and
hr-payroll (paylocity). Atlas now stops carrying them: `plugins/atlas/mcp/` (10 `.mcpb`
files + `extract.sh` + `launch.sh`, ~27 MB) and `plugins/atlas/.mcp.json` are removed,
and `plugins/atlas/.claude-plugin/plugin.json` drops the `mcpServers` key and the
entire `userConfig` block of vendor credential keys (version bumped to 2.6.0). The
domain plugins already declare their own `userConfig`/`.mcp.json` per vendor and are
now the single source. `atlas-hermes` is rewritten from "enable atlas's bundled
connectors" to a cross-plugin setup guide: it detects which domain plugins are
installed, shows enabled/disabled state per vendor against the *owning* plugin's
config, and directs credential entry to that plugin's `/plugin config`; `vendors.md`
updated to match, with a migration note. Stale bundling/`.mcpb`/`userConfig` claims
swept from `capability-catalog.md`, `atlas-metis/SKILL.md`,
`scripts/discover_capabilities.py`, `commands/atlas.md`, and `README.md`. The
marketplace entry description for atlas was re-synced from the updated plugin
manifest. MIGRATION: credentials previously entered on atlas's own plugin config
(e.g. `paylocity_client_id`) must be re-entered on the owning domain plugin via
`/plugin` - atlas's copies of those keys no longer exist.

## Atlas v2.5.0 -- deterministic orchestration wiring + docs gate widened (2026-07-03)

Session audit found the plugin's connective tissue was prose, not machinery: the
orchestration marker was never set automatically (so the tripwire and completion gate
stayed inert in normal use), the gate ignored ROADMAP/README/docs-drift, both
atlas-metis and `atlas-prompt` explicitly forbade asking the user scoping questions, and
five orphan pre-rename skill dirs plus cache debris sat on disk. All fixed in
`plugins/atlas/CHANGELOG.md` 2.5.0: auto-marking via the dispatch tripwire (Skill +
`atlas:*` dispatch signals), a 6-condition completion gate with blocking docs-drift,
one-round AskUserQuestion elicitation, docs-curator-owned graphify regeneration, and
leftover removal. Expanded in the same session: new atlas-nestor skill/command
(AskUserQuestion-driven skill stacking), elicitation guidance in all nine skills plus a
subagent DECISION-NEEDED bubbling rule, atlas-doctor `stale-assets` +
`orchestration-wiring` checks with quarantine-based --fix and an asset-count fix
(.DS_Store no longer counted as a skill), and quarantine of the ghost pre-atlas assets
(orchestrate.backup-*, uxt-swarm, self-improving, connector-ops skeletons and 36 orc-*
agent files) that polluted the slash/agent pickers. 73 hook/script tests pass. Also
repaired the dev repo itself: `.git/HEAD` + `.git/config` were missing (MEGA sync loss)
and 276 deleted tracked files were restored via `git restore`.

## Atlas v2.4.0 -- atlas-doctor installation self-repair (2026-07-01)

Root-caused and fixed the plugin-rollback incident: the tech-tools marketplace entry in
`~/.claude/plugins/known_marketplaces.json` tracked the stale henssler-financial fork with
autoUpdate on, so `/plugin` updates silently rolled atlas back to 1.0.1 (no subagents, no
hooks, no engine). Marketplace repointed to w159/tech-tools; atlas re-registered.

- **atlas-doctor** (`scripts/atlas_doctor.py`, `/atlas-doctor`): eight-check CHECK/SET/VERIFY
  health pass over the installation itself -- marketplace source vs the canonical repo from
  the plugin's own manifest, clone remote, version sync, rollback high-water mark
  (`~/.atlas/doctor-state.json`), `.orphaned_at` GC markers, hooks wiring, asset inventory.
  `--fix` auto-repairs; 7 sandbox unit tests recreate the incident.
- **SessionStart rollback guard**: `atlas_doctor.py --hook` (warn-only, exit 0) added to
  `hooks/hooks.json` so any future downgrade is announced at the top of the session.
- Marketplace manifest 1.6.1; counts reconciled (17 launchers, doctor hook) across
  plugin.json, marketplace.json, and the plugin README.

## Atlas v2.3.0 -- cohesion program (2026-06-30)

The five-workstream Atlas cohesion program plus three adoption follow-ups. Each workstream was
independently reviewed before merge. Plans + evidence under `docs/audits/atlas-cohesion-2026-06-29/`.

- **WS1 - hook misfires**: per-session orchestration marker (`runs.orchestrating` + `mark-orchestrating`
  CLI). The dispatch tripwire, completion gate, and nudge now gate on it, so non-orchestration sessions
  are never nagged or blocked. Hook inventory reconciled to the real 8 across all surfaces.
  (`plugins/atlas/hooks/*`, `plugins/atlas/scripts/atlas_db.py`)
- **WS2 - instrumentation**: most was already shipped in v2.2.3 (dispatch logging, metric derivation,
  classifier). Net-new: a `record_recall` signal (`record-recall <session> hit|miss` CLI) so the engine
  Orient step records recall hit/miss. Validated to survive `derive_run_metrics`.
- **WS3 - graphify scoping**: per-root scoping + a non-interactive size gate (`GRAPHIFY_NONINTERACTIVE`)
  so audits never stall on whole-monorepo scope; repo `.graphifyignore`. (`skills/graphify/SKILL.md`,
  `plugins/atlas/skills/atlas-athena/SKILL.md`)
- **WS4 - knowledge-graph hub + launcher**: `scripts/build_hub.py` (file-granular node<->finding
  manifest + branded Atlas hub HTML) and the new `/atlas-launch` command closing the audit->remediation
  loop. Survey/cartographer/engine wired. (15 -> 16 launchers)
- **WS5 - adoption**: memo with user-confirmed verdicts (no assets pruned). Follow-ups landed:
  `/atlas menu` discoverability mode; claude-mem worker-runtime call conventions
  (`references/memory-access.md`) fixing the 44% error rate; supermemory pointed at cloud.

### Sextant self-improvement run (2026-06-30, post-WS5)

Two further fixes from an `atlas-argus` self-improvement pass, plus two related changes outside
the plugin.

- **Fixed: the `dispatches` run-health metric was a stale snapshot, not a delegation gap.**
  `derive_run_metrics` now recomputes `dispatches = COUNT(*) FROM dispatches WHERE run_id=?` onto
  the metrics row instead of trusting the one-shot snapshot `finalize_run` takes at the first Stop.
  Dispatches landing in later turns of the same session (via the `dispatch_tripwire` last-run
  fallback) were never recounted, so `metrics.dispatches` read 0 even when the `dispatches` table
  had rows -- across the DB, 46 dispatch rows existed across 10 runs but only 3 metrics rows showed
  `dispatches>0`; run 52 had 7 dispatch rows with `metrics.dispatches=0`, now corrected to 7. This
  reframes the recurring "zero subagent dispatches" investigations from prior sessions (the v2.2.3
  work) as chasing a REPORTING bug, not a delegation failure -- delegation was happening; the metric
  was not counting it.
  (`plugins/atlas/scripts/atlas_db.py:380-397`)
- **Added: auto-derived session resume on SessionStart.** `session_boot.py` gained `resume_block(root)`
  plus helpers `_relative_time`, `_claude_mem_summary`, `_atlas_session_context` (198 lines added).
  On boot it derives and prints a "## Resuming &lt;project&gt;" block from three read-only sources:
  claude-mem's `session_summaries`/observations, the atlas mirror (last session, last user prompt,
  last edited file, unverified-claim count), and the newest transcript mtime for freshness.
  Fail-silent; never blocks boot. Deliberately replaces a rejected "continue from last session"
  command -- resume state is derived, never re-typed by the user. Known gap, intentionally
  deferred: there is no Stop-time `next_step` signal, so the part of resume state that depends on
  what-to-do-next still relies on claude-mem's `session_summaries.next_steps` field rather than a
  dedicated atlas signal.
  (`plugins/atlas/hooks/session_boot.py:31-216`)
- The claude-mem worker-runtime calling convention shipped in WS5 above
  (`plugins/atlas/skills/atlas-metis/references/memory-access.md`) proved insufficient on its own:
  two sessions after that commit still mis-called `observation_search` in worker runtime. The rule
  was promoted to the user's global, always-loaded `~/.claude/CLAUDE.md` so it loads regardless of
  whether the skill is in context. Cross-referenced, not duplicated, in `memory-access.md`.
  (`plugins/atlas/skills/atlas-metis/references/memory-access.md:36`)
- The user's global verification protocol (`agentic-tools/rules/verification-protocol.md`, outside
  this repo) was independently strengthened in response to mined signals -- 29 unverified-claim
  findings across 7 projects and 64 assumption-admission findings across 12 -- closing a
  prediction-phrase loophole and adding an assumption gate and claim-evidence adjacency requirement.
  No file in this repo changed for this item; noted here for cross-project traceability. See
  `plugins/atlas/skills/atlas-metis/references/verification-and-grounding.md:78` for the
  cross-reference.

## Atlas v2.2.3 (released 2026-06-29)

Four work items extending the observability layer shipped in v2.2.1/2.2.2. Not yet released.

- **Run-kind tagging**: tag each session/run as orchestrator or worker so Trends aggregates exclude
  short-lived sidechain worker sessions from run-health metrics. Requires a `run_kind` column in
  the `runs` table and hook-side detection of background/subagent launches.
  (`plugins/atlas/scripts/atlas_db.py`)
- **Docs-freshness advisory completion gate**: `completion_gate.py` will emit a one-time advisory
  when `docs/CHANGELOG.md` or `docs/ROADMAP.md` have not been updated since the last run that
  touched skill or hook files. Advisory only; fail-open; disable with `ATLAS_GATE=off`.
  (`plugins/atlas/hooks/completion_gate.py`)
- **Late-dispatch drop hardening**: a `current_or_last_run_id` helper to replace the
  `current_run_id`-after-Stop NULL pattern that caused the 2.2.2 `latest_run_id` fix; ensures
  post-Stop hooks attach metric derivation regardless of hook ordering.
  (`plugins/atlas/scripts/atlas_db.py`)
- **Docs SSOT backfill**: repo-level `docs/CHANGELOG.md`, `docs/ROADMAP.md`, and `docs/AGENTS.md`
  brought current with v2.2.1 and v2.2.2 (previously recorded only in `plugins/atlas/CHANGELOG.md`).
  (`docs/CHANGELOG.md`, `docs/ROADMAP.md`, `docs/AGENTS.md`)

---

## 2026-06-29 -- Atlas v2.2.2: run-metrics population fix and defect corrections

Commit 1d0f6c4. Corrects three defects found by end-to-end testing against the live hooks that
left `est_context_tokens`, `verifier_coverage`, `parallel_waves`, `in_flight_peak`, and
`wall_clock_s` NULL on every real (non-test) run after v2.2.1.

- `derive_run_metrics` wired into `ingest_transcript`: v2.2.1 added the function but nothing
  called it outside tests, so the four computed metrics stayed NULL on every live run. Now called
  after each mirror refresh (Stop / SubagentStop / SessionEnd / PreCompact).
  (`plugins/atlas/scripts/session_ingest.py`)
- `finalize_run` defaults `wall_clock_s`: the Stop hook called `finalize_run(run_id)` with no
  duration, so `wall_clock_s` was NULL on every historical run. It now defaults to
  `max(0.0, time.time() - started_at)` when the argument is omitted.
  (`plugins/atlas/scripts/atlas_db.py:179`)
- COALESCE order corrected in `derive_run_metrics` upsert: the previous form
  `COALESCE(excluded.wall_clock_s, wall_clock_s)` overwrote finalize's authoritative value with
  the (often zero) transcript span. Flipped to `COALESCE(wall_clock_s, excluded.wall_clock_s)`
  so derive only fills a wall clock that finalize never set (backfill-only sessions).
  (`plugins/atlas/scripts/atlas_db.py:276`)
- `trends()` now returns the full metric set: the selector previously chose three columns while
  the `atlas-argus` Trends table compares five; it now returns all metrics including
  `verifier_coverage` and `parallel_waves`.
  (`plugins/atlas/scripts/atlas_db.py:325`)
- `latest_run_id(conn, session_id)` added: resolves the most recent run open or closed so
  post-Stop metric derivation attaches regardless of hook ordering.
  (`plugins/atlas/scripts/atlas_db.py`)
- `atlas-argus` SKILL.md corrected: `derive_run_metrics` marked auto-wired, `latest_run_id`
  documented, Trends column list and the example (which used `current_run_id`, NULL after Stop)
  fixed.
  (`plugins/atlas/skills/atlas-argus/SKILL.md`)

---

## 2026-06-26 -- Atlas v2.2.1: session transcript ingestion, hook exec-bit fix, run metrics

Commit 0c792dd. Adds a session-forensics lens to atlas-argus: the observability DB now indexes
the lossless JSONL session transcripts Claude Code writes, so sextant can see every message,
tool call, and token-usage number instead of only the sparse live-event counters. Also fixes a
hook exec-bit defect that logged "Permission denied" on every PostToolUse call, and adds
`derive_run_metrics()` to compute `wall_clock_s` and `est_context_tokens` per run.

### Session transcript ingestion

- New `scripts/session_ingest.py`: parses transcripts incrementally by byte cursor (reads only
  new lines per call), classifies each tool call as builtin/skill/mcp/agent, scrubs secrets from
  input summaries, records per-message token and cache usage, and tags three behavioral signals
  (assumption_admission, unverified_claim, user_correction). `--backfill` walks
  `~/.claude/projects` idempotently; single-session mode for the hook.
  (`plugins/atlas/scripts/session_ingest.py`)
- New `hooks/ingest_session.py` wired in `hooks.json` on Stop, SubagentStop, SessionEnd, and
  PreCompact; fail-open and fast (reads only new bytes). Disable with `ATLAS_INGEST=off`.
  (`plugins/atlas/hooks/ingest_session.py`, `plugins/atlas/hooks/hooks.json`)
- Five new mirror tables in the observability DB, joinable to `projects`/`runs` by `session_id`:
  - `session_logs`: one row per transcript file with byte cursor and file size.
    (`plugins/atlas/scripts/atlas_db.py:44`)
  - `messages`: per-message token/cache usage and sidechain flag.
    (`plugins/atlas/scripts/atlas_db.py:56`)
  - `tool_calls`: per-call classification (kind, target, server), input summary, result excerpt.
    (`plugins/atlas/scripts/atlas_db.py:64`)
  - `user_prompts`: normalized human prompts with machine-generated openings excluded.
    (`plugins/atlas/scripts/atlas_db.py:73`)
  - `signals`: behavioral signals deduped per message per signal_type.
    (`plugins/atlas/scripts/atlas_db.py:79`)
- Six read helpers added to `atlas_db.py`: `tool_usage`, `idle_assets`, `context_tool_health`,
  `signal_counts`, `signal_rollup`, `repeated_prompts`. Token totals recomputed from child rows
  so re-ingest never double-counts. Machine-generated openings excluded from `user_prompts` so
  the repeated-request signal reflects real human asks.
  (`plugins/atlas/scripts/atlas_db.py`)

### Hook exec-bit fix

`hooks.json` previously invoked hooks by bare path, requiring the execute bit.
`dispatch_tripwire.py` shipped mode 0644 (no execute bit), so every PostToolUse call logged
"Permission denied" and the tripwire did not fire. All hooks now invoked as
`python3 "${CLAUDE_PLUGIN_ROOT}/hooks/X.py"`, making them exec-bit-independent and
path-space-safe.
(`plugins/atlas/hooks/hooks.json`)

### Run metrics

`derive_run_metrics()` added to `atlas_db.py`: derives `est_context_tokens` (peak input+cache_read
over main-thread messages) and `wall_clock_s` (session span from the mirror) and upserts them into
the `metrics` table. Recall hits/misses stay NULL and are filled by atlas-argus on demand.
(`plugins/atlas/scripts/atlas_db.py:268`)

### Tests and version

New `scripts/test_session_ingest.py` covers classification, secret redaction, result join, signal
detection, token aggregates, idempotency/incremental, truncation reset, and machine-prompt
filtering. Derive test added to `test_atlas_db.py`. Full suite: 15 tests green. Plugin bumped
2.0.0 -> 2.2.1.
(`plugins/atlas/scripts/test_session_ingest.py`, `plugins/atlas/scripts/test_atlas_db.py`,
`plugins/atlas/.claude-plugin/plugin.json`)

## 2026-06-25 -- Atlas v2.0.0: final 8-skill redesign, observability DB, de-hardcoded swarms

Completed the atlas plugin skill-set redesign. Every skill is now canonically named under the
`atlas-*` prefix; the five retired names (atlas-loop, atlas-connectors, atlas-self-improving,
atlas-uxt-swarm, atlas-operating-contract) no longer appear in the plugin or its docs except in
historical CHANGELOG entries below.

### Skill renames and retirements

- `atlas-loop` -> `atlas-chronos`: same loop library, canonical name dropped the ambiguous "loop" suffix.
- `atlas-connectors` -> `atlas-hermes`: vendor MCP connector setup skill; name reflects the "safe harbor"
  for external integrations.
- `atlas-self-improving` retired; replaced by `atlas-argus`: the new skill reads a SQLite observability
  DB (`~/.atlas/atlas.db`) populated by the session/tripwire/completion hooks, computes wall-clock, inline-ops, dispatches, parallel
  waves, context, recall, and verifier-coverage scores, and proposes metric-backed improvement targets
  (baseline -> target). Measurable; not motivational.
- `atlas-uxt-swarm` retired; its pipeline (cartographer -> persona -> fuzzer -> oracle -> reporter) is now
  the implementation detail of `atlas-odysseus`. atlas-odysseus adds app-discovery: it auto-finds
  routes and form fields in any live web app with no hardcoded paths, so it works on any project.
- `atlas-operating-contract` retired; the operating contract itself (`operating-contract.md`) still ships
  as a reference file under atlas-metis/references/. The skill wrapper was not necessary.

### New skills

- `atlas-ariadne`: produces an evidence-grounded architecture map of any codebase, identifies
  structural duplicates (DRY-at-the-module level), and writes `docs/architecture/boundaries.md` as a
  persistent artifact a future agent can load instead of re-discovering structure.
- `atlas-odysseus`: app-discovering UX swarm. Discovers routes/fields from a live app via a cartographer
  phase, then runs the full persona + fuzz + accuracy-oracle + reporter pipeline. No hardcoded paths;
  works on any web app.
- `atlas-athena`: discovery-first comprehensive quality and security audit swarm. Covers code quality
  (complexity, dead code, test coverage, error handling), security (OWASP Top 10, SANS 25, secrets,
  auth, injection, SSRF), and dependency risk. Returns severity-graded findings and an actionable
  remediation plan.
- `atlas-argus` (detailed above).

### Manifest and docs reconciliation

- `plugins/atlas/.claude-plugin/plugin.json` bumped 1.2.1 -> 2.0.0 (MAJOR: breaking change - four skills
  renamed and `atlas-operating-contract` removed, so any external reference to an old skill name breaks);
  description updated to enumerate all 8 skills with their one-line purpose and the 8-hook count; 5 new
  keywords added (observability-db, architecture-audit, owasp, security-audit, ux-swarm).
- `plugins/atlas/README.md` updated: "What ships" table expanded to all 8 skill rows; layout tree
  updated to show all 8 skill directories.
- `plugins/atlas/skills/atlas-metis/references/capability-catalog.md` updated: 3 new signal rows added
  for atlas-ariadne, atlas-athena, atlas-odysseus.
- `plugins/atlas/skills/atlas-metis/references/capability-routing.md` updated: atlas-odysseus added
  to the UX-sweep row; 6 new routing rows added for atlas-athena, atlas-ariadne, atlas-chronos,
  atlas-hermes, atlas-argus, and the app-routes-unknown expedition path.
- `.claude-plugin/marketplace.json` atlas entry updated: description and keywords now match plugin.json.

## 2026-06-23 -- Connector .mcpb bloat fixed; marketplace install repaired; atlas connectors made standalone-resolvable

Diagnosed why connector-heavy plugins did not appear (or appeared empty) when adding the marketplace in
Claude Desktop. Root cause was bundle weight, not manifest structure: the marketplace catalog, all 12
plugin.json manifests, userConfig/mcp.json key parity, and component frontmatter were all valid and
git-tracked (confirmed via the plugin-dev plugin-validator agent).

### Packer fix (root cause)

`mcp_servers/_shared/pack-mcpb.js` copied each `file:`-linked vendor lib with a recursive `cpSync`, which
dragged in that lib's nested `node_modules` and its iCloud `node_modules.nosync.noindex` twin (dev toolchain:
esbuild, vite, typescript, rollup, msw). That was the entire bloat. Two earlier per-server packer variants
attempted a fix but their regexes only matched `node_modules` followed by a separator, so they missed the
`.nosync.noindex` twin. The fix dereferences the symlinked vendor (`realpathSync`) and filters out both
nested `node_modules` and any `.nosync*` directory, plus a defensive staging cleanup and `.mcpbignore`
entries. Propagated the one canonical packer to all 10 per-server copies (they had drifted into 3 variants;
now a single md5, all `node --check` clean).

### Bundles rebuilt and verified (staged in /tmp, never npm-installed under iCloud)

| connector | before | after |
| --- | --- | --- |
| spanning | 99 MB | 2.78 MB |
| blumira | 60 MB | 2.61 MB |
| vanta | 51 MB | 2.77 MB |
| threatlocker | 47 MB | 2.76 MB |
| paylocity | 25 MB | 2.77 MB |

Tracked `.mcpb` total dropped from ~283 MB to ~14 MB across these five; largest single bundle is now 3.3 MB
vs GitHub's 104.8 MB hard push limit. Each rebuild was adversarially verified: size <= 20 MB, entry point
present, zero `.nosync` entries, and a credential-free stdio launch returning a full `tools/list` (spanning,
blumira, vanta ~30 tools, threatlocker 18, paylocity 17).

### atlas connectors resolvable standalone

`plugins/atlas/mcp/extract.sh` searched only the operator data dir, an env override, and a source checkout -
none exist on a marketplace install, so all 10 declared atlas connectors were "declared but not set up."
Added a `${CLAUDE_PLUGIN_ROOT}/mcp/<name>.mcpb` search candidate and shipped all 10 slimmed bundles (~27 MB
total) under `plugins/atlas/mcp/` named `<svc>-mcp.mcpb`. Verified end to end: extract resolves the bundled
copy and launch boots vanta credential-free with full tools/list. Connectors stay INERT until credentials
are supplied.

### bash_advisor.py exec bit

`plugins/atlas/hooks/bash_advisor.py` (the PreToolUse Bash advisor) was missing its execute bit while the six
peer hooks had it; hooks.json wires it as a bare command path, so a direct execve could fail to launch the
catastrophic-command advisor. `chmod +x` and `git update-index --chmod=+x` (mode 100644 -> 100755) so a fresh
clone keeps the bit. Verified: script exits 0 on a sample Bash event.

### docs / .gitignore

Corrected the `.gitignore` comment that wrongly assured connector bundles were "~3 MB, well under GitHub's
limit" (they were up to 99 MB); it now states the slim-pack requirement and the regression risk. Refreshed
`PLUGIN_INVENTORY.md` to document the slim packer and atlas standalone bundling.

## 2026-06-23 -- Atlas optimization Phase 2/3: Architect Mode, ponytail/loop-library/connector discovery, session-lifecycle docs, visual layer

Independently verified (adversarial verifier, 14/14 after fixing one pre-existing broken script path).
All additive and opt-in; default sessions are unchanged.

### atlas-hephaestus: Architect Mode + no-args scan

The architect turns the session into a pure orchestrator: it rewrites vague or incomplete prompts into
structured, reference-backed tasks (operating contract + doc quotations), delegates research/impl/test to
parallel subagents, and routes every claimed change to an adversarial verifier for red -> green evidence.
With no task/args, any atlas skill runs a standard scan and reports the gap to atlas standard. Bootstrap
now treats claude-mem + context-mode + ponytail as the session-augmentation trio and surfaces the
loop-library and connector built-ins.
(`plugins/atlas/skills/atlas-hephaestus/SKILL.md`)

### Discovery: ponytail, loop-library, connectors

capability-catalog and discover_capabilities.py now recommend ponytail (always), loop-library (via
atlas-loop), and connectors (when `mcp_servers/` or `*.mcpb` present). session_boot reports ponytail
status and points at the no-prompt scan. Fixed a pre-existing broken path: the discover script is now
anchored at `${CLAUDE_PLUGIN_ROOT}/scripts/discover_capabilities.py` in both the skill and the catalog.
(`plugins/atlas/scripts/discover_capabilities.py`, `plugins/atlas/skills/atlas-metis/references/capability-catalog.md`, `plugins/atlas/hooks/session_boot.py`)

### Session docs lifecycle

New `references/session-lifecycle.md`: START reconciles recent claude-mem/context-mode work against docs/
(correct invalid, archive outdated) before new work; END runs a docs-curator that moves every completed
ROADMAP task to CHANGELOG with date and evidence. Wired as pointers into atlas-metis and docs-ssot.
(`plugins/atlas/skills/atlas-metis/references/session-lifecycle.md`)

### Visual layer (opt-in)

18 subagents given role-family colors (explorer cyan, implementer green, verifier red, db yellow, ux
purple, docs orange, planner blue). New opt-in "Atlas Orchestrator" output style and an opt-in colored
statusline script. No default changed; no settings.json touched.
(`plugins/atlas/agents/`, `plugins/atlas/output-styles/`, `plugins/atlas/statusline/`)

## 2026-06-23 -- Atlas optimization Phase 1: skill rename, loop-library + atlas-loop, all 10 connectors (disabled), self-improvement settings

Verified zero-degradation by an independent adversarial verifier (12/12 claims PASS).

### Skill naming fixed (atlas-* prefix)

`operating-contract` -> `atlas-operating-contract`, `self-improving` -> `atlas-self-improving`,
`uxt-swarm` -> `atlas-uxt-swarm`. Folders, `name:` fields, and every in-plugin reference updated.
The reference files `atlas-metis/references/operating-contract.md` and `references/self-improving.md`
were intentionally left as-is (they are docs the commands read, not the skills).
(`plugins/atlas/skills/`)

### New: loop-library + atlas-loop skill

`atlas-loop` discovers and instantiates the best-fit reusable loop for a recurring or iterative task.
Ships 12 loops (loop-until-dry, fan-out-adversarial-verify, red-green-tdd, doc-reconcile, incident-triage,
dependency-bump-sweep, flaky-test-hunt, migration-pipeline, perf-profile-iterate, security-finding-verify,
build-fix-loop, code-review-iterate) plus an INDEX catalog, read progressively.
(`plugins/atlas/skills/atlas-loop/`)

### New: atlas connectors (all 10, disabled by default, extract-on-demand)

atlas declares all 10 repo MCP servers via `.mcp.json`, inert by default (40 userConfig keys, all
required:false default:""). `mcp/launch.sh` + `extract.sh` extract a vendor bundle on demand so atlas
stays small (no ~297MB bundled), and emit a clear not-set-up message instead of crashing. New
`atlas-connectors` skill runs guided setup. plugin.json bumped 1.1.0 -> 1.2.0 (purely additive).
(`plugins/atlas/.mcp.json`, `plugins/atlas/mcp/`, `plugins/atlas/skills/atlas-connectors/`)

### New: project self-improvement settings

`.claude/settings.json` re-enables claude-mem auto-memory for this project (overrides the global
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` that was silently disabling the atlas nudge), sets
`ATLAS_BUILD_DIR=/tmp` for iCloud-safe builds, and pre-approves context-mode/docs MCP tools plus
safe Bash to cut approval friction. No hooks declared (the plugin auto-loads them).
(`.claude/settings.json`)

## 2026-06-22 -- MCP server hardening pass: error-envelope fix, ThreatLocker approve tool, vanta vitest suite, description and risk-prefix quality sweep

### Error-envelope HTTP classifier fixed (shared + connectwise + cipp private copies + auvik mapper)

`_shared/error-envelope.ts` `classifyError()` previously returned INTERNAL_ERROR for all
HTTP failures because it inspected `error.status` only; the vendor clients surface the code
on `error.statusCode` and the body on `error.response`. Both fields are now read before
falling back to INTERNAL_ERROR. The same fix was applied to two private copies of the
classifier (`connectwise-manage-mcp/src/_shared/error-envelope.ts` and
`cipp-mcp/src/_shared/error-envelope.ts`) and to auvik-mcp's private error mapper
(`auvik-mcp/src/errors.ts`). CIPP and auvik were real misclassification bugs: both servers
carried `statusCode` on their error objects but the code read only `status`, so HTTP
401/403/404/429/5xx all returned as INTERNAL_ERROR with no vendor detail. All three private
copies now verified to classify a `statusCode:403` error as FORBIDDEN with vendor detail.
Downstream effect: node-threatlocker, node-vanta, connectwise-manage, cipp, and auvik now
emit FORBIDDEN (403), NOT_FOUND (404), and RATE_LIMITED (429) correctly.
(`mcp_servers/_shared/error-envelope.ts`,
`mcp_servers/connectwise-manage-mcp/src/_shared/error-envelope.ts`,
`mcp_servers/cipp-mcp/src/_shared/error-envelope.ts`,
`mcp_servers/auvik-mcp/src/errors.ts`)

### New tool: threatlocker_approvals_approve (DESTRUCTIVE)

Added `threatlocker_approvals_approve` to threatlocker-mcp. Calls
`POST /ApprovalRequest/ApprovalRequestPermitApplication` to approve a pending application
request. Prefixed DESTRUCTIVE per the tool-quality contract.
ThreatLocker Portal API exposes no deny endpoint; deny must be performed in the Portal UI.
threatlocker-mcp version bumped 1.2.0 -> 1.3.0; tool count 17 -> 18.
(`mcp_servers/threatlocker-mcp/src/domains/approvals.ts`,
`mcp_servers/threatlocker-mcp/manifest.json`)

### Vanta-mcp: README and vitest suite added

vanta-mcp gained a README.md (setup, auth, env vars, tool index) and 20 vitest unit specs
covering the main domain handlers. vanta-mcp version bumped 0.2.0 -> 0.2.3.
(`mcp_servers/vanta-mcp/README.md`, `mcp_servers/vanta-mcp/src/__tests__/`)

### Auvik: 39 tool descriptions rewritten verb-first

All 39 auvik-mcp tool descriptions rewritten to start with a verb and state what the tool
returns and when an agent should call it. No tool count change. Version bumped 0.4.1 -> 0.4.2.
(`mcp_servers/auvik-mcp/src/domains/`)

### Blumira: 6 tools re-prefixed DESTRUCTIVE / VISIBLE-TO-OTHERS

Six blumira-mcp tools that create, update, or send data gained the required
DESTRUCTIVE or VISIBLE-TO-OTHERS prefix per the tool-quality contract.
Version bumped 1.1.4 -> 1.1.5.
(`mcp_servers/blumira-mcp/src/domains/`)

### All 10 .mcpb bundles rebuilt and plugin copies refreshed

After the above source changes all 10 servers were rebuilt (`npm run build`) and repacked
(`npm run pack:mcpb`). Plugin copies under `plugins/*/mcp/` updated to match.
Version table (all 10 bumped):
auvik 0.4.1 -> 0.4.2 | blumira 1.1.4 -> 1.1.5 | cipp 0.2.0 -> 0.2.2 |
connectwise-manage 0.1.0 -> 1.5.2 | kaseya-spanning-backup 1.1.2 -> 1.1.3 |
knowbe4 1.1.0 -> 1.1.2 | ninjaone 1.6.0 -> 1.6.2 | paylocity 0.1.3 -> 0.1.4 |
threatlocker 1.2.0 -> 1.3.0 | vanta 0.2.0 -> 0.2.3.
Grand total: 298 tools across 10 servers.
(`mcp_servers/*/manifest.json`, `plugins/*/mcp/*.mcpb`)

---

## 2026-06-22 -- Ramp connector removed from finance plugin; marketplace keyword parity fix

### Ramp connector removed from finance plugin (version 1.4.0 -> 1.4.1)

Decision reversed from "pending - wire when Ramp publishes an endpoint." Ramp publishes no
wireable hosted MCP endpoint; the five ramp-* skill folders are no longer API-pattern value
enough to justify the dead references in the manifest.

- Deleted skill folders: `ramp-api-patterns`, `ramp-bill-vendor-reconciliation`,
  `ramp-card-controls`, `ramp-reimbursement-review`, `ramp-spend-triage`.
  (`plugins/finance/skills/`)
- Removed Ramp section from `plugins/finance/CONNECTORS.md`.
  (`plugins/finance/CONNECTORS.md`)
- Removed keywords `ramp`, `spend-management`, `card-controls` from finance `plugin.json`
  and the finance entry of `.claude-plugin/marketplace.json`.
  (`plugins/finance/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`)
- Finance plugin version bumped 1.4.0 -> 1.4.1.
  (`plugins/finance/.claude-plugin/plugin.json`)
- Verified: 0 ramp references remain in `plugins/finance/`; both JSON files are valid.

To restore: recover from git history and wire via the pax8/pandadoc `.mcp.json` pattern
once Ramp ships an official MCP server.

### Marketplace keyword parity fix (all 12 plugins)

Keyword lists in `.claude-plugin/marketplace.json` were out of sync with the corresponding
`plugin.json` files in four plugins. Brought all 12 into parity.

- `finance` marketplace entry: added missing keywords `pax8`, `pandadoc`.
  (`.claude-plugin/marketplace.json`)
- `it-operations` marketplace entry: added missing keyword `endpoint`.
  (`.claude-plugin/marketplace.json`)
- `security-compliance` marketplace entry: added missing keyword `email-security`.
  (`.claude-plugin/marketplace.json`)
- Verified: all 12 plugins now have matching keyword lists between `plugin.json` and
  `marketplace.json`; `marketplace.json` is valid JSON.

---

## 2026-06-22 -- atlas plugin Phase 1 optimization (hook contract, manifests, reliability guidance)

### Hard contract: atlas hooks are advisory-only, never approval-blocking

Atlas hooks now carry a non-negotiable contract: no hook emits `permissionDecision` and no hook
exits with code 2 to block a tool call. The only permitted influence channels are
`additionalContext` (factual, advisory) and a one-time fail-open `Stop`-event reminder.
Verified by independent smoke tests and atlas:verifier pass (see
`docs/evidence/2026-06-22-atlas-hook-contract.md`).

- `plugins/atlas/hooks/bash_guard.py` renamed to `bash_advisor.py` and rewritten advisory-only.
  (`plugins/atlas/hooks/bash_advisor.py`)
- `bash_advisor.py` now emits `additionalContext` ONLY on catastrophic, near-irreversible
  commands (`rm -rf /`, fork bomb pattern, `mkfs`, `dd` to a raw disk device). The prior "ask"
  list (`sudo`, force push, `curl|sh`) was removed -- those are not near-irreversible.
  (`plugins/atlas/hooks/bash_advisor.py`)
- `hooks.json` updated to wire `bash_advisor.py` under `PreToolUse` for `Bash`.
  (`plugins/atlas/hooks/hooks.json`)
- `session_boot.py`: strengthened the orchestrator-delegation statement injected at `SessionStart`,
  making the delegation intent explicit.
  (`plugins/atlas/hooks/session_boot.py`)
- `completion_gate.py`: docstring corrected from "opt-in" to "opt-out" (on by default when
  `docs/` exists; disable with `ATLAS_GATE=off`). Behavior unchanged: one-time, fail-open
  `Stop` reminder.
  (`plugins/atlas/hooks/completion_gate.py`)

### Stale "orchestrate" output tokens replaced with "atlas"

All wired hooks and scripts that emitted `[orchestrate ...]` prefixes in their `additionalContext`
or log output now emit `[atlas ...]`. `install_hooks.py` updated accordingly.
Zero residuals confirmed by grep across `plugins/atlas/hooks/`, `plugins/atlas/scripts/`, and
`plugins/atlas/skills/.claude-plugin/`.
(`plugins/atlas/scripts/install_hooks.py`)

### Manifest accuracy: 18-agent count, new launchers, version bump to 1.1.0

- `plugin.json` and the marketplace.json atlas entry now correctly state "18-agent subagent squad"
  (disk count confirmed: 18 agents under `plugins/atlas/agents/`; prior claim was 14).
  (`plugins/atlas/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`)
- Both manifests enumerate all launchers including `atlas-prompt` and the new `atlas-validate`.
  (`plugins/atlas/.claude-plugin/plugin.json`)
- Marketplace top-level description changed from "the orchestrate multi-agent coding meta-agent"
  to "the atlas multi-agent coding meta-agent".
  (`.claude-plugin/marketplace.json`)
- Atlas plugin version bumped from 1.0.1 to 1.1.0.
  (`plugins/atlas/.claude-plugin/plugin.json`)
- `plugins/atlas/README.md` reconciled to match manifest claims.
  (`plugins/atlas/README.md`)

### New launcher: atlas-validate

`plugins/atlas/skills/atlas-validate.md` added. Drives `plugin-dev:plugin-validator` and
`plugin-dev:skill-reviewer` over a target plugin, providing structured quality gates without
requiring the full atlas orchestration path.
(`plugins/atlas/skills/atlas-validate.md`)

### Reliability guidance added (path verification, ToolSearch-before-deferred, timeout+retry)

Grounded in error telemetry (claude-mem obs #14075): path/file-not-found errors account for
approximately 56% of all atlas session errors; timeouts are second; InputValidationError
accounts for approximately 6,800 occurrences. Three mitigations documented:

- **Path-exists verification** -- agents must confirm a path exists before using it as an
  argument to any tool.
- **ToolSearch before deferred/MCP tool calls** -- any tool whose schema is not loaded (deferred
  in the harness) requires a `ToolSearch` call before invocation; calling without the schema
  produces `InputValidationError`.
- **Timeout and retry** -- long-running tool calls should set explicit timeouts and retry once
  on transient failure before escalating.

Added to:
(`plugins/atlas/references/verification-and-grounding.md`,
`plugins/atlas/references/subagent-kit.md`,
`plugins/atlas/agents/explorer.md`,
`plugins/atlas/agents/implementer.md`)

### Phase 3 -- finance connectors wired, productivity/nudge made standalone, ASCII normalization complete (shipped 2026-06-22)

#### finance plugin: pax8 + pandadoc connectors wired

`plugins/finance/.mcp.json` created with two remote connector entries. Pax8 uses
`https://mcp.pax8.com/v1/mcp` with an `x-pax8-mcp-token` header; pandadoc uses
`https://developers.pandadoc.com/mcp` with an `Authorization: API-Key` header; both
transport via the `npx mcp-remote` stdio pattern.

`plugins/finance/.claude-plugin/plugin.json` updated: `"mcpServers": "./.mcp.json"`
added; `userConfig` block declares `pax8_mcp_token` and `pandadoc_api_key` (both
marked sensitive); version bumped 1.3.0 -> 1.4.0; pax8 and pandadoc keywords added.
Finance README and CONNECTORS documentation updated.

Verified: userConfig keys match the `${user_config.*}` references in `.mcp.json`
exactly; both JSON files are valid.

- `plugins/finance/.mcp.json` (created)
- `plugins/finance/.claude-plugin/plugin.json` (version 1.3.0 -> 1.4.0)

Remaining caveat: the Ramp connector is NOT wired. Ramp has no documented public MCP
endpoint. The `ramp-*` skills remain available as API-pattern references only. Will
wire once Ramp publishes an official MCP endpoint.

#### productivity/nudge made standalone (macOS launchd dependency removed)

`plugins/productivity/commands/nudge.md` rewritten to remove the macOS launchd/plist
dependency. Install now scaffolds `~/.nudge` state and documents portable scheduler
options (cron, systemd, Task Scheduler). kick/eval/status subcommands run on demand
with no background daemon required. The command is now OS-agnostic.

- `plugins/productivity/commands/nudge.md`

#### ASCII normalization complete across all 12 plugins

All 12 plugins plus `plugins/_templates/` and `plugins/CLAUDE.md` normalized to pure
ASCII. Transformations applied: em/en dashes -> "-", arrows -> "->", box-drawing
characters -> "+", "-", "|", status emoji -> bracketed labels (e.g. "[PASS]"),
math symbols -> "<=", ">=", "+", "-", "x". Final scan confirms 0 non-ASCII codepoints
across all `plugins/**/*.md`.

- `plugins/_templates/` (all markdown files)
- `plugins/CLAUDE.md`
- All 12 plugin clusters (normalized in place)

#### Verification summary (2026-06-22 Phase 3)

- 362 frontmatter files parsed with PyYAML, 0 failures. Corruption class remains
  fully closed.
- 0 non-ASCII codepoints across all `plugins/**/*.md`.
- `plugins/finance/.mcp.json` and `plugins/finance/.claude-plugin/plugin.json` valid
  JSON; userConfig keys match `.mcp.json` `${user_config.*}` references exactly.
- `marketplace.json` lists 12 plugins matching disk.

---

### Phase 2 -- marketplace-wide hygiene (shipped 2026-06-22)

Validated all 12 marketplace plugins; corrected frontmatter corruptions and non-ASCII
characters across four plugin clusters; repaired stale references in root README.md and
plugin READMEs; re-verified 362 frontmatter files parse cleanly (0 failures).

- **Full plugin validation pass**: ran `plugin-dev:plugin-validator` across all 12 non-atlas
  marketplace plugins. `marketplace.json` matches disk exactly (12/12). The `.env.template`
  gap from obs #13987 was already resolved prior to this phase; all 10 connectors' vars
  are present. No new structural gaps found.
- **YAML frontmatter critical fixes (2 files)**: unquoted `description` values containing
  an internal colon-space sequence caused PyYAML parse failures. Fixed by wrapping in double
  quotes.
  (`plugins/finance/skills/ramp-api-patterns/SKILL.md`,
  `plugins/engineering/skills/dead-code-cleanup/SKILL.md`)
- **Non-ASCII frontmatter fixes (12 files)**: em dashes and right-arrow characters inside
  YAML frontmatter blocks replaced with ASCII equivalents across four plugin clusters:
  hr-payroll, finance, engineering, data. All 12 files now pass PyYAML parse.
- **Root README.md stale references fixed**: removed all remaining `orchestrate` plugin
  references; corrected broken link `plugins/orchestrate` -> `plugins/atlas`; updated
  counts to 15 launchers and 18 subagents.
  (`README.md`)
- **plugins/it-operations/README.md name fix**: updated old "operations" plugin name to
  current name.
  (`plugins/it-operations/README.md`)
- **Leaked personal path removed**: a local filesystem path was removed from the install
  command in `plugins/productivity/commands/nudge.md`.
  (`plugins/productivity/commands/nudge.md`)
- **Re-verification**: 362 frontmatter files across all plugins re-parsed with PyYAML; 0
  failures. This closes the claude-mem obs #13947 corruption class.

---

## 2026-06-09 -- Shared response-quality layer, marketplace, skills consolidation

### Shared response-quality layer (mcp_servers/_shared/)

All 10 MCP servers adopted a shared response-quality layer shipped in `mcp_servers/_shared/`. Three modules:

- **response-shaper** -- list/get tools now default to compact summaries. Callers can pass `fields=[...]` to select
  specific fields or `full=true` to get the raw vendor payload. This eliminated the ConnectWise
  context-flooding defect: a single `cw_list_tickets` response shrank from 158,777 bytes to 5,960 bytes
  (green vs. red in the harness) without losing any information the agent needs for triage.
- **error-envelope** -- all tool errors now return a structured object
  `{error:{code, message, detail, hint}}` instead of raw exception strings. The `hint` field names
  the env var to set, the endpoint to enable, or the vendor doc page to consult.
- **base-url** -- each server hardcodes its vendor's documented default base URL. The corresponding
  `<VENDOR>_BASE_URL` env var is optional -- missing/empty resolves to the default with no warning
  and no error. Manifest `user_config` entries updated to `"required": false`.

### ThreatLocker default base URL corrected

Default corrected from the old shard URL to `https://portalapi.g.threatlocker.com/portalapi`.
The `.env.template` comment and manifest description updated to match.

### Blumira auth surface expanded

`blumira-mcp` manifest now accepts `BLUMIRA_CLIENT_ID` / `BLUMIRA_CLIENT_SECRET` / `BLUMIRA_BASE_URL`
in addition to the original `BLUMIRA_JWT_TOKEN`. Default base URL is `https://api.blumira.com/public-api/v1`.

### Pack-script transitive-dependency filter

All 10 server `scripts/pack-mcpb.js` wrappers and `_shared/pack-mcpb.js` gained a filter that
prevents nested transitive dependencies of `file:`-linked `mcp_node` libraries from poisoning
the bundle's `node_modules`. Bundles are now smaller and reproducible across machines.

### Manifest version bumps

All 10 server `manifest.json` files were version-bumped to reflect the response-quality surface change.
Current versions: auvik 0.4.0, blumira 1.1.0, cipp 0.2.0, connectwise-manage 0.1.0,
kaseya-spanning-backup 1.1.0, knowbe4 1.1.0, ninjaone 1.6.0, paylocity 0.1.1,
threatlocker 1.2.0, vanta 0.2.0.

### Status tools boot without credentials

Every server's `<vendor>_status` tool now boots and returns a structured status report even when
credentials are absent. The report names which env vars are missing and which endpoints to configure.

### Verified tool counts (2026-06-09)

auvik 39, blumira 30, cipp 43, connectwise 52, kaseya-spanning 14, knowbe4 30,
ninjaone 26, paylocity 16, threatlocker 17, vanta 28.

### Plugin marketplace (26 plugins + minutes)

`.claude-plugin/marketplace.json` created at the repo root, listing 26 plugins with name, source
path, description, category, and keywords. The `plugins/minutes` plugin (contains a nested Rust
application) is excluded from marketplace auto-install and documented separately.

All plugin `plugin.json` manifests normalized to a consistent structure.

### Skills consolidated 25 -> 13

The `skills/` directory was pruned from 25 skills to 13. New skills added: `msoffice-docs`,
`database-optimization`, `security-audit`. Skills merged into survivors: `codeql` and
`pytest-coverage` -> `security-audit`; `prompt-optimizer` and `self-improving` ->
`orchestrate` (as referenced sub-patterns). Remaining retirements had overlapping scope
with the 13 survivors.

Final 13: `az-cost-optimize`, `azure-deployment-preflight`, `cloud-design-patterns`,
`codebase-brain`, `database-optimization`, `entra-agent-user`, `graphify`, `msgraph-sdk`,
`msoffice-docs`, `orchestrate`, `scrapling-official`, `security-audit`, `webapp-testing`.

---

## 2026-06-02 -- Prompt-optimizer hook

- `UserPromptSubmit` hook wired in `always` mode, routing non-trivial prompts through local
  ollama `prompt-optimizer:latest` before they reach the main session.
- Two follow-ups deferred: command collision with the existing `/prompt-optimizer` skill, and
  whether `always` mode latency (~25-45s per first turn) warrants switching to `trigger` mode.

---
