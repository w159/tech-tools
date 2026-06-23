# Vanta MCP Server

Model Context Protocol server for the [Vanta](https://www.vanta.com) GRC and compliance platform.
Exposes 28 tools across 11 domains so AI agents can query frameworks, controls, tests, evidence
documents, people, vendors, risk scenarios, vulnerabilities, policies, integrations, and endpoint
compliance posture directly from a conversation.

## Requirements

- Node.js 18 or later
- A Vanta API client ID and secret (OAuth2 machine-to-machine credentials from the Vanta Developer
  portal under **Integrations > API**).

## Configuration

| Variable | Required | Default | Notes |
|---|---|---|---|
| `VANTA_CLIENT_ID` | yes | - | OAuth2 client ID from the Vanta Developer portal |
| `VANTA_CLIENT_SECRET` | yes | - | OAuth2 client secret |
| `VANTA_BASE_URL` | no | `https://api.vanta.com/v1` | Override only for staging or sovereign shards |

The server boots and registers all tools even when credentials are absent. The `vanta_status` tool
always responds with a plain-text status message instead of throwing, so agents can check connectivity
before running queries.

## Claude Desktop configuration

Add the following block to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vanta": {
      "command": "node",
      "args": ["/path/to/vanta-mcp/dist/index.js"],
      "env": {
        "VANTA_CLIENT_ID": "your-client-id",
        "VANTA_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

## Example prompts

- "List all controls in our SOC 2 framework that are currently failing or need attention."
- "Which employee compliance tasks are still outstanding? Give me names, emails, and task status."
- "Show me every vulnerability with a past-due SLA and whether a fix is available."
- "What evidence documents are expiring in the next 30 days for our ISO 27001 program?"
- "List our third-party vendors and their risk ratings."

## Available domains and tools

### Navigation (always available)

| Tool | Description |
|---|---|
| `vanta_navigate` | Discover tools by domain. Returns names and descriptions for the selected domain. |
| `vanta_status` | Show credential status, base URL, and domain list. Use to verify connectivity. |

### Frameworks

| Tool | Description |
|---|---|
| `vanta_frameworks_list` | List all compliance frameworks in the workspace (SOC 2, ISO 27001, HIPAA, etc.). |
| `vanta_frameworks_get` | Get a single framework by ID. |
| `vanta_frameworks_list_controls` | List controls within a specific framework. |

### Controls

| Tool | Description |
|---|---|
| `vanta_controls_list` | List GRC controls; filter by `frameworkMatchesAny`. |
| `vanta_controls_get` | Get a single control by ID. |

### Tests

| Tool | Description |
|---|---|
| `vanta_tests_list` | List automated control tests; filter by `statusFilter` or `frameworkFilter`. |
| `vanta_tests_get` | Get a single automated test by ID. |

### Documents

| Tool | Description |
|---|---|
| `vanta_documents_list` | List evidence documents; filter by `frameworkMatchesAny` or `statusMatchesAny`. |
| `vanta_documents_get` | Get a single evidence document by ID. |

### Integrations

| Tool | Description |
|---|---|
| `vanta_integrations_list` | List connected integrations (AWS, Okta, GitHub, etc.). |
| `vanta_integrations_get` | Get a single integration by ID. |
| `vanta_integrations_list_resource_kinds` | List the resource types inventoried by an integration. |
| `vanta_integrations_list_resources` | List individual resources inventoried by an integration. |
| `vanta_integrations_get_resource` | Get a single inventoried resource by ID. |

### People

| Tool | Description |
|---|---|
| `vanta_people_list` | List workforce members; filter by `emailAndNameFilter` or `groupIdsMatchesAny`. |
| `vanta_people_get` | Get a single person by ID. |

### Vendors

| Tool | Description |
|---|---|
| `vanta_vendors_list` | List third-party vendor risk records. |
| `vanta_vendors_get` | Get a single vendor record by ID. |

### Risk Scenarios

| Tool | Description |
|---|---|
| `vanta_risk_scenarios_list` | List enterprise risk register scenarios. |
| `vanta_risk_scenarios_get` | Get a single risk scenario by ID. |

### Vulnerabilities

| Tool | Description |
|---|---|
| `vanta_vulnerabilities_list` | List discovered vulnerabilities with SLA and fix-availability data. |
| `vanta_vulnerabilities_get` | Get a single vulnerability by ID. |

### Policies

| Tool | Description |
|---|---|
| `vanta_policies_list` | List approved policies from the workspace policy library. |
| `vanta_policies_get` | Get a single policy by ID. |

### Monitored Computers

| Tool | Description |
|---|---|
| `vanta_monitored_computers_list` | List endpoints with their compliance posture from the Vanta agent. |
| `vanta_monitored_computers_get` | Get a single monitored computer by ID. |

## Pagination

All `*_list` tools accept:

- `pageSize` (number, default 25) - number of items per page.
- `pageCursor` (string) - opaque cursor returned as `endCursor` on the previous page.

When a response includes a next-page hint, pass the `endCursor` value as `pageCursor` in the next call.

## Response shaping

All list tools default to a compact summary view. Pass `full: true` to receive the complete raw object
from the Vanta API. Use `fields` (array of strings) to select specific top-level fields from the full
object.

## Architecture

```
src/
+-- index.ts              Stdio transport entry point
+-- server.ts             MCP server, request routing for vanta_status / vanta_navigate
+-- annotate-tool.ts      Adds vendor tag to all tool descriptions
+-- domains/
|   +-- navigation.ts     vanta_navigate and vanta_status tool definitions; DOMAINS list
|   +-- index.ts          Lazy domain handler loader with in-process cache
|   +-- frameworks.ts
|   +-- controls.ts
|   +-- tests.ts
|   +-- documents.ts
|   +-- integrations.ts
|   +-- people.ts
|   +-- vendors.ts
|   +-- risk_scenarios.ts
|   +-- vulnerabilities.ts
|   +-- policies.ts
|   +-- monitored_computers.ts
|   +-- _helpers.ts       Re-exports shared response-shaper, error-envelope, base-url modules
+-- utils/
    +-- client.ts         VantaClient singleton; getCredentials() / resetClient()
    +-- logger.ts         Structured logger
    +-- types.ts          DomainName, DomainHandler, CallToolResult types
```

Domain handlers follow a two-method contract: `getTools()` returns the tool definitions; `handleCall()`
dispatches by tool name and returns a `CallToolResult`. Errors are surfaced via `toolErrorFromCatch`
from `_shared/error-envelope.ts`, which maps vendor HTTP status codes to canonical error codes
(`FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `VENDOR_ERROR`, etc.) so agents receive actionable context
without parsing raw exceptions.

## Troubleshooting

**"NOT CONFIGURED" in vanta_status output**
Set `VANTA_CLIENT_ID` and `VANTA_CLIENT_SECRET`. The server registers all tools on startup regardless
of credential state to avoid crashing the MCP host.

**HTTP 401 / FORBIDDEN errors**
The OAuth2 client in Vanta must have the relevant API scopes enabled (e.g. `controls:read`,
`people:read`). Check the Vanta Developer portal under the client's scope configuration.

**HTTP 404 / NOT_FOUND errors**
The resource ID is stale or belongs to a different workspace. Re-run the corresponding `*_list` tool
to get a current ID.

**HTTP 429 / RATE_LIMITED errors**
Vanta enforces per-client rate limits. Wait a moment and retry. For bulk enumeration, add a delay
between paginated calls.

**Unresolved MCP template placeholders (`${user_config.x}`)**
If a MCP host injects unresolved placeholders as env var values, `getCredentials()` detects the
`${...}` pattern and treats the variable as unset. Check that the host's `userConfig` keys match the
names in the server manifest.

## Development

```bash
# Build (run from /tmp to keep node_modules out of iCloud)
cp -r mcp_servers/vanta-mcp /tmp/vanta-build
cd /tmp/vanta-build && npm install && npm run build

# Run tests
npm test

# Pack the distributable .mcpb bundle
npm run pack:mcpb
```

## License

Apache-2.0
