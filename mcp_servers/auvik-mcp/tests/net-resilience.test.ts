import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuvikClient } from '../src/client-factory.js';

// The Auvik API host is fixed per region (never a local URL), so the transport is
// stubbed at global fetch with the same shapes undici produces: a TypeError whose
// cause carries the errno for a refused connection, and a request that only ends
// when its AbortSignal fires for a server that never answers.
const SECRET = 'sekrit-credential-4711';
const client = () => createAuvikClient({ username: 'user@example.test', apiKey: SECRET });

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MCP_HTTP_TIMEOUT_MS;
});

describe('auvik network resilience', () => {
  it('refused connection fails fast and names the host', async () => {
    vi.stubGlobal('fetch', async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    });
    const t0 = Date.now();
    const err = await client().tenants.list().then(() => new Error('call unexpectedly succeeded'), (e) => e as Error);
    expect(err.message).toMatch(/cannot reach auvikapi\.us1\.my\.auvik\.com: connection refused/);
    expect(err.message).not.toContain(SECRET);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('server that never answers is cut off by the request timeout', async () => {
    process.env.MCP_HTTP_TIMEOUT_MS = '300';
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    const t0 = Date.now();
    const err = await client().tenants.list().then(() => new Error('call unexpectedly succeeded'), (e) => e as Error);
    expect(err.message).toMatch(/timed out after 300ms/);
    expect(err.message).not.toContain(SECRET);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
