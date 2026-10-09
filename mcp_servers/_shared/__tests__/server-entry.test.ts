/**
 * Run with: node --experimental-strip-types --test __tests__/server-entry.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  textResult, formatToolSummary, serveStatelessRequest, runMain, requestUrl, respondHealth,
  respondMissingCredentials, respondNotFound, listenHttp, httpConfigFromEnv,
} from "../server-entry.ts";

describe("textResult", () => {
  it("omits isError unless true", () => {
    assert.deepEqual(textResult("hi"), { content: [{ type: "text", text: "hi" }] });
    assert.deepEqual(textResult("hi", false), { content: [{ type: "text", text: "hi" }] });
    assert.deepEqual(textResult("bad", true), { content: [{ type: "text", text: "bad" }], isError: true });
  });
});

describe("formatToolSummary", () => {
  it("lists one line per tool", () => {
    const tools = [{ name: "a", description: "da" }, { name: "b", description: "db" }] as never[];
    assert.equal(formatToolSummary(tools), "- a: da\n- b: db");
  });
});

describe("serveStatelessRequest", () => {
  it("connects, hands the request over, and closes both on response close", async () => {
    const calls: string[] = [];
    let onClose: () => void = () => {};
    const res = { on: (_e: string, cb: () => void) => { onClose = cb; } };
    const server = { connect: async () => { calls.push("connect"); }, close: () => { calls.push("server.close"); } };
    const transport = { handleRequest: () => { calls.push("handle"); }, close: () => { calls.push("transport.close"); } };
    await serveStatelessRequest(server, transport, {} as never, res as never);
    assert.deepEqual(calls, ["connect", "handle"]);
    onClose();
    assert.deepEqual(calls, ["connect", "handle", "transport.close", "server.close"]);
  });
});

describe("runMain", () => {
  it("logs a rejection and exits 1", async () => {
    const realExit = process.exit;
    const exits: unknown[] = [];
    const logged: unknown[] = [];
    process.exit = ((code?: number) => { exits.push(code); }) as never;
    try {
      runMain(async () => { throw new Error("boom"); }, (m, f) => logged.push([m, f.error]));
      await new Promise((r) => setImmediate(r));
    } finally {
      process.exit = realExit;
    }
    assert.deepEqual(logged, [["Fatal startup error", "boom"]]);
    assert.deepEqual(exits, [1]);
  });

  it("does nothing when main resolves", async () => {
    let logged = 0;
    runMain(async () => {}, () => { logged++; });
    await new Promise((r) => setImmediate(r));
    assert.equal(logged, 0);
  });
});

function fakeRes() {
  const seen: { status?: number; headers?: unknown; body?: string } = {};
  return {
    seen,
    res: {
      writeHead: (status: number, headers: unknown) => { seen.status = status; seen.headers = headers; },
      end: (body: string) => { seen.body = body; },
    } as never,
  };
}

describe("http responders", () => {
  it("requestUrl falls back to / and localhost", () => {
    assert.equal(requestUrl({ headers: {} } as never).href, "http://localhost/");
    assert.equal(requestUrl({ url: "/mcp?x=1", headers: { host: "h:1" } } as never).href, "http://h:1/mcp?x=1");
  });

  it("respondHealth answers /health and /healthz only", () => {
    for (const path of ["/health", "/healthz"]) {
      const { seen, res } = fakeRes();
      assert.equal(respondHealth(new URL(`http://x${path}`), res), true);
      assert.equal(seen.status, 200);
      assert.equal(seen.body, '{"status":"ok"}');
    }
    const { seen, res } = fakeRes();
    assert.equal(respondHealth(new URL("http://x/mcp"), res), false);
    assert.equal(seen.status, undefined);
  });

  it("respondMissingCredentials writes the 401 envelope in key order", () => {
    const { seen, res } = fakeRes();
    respondMissingCredentials(res, "need key", ["A"], ["B"]);
    assert.equal(seen.status, 401);
    assert.equal(seen.body, '{"error":"Missing credentials","message":"need key","required":["A"],"optional":["B"]}');
  });

  it("respondNotFound lists endpoints", () => {
    const { seen, res } = fakeRes();
    respondNotFound(res, ["/mcp"]);
    assert.equal(seen.status, 404);
    assert.equal(seen.body, '{"error":"Not found","endpoints":["/mcp"]}');
  });

  it("listenHttp resolves after the listen callback", async () => {
    let called = false;
    const server = { listen: (_p: number, _h: string, cb: () => void) => cb() };
    await listenHttp(server as never, 1, "h", () => { called = true; });
    assert.equal(called, true);
  });
});

describe("httpConfigFromEnv", () => {
  it("reads port, host and gateway mode with defaults", () => {
    const saved = { p: process.env.MCP_HTTP_PORT, h: process.env.MCP_HTTP_HOST, a: process.env.AUTH_MODE };
    try {
      delete process.env.MCP_HTTP_PORT; delete process.env.MCP_HTTP_HOST; delete process.env.AUTH_MODE;
      assert.deepEqual(httpConfigFromEnv(), { port: 8080, host: "0.0.0.0", isGatewayMode: false });
      process.env.MCP_HTTP_PORT = "9000"; process.env.MCP_HTTP_HOST = "127.0.0.1"; process.env.AUTH_MODE = "gateway";
      assert.deepEqual(httpConfigFromEnv(), { port: 9000, host: "127.0.0.1", isGatewayMode: true });
    } finally {
      for (const [k, v] of [["MCP_HTTP_PORT", saved.p], ["MCP_HTTP_HOST", saved.h], ["AUTH_MODE", saved.a]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});
