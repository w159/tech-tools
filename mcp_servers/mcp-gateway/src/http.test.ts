import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { AuditLogger, type AuditEvent } from "./audit.js";
import { verifyAccessToken } from "./auth.js";
import { BackendPool } from "./backends.js";
import { directProtectedResourceMetadata, loadConfig, type GatewayConfig } from "./config.js";
import { Gateway } from "./gateway.js";
import { createHttpServer } from "./http.js";
import { compatPolicy, resolveRoles } from "./policy.js";
import { makeSigner, spec, stubBackend, tool, type Signer } from "./test-fixtures/helpers.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const RESOURCE_URL = "https://mcp.example.com/mcp";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;

const config: GatewayConfig = loadConfig({
  ENTRA_TENANT_ID: TENANT_ID,
  ENTRA_CLIENT_ID: CLIENT_ID,
  MCP_RESOURCE_URL: RESOURCE_URL,
  PORT: "0",
  HOST: "127.0.0.1",
});

// Stub Vanta backend exposing one readOnly and one mutating tool.
const READ_TOOL: Tool = tool("vanta_list_controls", "read");
const WRITE_TOOL: Tool = tool("vanta_update_control", "destructive");

const policy = compatPolicy([{ id: "vanta", compatRole: "Vanta" }]);

let httpServer: HttpServer;
let baseUrl: string;
let signer: Signer;
const lines: string[] = [];
const events = (): AuditEvent[] => lines.map((l) => JSON.parse(l) as AuditEvent);

async function signToken(roles: string[], extra: Record<string, unknown> = {}, opts?: { exp?: string }): Promise<string> {
  return signer.sign(
    { iss: ISSUER, aud: CLIENT_ID, tid: TENANT_ID, oid: "user-oid-1", preferred_username: "user@example.com", roles, ...extra },
    opts,
  );
}

