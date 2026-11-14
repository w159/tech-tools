/**
 * Run with: node --experimental-strip-types --test __tests__/resilient-fetch.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttp, type Server as HttpServer } from "node:http";
import { createServer as createTcp, type Server as TcpServer } from "node:net";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NetworkError, parseRetryAfterMs, resilientFetch, resolveTimeoutMs } from "../resilient-fetch.ts";
import { toolErrorFromCatch } from "../error-envelope.ts";

const here = dirname(fileURLToPath(import.meta.url));

async function listen<S extends HttpServer | TcpServer>(server: S): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}
const live = new Map<TcpServer, Set<import("node:net").Socket>>();
/** TCP server that accepts connections and never answers them. */
function hungServer(onConnection?: () => void): TcpServer {
  const sockets = new Set<import("node:net").Socket>();
  const server = createTcp((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    onConnection?.();
  });
  live.set(server, sockets);
  return server;
}
const close = (s: HttpServer | TcpServer) => new Promise<void>((r) => {
  (s as HttpServer).closeAllConnections?.();
  for (const sock of live.get(s as TcpServer) ?? []) sock.destroy();
  s.close(() => r());
});

async function closedPort(): Promise<number> {
  const probe = createTcp();
  const port = await listen(probe);
  await close(probe);
  return port;
}

const noSleep = { sleep: async () => undefined };

describe("resilientFetch errors", () => {
  it("refused connection fails fast with host and reason, never the path or query", async () => {
    const port = await closedPort();
    const t0 = Date.now();
    await assert.rejects(
      resilientFetch(`http://127.0.0.1:${port}/secret/path?token=sekrit`, { method: "GET" }),
      (err: unknown) => {
        assert.ok(err instanceof NetworkError);
        assert.match(err.message, new RegExp(`^cannot reach 127\\.0\\.0\\.1:${port}: connection refused \\(ECONNREFUSED\\)$`));
        assert.equal(err.code, "ECONNREFUSED");
        assert.equal(err.timedOut, false);
        for (const leak of ["sekrit", "secret/path", "token="]) assert.ok(!err.message.includes(leak), leak);
        return true;
      },
    );
    assert.ok(Date.now() - t0 < 2000);
  });

  it("names the blocked-port case (fetch refuses port 9) instead of a bare 'fetch failed'", async () => {
    await assert.rejects(
      resilientFetch("http://127.0.0.1:9/", { method: "GET" }),
      /^NetworkError: cannot reach 127\.0\.0\.1:9: port is blocked by fetch \(bad port\)$/,
    );
  });

  it("a server that accepts and never answers is cut off by the timeout", async () => {
    const hung = hungServer();
    const port = await listen(hung);
    try {
      const t0 = Date.now();
      await assert.rejects(
        resilientFetch(`http://127.0.0.1:${port}/x`, { method: "GET" }, { timeoutMs: 250 }),
        (err: unknown) => {
          assert.ok(err instanceof NetworkError);
          assert.match(err.message, /timed out after 250ms/);
          assert.equal(err.timedOut, true);
          return true;
        },
      );
      assert.ok(Date.now() - t0 < 2000);
    } finally { await close(hung); }
  });

  it("a timeout is not retried", async () => {
    let calls = 0;
    const hung = hungServer(() => { calls++; });
    const port = await listen(hung);
    try {
      await assert.rejects(resilientFetch(`http://127.0.0.1:${port}/`, { method: "GET" }, { timeoutMs: 150, maxRetries: 3, ...noSleep }));
      assert.equal(calls, 1);
    } finally { await close(hung); }
  });

  it("the caller's own abort passes through untouched", async () => {
    const hung = hungServer();
    const port = await listen(hung);
    try {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 50);
      await assert.rejects(
        resilientFetch(`http://127.0.0.1:${port}/`, { signal: ac.signal }, { timeoutMs: 5000 }),
        (err: unknown) => !(err instanceof NetworkError),
      );
    } finally { await close(hung); }
  });

  it("MCP_HTTP_TIMEOUT_MS sets the default, an explicit value wins", () => {
    const prev = process.env.MCP_HTTP_TIMEOUT_MS;
    try {
      delete process.env.MCP_HTTP_TIMEOUT_MS;
      assert.equal(resolveTimeoutMs(), 20_000);
      process.env.MCP_HTTP_TIMEOUT_MS = "1234";
      assert.equal(resolveTimeoutMs(), 1234);
      assert.equal(resolveTimeoutMs(99), 99);
      process.env.MCP_HTTP_TIMEOUT_MS = "nope";
      assert.equal(resolveTimeoutMs(), 20_000);
    } finally { if (prev === undefined) delete process.env.MCP_HTTP_TIMEOUT_MS; else process.env.MCP_HTTP_TIMEOUT_MS = prev; }
  });
});

