Part of [tech-tools](https://github.com/w159/tech-tools) — see repo for the matching MCP server (`mcp_servers/paylocity-mcp`) and plugin (`plugins/paylocity-*`).

# node-paylocity

Typed Node.js client for the Paylocity REST API. Zero production dependencies, native `fetch`, TypeScript, dual ESM/CJS.

## Installation

This package is vendored locally and consumed via a `file:` dependency from sibling MCP servers. There is no public registry release.

## Quick Start

```typescript
import { PaylocityClient } from 'node-paylocity';

const client = new PaylocityClient({
  clientId: process.env.PAYLOCITY_CLIENT_ID!,
  clientSecret: process.env.PAYLOCITY_CLIENT_SECRET!,
});
```

## License

Apache-2.0
