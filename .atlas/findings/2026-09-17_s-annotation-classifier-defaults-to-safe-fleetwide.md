# S-annotation-classifier-defaults-to-safe-fleetwide: Nine connectors still infer MCP safety annotations from tool names and answer 'read-only' for any name no pattern matched

- id: S-annotation-classifier-defaults-to-safe-fleetwide
- status: verified
- verified_by: main-agent-direct-execution
- verified_at: 2026-09-17T16:20:00+00:00

## Evidence
- Final fallback 'return "read";' present at annotate-tool.ts:132 in auvik, blumira, cipp, kaseya-spanning-backup, knowbe4, paylocity, threatlocker, vanta and at :148 in ninjaone. Only panos (fixed today) and connectwise-manage (no annotate-tool.ts) are clean.
- readOnlyHint is the flag an MCP client reads to decide it may run a tool WITHOUT asking the human. A classifier that guesses from names and defaults to 'read' therefore fails toward unattended execution of unrecognized tools.
- Fleet audit of the shipped bundles (348 tools, 11 connectors, dual-strategy placeholder env) found exactly one CURRENT mislabel: ninjaone_devices_service_control - description 'DESTRUCTIVE: Start, stop, pause, or restart a Windows service ... can take a production application offline', annotation readOnlyHint:true. Cause: 'service_control' matches nothing in DESTRUCTIVE_PATTERNS, which has no 'control' entry.
- The other eight are latent, not safe: they pass today only because their mutating tool names happen to match a pattern. The trap fires on the next tool whose name nobody anticipated - which is exactly how panos shipped 22 mislabeled tools.
- These connectors drive production MSP systems: CIPP disables users and resets passwords, NinjaOne runs scripts and controls services, ThreatLocker changes policies.

## Reproduction
node .atlas/.run/fleet-annotations.mjs; grep -rn 'return "read";' mcp_servers/*/src/annotate-tool.ts

## Proposed fix
Make the description marker authoritative and fail closed on an unmatched name, per the panos pattern (one decision emits both the DESTRUCTIVE: prefix and the annotations). Delete the name-pattern guess rather than extending its tables.

## Doc refs
- none

## History
- no earlier verdicts
