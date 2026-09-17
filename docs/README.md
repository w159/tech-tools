# tech-agent docs

Developer documentation, vendor SDKs, and framework references for every MCP server in this repo. Use this folder as the source-of-truth when extending, debugging, or asking an AI agent to update an MCP server.

## Layout

```
docs/
├── vendors/          # one folder per upstream vendor (matches mcp_servers/ and mcp_node/)
│   ├── auvik/        # Auvik API (network monitoring)
│   ├── blumira/      # Blumira Public API (SIEM/XDR) + OpenAPI spec
│   ├── cipp/         # CIPP (M365 MSP) — CIPP, CIPP-API, docs-site repos cloned
│   ├── connectwise-manage/  # ConnectWise Manage REST
│   ├── knowbe4/      # KnowBe4 Reporting + User Event + GraphQL APIs (OpenAPI YAML)
│   ├── ninjaone/     # NinjaOne / NinjaRMM Public API v2
│   ├── paylocity/    # Paylocity API Hub
│   ├── spanning/     # Spanning Backup (M365/GWS/SF)
│   ├── threatlocker/ # ThreatLocker Portal API
│   └── vanta/        # Vanta — 5 official repos cloned (incl. MCP server + Claude Code plugin)
└── frameworks/       # SDK + protocol references
    ├── anthropic-sdk/        # anthropic-sdk-python + anthropic-sdk-typescript
    ├── mcp-sdk-typescript/   # @modelcontextprotocol/sdk source
    ├── mcp-sdk-python/       # mcp Python SDK (FastMCP + low-level Server)
    ├── mcp-protocol/         # spec repo (2024-11-05 → 2025-11-25 + draft)
    └── claude-code/          # public mirror + plugins/skills/hooks/mcp/settings docs
```

## How to use

- **Maintaining an MCP server?** Read the vendor's `README.md` first, then check cloned repos / OpenAPI specs for endpoint shapes.
- **Pointing an AI agent at it?** Reference the absolute path (e.g. `docs/vendors/vanta/README.md`) when asking for changes — the agent will have everything it needs without leaving the repo.
- **Refreshing docs?** Each cloned repo is a depth-1 clone — `git -C <repo> pull` to update. WebFetched markdown pages note their source URL at the top.

## MCP connector boot gate (2026-09-17)

`node test-mcp-tools.mjs` at the repo root is the boot and tool-count gate `AGENTS.md:95`
requires for any connector change; `node test-mcp-tools.mjs <svc>` probes one connector and
`--list` prints the known names. It launches each connector exactly as
`plugins/atlas/.mcp.json` declares it - the eleven Node connectors as
`plugins/atlas/mcp/<name>/server.mjs` over MCP stdio, `falcon` through its
`uv run --project plugins/atlas/mcp/falcon ...` entry - with placeholder credentials in a
from-scratch child environment, so it needs no real credentials and cannot reach a live vendor
appliance. Four checks per connector: BOOT, FLOOR (no tool-count regression), AGREEMENT
(`DESTRUCTIVE:` / `VISIBLE-TO-OTHERS:` prose must carry `readOnlyHint: false`), SHAPE. The
contract it enforces is `standards/connector-safety-signals.md`.

Last run: exit 0, PASS - 523 tools across 12 connectors, 0 safety-signal mismatches, and every
connector fully enumerated (0 gated, 0 skipped). "Fully enumerated" is the point: a tool the
harness never lists is a tool whose safety signals were never checked, so connectors that hide
tools behind a `<vendor>_navigate` step are walked domain by domain and unioned, and falcon -
which registers its domain modules only after an OAuth exchange - is probed against a loopback
stub that answers `POST /oauth2/token` and nothing else.

| Server | Status | Tools (floor) | Notes |
|--------|--------|---------------|-------|
| auvik | PASS | 39 (39) | no prose effect markers, so AGREEMENT is vacuous here |
| blumira | PASS | 32 (32) | 6 marked, 6 annotated; 2 listed cold + 30 behind 5 `blumira_navigate` domains |
| cipp | PASS | 43 (43) | 12 marked mutating, 15 annotated mutating |
| connectwise | PASS | 52 (52) | no prose effect markers, so AGREEMENT is vacuous here |
| falcon | PASS | 145 (145) | Python connector, launched via `uv`; 45 annotated mutating, 0 prose markers, so AGREEMENT is vacuous here |
| knowbe4 | PASS | 30 (30) | no prose effect markers, so AGREEMENT is vacuous here |
| ninjaone | PASS | 45 (45) | 9 marked mutating, 14 annotated mutating |
| panos | PASS | 60 (60) | 32 marked mutating, 34 annotated mutating |
| paylocity | PASS | 16 (16) | no prose effect markers, so AGREEMENT is vacuous here |
| spanning | PASS | 14 (14) | 1 marked, 1 annotated |
| threatlocker | PASS | 19 (19) | 1 marked, 1 annotated |
| vanta | PASS | 28 (28) | no prose effect markers, so AGREEMENT is vacuous here |

A vacuous AGREEMENT row is a known limitation, not a clean bill of health: the check compares
prose against annotations, so a connector that marks nothing as mutating passes by agreeing with
itself. `.atlas/.run/vacuous-check.mjs` is the heuristic used to probe that blind spot.

## Known gaps

- **Paylocity, ThreatLocker, Spanning, NinjaOne, ConnectWise**: no public SDK on GitHub. Docs are authored from upstream Swagger/portal where available + the local MCP source.
- **Several vendor docs sites** are auth-gated (CIPP, ThreatLocker portal swagger, Paylocity developer portal, KnowBe4 SPA). Where pages 404'd they are noted in each README.
- **CIPP folder is 192 MB** (full CIPP + CIPP-API clones). The CIPP-API repo contains `openapi.json` with 192 endpoints — that's the authoritative API surface.