describe("resilientFetch retries", () => {
  async function flaky(plan: Array<{ status: number; headers?: Record<string, string> } | "reset">) {
    let n = 0;
    const seen: string[] = [];
    const server = createHttp((req, res) => {
      seen.push(req.method ?? "");
      const step = plan[Math.min(n++, plan.length - 1)];
      if (step === "reset") { req.socket.destroy(); return; }
      res.writeHead(step.status, step.headers);
      res.end("{}");
    });
    const port = await listen(server);
    return { server, port, seen };
  }

  it("retries an idempotent GET on 503 and returns the eventual success", async () => {
    const { server, port, seen } = await flaky([{ status: 503 }, { status: 200 }]);
    try {
      const res = await resilientFetch(`http://127.0.0.1:${port}/`, { method: "GET" }, noSleep);
      assert.equal(res.status, 200);
      assert.equal(seen.length, 2);
    } finally { await close(server); }
  });

  it("is bounded: gives up after maxRetries and hands back the last response", async () => {
    const { server, port, seen } = await flaky([{ status: 500 }]);
    try {
      const res = await resilientFetch(`http://127.0.0.1:${port}/`, { method: "GET" }, { maxRetries: 2, ...noSleep });
      assert.equal(res.status, 500);
      assert.equal(seen.length, 3);
    } finally { await close(server); }
  });

  it("does not retry a POST, even on 503", async () => {
    const { server, port, seen } = await flaky([{ status: 503 }, { status: 200 }]);
    try {
      const res = await resilientFetch(`http://127.0.0.1:${port}/`, { method: "POST", body: "{}" }, noSleep);
      assert.equal(res.status, 503);
      assert.equal(seen.length, 1);
    } finally { await close(server); }
  });

  it("retries a POST only when the caller marks it idempotent", async () => {
    const { server, port, seen } = await flaky([{ status: 502 }, { status: 200 }]);
    try {
      const res = await resilientFetch(`http://127.0.0.1:${port}/`, { method: "POST", body: "{}" }, { idempotent: true, ...noSleep });
      assert.equal(res.status, 200);
      assert.equal(seen.length, 2);
    } finally { await close(server); }
  });

  it("does not retry a 4xx other than 429", async () => {
    const { server, port, seen } = await flaky([{ status: 404 }, { status: 200 }]);
    try {
      const res = await resilientFetch(`http://127.0.0.1:${port}/`, { method: "GET" }, noSleep);
      assert.equal(res.status, 404);
      assert.equal(seen.length, 1);
    } finally { await close(server); }
  });

  it("retries a GET after ECONNRESET", async () => {
    const { server, port, seen } = await flaky(["reset", { status: 200 }]);
    try {
      const res = await resilientFetch(`http://127.0.0.1:${port}/`, { method: "GET" }, noSleep);
      assert.equal(res.status, 200);
      assert.equal(seen.length, 2);
    } finally { await close(server); }
  });

  it("honors a short Retry-After on 429", async () => {
    const { server, port } = await flaky([{ status: 429, headers: { "retry-after": "2" } }, { status: 200 }]);
    const waits: number[] = [];
    try {
      const res = await resilientFetch(`http://127.0.0.1:${port}/`, { method: "GET" }, { sleep: async (ms) => { waits.push(ms); } });
      assert.equal(res.status, 200);
      assert.deepEqual(waits, [2000]);
    } finally { await close(server); }
  });

  it("does not sit through a Retry-After beyond the cap", async () => {
    const { server, port, seen } = await flaky([{ status: 429, headers: { "retry-after": "120" } }, { status: 200 }]);
    const waits: number[] = [];
    try {
      const res = await resilientFetch(`http://127.0.0.1:${port}/`, { method: "GET" }, { sleep: async (ms) => { waits.push(ms); } });
      assert.equal(res.status, 429);
      assert.equal(seen.length, 1);
      assert.deepEqual(waits, []);
    } finally { await close(server); }
  });
});

describe("error envelope", () => {
  const codeOf = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text).error.code;

  it("classifies a NetworkError as NETWORK_ERROR, directly or as the cause of a wrapper", () => {
    const net = new NetworkError("cannot reach h:1: port is blocked by fetch (bad port)", "BAD_PORT", "h:1", false);
    assert.equal(codeOf(toolErrorFromCatch("op", net) as never), "NETWORK_ERROR");
    const wrapped = Object.assign(new Error("wrapper without the usual keywords"), { cause: net });
    assert.equal(codeOf(toolErrorFromCatch("op", wrapped) as never), "NETWORK_ERROR");
  });

  it("a library error carrying statusCode 0 is no longer reported as 'HTTP 0'", () => {
    const net = Object.assign(new Error("Failed to acquire token: cannot reach h:1: connection refused (ECONNREFUSED)"), { statusCode: 0 });
    const out = JSON.parse((toolErrorFromCatch("op", net) as never as { content: Array<{ text: string }> }).content[0].text).error;
    assert.ok(!/HTTP 0/.test(out.message), out.message);
  });
});

describe("parseRetryAfterMs", () => {
  it("parses seconds, dates and junk", () => {
    assert.equal(parseRetryAfterMs("3"), 3000);
    assert.equal(parseRetryAfterMs("0"), 0);
    assert.equal(parseRetryAfterMs(new Date(12_000).toUTCString(), 10_000), 2000);
    assert.equal(parseRetryAfterMs(new Date(1_000).toUTCString(), 10_000), 0);
    assert.equal(parseRetryAfterMs("soon"), undefined);
    assert.equal(parseRetryAfterMs(null), undefined);
  });
});

describe("mcp_node copies", () => {
  it("every mcp_node/node-*/src/net.ts is byte-identical to _shared/resilient-fetch.ts", () => {
    const canonical = readFileSync(join(here, "..", "resilient-fetch.ts"), "utf8");
    const nodeDir = join(here, "..", "..", "..", "mcp_node");
    const copies = readdirSync(nodeDir).filter((n) => existsSync(join(nodeDir, n, "src", "net.ts")));
    assert.ok(copies.length >= 6, `expected at least 6 libraries carrying net.ts, found ${copies.join(",")}`);
    for (const lib of copies) {
      assert.equal(readFileSync(join(nodeDir, lib, "src", "net.ts"), "utf8"), canonical, `${lib}/src/net.ts drifted from _shared/resilient-fetch.ts`);
    }
  });
});
