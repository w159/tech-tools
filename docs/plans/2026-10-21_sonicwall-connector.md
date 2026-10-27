# SonicWall connector stage map

Status: S0-S4 done, 2026-10-21 (live hardware validation remains a ROADMAP item). Owner: lead (orchestrator). Contract:
`docs/architecture/sonicwall-connector-design.md`.

| Stage | Unit | Deliverable | Failable check | Depends on |
|---|---|---|---|---|
| S0 research | - | `.atlas/.run/sonicos/research-sonicos-api*.md` | claims cite URL or inventory row | - |
| S1 design | - | `docs/architecture/sonicwall-connector-design.md` | env table, tool table, error map, test list present | S0 |
| S2 implement | S2-U1 | `mcp_node/node-sonicwall` (client + vitest) | `npm test` in the package: every test in "The check" passes, each written red first | S1 |
| S2 implement | S2-U2 | `mcp_servers/sonicwall-mcp` (server, inventory, boot probe, bundle) | `npm run build && npm run bundle:atlas && npm run test:boot` pass; bundle at `plugins/atlas/mcp/sonicwall/server.mjs` | S2-U1 merged |
| S2 implement | S2-U3 | wiring: `.mcp.json`, `plugin.json`, `.env.template`, vendors/connectors refs, README rows, `test_connectors_wiring.py` | `python3 -m unittest plugins/atlas/scripts/test_connectors_wiring.py` passes with sonicwall enumerated | S1 (bundle presence check waits for S2-U2) |
| S3 verify | - | `.atlas/evidence/2026-10-21-sonicwall-*.md`, findings stamped verified | vitest, boot probe, wiring test, `node test-mcp-tools.mjs sonicwall`, contract tests all green on the merged tree | S2 |
| S4 docs | - | CHANGELOG, ROADMAP, README, connector docs, version bump | docs-auditor reports no drift; completion gate passes | S3 |

Waves: 2a = U1 + U3 in parallel (disjoint write sets, worktrees `u1-client`,
`u3-wiring`); 2b = U2 after U1 merges (server consumes `file:../../mcp_node/node-sonicwall`).
Evidence strategy: U1 proof-first; U2 proof-first via the boot probe; U3
characterization via `test_connectors_wiring.py` (extend the enumeration, watch
it fail on the missing bundle, then pass once U2 lands).

## Stage status (2026-10-21)

| Stage | Status | Sha / evidence |
|---|---|---|
| S0 research | done | `.atlas/.run/sonicos/research-*.md` |
| S1 design | done | `docs/architecture/sonicwall-connector-design.md` |
| S2-U1 client | done | 069c2374, merge bffaf1f9; `.atlas/evidence/2026-10-21-S2-U1-{receipt,verify}.md` |
| S2-U2 server | done | f73d59d4, merge c905ee13; `-S2-U2-{receipt,verify}.md` |
| S2-U3 wiring | done | 24b00f57, merge fe52d634; `-S2-U3-{receipt,verify}.md` |
| S2-U4 fleet | done | 837390bc, 7fc22c3e, merge e8204552; `-S2-U4-receipt.md` |
| S3 verify | done | main e8204552; `.atlas/evidence/2026-10-21-S3-sonicwall-merged-verify.md` |
| S4 docs | done | CHANGELOGs, ROADMAP, README by docs-curator; 12.7.0 in plugin.json and marketplace.json; docs audit: all areas current after four fixes; dashboard CONNECTOR_AUTH entry (S4-U2) |
