Part of [tech-tools](https://github.com/w159/tech-tools) — see repo for the matching MCP server (`mcp_servers/auvik-mcp`) and plugin (`plugins/auvik-*`).

# node-auvik

Node.js client library for the Auvik network monitoring API.

## Installation

This package is vendored locally and consumed via a `file:` dependency from sibling MCP servers. There is no public registry release.

## Quick Start

```typescript
import { AuvikClient } from 'node-auvik';

const client = new AuvikClient({
  username: 'your-auvik-email@example.com',
  apiKey: 'your-api-key',
  // Optional: specify region if known, otherwise auto-detected
  region: 'us1', // us1, us2, us3, us4, eu1, eu2, au1, ca1
});

// List all tenants
const tenants = await client.tenants.list();
console.log(tenants.data);

// Get device information
const devices = await client.inventoryDevice.listInfo();
console.log(devices.data);

// List alerts
const alerts = await client.alerts.listHistory();
console.log(alerts.data);
```

## Regions

Auvik operates in multiple regions. If you don't specify a region, the client will automatically probe all regions to find the correct one for your credentials. For better performance, specify your region explicitly:

- `us1`, `us2`, `us3`, `us4` - United States
- `eu1`, `eu2` - Europe 
- `au1` - Australia
- `ca1` - Canada

You can also set the `AUVIK_REGION` environment variable to override region detection.

## Documentation

For complete API documentation, see the [Auvik API Documentation](https://support.auvik.com/hc/en-us/sections/360002960071-Auvik-APIs).


## License

Apache-2.0