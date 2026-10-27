# W3-probe-home: panos and sonicwall boot probes isolate HOME so the developer's atlas.env never reaches a probe case

- id: W3-probe-home
- status: verified
- verified_by: lead
- verified_at: 2026-10-22T09:55:18+00:00

## Evidence
- mcp_servers/panos-mcp: npm test PROBE PASS (was PROBE FAIL: 10 problem(s)); HOME line commented -> fails again
- mcp_servers/sonicwall-mcp: npm test PROBE PASS

## Reproduction
cd mcp_servers/panos-mcp && npm test

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
