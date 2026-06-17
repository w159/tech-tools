Part of [tech-tools](https://github.com/w159/tech-tools) — see repo for the matching MCP server (`mcp_servers/blumira-mcp`) and plugin (`plugins/blumira-*`).

# node-blumira

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Node.js client library for the [Blumira SIEM](https://blumira.com) API. Zero production dependencies, native `fetch`, TypeScript, dual ESM/CJS.

## Installation

This package is vendored locally and consumed via a `file:` dependency from sibling MCP servers. There is no public registry release.

## Quick Start

```typescript
import { BlumiraClient } from 'node-blumira';

const client = new BlumiraClient({
  jwtToken: process.env.BLUMIRA_JWT_TOKEN!,
});

// Check API health
const health = await client.health.check();
console.log(health.data.api_name);

// List open findings
const findings = await client.findings.list({ status: 10 });
console.log(`${findings.meta.total_items} open findings`);

// Resolve a finding
await client.findings.resolve('finding-uuid', {
  resolution: 10, // Valid
  resolution_notes: 'Confirmed and remediated',
});

// MSP: List all accounts
const accounts = await client.msp.listAccounts();
for (const acct of accounts.data) {
  console.log(`${acct.name}: ${acct.open_findings} open findings`);
}
```

## API Coverage

### Organization Endpoints (`/org/`)

| Resource | Methods |
|----------|---------|
| **Health** | `health.check()` |
| **Findings** | `findings.list()`, `findings.get()`, `findings.getDetails()`, `findings.resolve()`, `findings.assignOwners()`, `findings.listComments()`, `findings.addComment()` |
| **Agents/Devices** | `agents.listDevices()`, `agents.getDevice()` |
| **Agents/Keys** | `agents.listKeys()`, `agents.getKey()` |
| **Users** | `users.list()` |
| **Resolutions** | `resolutions.list()` |

### MSP Endpoints (`/msp/`)

| Resource | Methods |
|----------|---------|
| **Accounts** | `msp.listAccounts()`, `msp.getAccount()` |
| **Findings** | `msp.listAllFindings()`, `msp.listFindings()`, `msp.getFinding()`, `msp.resolveFinding()`, `msp.assignFindingOwners()`, `msp.listFindingComments()`, `msp.addFindingComment()` |
| **Agents** | `msp.listDevices()`, `msp.getDevice()`, `msp.listKeys()`, `msp.getKey()` |
| **Users** | `msp.listUsers()` |

## Configuration

```typescript
const client = new BlumiraClient({
  jwtToken: 'your-jwt-token',       // Required
  baseUrl: 'https://api.blumira.com/public-api/v1', // Optional (default)
  maxRetries: 3,                     // Optional (default: 3)
  rateLimitPerMinute: 60,            // Optional (default: 60)
});
```

## Error Handling

```typescript
import { BlumiraError, AuthenticationError, NotFoundError } from 'node-blumira';

try {
  await client.findings.get('nonexistent-id');
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log('Finding not found');
  } else if (error instanceof AuthenticationError) {
    console.log('Invalid JWT token');
  } else if (error instanceof BlumiraError) {
    console.log(`API error ${error.statusCode}: ${error.message}`);
  }
}
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
