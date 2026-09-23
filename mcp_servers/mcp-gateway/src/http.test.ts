import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from "jose";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { BackendLike, BackendSpec } from "./backends.js";
import type { GatewayConfig } from "./config.js";
import { Gateway } from "./gateway.js";
import { createHttpServer } from "./http.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const RESOURCE_URL = "https://mcp.henssler.com/mcp";

const config: GatewayConfig = {
  entraTenantId: TENANT_ID,
  entraClientId: CLIENT_ID,
  mcpResourceUrl: RESOURCE_URL,
  port: 0,
  host: "127.0.0.1",
  backendsRoot: "/app/mcp",
  enabledBackends: ["vanta"],
};

// Stub Vanta backend exposing one readOnly and one mutating tool.
const READ_TOOL: Tool = { name: "vanta_list_controls", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } };
const WRITE_TOOL: Tool = { name: "vanta_update_control", inputSchema: { type: "object" }, annotations: { readOnlyHint: false } };

const vantaSpec: BackendSpec = {
  id: "vanta",
  role: "Vanta",
  envPrefixes: ["VANTA_"],
  command: () => ({ command: "unused", args: [] }),
};

const stubBackend: BackendLike = {
  spec: vantaSpec,
  async listTools() {
    return [READ_TOOL, WRITE_TOOL];
  },
  async callTool(name: string) {
    return { isError: false, content: [{ type: "text", text: `called ${name}` }] };
  },
  async close() {},
};

let httpServer: HttpServer;
let baseUrl: string;
let privateKey: KeyLike;
let keyResolver: ReturnType<typeof createLocalJWKSet>;

async function signToken(roles: string[]): Promise<string> {
  return new SignJWT({
    iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    aud: CLIENT_ID,
    tid: TENANT_ID,
    oid: "user-oid-1",
    preferred_username: "user@henssler.com",
    roles,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

async function postMcp(body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const publicJwk = (await exportJWK(pair.publicKey)) as JWK;
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  keyResolver = createLocalJWKSet({ keys: [publicJwk] });

  const gateway = new Gateway([stubBackend]);
  httpServer = createHttpServer(config, gateway, keyResolver, ["vanta"]);
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
});

describe("protected resource metadata", () => {
  it("matches RFC 9728 shape exactly", async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resource: RESOURCE_URL,
      authorization_servers: [`https://login.microsoftonline.com/${TENANT_ID}/v2.0`],
      bearer_methods_supported: ["header"],
      scopes_supported: [`${RESOURCE_URL}/access_as_user`, "offline_access"],
    });
  });
});

describe("POST /mcp auth", () => {
  it("401s with resource_metadata in WWW-Authenticate when no token is sent", async () => {
    const res = await postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata=");
    expect(res.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/mcp");
    expect(await res.json()).toEqual({ error: "invalid_token" });
  });

  it("403s for a valid token with no vendor roles", async () => {
    const token = await signToken([]);
    const res = await postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, token);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient_scope" });
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
});
