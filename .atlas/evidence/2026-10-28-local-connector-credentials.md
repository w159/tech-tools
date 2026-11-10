# Evidence: local connector credentials repaired and re-verified (2026-10-28)

Observed behaviour, captured from the running connector servers on this machine.
No secret value is reproduced - only key names, value lengths, HTTP status codes
and vendor status text.

Local credential file: `~/.config/atlas/atlas.env` (mode 600), the fallback the
armada connector loaders read (`plugins/armada/mcp/_env/load.mjs`
`DEFAULT_ATLAS_ENV_FILE`). Backup taken before the change:
`~/.config/atlas/atlas.env.bak-<timestamp>` (600).

## 1. What was wrong

The file declared the key names but the running MCP servers in this session had
no usable values for several connectors, and there were no `FALCON_*` entries at
all. The values now in the file were sourced from Key Vault `gwh-mcp-gateway-kv`
(resource group `gwh-mcp-gateway-rg`, subscription Henssler Azure), i.e. the same
credentials the gateway container already authenticates with.

Keys written (name = value length, nothing else):

```
AUVIK_USERNAME=20  AUVIK_API_KEY=48  AUVIK_REGION=3
SPANNING_ADMIN_EMAIL=20  SPANNING_API_TOKEN=36  SPANNING_PLATFORM=4  SPANNING_API_URL=47
PAYLOCITY_CLIENT_ID=48  PAYLOCITY_CLIENT_SECRET=88  PAYLOCITY_COMPANY_ID=6
THREATLOCKER_API_KEY=64  THREATLOCKER_ORGANIZATION_ID=36  THREATLOCKER_BASE_URL=46
FALCON_CLIENT_ID=32  FALCON_CLIENT_SECRET=40  FALCON_BASE_URL=32
```

## 2. Verification - one real status call per vendor

```
node /tmp/gw-auth/probe.mjs plugins/armada/mcp/<vendor>/server.mjs <vendor>_status
```
with the env read from `~/.config/atlas/atlas.env` (`MCP_TRANSPORT=stdio`), and
for falcon its own python entry point (`falcon_mcp.server --transport stdio`).

| Vendor | Observed status text | Verdict |
|---|---|---|
| auvik | `"hasCredentials": true`, `"verified": true`, `"authCheck": "OK (HTTP 200)"`, region us1 | WORKING |
| spanning | `Credentials: Configured (platform=m365, baseUrl=https://o365-api-us.spanningbackup.com/external)` / `Auth check: OK (HTTP 200, 344 ms)` | WORKING |
| paylocity | `Credentials: Configured` / `Auth check: OK (HTTP 200, 225 ms)` | WORKING |
| threatlocker | `Credentials: Configured` / `Auth check: OK (authenticated; pending approvals: 1)` | WORKING (previous key was revoked: HTTP 440) |
| falcon | `"state": "OK"`, `"configured": true`, `"authenticated": true`, `"tool_count": 145`, `falcon_check_connectivity -> {"connected": true}` | WORKING (previously `AUTH_FAILED`) |
| knowbe4 | `Auth check: FAILED HTTP 401: Invalid Token` | REJECTED upstream - the vault's key is refused too; needs a new KnowBe4 key |
| vanta | `Auth check: FAILED HTTP 401: Vanta token mint failed: 401` | REJECTED upstream - needs new Vanta credentials |

Left alone on purpose: `KNOWBE4_API_KEY`, `VANTA_CLIENT_ID`, `VANTA_CLIENT_SECRET`
(copied values would be refused the same way). No credential exists anywhere on
this machine or in the vault for blumira, sonicwall or the gateway-side CIPP REST
backend, so those stay unprovisioned.

## 3. Recorded status

`.atlas/departments/*.yaml` now records the verified state - key names only:

- `it-operations.yaml`: ninjaone, connectwise, auvik, spanning - `enabled`
- `hr.yaml`: paylocity - `enabled` (paylocity_client_id, paylocity_client_secret, paylocity_company_id)
- `security.yaml`: falcon, threatlocker - `enabled`; knowbe4, vanta, blumira - `disabled`
- `microsoft-365.yaml`: cipp - `disabled` (cipp_mcp_url, cipp_client_id)

Leak check: `grep -riE '(secret|token|apikey|api_key)["']?[[:space:]]*[:=][[:space:]]*["']?[A-Za-z0-9_/+-]{20,}' .atlas/departments/` returns nothing.

## 4. The plugin version that makes the CIPP change installable

The armada plugin version had not moved with the CIPP connector change, so every
installed copy stayed on the old bundled-CIPP server. Now:

```
plugins/armada/.claude-plugin/plugin.json   version 2.2.1 -> 2.3.0
.claude-plugin/marketplace.json              armada entry 2.2.1 -> 2.3.0
claude plugin validate plugins/armada        -> Validation passed (PRIVACY_URL_MISSING warning only)
cd plugins/armada && python3 tests/test_armada_contract.py -> Ran 21 tests, OK
```

## 5. What still needs a session restart

The MCP servers read `~/.config/atlas/atlas.env` at startup, so the mounted tools
in the session that ran this work still carry the old environment. After a
restart, auvik, spanning, paylocity, threatlocker and falcon come up with their
full tool sets, and CIPP comes up as the URL-only remote connector once
`cipp_mcp_url` is set (`cipp_client_id` has a working default).

Proof command for a restarted session:

```
cd plugins/armada && python3 tests/test_armada_contract.py
curl -s https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/health
```
