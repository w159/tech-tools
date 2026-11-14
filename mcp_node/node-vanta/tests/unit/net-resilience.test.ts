import { createServer, type Server, type Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { server as mswServer } from '../mocks/server.js';
import { VantaClient } from '../../src/index.js';

// Request-level network resilience: a refused connection must fail fast with a
// message that names the host, and a server that accepts and never answers must be
// cut off by the per-request timeout. Real sockets, no mocks.
const SECRET = 'sekrit-credential-4711';
let hung: Server;
const sockets = new Set<Socket>();
let hungPort = 0;
let closedPort = 0;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

async function failureOf(call: (base: string) => Promise<unknown>, port: number): Promise<{ err: Error; ms: number }> {
  const t0 = Date.now();
  const err = await call(`http://127.0.0.1:${port}`).then(() => new Error('call unexpectedly succeeded'), (e) => e as Error);
  return { err, ms: Date.now() - t0 };
}

const call = async (base: string): Promise<unknown> => {
  return new VantaClient({ clientId: 'cid', clientSecret: SECRET, baseUrl: base, tokenUrl: `${base}/oauth/token` }).frameworks.list();
};

describe('node-vanta network resilience', () => {
  beforeAll(async () => {
    mswServer.close(); // this file talks to real local sockets, not the msw handlers
    hung = createServer((socket) => { sockets.add(socket); socket.on('error', () => undefined); }); // accepts, never answers
    hungPort = await listen(hung);
    const probe = createServer();
    closedPort = await listen(probe);
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  });

  afterEach(() => { delete process.env.MCP_HTTP_TIMEOUT_MS; });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => hung.close(() => resolve()));
  });

  it('refused connection fails fast and names the host', async () => {
    const { err, ms } = await failureOf(call, closedPort);
    expect(err.message).toMatch(/cannot reach 127\.0\.0\.1:\d+: connection refused/);
    expect(err.message).not.toContain(SECRET);
    expect(ms).toBeLessThan(2000);
  });

  it('server that never answers is cut off by the request timeout', async () => {
    process.env.MCP_HTTP_TIMEOUT_MS = '300';
    const { err, ms } = await failureOf(call, hungPort);
    expect(err.message).toMatch(/timed out after 300ms/);
    expect(err.message).not.toContain(SECRET);
    expect(ms).toBeLessThan(3000);
  });
});
