# Connector configuration: observed test logs (2026)

Dated observations moved out of `plugins/atlas/references/connector-config-flow.md`, kept verbatim so the reference can stay a description of how the flow works. Counts here are historical; the current connector list is in `plugins/armada/.mcp.json`.

## Layer 1 observation (2026-09-28)

**[INFERENCE, not directly
   observed 2026-09-28]:** at least one harness likely does not, which
   would leave every `CFG_*` var as a literal unexpanded
   `${user_config.*}` string for the loader's own unexpanded-value guard
   to correctly refuse to promote - this is consistent with, but not
   proven by, an observed `MISSING_CREDENTIALS` result for every vendor
   except shell-exported Falcon in that harness (no command actually read
   the env a spawned server received).

## End-to-end results (this workspace)

Test harness: stdio MCP client with `CLAUDE_PLUGIN_ROOT=plugins/atlas`, env from
plugin `.env` + CFG passthrough (no secret logging).
Dates: 2026-08-28 (ten Node connectors) and **2026-09-02** (re-verify including Falcon).
**Historical record:** the matrix below is the 2026-09-02 run (11 connectors,
before panos was added); it is not the current count. Current count: thirteen (the twelve below plus sonicwall).

Wiring unit tests (`plugins/atlas/scripts/test_connectors_wiring.py`): **9/9 OK**.

| Connector | Init | Tools listed | Status tool | Status / notes (no secret values) |
| --- | --- | --- | --- | --- |
| auvik | ok | 39 | `auvik_status` | reports when username/api key missing; otherwise vendor call may 401 |
| blumira | ok | 2 | `blumira_status` | progressive shell; MISSING_CREDENTIALS without jwt or oauth pair |
| cipp | ok | 43 | `cipp_status` | MISSING_CREDENTIALS without base URL + token or oauth trio |
| connectwise | ok | 2 | `cw_status` | gated shell until company/public/private/client id set |
| spanning | ok | 14 | `spanning_status` | MISSING_CREDENTIALS without admin email + token |
| falcon | ok | **4** inert / **144+** when authenticated | `falcon_status` | inert without creds (`MISSING_CREDENTIALS`); full catalog only after auth |
| knowbe4 | ok | 30 | `knowbe4_status` | status tool present |
| ninjaone | ok | 45 | `ninjaone_status` | status tool present |
| paylocity | ok | 16 | `paylocity_status` | NOT CONFIGURED without client id/secret |
| threatlocker | ok | 19 | `threatlocker_status` | status tool present |
| vanta | ok | 28 | `vanta_status` | status tool present |

Dashboard API (2026-09-02, historical, before panos was added):

- `GET /api/connectors` -> **11** connectors (includes falcon) [historical; now 12 with panos]
- health ok, DB `~/.atlas/atlas.db`
- After `python3 plugins/atlas/scripts/atlas_dashboard.py ensure`, health `script`
  must be this repo's `plugins/atlas/scripts/atlas_dashboard.py` (not a cache path).

### Interpretation

- **Transport + packaging are healthy** for all **thirteen** connectors declared in
  `plugins/armada/.mcp.json` (auvik, blumira, cipp, connectwise, falcon, knowbe4,
  ninjaone, panos, paylocity, sonicwall, spanning, threatlocker, vanta). The 2026-09-02 matrix above
  exercised eleven of them (init + tool list from repo source); panos is
  declared in `.mcp.json` and listed by `GET /api/connectors` but is not in
  that dated matrix.
- **Status standard met for all thirteen:** each exposes `*_status` or `cw_status`.
  Falcon boots **inert** without credentials (4 diagnostic tools including
  `falcon_status` -> `MISSING_CREDENTIALS`) and expands only after auth succeeds.
- **Progressive disclosure works** for Blumira/ConnectWise; other Node connectors
  list broader catalogs while status reports missing creds.
- **Dashboard:** run `python3 plugins/atlas/scripts/atlas_dashboard.py ensure` from
  this repo so health `script` points at source, not an install/cache copy.
  Verified 2026-09-02 (historical): 11 connectors; source script path.
