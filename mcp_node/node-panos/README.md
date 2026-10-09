Part of [tech-tools](https://github.com/w159/tech-tools) — see repo for the matching MCP server (`mcp_servers/panos-mcp`) and the design contract (`docs/panos-connector-design.md`).

# node-panos

Typed Node.js/TypeScript client for the PAN-OS XML API and the PAN-OS REST API, for Panorama and standalone firewalls.

> **Vendored within the [tech-tools](https://github.com/w159/tech-tools) monorepo.**
> Consumed by `panos-mcp` via `"node-panos": "file:../../mcp_node/node-panos"`.
> It is not published to npm — do not `npm install node-panos`.

## Features

- Both PAN-OS APIs behind one client: XML (`/api/`) and REST (`/restapi/<version>/`)
- API key sent in the `X-PAN-KEY` header, never in a query string
- Error detection from the parsed `<response>` envelope, not the HTTP status
- Sub-clients for REST resources (`client.rest`) and job polling (`client.jobs`)
- Optional per-request TLS opt-out for appliances still serving a factory certificate, with no process-wide `NODE_TLS_REJECT_UNAUTHORIZED` mutation
- Exactly one runtime dependency: `fast-xml-parser`

## Installation

This library is vendored — no separate installation needed. It is consumed by `panos-mcp` as a local file dependency within the monorepo.

## Quick Start

```typescript
import { PanosClient, keygen, PanosApiError } from 'node-panos';

const client = new PanosClient({
  host: 'panorama.example.com',
  apiKey: process.env.PANOS_API_KEY!,
  target: '023009014025', // optional managed-firewall serial
});

// Operational command
const info = await client.op('<show><system><info/></system></show>');

// Version, serial, model
const version = await client.version();

// Read the candidate config at an xpath
const candidate = await client.config('get', { xpath: "/config/devices/entry[@name='localhost.localdomain']" });

// REST objects
const addresses = await client.rest.list('Objects', 'Addresses', { location: 'vsys', vsys: 'vsys1' });

// Commit, then wait on the job it returns
const { jobId } = await client.commit();
if (jobId) await client.jobs.wait(jobId, { timeoutMs: 300_000 });
```

## Configuration

```typescript
const client = new PanosClient({
  host: 'panorama.example.com',  // hostname or IP, no scheme and no path
  apiKey: 'your-api-key',
  target: '023009014025',        // optional; default serial for every call
  verifyTls: true,               // optional, defaults to true
  restVersion: 'v11.1',          // optional, defaults to 'v11.1'
  timeoutMs: 60_000,             // optional, defaults to 60_000
});
```

`host` and `apiKey` are the only required fields. There is no default `host`: PAN-OS publishes no vendor base URL, because the base URL is the appliance itself.

### TLS

`verifyTls` defaults to `true` and uses global `fetch`. Setting it `false` disables certificate verification for that appliance — it routes through `node:https` with a per-request `Agent({ rejectUnauthorized: false })` rather than mutating process-wide TLS state, but the connection is no longer protected against interception. Use it only for an appliance serving a self-signed or factory certificate.

## API Reference

### XML API

```typescript
await client.request({ type: 'op', cmd: '<show><jobs/></show>' });     // raw request
await client.op('<show><system><info/></system></show>');               // type=op
await client.config('set', { xpath, element });                         // type=config
await client.commit({ action: 'all' });                                 // returns { jobId }
await client.logs({ 'log-type': 'traffic', nlogs: '20' });              // type=log
await client.report({ reporttype: 'dynamic', reportname: 'top-app-summary' });
await client.exportFile({ category: 'configuration' });                 // { contentType, bytes, text? }
await client.importFile({ category: 'certificate' }, { name, content });
await client.version();                                                 // type=version
```

`config` takes any PAN-OS config action: `show`, `get`, `set`, `edit`, `delete`, `rename`, `clone`, `move`, `override`, `multi-move`, `multi-clone`, `complete`.

### REST sub-client

```typescript
const loc = { location: 'vsys', vsys: 'vsys1' };

await client.rest.list('Objects', 'Addresses', loc);
await client.rest.get('Objects', 'Addresses', 'web-server', loc);
await client.rest.create('Objects', 'Addresses', 'web-server', body, loc);
await client.rest.update('Objects', 'Addresses', 'web-server', body, loc);
await client.rest.remove('Objects', 'Addresses', 'web-server', loc);
```

`RestLocation` uses PAN-OS's own wire spelling — `location`, `vsys`, `'device-group'` (hyphenated), `template`, `target` — so a location object can be handed straight to the query string. A `target` on the location overrides the client-level default.

### Jobs sub-client

```typescript
const status = await client.jobs.status('42');
const final = await client.jobs.wait('42', { timeoutMs: 300_000, pollMs: 2_000 });
```

Job-table jobs only: commits, content and software download/install, tech-support exports. Log-query and report IDs live in a different PAN-OS namespace and answer code 7 (Object not present) here.

### keygen

```typescript
const apiKey = await keygen({
  host: 'panorama.example.com',
  user: 'admin',
  password: 'secret',
  verifyTls: true,
});
```

`type=keygen` is issued as a **POST with the credentials in the request body**, never a GET with them in the URL. The returned key is long-lived; store it, do not log it.

## Error Handling

PAN-OS answers authorization failures, bad xpaths, and malformed elements with **HTTP 200** and `<response status="error" code="403">`. A client that checks `res.ok` reports every one of those as a success, so this one reads `status` from the parsed body instead:

```typescript
import { PanosApiError } from 'node-panos';

try {
  await client.op('<show><devices><all/></devices></show>');
} catch (error) {
  if (error instanceof PanosApiError) {
    console.log(error.code);          // PAN-OS vendor code, e.g. '17', as a string
    console.log(error.httpStatus);    // transport status, frequently 200
    console.log(error.responseText);  // raw XML for diagnosis
  }
}
```

REST failures surface as the same `PanosApiError` with `code` set to the HTTP status.

## XML parsing is not numeric — and must not become so

`fast-xml-parser` is configured with exactly four options, and two of them are load-bearing:

```typescript
new XMLParser({
  attributeNamePrefix: '@',
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
});
```

`parseTagValue` and `parseAttributeValue` are **both** `false` to disable `strnum` coercion. PAN-OS serials, versions, job IDs, and error codes are identifiers, not quantities. Coercion drops leading zeros, so serial `023009014025` would parse as `23009014025` — and every `target=<serial>` route built from that value silently addresses the wrong appliance, or no appliance at all. Live validation is what pinned this down; three of the tests exist solely to guard it. Do not turn either option on.

## TypeScript Support

All types are exported:

```typescript
import type {
  PanosConfig,
  ConfigAction,
  ConfigParams,
  LogParams,
  ReportParams,
  ExportParams,
  ImportParams,
  RestLocation,
  RestLocationKind,
  JobStatus,
} from 'node-panos';
```

## Tests

Nine vitest tests in `tests/client.test.ts` over captured PAN-OS response shapes — success and HTTP-200 error envelopes, empty results, commit job-ID extraction, header placement of the API key, `target` inclusion/omission, and the three identifier-preservation guards (leading-zero serial, digit-only version and family, string error code).

```bash
npm test
```

## License

Apache-2.0

## Author

w159
