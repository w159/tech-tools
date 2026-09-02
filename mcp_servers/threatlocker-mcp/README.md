# ThreatLocker MCP Server

A Model Context Protocol (MCP) server that provides AI assistants with access to the ThreatLocker Portal API. Manage computers, approval requests, audit logs, and organizations through natural language interactions.

## Features

- **Stateless Architecture**: No session state required, fresh connections per request
- **Decision-Tree Navigation**: Navigate domains with `threatlocker_navigate`
- **Gateway Mode**: Multi-tenant support via HTTP headers
- **Names, not GUIDs**: devices by hostname, approval requests by hostname plus file path, audit by hostname / user / action; IDs only behind `full:true`
- **Comprehensive Error Handling**: Detailed error messages and logging; unknown or ambiguous names fail closed with the candidate names

## Tools

### Navigation
- `threatlocker_navigate` - Navigate to a domain to see available tools
- `threatlocker_status` - Check API connection status and available domains

Every tool takes and returns names. GUIDs and hashes appear only with `full:true`.
List results start with a one-line summary (`totalDevices`, `pendingApprovals`,
the audit window).

### Computers (by hostname)
- `threatlocker_computers_list` - devices with `totalDevices`; filters `search`, `group`, `mode`, `includeChildOrganizations`, `orderBy`
- `threatlocker_computers_get` - one device by `hostname`: OS/version, make/model, serial, group, mode, last check-in, deny counts, recent users
- `threatlocker_computers_get_checkins` - check-in history by `hostname` (heartbeats hidden unless `includeHeartbeats`)
- `threatlocker_computers_maintenance_modes` - active/scheduled maintenance modes by `hostname`

### Computer Groups
- `threatlocker_computer_groups_list` / `threatlocker_computer_groups_dropdown` - group names with operating system; optional `operatingSystem` (Windows, macOS, Linux)

### Approval Requests (by hostname plus file path fragment)
- `threatlocker_approvals_list` - `status` (Pending default, Approved, Rejected, Not Learned, Added to Application, Escalated, Self-Approved), `search`, `includeChildOrganizations`
- `threatlocker_approvals_get` - one request selected by `hostname` + `pathContains` (or `approvalRequestId`)
- `threatlocker_approvals_pending_count` - pending count, `includeChildOrganizations`
- `threatlocker_approvals_get_permit_application` - what approving would permit, same selector
- `threatlocker_approvals_approve` - DESTRUCTIVE; same selector, must match exactly one pending request; pass the unmodified `json` from the permit-application call

### Audit Log (Unified Audit)
- `threatlocker_audit_search` - `hostname`, `username`, `action` (Permit/Deny), `actionType`, exact `path` / `application` / `policy` (server-side), `contains` (client-side substring), `hours` (default 24) or `startDate`/`endDate`
- `threatlocker_audit_get` - one event by `auditEntryId` (from `full:true` search output)
- `threatlocker_audit_file_history` - every event for `hostname` + `fullPath`

### Organizations
- `threatlocker_organizations_list_children` - child organizations by name (empty for a single-org tenant)
- `threatlocker_organizations_get_auth_key` - agent enrollment Auth Key (a secret; not an API token)
- `threatlocker_organizations_for_move_computers` - organizations the key can act on, by name

### Instance letter
`THREATLOCKER_BASE_URL` must point at your instance:
`https://portalapi.<letter>.threatlocker.com/portalapi`, where the letter is in
your portal URL (Help menu). The `g` default is not universal; a token from
another instance gets `440 TOKEN_REVOKED`. `threatlocker_status` probes the
instances and names the one that accepts the key.

## Configuration

### Environment Variables

#### Stdio Mode (Direct API Access)
```bash
THREATLOCKER_API_KEY=your_api_key_here
THREATLOCKER_ORGANIZATION_ID=your_org_id_here
MCP_TRANSPORT=stdio
```

#### Gateway Mode (Multi-tenant)
```bash
AUTH_MODE=gateway
MCP_TRANSPORT=http
MCP_HTTP_PORT=8080
MCP_HTTP_HOST=0.0.0.0
```

#### Gateway Mode Headers
When running in gateway mode, include these headers with each request:
- `X-Threatlocker-Api-Key`: Your ThreatLocker API key
- `X-Threatlocker-Organization-Id`: Your organization ID

### Logging
```bash
LOG_LEVEL=debug|info|warn|error  # Default: info
```

## Local Development

1. Clone the repository:
```bash
git clone https://github.com/w159/tech-tools.git
cd threatlocker-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Set environment variables:
```bash
cp .env.example .env
# Edit .env with your ThreatLocker credentials
```

4. Build and run:
```bash
npm run build
npm start

# Or for development with hot reload:
npm run dev
```

5. Test the server:
```bash
# Stdio mode
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' | npm start

# HTTP mode
curl http://localhost:8080/health
```

## Architecture

### Directory Structure
```
src/
├── domains/           # Domain-specific handlers
│   ├── computers.ts
│   ├── computer_groups.ts
│   ├── approval_requests.ts
│   ├── audit_log.ts
│   ├── organizations.ts
│   ├── navigation.ts
│   └── index.ts
├── utils/             # Utilities
│   ├── client.ts      # ThreatLocker API client
│   ├── logger.ts      # Structured logging
│   ├── types.ts       # TypeScript types
│   └── resolve.ts     # hostname / approval-request name resolution
├── server.ts          # MCP server creation
├── index.ts           # Stdio transport entry
└── http.ts            # HTTP transport entry
```

### Design Patterns
- **Domain Handlers**: Each API area has its own handler with `getTools()` and `handleCall()`
- **Lazy Loading**: Domain handlers are imported on-demand
- **Fresh Connections**: New server instance per HTTP request for stateless operation
- **Credential Invalidation**: Client is reset when credentials change
- **Name Resolution**: every ID-only PortalAPI endpoint is reached through `resolve.ts`, which fails closed on zero or several matches

## License

Apache-2.0 - see [LICENSE](LICENSE) for details.