async function postMcp(body: unknown, token?: string, headers: Record<string, string> = {}): Promise<Response> {
  const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}/mcp`, { method: "POST", headers: h, body: JSON.stringify(body) });
}

beforeAll(async () => {
  signer = await makeSigner();
  const vanta = spec("vanta");
  const pool = new BackendPool([vanta], (s) => stubBackend(s, [READ_TOOL, WRITE_TOOL]), { idleMs: 1000, maxPerUserChildren: 5 });
  const audit = new AuditLogger({ hmacKey: "k", sink: (l) => lines.push(l) });
  const gateway = new Gateway(pool, policy, audit);
  await gateway.init();

  httpServer = createHttpServer({
    config,
    gateway,
    audit,
    verify: (token) =>
      verifyAccessToken(token, {
        issuer: config.direct!.issuer,
        audiences: [...config.direct!.audiences],
        keyResolver: signer.keyResolver,
        tenant: config.direct!.tenant,
        rolesFor: (claims) => resolveRoles(policy, claims),
        idp: "entra",
      }),
    health: () => ({ status: "ok", backends: ["vanta"] }),
    prm: () => directProtectedResourceMetadata(config),
    wwwAuthenticateScope: config.direct!.scope,
    fallback: (req, res) => {
      if (req.url === "/fallback") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("from-fallback");
        return;
      }
      res.writeHead(404);
      res.end("fallback-404");
    },
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("GET /health", () => {
  it("returns backend ids with no auth", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", backends: ["vanta"] });
  });

  it("returns X-Request-Id, honoring a well-formed caller value", async () => {
    const minted = await fetch(`${baseUrl}/health`);
    expect(minted.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await fetch(`${baseUrl}/health`, { headers: { "X-Request-Id": "corr-12345678" } });
    expect(echoed.headers.get("x-request-id")).toBe("corr-12345678");
    const bad = await fetch(`${baseUrl}/health`, { headers: { "X-Request-Id": "bad id!" } });
    expect(bad.headers.get("x-request-id")).not.toBe("bad id!");
  });
});

describe("protected resource metadata", () => {
  it("matches RFC 9728 shape exactly", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        resource: RESOURCE_URL,
        authorization_servers: [ISSUER],
        bearer_methods_supported: ["header"],
        scopes_supported: [`${RESOURCE_URL}/access_as_user`, "offline_access"],
      });
    }
  });
});

describe("POST /mcp auth (acceptance 1 and 2)", () => {
  it("401s with resource_metadata in WWW-Authenticate when no token is sent", async () => {
    const res = await postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate");
    expect(challenge).toContain("resource_metadata=");
    expect(challenge).toContain("/.well-known/oauth-protected-resource/mcp");
    // Built from config, not from the Host header.
    expect(challenge).toBe(
      `Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="${RESOURCE_URL}/access_as_user"`,
    );
    expect(await res.json()).toEqual({ error: "invalid_token" });
    expect(events().at(-1)).toMatchObject({ event: "auth_failed", reason: "missing_bearer" });
  });

  it.each([
    ["wrong issuer", { iss: "https://login.microsoftonline.com/other/v2.0" }],
    ["wrong audience", { aud: "33333333-3333-3333-3333-333333333333" }],
    ["tenant mismatch", { tid: "44444444-4444-4444-4444-444444444444" }],
  ])("401s on %s", async (_name, claims) => {
    const token = await signToken(["Vanta.Read"], claims);
    const res = await postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, token);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_token" });
    const last = JSON.stringify(events().at(-1));
    expect(last).toContain("auth_failed");
    expect(last).not.toContain(token);
  });

  it("401s on an expired token", async () => {
    const res = await postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, await signToken(["Vanta.Read"], {}, { exp: "-1h" }));
    expect(res.status).toBe(401);
  });

  it("403s for a valid token with no gateway roles, audited as no_roles", async () => {
    const token = await signToken([]);
    const res = await postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, token);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient_scope" });
    expect(res.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
    expect(events().at(-1)).toMatchObject({ event: "auth_failed", reason: "no_roles", actor: { sub: "user-oid-1" } });
  });
});

describe("POST /mcp tools/list and tools/call", () => {
  it("returns only the readOnly tool for a Vanta.Read token", async () => {
    const token = await signToken(["Vanta.Read"]);
    const res = await postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: Tool[] } };
    expect(body.result.tools.map((t) => t.name)).toEqual([READ_TOOL.name]);
  });

  it("denies tools/call on the mutating tool for a Vanta.Read token", async () => {
    const token = await signToken(["Vanta.Read"]);
    const res = await postMcp(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: WRITE_TOOL.name, arguments: {} } },
      token,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toContain("Access denied");
  });

  it("proxies an allowed call for a Vanta.Write token and carries the request id into the audit line", async () => {
    const token = await signToken(["Vanta.Write"], { azp: "claude-desktop" });
    const res = await postMcp(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: WRITE_TOOL.name, arguments: { x: 1 } } },
      token,
      { "X-Request-Id": "corr-abcdef01" },
    );
    expect(res.status).toBe(200);
    const line = events().find((e) => e.request_id === "corr-abcdef01" && e.event === "tool_call");
    expect(line).toMatchObject({ decision: "allow", outcome: "ok", client_id: "claude-desktop", connector: "vanta" });
  });
});

describe("routing and limits", () => {
  it("405s GET and DELETE on /mcp", async () => {
    expect((await fetch(`${baseUrl}/mcp`)).status).toBe(405);
    expect((await fetch(`${baseUrl}/mcp`, { method: "DELETE" })).status).toBe(405);
  });

  it("413s an oversized body", async () => {
    const big = "x".repeat(1024 * 1024 + 10);
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: big,
    });
    expect(res.status).toBe(413);
  });

  it("hands unknown paths to the fallback, and 404s without one", async () => {
    expect(await (await fetch(`${baseUrl}/fallback`)).text()).toBe("from-fallback");
    const bare = createHttpServer({
      config,
      gateway: undefined as never,
      audit: new AuditLogger({ sink: () => undefined }),
      verify: async () => {
        throw new Error("unused");
      },
      health: () => ({}),
      prm: () => ({}),
      wwwAuthenticateScope: "mcp",
    });
    await new Promise<void>((resolve) => bare.listen(0, "127.0.0.1", resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}/anything`);
      expect(res.status).toBe(404);
      expect(res.headers.get("x-request-id")).toBeTruthy();
    } finally {
      await new Promise<void>((resolve) => bare.close(() => resolve()));
    }
  });
});
