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

## MCP server test status (2026-05-26)

Run `node test-mcp-tools.mjs` to re-test. Last run:

| Server | Status | Notes |
|--------|--------|-------|
| auvik | ✅ PASS | 39 tools |
| blumira | ⏭ SKIP | needs `BLUMIRA_JWT_TOKEN` |
| cipp | ❌ FAIL | HTTP 401 — caller lacks permission for `ListTenants` |
| connectwise | ✅ PASS | 52 tools (with creds; 2 when unconfigured) |
| kaseya-spanning-backup | ⏭ SKIP | needs `SPANNING_ADMIN_EMAIL` + `SPANNING_API_TOKEN` |
| knowbe4 | ⏭ SKIP | needs `KNOWBE4_API_KEY` |
| ninjaone | ✅ PASS | 26 tools |
| paylocity | ❌ FAIL | token mint HTTP 406 — check `Accept` header / scope |
| threatlocker | ✅ PASS | 17 tools |
| vanta | ✅ PASS | 28 tools |

## Known gaps

- **Paylocity, ThreatLocker, Spanning, NinjaOne, ConnectWise**: no public SDK on GitHub. Docs are authored from upstream Swagger/portal where available + the local MCP source.
- **Several vendor docs sites** are auth-gated (CIPP, ThreatLocker portal swagger, Paylocity developer portal, KnowBe4 SPA). Where pages 404'd they are noted in each README.
- **CIPP folder is 192 MB** (full CIPP + CIPP-API clones). The CIPP-API repo contains `openapi.json` with 192 endpoints — that's the authoritative API surface.
