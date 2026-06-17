Part of [tech-tools](https://github.com/w159/tech-tools) — see repo for the matching MCP server (`mcp_servers/kaseya-spanning-backup-mcp`) and plugin (`plugins/spanning-*`).

# node-spanning

Comprehensive, fully-typed Node.js / TypeScript client library for the
[Spanning Cloud Backup REST API](https://www.spanning.com/).

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

## Features

- Coverage of Spanning's M365 surface: users, services, backups, restores, audit, license
- Per-platform base URL routing (`m365` / `gws` / `salesforce`)
- Bearer-token + admin-email pair authentication
- Cursor-based pagination via async iterators
- Rate limiting tuned for the 100 req/min Spanning limit, with concurrency capped at 4
- Async restore queue + poll helpers (`restores.queue`, `restores.get`, `restores.waitFor`)
- Typed error hierarchy with a "verify both fields" hint baked into 401 messages
- ESM and CommonJS dual exports, full `.d.ts` types
- Zero `any` in the public API

## Install

This package is vendored locally and consumed via a `file:` dependency from sibling MCP servers. There is no public registry release.

## Quick start

```typescript
import { SpanningClient } from 'node-spanning';

const client = new SpanningClient({
  adminEmail: 'admin@example.com',
  apiToken: process.env.SPANNING_API_TOKEN!,
  platform: 'm365', // or 'gws' | 'salesforce'
});

for await (const user of client.users.listAll({ limit: 100 })) {
  console.log(user.id, user.email);
}
```

## Configuration

```typescript
new SpanningClient({
  adminEmail: 'admin@example.com',
  apiToken: 'spanning-api-token',

  // Platform selection — picks the per-platform base URL
  platform: 'm365', // 'm365' | 'gws' | 'salesforce', default 'm365'

  // Optional — override the base URL entirely (forward-compat / staging)
  apiUrl: 'https://o365-api.spanningbackup.com/external',

  // Optional — tune client-side rate limiting
  rateLimit: {
    enabled: true,
    maxRequests: 100,
    windowMs: 60_000,
    throttleThreshold: 0.8,
    retryAfterMs: 5_000,
    maxRetries: 3,
    maxConcurrency: 4,
  },
});
```

## Platforms

Spanning is purchased and licensed per platform. A token issued for one
platform CANNOT call another platform's endpoints.

| Platform     | Base URL                                              |
| ------------ | ----------------------------------------------------- |
| `m365`       | `https://o365-api.spanningbackup.com/external`        |
| `gws`        | `https://api.spanningbackup.com/external`             |
| `salesforce` | `https://salesforce-api.spanningbackup.com`           |

> **Pair-bound credentials**: Spanning ties API tokens to a specific admin
> email. If either the email or the token is wrong (or they don't match the
> pair Spanning has on file), the upstream API returns a generic
> `401 Unauthorized`. The SDK includes a hint in
> `SpanningAuthenticationError.message` to verify BOTH fields together AND
> that they were issued for the configured platform.

## Authentication

Every request sends two headers:

```
X-Spanning-Admin: admin@example.com
X-Spanning-Authorization: Bearer <api_token>
```

## Pagination

Cursor-based:

```
GET /external/users?limit=100
→ { items: [...], next: "abc123" }

GET /external/users?limit=100&cursor=abc123
```

Default `limit` is 50, max is 200. Iteration stops automatically when
`next` is `null`.

```typescript
const page = await client.users.list({ limit: 100 });

for await (const u of client.users.listAll({ limit: 200 })) { /* ... */ }
```

## Restores: queue + poll workflow

Restores are asynchronous. Queue with `restores.queue(userId, service, payload)`,
then wait for the restore to leave the `queued`/`running` state.

```typescript
const { restoreId } = await client.restores.queue('user-123', 'mail', {
  backupId: 'backup-789',
});

const final = await client.restores.waitFor(restoreId, {
  intervalMs: 30_000,    // default — do not poll faster
  timeoutMs: 60 * 60_000,
});

if (final.status === 'failed') {
  console.error('Restore failed:', final.error);
}
```

## API surface

```typescript
client.users.list(params)
client.users.listAll(params)
client.users.get(userId)

client.services.list(userId)

client.backups.list(userId, service, params)
client.backups.listAll(userId, service, params)

client.restores.queue(userId, service, payload)
client.restores.get(restoreId)
client.restores.waitFor(restoreId, { intervalMs?, timeoutMs? })

client.audit.list({ from?, to?, ...params })
client.audit.listAll({ from?, to?, ...params })

client.license.get()
```

## GWS / Salesforce support

The first cut implements the M365 surface fully. The same generic resources
also work transparently against the GWS and Salesforce base URLs (just set
`platform: 'gws' | 'salesforce'`) — Spanning's user/service/backup/restore
shapes are similar across platforms.

Platform-specific helpers live on `client.gws` and `client.salesforce`. They
currently throw `NotImplementedError`; full first-class support for those
two platforms is planned.

> **Salesforce object IDs**: Salesforce uses 15- or 18-character,
> case-sensitive object IDs (e.g. `0051a000001abcdAAA`) — NOT the
> user-friendly identifiers from M365 / GWS. The `SalesforceObjectId` type
> is exported as a marker.

## Error handling

```typescript
import {
  SpanningError,
  SpanningAuthenticationError,
  SpanningForbiddenError,
  SpanningNotFoundError,
  SpanningConflictError,
  SpanningRateLimitError,
  SpanningServerError,
} from 'node-spanning';

try {
  await client.users.get('user-123');
} catch (err) {
  if (err instanceof SpanningAuthenticationError) {
    // Verify the admin email AND the token together — see err.message
  } else if (err instanceof SpanningConflictError) {
    // A restore is already in flight for these items
  } else if (err instanceof SpanningRateLimitError) {
    await new Promise((r) => setTimeout(r, err.retryAfter));
  }
}
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run build
```

## License

Apache-2.0
