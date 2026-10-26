# S-panos-offline-suite-green: panos connector offline verification is green at 60 tools / 32 destructive; live-appliance validation remains UNVERIFIED

- id: S-panos-offline-suite-green
- status: verified
- verified_by: main-agent-direct-execution
- verified_at: 2026-09-17T15:11:21+00:00

## Evidence
- mcp_node/node-panos: npm test -> vitest 4.1.11, 1 file / 6 tests passed; covers success envelope, HTTP-200 error envelope -> PanosApiError code '403', empty <result/>, commit jobId '42', X-PAN-KEY header with key absent from URL, target present/omitted (tests/client.test.ts:20,27,37,44,51,61)
- mcp_servers/panos-mcp: npm run test:boot -> exit 0, PROBE PASS; gate states 2 / 3 / 60 tools, destructive-prefixed 32, panos_system_reboot description starts 'DESTRUCTIVE: VISIBLE-TO-OTHERS:', unresolved ${user_config.*} -> 2 tools, CFG_-only injection -> 60 tools
- Probe spawns node --import plugins/atlas/mcp/_env/load.mjs plugins/atlas/mcp/panos/server.mjs (tests/boot-probe.mjs:11,26), exercising the shipped bundle through the CFG_ prefix-stripping loader rather than dist/
- UNVERIFIED: no call has reached a real Panorama or firewall. All evidence is mocked fetch plus stdio ListTools. Blocked on PANOS_HOST plus PANOS_API_KEY or PANOS_USERNAME/PANOS_PASSWORD from the user.

## Reproduction
cd mcp_node/node-panos && npm test; cd ../../mcp_servers/panos-mcp && npm run test:boot

## Proposed fix
none recorded

## Doc refs
- docs/architecture/panos-connector-design.md:219-248

## History
- no earlier verdicts
