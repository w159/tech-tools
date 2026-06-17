# Auvik MCP Server

MCP server for the Auvik network monitoring API. This server provides tools to interact with Auvik's network monitoring platform, allowing you to manage devices, networks, alerts, and more.

## Features

- **Multi-tenant support** - Works in both single-tenant and gateway (per-request credential) modes
- **Spec-verified coverage** - 39 tools whose paths, filters, and enums are checked against the live Auvik OpenAPI spec
- **Transport flexibility** - Supports both HTTP and stdio transports
- **Resilient HTTP** - Follows 308 region redirects transparently and retries 429s with backoff

## Tools Available

39 read-only tools. Endpoint paths, query filters, and enum values are verified
against the live Auvik OpenAPI spec (`/spec`). List endpoints are JSON:API —
paginate by passing the `page[after]` cursor from `links.next` into `pageAfter`,
or call `auvik_navigate` with the `links.next` URL. The `tenants` parameter is
optional on inventory endpoints (omit to span every accessible tenant).

### Status and Navigation
- `auvik_status` - Preflight: report whether credentials are configured and verify them live
- `auvik_navigate` - Follow a JSON:API `links.next`/`prev`/`first` URL to paginate

### Tenants
- `auvik_tenants_list` - List all accessible tenants (IDs + domainPrefix)
- `auvik_tenants_detail` - Tenant detail by domain prefix
- `auvik_tenants_get_detail` - Tenant detail by numeric ID (needs id + domainPrefix)

### Devices
- `auvik_devices_list` - List devices (filter by type/vendor/status/network/modifiedAfter)
- `auvik_devices_get` - Single device basic info
- `auvik_devices_get_details` / `auvik_devices_list_details` - Device discovery/manage detail
- `auvik_devices_get_extended` / `auvik_devices_list_extended` - Extended detail (traffic insights)
- `auvik_devices_list_warranty` / `auvik_devices_get_warranty` - Warranty / service coverage
- `auvik_devices_list_lifecycle` / `auvik_devices_get_lifecycle` - End-of-life / end-of-support

### Networks
- `auvik_networks_list` / `auvik_networks_get` - Networks (VLAN/routed/wifi/subnets)
- `auvik_networks_list_detail` / `auvik_networks_get_detail` - Network detail (scope, collectors)

### Interfaces
- `auvik_interfaces_list` / `auvik_interfaces_get` - Network interfaces

### Configurations
- `auvik_configurations_list` / `auvik_configurations_get` - Device config backups

### Components
- `auvik_components_list` / `auvik_components_get` - CPUs, disks, fans, power supplies

### Entities
- `auvik_entities_list_notes` / `auvik_entities_get_note` - Entity notes
- `auvik_entities_list_audits` / `auvik_entities_get_audit` - Audit logs (terminal/tunnel sessions)

### Alerts
- `auvik_alerts_list` - List alerts (filter by severity/status/dismissed/time/entity)
- `auvik_alerts_get` - Single alert detail

### Statistics
- `auvik_statistics_device` - Device metrics (cpu/memory/storage/bandwidth/packets)
- `auvik_statistics_device_availability` - Uptime / outage
- `auvik_statistics_interface` - Interface metrics (utilization/bandwidth/loss/discard/packets)
- `auvik_statistics_service` - Service-monitor ping metrics
- `auvik_statistics_component` - Per-component metrics (fan speed, PSU power, etc.)
- `auvik_statistics_oid` - SNMP OID monitor statistics

### Billing
- `auvik_billing_client_usage` - Per-client billable device counts
- `auvik_billing_device_usage` - Per-device billable usage

## Installation

### Environment Variables

#### Single-tenant mode (stdio/direct):
```bash
AUVIK_USERNAME=your_auvik_username
AUVIK_API_KEY=your_auvik_api_key
AUVIK_REGION=us1  # Optional: us1, us2, us3, us4, eu1, eu2, au1, ca1
```

#### Gateway mode (HTTP):
Credentials are provided via request headers:
- `x-auvik-username`
- `x-auvik-api-key`
- `x-auvik-region` (optional)

### Local Development

```bash
git clone https://github.com/w159/tech-tools.git
cd auvik-mcp
npm install
npm run build

# Run with stdio transport
npm start

# Run with HTTP transport
npm run start:http
```

## Usage

### With MCP Gateway

The server is designed to work with an MCP Gateway. The gateway handles authentication and routing:

```typescript
// Gateway automatically injects credentials via headers
const response = await fetch('http://gateway:8080/mcp', {
  method: 'POST',
  headers: {
    'x-auvik-username': 'your_username',
    'x-auvik-api-key': 'your_api_key',
    'x-auvik-region': 'us1',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'auvik_devices_list',
      arguments: {}
    }
  })
});
```

### Direct Usage (stdio)

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"auvik_status","arguments":{}}}' | npm start
```

## API Regions

Auvik operates in multiple regions. Set the appropriate region:

- `us1` - US East (default)
- `us2` - US West
- `us3` - US Central
- `us4` - US South
- `eu1` - Europe West
- `eu2` - Europe Central
- `au1` - Australia
- `ca1` - Canada

## Error Handling

The server implements comprehensive error handling:

- Invalid credentials return 401 errors
- Missing resources return descriptive "not found" messages with `isError: true`
- API rate limits and service errors are properly mapped
- All responses include structured error information

## Health Check

The server exposes a health endpoint at `/health` that always returns 200 OK. This endpoint does not require authentication and is suitable for liveness probes.

## Development

```bash
# Install dependencies
npm install

# Run in development mode with file watching
npm run dev

# Run tests
npm test

# Type checking
npm run typecheck

# Lint
npm run lint

# Build
npm run build
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

## Support

- [GitHub Issues](https://github.com/w159/tech-tools/issues)
- [Auvik API Documentation](https://api.auvik.com/documentation)
- [MCP Protocol Documentation](https://modelcontextprotocol.io/)