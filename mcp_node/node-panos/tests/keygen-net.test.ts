import { createServer, type Server, type Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { keygen } from '../src/keygen.js';

// panos_keygen sends the account password, so it must not hang on a dead appliance either.
const PASSWORD = 'sekrit-credential-4711';
let hung: Server;
const sockets = new Set<Socket>();
let hungPort = 0;

beforeAll(async () => {
  hung = createServer((socket) => { sockets.add(socket); socket.on('error', () => undefined); });
  await new Promise<void>((resolve) => hung.listen(0, '127.0.0.1', resolve));
  hungPort = (hung.address() as { port: number }).port;
});

afterEach(() => { delete process.env.MCP_HTTP_TIMEOUT_MS; });

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => hung.close(() => resolve()));
});

describe('keygen network resilience', () => {
  for (const verifyTls of [true, false]) {
    it(`is cut off by the request timeout (verifyTls=${verifyTls})`, async () => {
      process.env.MCP_HTTP_TIMEOUT_MS = '300';
      const t0 = Date.now();
      const err = await keygen({ host: `127.0.0.1:${hungPort}`, user: 'admin', password: PASSWORD, verifyTls })
        .then(() => new Error('call unexpectedly succeeded'), (e) => e as Error);
      expect(err.message).toMatch(/timed out after 300ms/);
      expect(err.message).not.toContain(PASSWORD);
      expect(Date.now() - t0).toBeLessThan(1000);
    });
  }
});
