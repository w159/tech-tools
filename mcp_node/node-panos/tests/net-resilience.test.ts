import { createServer, type Server, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PanosClient } from '../src/index.js';

// Both transports must be bounded: verifyTls true goes through fetch, verifyTls false through
// node:https. A refused connection fails fast with a clear error; a server that accepts and
// never answers (no TLS handshake) is cut off at the configured timeout, once, not twice.
const SECRET = 'sekrit-credential-4711';
const TIMEOUT_MS = 300;
let hung: Server;
const sockets = new Set<Socket>();
let hungPort = 0;
let closedPort = 0;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

const call = (port: number, verifyTls: boolean): Promise<unknown> => new PanosClient({ host: `127.0.0.1:${port}`, apiKey: SECRET, verifyTls, timeoutMs: TIMEOUT_MS }).op('<show><system><info/></system></show>');

async function failureOf(port: number, verifyTls: boolean): Promise<{ err: Error; ms: number }> {
  const t0 = Date.now();
  const err = await call(port, verifyTls).then(() => new Error('call unexpectedly succeeded'), (e) => e as Error);
  return { err, ms: Date.now() - t0 };
}

describe('node-panos network resilience', () => {
  beforeAll(async () => {
    hung = createServer((socket) => { sockets.add(socket); socket.on('error', () => undefined); });
    hungPort = await listen(hung);
    const probe = createServer();
    closedPort = await listen(probe);
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => hung.close(() => resolve()));
  });

  for (const verifyTls of [true, false]) {
    it(`refused connection fails fast (verifyTls=${verifyTls})`, async () => {
      const { err, ms } = await failureOf(closedPort, verifyTls);
      expect(err.message).toMatch(/ECONNREFUSED|connection refused/);
      expect(err.message).toContain('127.0.0.1');
      expect(err.message).not.toContain(SECRET);
      expect(ms).toBeLessThan(2000);
    });

    it(`server that never answers is cut off once at the timeout (verifyTls=${verifyTls})`, async () => {
      const { err, ms } = await failureOf(hungPort, verifyTls);
      expect(err.message).toMatch(new RegExp(`timed out after ${TIMEOUT_MS}ms`));
      expect(err.message).not.toContain(SECRET);
      expect(ms).toBeGreaterThanOrEqual(TIMEOUT_MS - 50);
      expect(ms).toBeLessThan(TIMEOUT_MS + 250);
    });
  }
});
