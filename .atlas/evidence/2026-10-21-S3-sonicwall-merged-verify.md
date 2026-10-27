# S3: sonicwall connector, full gates on the merged tree

Tree: main at e8204552 (merges of worker/u1-client, u3-wiring, u2-server, u4-fleet).
Run by the lead on 2026-10-21 10:46 local via context-mode ctx_batch_execute, concurrency 1.

| Check | Command | Result |
|---|---|---|
| client unit tests | `cd mcp_node/node-sonicwall && npm install && npm test` | vitest: 1 file, 19 passed, exit 0 |
| server boot probe | `cd mcp_servers/sonicwall-mcp && npm install && npm run test:boot` | PROBE PASS; no-creds 2 tools; full 41 tools (read=29, mutating=11, unprefixed-mutating=1, 11 DESTRUCTIVE:-prefixed); CFG_-only through `_env/load.mjs` 41; unresolved placeholders 2; six guard cases rejected locally; password line `configured (23 chars)` |
| fleet harness | `node test-mcp-tools.mjs sonicwall` | PASS (placeholders): boot, floor 41, prose/annotation agreement, shape, 0 mismatches; PASS (no-creds): 2 meta tools, status names SONICWALL_HOST, SONICWALL_USERNAME, SONICWALL_PASSWORD |
| wiring test | `python3 -m unittest discover -s plugins/atlas/scripts -p test_connectors_wiring.py` | Ran 10 tests, OK |
| contract tests | `python3 -m unittest discover -s plugins/atlas/hooks -p test_atlas_contract.py` | Ran 108 tests, OK (skipped=3) |
| banned characters | python scan of node-sonicwall/src, sonicwall-mcp/src, design doc, plugin.json, .env.template | only pre-existing hits in .env.template lines 60, 61, 90, 119, 122 (ninjaone, vanta, spanning blocks); none in sonicwall files |
| worktrees | `atlas_wt.py status` | `[]` (all four merged and removed) |

Per-unit receipts and verifier reports: `2026-10-21-S2-U1-*.md`, `-S2-U2-*.md`,
`-S2-U3-*.md`, `-S2-U4-receipt.md` in this folder.

Not claimed: live validation against a SonicWall appliance. The next step for that
is `sonicwall_status` under real `SONICWALL_*` credentials, expected to report
`GET /version` output and `session.loggedIn: true`.
