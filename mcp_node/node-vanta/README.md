Part of [tech-tools](https://github.com/w159/tech-tools) — see repo for the matching MCP server (`mcp_servers/vanta-mcp`) and plugin (`plugins/vanta-*`).

# node-vanta

Typed Node.js client for the Vanta REST API. Zero production dependencies, native `fetch`, TypeScript, dual ESM/CJS.

## Installation

This package is vendored locally and consumed via a `file:` dependency from sibling MCP servers. There is no public registry release.

## Quick Start

```typescript
import { VantaClient } from 'node-vanta';

const client = new VantaClient({
  clientId: process.env.VANTA_CLIENT_ID!,
  clientSecret: process.env.VANTA_CLIENT_SECRET!,
});
```

## License

Apache-2.0
