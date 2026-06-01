# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-05-28

### Changed
- **Full re-verification against the live Auvik OpenAPI spec (`/spec`).** Every tool's
  endpoint path, query filters, and enum values are now sourced from the spec and
  confirmed with a live end-to-end probe (37/37 tool calls succeed against a real tenant).
- Corrected wrong/invalid enums and filters that caused 400s in clients:
  - Alert `status` enum is now `created/resolved/paused/unpaused` (was an invalid
    `created/acknowledged/resolved/cleared`).
  - Interface statistics `statId` enum fixed (`transmittedTotal` was invalid; real values
    are `bandwidth/utilization/packetLoss/packetDiscard/packet*`).
  - Device/interface/network/component/entity filters now use the real enum value sets;
    removed the bogus `componentType` filter from `auvik_components_list`.
- Statistics `thruTime` is now correctly required and `deviceId`/`interfaceId` are optional.
- `tenants` is now optional on inventory endpoints (the API does not require it).
- HTTP client now re-sends auth across 308 region redirects, accepts
  `application/vnd.api+json`, and returns legible messages for empty-body 404s.

### Added
- By-id tools: `auvik_tenants_get_detail`, `auvik_devices_get_warranty`,
  `auvik_devices_get_lifecycle`, `auvik_devices_get_extended`, `auvik_networks_get_detail`,
  `auvik_components_get`, `auvik_entities_get_note`, `auvik_entities_get_audit`,
  `auvik_billing_device_usage`.
- List tools: `auvik_devices_list_details`, `auvik_devices_list_extended`.
- Statistics tools: `auvik_statistics_device_availability`, `auvik_statistics_service`,
  `auvik_statistics_component`, `auvik_statistics_oid`.
- Forward/backward pagination cursors (`pageAfter`/`pageBefore`) on all list tools.

### Removed
- Nonexistent tools that never matched the API (`auvik_tenants_get`,
  `auvik_alerts_dismiss`, `auvik_statistics_snmp_poller`).
- Unused `src/schemas/` zod scaffolding and the redundant direct `zod` dependency.

## [0.1.0] - 2024-05-21

### Added
- Initial release of Auvik MCP server
- Support for HTTP and stdio transports
- Multi-tenant support with AsyncLocalStorage-based credential injection
- 25+ tools covering all major Auvik API endpoints:
  - Status and navigation tools
  - Tenant management (list, get, detail)
  - Device management (list, get, details, warranty, lifecycle)
  - Network discovery (list, get)
  - Interface management (list)
  - Configuration management (list, get)
  - Entity management (notes, audits)
  - Alert management (list, get, dismiss)
  - Statistics (device, interface, service, SNMP poller)
  - Billing (client usage, device usage)
- Comprehensive error handling with proper MCP error mapping
- Empty-result handling to prevent LLM hallucination
- Health check endpoint
- Type-safe implementation with Zod validation
- OSS hygiene files (README, LICENSE, CONTRIBUTING, etc.)
- GitHub Actions workflows for CI/CD
- Semantic release automation

### Security
- Credentials handled securely via environment variables or request headers
- No credential leakage in health check endpoint
- Proper input validation and sanitization