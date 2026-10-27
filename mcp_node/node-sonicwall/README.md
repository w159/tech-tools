# node-sonicwall

Typed Node.js client for the SonicOS 7 REST API (`/api/sonicos`). Zero runtime
dependencies (global `fetch`, Node 18+). Used by `mcp_servers/sonicwall-mcp`.
Contract: `docs/architecture/sonicwall-connector-design.md`.

```ts
import { SonicwallClient, SonicwallApiError } from 'node-sonicwall';

const fw = new SonicwallClient({ host: 'fw.example.com', username: 'apiadmin', password: '...' });
const version = await fw.request('GET', '/version');   // logs in lazily
await fw.create('address-objects/ipv4', { address_objects: [{ ipv4: { name: 'web', host: { ip: '10.0.0.5' } } }] });
await fw.commit();                                      // writes are staged until commit
await fw.logout();                                      // release the single admin slot
```

Behavior worth knowing:

- Lazy login (`POST /auth`, Basic), optional bearer token, cookie replay, tolerated `POST /start-management`.
- One re-login and retry on 401. `session().relogins` counts them and `warnings()` carries the
  "pending config was discarded" notice.
- Any `status.success === false`, error-level `info[]`, or HTTP >= 400 throws `SonicwallApiError`, even on HTTP 200.
- Writes enter config mode once per session; a 405 `E_NON_CONFIG` re-enters once and retries.
- `verifyTls: false` uses a per-request `https.Agent`; `NODE_TLS_REJECT_UNAUTHORIZED` is never touched.
- Error messages and `responseText` never contain the password, Basic header, or bearer token.

`npm test` runs vitest with an injected fake `fetch`. `npm run build` emits ESM, CJS and types.
