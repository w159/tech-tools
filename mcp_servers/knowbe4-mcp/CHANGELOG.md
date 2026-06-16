# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-06-12

### Fixed
- Corrected store-purchases endpoint paths to match the KnowBe4 Reporting API:
  `knowbe4_store_purchases_list/get` now call `/v1/training/store_purchases[/{id}]`
  instead of the non-existent `/v1/store/purchases[/{id}]`.
- Corrected policies endpoint paths: `knowbe4_policies_list/get` now call
  `/v1/training/policies[/{id}]` instead of the non-existent `/v1/policies[/{id}]`.
- Fixed region resolution: `KNOWBE4_REGION` (eu/ca/uk/de) was silently ignored
  because `resolveBaseUrl` always returned the hardcoded US default before the
  region map was consulted, routing all non-US accounts to the US shard.
  `KNOWBE4_BASE_URL` (explicit override) still takes precedence; the region map
  is now honored when no override is set.
- Fixed bundle entry point: `manifest.json` `mcp_config.args` pointed at the
  non-existent `dist/index.js`; it now matches `entry_point`
  (`dist/mcp_servers/knowbe4-mcp/src/index.js`), so the packed `.mcpb` launches.
- Restored the missing shared source `mcp_servers/_shared/error-envelope.ts`
  (only the compiled output was present) so the server builds from a clean tree.

### Changed
- Bumped version to 1.1.1 across `package.json` and `manifest.json` (resolves
  prior 1.0.3 / 1.1.0 drift).
- `knowbe4_status` base-URL description now always reports the active region URL
  and remediation hint.

## [Unreleased]

### Fixed
- `/health` is now a shallow, unauthenticated liveness probe returning `200 {"status":"ok"}` — it no longer calls `getCredentials()`. In gateway mode (`AUTH_MODE=gateway`) credentials only arrive per-request via the `X-KnowBe4-API-Key` header, so the previous credential-gated `/health` always returned `503`, causing upstream liveness probes to fail. Added `/healthz` as an alias.

### Added
- Lazy-loading meta-tools mode (`LAZY_LOADING=true` env var) as an alternative to decision-tree navigation
  - `knowbe4_list_categories`: Discover available tool categories with descriptions and counts
  - `knowbe4_list_category_tools`: Load full tool schemas for a specific category on demand
  - `knowbe4_execute_tool`: Execute any domain tool by name without navigation
  - `knowbe4_router`: Intent-based tool suggestion from plain-language descriptions
- `src/utils/categories.ts`: Tool category definitions and intent routing logic

## [1.0.0] - 2026-03-10

### Added
- Initial release of KnowBe4 MCP Server
- Decision-tree navigation architecture with six domains:
  - `account`: Account info, subscription details, and account-level risk score history
  - `users`: User listing, details, and individual risk score history
  - `groups`: Group listing, details, member management, and group risk score history
  - `phishing`: Phishing campaigns, Phishing Security Tests (PSTs), and per-recipient results
  - `training`: Training campaigns, enrollments, store purchases (ModStore), and policies
  - `reporting`: Aggregated phishing summaries, training summaries, and risk overview with top-risk groups
- Multi-region support: US, EU, CA, UK, DE (via KNOWBE4_REGION env var)
- Bearer token authentication via KNOWBE4_API_KEY
- Dual transport support: stdio (Claude Desktop) and HTTP streaming (hosted deployment)
- Gateway auth mode: credentials injected via X-KnowBe4-API-Key header
- Health check endpoint at `/health`
- Elicitation support for interactive user filtering
- Structured stderr-only logging with configurable log level
- Comprehensive test suite with vitest
- Semantic release CI/CD pipeline
- MCPB manifest for Claude Desktop installation
