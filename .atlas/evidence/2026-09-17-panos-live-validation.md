# PAN-OS connector: live-appliance validation

Date: 2026-09-17. Appliance supplied by the user for this run; the API key was
deliberately short-lived and is being rotated/deleted by the user afterward. No
credential value appears in this file by design.

## Appliance under test

| Field | Value |
|---|---|
| Model | PA-460 |
| PAN-OS | 11.1.13-h6 |
| Serial | 023009014025 |
| Topology | standalone firewall, `multi-vsys: off` (NOT Panorama) |
| Host | LAN address, reachable on 443 |
| TLS | self-signed: subject == issuer, `CN=023009014025`, `O=Palo Alto Networks`, valid 2026-09-10 -> 2027-09-11 |
| REST version | `v11.1` default matched the appliance release |

`PANOS_VERIFY_TLS=false` is therefore correct for this host and is the documented
self-signed exception, not a shortcut: strict verification fails against a
self-issued certificate.

## How it was driven

`.atlas/.run/panos-live.mjs` spawns the SHIPPED bundle exactly as
`plugins/atlas/.mcp.json` does:

    node --import plugins/atlas/mcp/_env/load.mjs plugins/atlas/mcp/panos/server.mjs

with `ATLAS_ENV_FILE=plugins/atlas/.env`. So the env loader, the bundle, and the
MCP stdio surface are all exercised; nothing was tested through `dist/` or by
calling the client library directly. `tools/list` returned **60 tools** with a
real key present.

## Read-only calls that passed

| Tool | Live result |
|---|---|
| `panos_status` | credentials reported configured, all seven settings echoed |
| `panos_version` | sw-version 11.1.13-h6, model PA-460, serial, multi-vsys off |
| `panos_system_info` | hostname PA-460, uptime, app-version 8939-9248, MACs, full system block |
| `panos_config_show` | narrow xpath -> `{"hostname":"PA-460"}` |
| `panos_config_complete` | enumerated valid children of `deviceconfig/system` (login-banner, service, locale, mtu, ...) - the grounding tool works |
| `panos_objects_list` Addresses/vsys1 | real address objects returned |
| `panos_objects_list` Tags/vsys1 | empty list, no error (empty != failure) |
| `panos_policies_list` SecurityRules/vsys1 | 9 rules with names and actions |
| `panos_logs_query` | job enqueued, id returned |
| `panos_report_dynamic` | `top-app-summary` job enqueued, id returned |
| `panos_logs_retrieve` | real SYSTEM log rows, job status FIN |
| `panos_report_get` | report job FIN, percent 100, recordcnt 1 |
| `panos_op` | `<show><clock/></show>`, `<show><jobs><all/></jobs></show>` |
| `panos_job_status` / `panos_job_wait` | commit job 28 -> `{"status":"FIN","progress":100,"result":"OK"}` |

## Error paths proven against real firmware

The failure mode the design contract calls out - PAN-OS answering an error with
**HTTP 200** and `<response status="error">` - was confirmed on hardware, not
mocks:

- nonexistent xpath -> tool returned an error (not a false success)
- malformed xpath -> error
- REST `location=device-group` with a nonexistent device group -> REST HTTP 400 surfaced as an error

## Defects found by this run

1. **XML numeric coercion destroyed identifiers.** `fast-xml-parser` ran with
   default value parsing, so `<serial>023009014025</serial>` parsed to the NUMBER
   `23009014025` - leading zero gone. Since every Panorama-routed call addresses a
   firewall by `target=<serial>`, a serial read from the API and passed back as
   `target` would have addressed nothing. `av-version`/`family` were likewise
   coerced. Fixed by disabling tag/attribute value parsing.
2. **`panos_devices_list` blamed credentials for a Panorama-only command.** On a
   standalone firewall it returned PAN-OS code 17 with the hint "Check PANOS_HOST
   and PANOS_API_KEY are set correctly" - while 13 other calls succeeded with
   those same credentials in the same session.
3. **PAN-OS failures collapsed to an opaque string.** A bad xpath produced bare
   "PAN-OS API error" with no code and no appliance `<msg>` text, despite
   `PanosApiError` already carrying code/httpStatus/responseText.
4. **Log/report job ids are a separate namespace, undocumented.** `panos_logs_query`
   and `panos_report_dynamic` return ids that are NOT in the job table:
   `panos_job_status` on them returns code 7, and so does a raw
   `<show><jobs><id>...</id></jobs></show>`, proving it is PAN-OS behavior rather
   than bad command construction. `panos_job_status` on commit job 28 works
   correctly. The tool descriptions did not say to use `panos_logs_retrieve` /
   `panos_report_get` instead, so the obvious next call fails.
5. **`panos_status` echoed a credential prefix** (`PANOS_API_KEY: LUFRPT...`) into
   the transcript.

## Not exercised

Every mutating tool - config set/edit/delete/rename/clone/move/override, REST
create/update/delete, commit, commit_all, content/software download+install,
system reboot, certificate generate/renew/revoke/import, GlobalProtect
disconnect - was deliberately NOT called. This is the user's live production
firewall and they were away from keyboard; the safety contract requires
per-call approval at the point of risk. Those tools remain UNVERIFIED against
hardware.
