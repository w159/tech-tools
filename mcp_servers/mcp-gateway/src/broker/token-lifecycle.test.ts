// Token lifecycle through the broker and the real HTTP /mcp endpoint.
//
// Time: the whole stack runs in this process, so only Date is faked
// (vi.useFakeTimers({ toFake: ["Date"] })). oidc-provider, the memory adapter
// and jose all read Date.now(), so a jump expires tokens deterministically and
// real sockets/timers keep working. Assertions that touch token values compare
// booleans so a failure never prints a token.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { calculateJwkThumbprint, decodeJwt, exportJWK, generateKeyPair } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { AuditLogger } from "../audit.js";
import { Backend, BackendPool, type BackendSpec } from "../backends.js";
import { loadConfig } from "../config.js";
import { Gateway } from "../gateway.js";
import { createHttpServer } from "../http.js";
import { parsePolicy } from "../policy.js";
import { buildAuthRuntime, type AuthRuntime } from "../runtime.js";
import { CookieJar } from "../test-fixtures/cookie-jar.js";
import { spec } from "../test-fixtures/helpers.js";
import { IDP_CLIENT_ID, IDP_CLIENT_SECRET, MockIdp, TEST_USER } from "../test-fixtures/mock-idp.js";

const POLICY_YAML = `version: 1
subjects:
  - role: fixture-reader
    when: { claim: groups, equals: mcp-readers }
  - role: fixture-writer
    when: { claim: groups, equals: mcp-writers }
grants:
  - role: fixture-reader
    connectors: [fixture]
    effects: [read]
  - role: fixture-writer
    connectors: [fixture]
    effects: [read, write]
`;
const READERS = ["mcp-readers"];
const WRITERS = ["mcp-writers"];
const ACCESS_TTL = 5; // seconds
const JWT_CLOCK_TOLERANCE = 5; // src/auth.ts default (TOKEN_CLOCK_TOLERANCE_SECONDS)

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

interface Stack {
  idp: MockIdp;
  base: string;
  resource: string;
  close: () => Promise<void>;
}

async function startStack(env: Record<string, string>): Promise<Stack> {
  const idp = new MockIdp();
  await idp.start();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const resource = `${base}/mcp`;
  const pair = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(pair.privateKey);
  jwk.kid = await calculateJwkThumbprint(jwk);
  jwk.alg = "RS256";
  jwk.use = "sig";
  const config = loadConfig({
    GATEWAY_MODE: "broker",
    PUBLIC_BASE_URL: base,
    PORT: String(port),
    HOST: "127.0.0.1",
    BROKER_UPSTREAM_ISSUER: idp.issuer,
    BROKER_UPSTREAM_CLIENT_ID: IDP_CLIENT_ID,
    BROKER_UPSTREAM_CLIENT_SECRET: IDP_CLIENT_SECRET,
    BROKER_UPSTREAM_KIND: "oidc",
    BROKER_SIGNING_JWKS: JSON.stringify({ keys: [jwk] }),
    BROKER_COOKIE_KEYS: "cookie-signing-key-for-tests-0123456789",
    ...env,
  });
  const fixtureSpec: BackendSpec = {
    ...spec("fixture"),
    command: process.execPath,
    args: [fileURLToPath(new URL("../test-fixtures/fixture-server.mjs", import.meta.url))],
  };
  const policy = parsePolicy(POLICY_YAML, ["fixture"]);
  const pool = new BackendPool([fixtureSpec], (s) => new Backend(s), { idleMs: 60_000, maxPerUserChildren: 5 });
  const audit = new AuditLogger({ hmacKey: "k", sink: () => undefined });
  const gateway = new Gateway(pool, policy, audit);
  await gateway.init();
  const runtime: AuthRuntime = buildAuthRuntime(config, policy, audit);
  const server: HttpServer = createHttpServer({
    config,
    gateway,
    audit,
    verify: runtime.verify,
    prm: runtime.prm,
    wwwAuthenticateScope: runtime.wwwAuthenticateScope,
    fallback: runtime.fallback,
    health: () => ({ status: "ok" }),
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    idp,
    base,
    resource,
    close: async () => {
      runtime.close?.();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.closeAll();
      await idp.stop();
    },
  };
}

class MemoryOAuthProvider implements OAuthClientProvider {
  info?: OAuthClientInformationMixed;
  tok?: OAuthTokens;
  verifier = "";
  authUrl?: URL;
  authRedirects = 0;
  constructor(
    private readonly redirect: string,
    private readonly dropTokensOnInvalid = false,
  ) {}
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (this.dropTokensOnInvalid && (scope === "tokens" || scope === "all")) this.tok = undefined;
  }
  get redirectUrl(): string {
    return this.redirect;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Lifecycle Client",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.info;
  }
  saveClientInformation(i: OAuthClientInformationMixed): void {
    this.info = i;
  }
  tokens(): OAuthTokens | undefined {
    return this.tok;
  }
  saveTokens(t: OAuthTokens): void {
    this.tok = t;
  }
  redirectToAuthorization(u: URL): void {
    this.authRedirects += 1;
    this.authUrl = u;
  }
  saveCodeVerifier(v: string): void {
    this.verifier = v;
  }
  codeVerifier(): string {
    return this.verifier;
  }
}

// Browser stand-in: follows the redirect chain (mock IdP signs in with no
// prompt) and posts the consent form.
async function drive(start: URL, redirectPrefix: string): Promise<URL> {
  const jar = new CookieJar();
  let url = start;
  let method = "GET";
  for (let hop = 0; hop < 25; hop++) {
    const cookie = jar.headerFor(url);
    const res = await fetch(url, {
      method,
      redirect: "manual",
      headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      ...(method === "POST" ? { body: "" } : {}),
    });
    jar.store(res);
    method = "GET";
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get("location")!, url);
      if (next.href.startsWith(redirectPrefix)) return next;
      url = next;
      continue;
    }
    const body = await res.text();
    const form = /action="([^"]*\/confirm)"/.exec(body);
    if (res.status === 200 && form) {
      url = new URL(form[1]!.replaceAll("&#47;", "/"), url);
      method = "POST";
      continue;
    }
    throw new Error(`unexpected ${res.status} at ${url.pathname}`);
  }
  throw new Error("redirect chain too long");
}

async function signIn(s: Stack, port = 43200, dropTokensOnInvalid = false): Promise<MemoryOAuthProvider> {
  const redirect = `http://127.0.0.1:${port}/callback`;
  const provider = new MemoryOAuthProvider(redirect, dropTokensOnInvalid);
  expect(await auth(provider, { serverUrl: s.resource })).toBe("REDIRECT");
  const final = await drive(provider.authUrl!, redirect);
  expect(final.searchParams.get("error")).toBeNull();
  expect(await auth(provider, { serverUrl: s.resource, authorizationCode: final.searchParams.get("code")! })).toBe("AUTHORIZED");
  return provider;
}

async function refresh(s: Stack, clientId: string, refreshToken: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${s.base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// Raw /mcp call with a bearer token; 401 is decided before MCP parsing.
async function mcpRaw(s: Stack, token: string): Promise<{ status: number; wwwAuth: string | null }> {
  const res = await fetch(s.resource, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  await res.text();
  return { status: res.status, wwwAuth: res.headers.get("www-authenticate") };
}

// Real MCP session with a fixed bearer token (no SDK auth handling).
async function listToolsWith(s: Stack, token: string): Promise<string[]> {
  const client = new Client({ name: "lifecycle-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(s.resource), { requestInit: { headers: { authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  try {
    return (await client.listTools()).tools.map((t) => t.name).sort();
  } finally {
    await client.close();
  }
}

function jump(seconds: number): void {
  vi.setSystemTime(Date.now() + seconds * 1000);
}

afterEach(() => {
  vi.useRealTimers();
});

function fakeDate(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
}

// ---------------------------------------------------------------------------
// Main stack: short access token, long refresh chain.
// ---------------------------------------------------------------------------
describe("token lifecycle: access token and refresh", () => {
  let s: Stack;
  beforeAll(async () => {
    s = await startStack({ BROKER_ACCESS_TOKEN_TTL: String(ACCESS_TTL), BROKER_REFRESH_TOKEN_TTL: "3600" });
    s.idp.user = { ...TEST_USER, groups: READERS };
  }, 60_000);
  afterAll(async () => {
    await s?.close();
  });

  it("1. access token: works, still accepted inside the 5s JWT clock tolerance, then 401 with resource_metadata", async () => {
    fakeDate();
    const p = await signIn(s, 43201);
    const token = p.tok!.access_token;
    const claims = decodeJwt(token);
    expect(claims.exp! - claims.iat!).toBe(ACCESS_TTL);

    expect(await listToolsWith(s, token)).toEqual(["fx_read"]);

    // Past exp but inside verifyAccessToken's default clockTolerance of 5s: still accepted.
    jump(ACCESS_TTL + JWT_CLOCK_TOLERANCE - 2);
    expect((await mcpRaw(s, token)).status).toBe(200);

    // Beyond exp + tolerance: rejected with the discovery challenge.
    jump(5);
    const expired = await mcpRaw(s, token);
    expect(expired.status).toBe(401);
    expect(expired.wwwAuth).toMatch(/^Bearer resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
    expect(expired.wwwAuth).toContain('scope="mcp"');
  });

  it("2. silent refresh: new access token works on /mcp; refresh token rotates and the old one is invalid_grant", async () => {
    fakeDate();
    const p = await signIn(s, 43202);
    const clientId = p.info!.client_id;
    const oldAccess = p.tok!.access_token;
    const oldRefresh = p.tok!.refresh_token!;
    const idpHits = s.idp.tokenRequests;

    jump(ACCESS_TTL + JWT_CLOCK_TOLERANCE + 5);
    expect((await mcpRaw(s, oldAccess)).status).toBe(401);

    const r = await refresh(s, clientId, oldRefresh);
    expect(r.status).toBe(200);
    const newAccess = r.body.access_token as string;
    const newRefresh = r.body.refresh_token as string;
    expect(typeof newAccess).toBe("string");
    expect(newAccess !== oldAccess).toBe(true);
    expect(await listToolsWith(s, newAccess)).toEqual(["fx_read"]);
    // No user interaction: the upstream IdP was not contacted for the refresh.
    expect(s.idp.tokenRequests).toBe(idpHits);

    // Observed: rotation is on.
    expect(typeof newRefresh).toBe("string");
    expect(newRefresh !== oldRefresh).toBe(true);
    const replay = await refresh(s, clientId, oldRefresh);
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");
    // Observed: replay of a consumed refresh token revokes the grant, so the rotated one dies too.
    const afterReplay = await refresh(s, clientId, newRefresh);
    expect(afterReplay.status).toBe(400);
    expect(afterReplay.body.error).toBe("invalid_grant");
  });

  it("5. MCP SDK client: expired token is refreshed by the SDK, next tools/list succeeds with no new authorization", async () => {
    fakeDate();
    const p = await signIn(s, 43203);
    expect(p.authRedirects).toBe(1);
    const firstAccess = p.tok!.access_token;
    const firstRefresh = p.tok!.refresh_token!;
    const idpHits = s.idp.tokenRequests;

    const client = new Client({ name: "sdk-lifecycle", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(s.resource), { authProvider: p });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["fx_read"]);

      jump(ACCESS_TTL + JWT_CLOCK_TOLERANCE + 5);
      // The stored token is now rejected by the gateway; the SDK must refresh on 401.
      expect((await mcpRaw(s, firstAccess)).status).toBe(401);
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["fx_read"]);
    } finally {
      await client.close();
    }
    expect(p.tok!.access_token !== firstAccess).toBe(true);
    expect(p.tok!.refresh_token !== firstRefresh).toBe(true);
    expect(p.authRedirects).toBe(1); // no second browser step
    expect(s.idp.tokenRequests).toBe(idpHits); // upstream IdP untouched
  });

  it("4. roles are fixed per sign-in; a fresh authorization-code sign-in picks up changed upstream claims", async () => {
    fakeDate();
    s.idp.user = { ...TEST_USER, groups: READERS };
    const a = await signIn(s, 43204);
    expect(decodeJwt(a.tok!.access_token).roles).toEqual(["fixture-reader"]);
    expect(await listToolsWith(s, a.tok!.access_token)).toEqual(["fx_read"]);

    // Upstream claims change; no new sign-in yet.
    s.idp.user = { ...TEST_USER, groups: WRITERS };
    jump(ACCESS_TTL + JWT_CLOCK_TOLERANCE + 5);
    const r1 = await refresh(s, a.info!.client_id, a.tok!.refresh_token!);
    expect(r1.status).toBe(200);
    expect(decodeJwt(r1.body.access_token as string).roles).toEqual(["fixture-reader"]);
    expect(await listToolsWith(s, r1.body.access_token as string)).toEqual(["fx_read"]);

    // Fresh sign-in sees the new claims.
    const b = await signIn(s, 43205);
    expect(decodeJwt(b.tok!.access_token).roles).toEqual(["fixture-writer"]);
    expect(await listToolsWith(s, b.tok!.access_token)).toEqual(["fx_read", "fx_write"]);

    // Observed: roles live on the per-user account record that every sign-in
    // overwrites, so a refresh on the OLD grant now also returns the new roles.
    const r2 = await refresh(s, a.info!.client_id, r1.body.refresh_token as string);
    expect(r2.status).toBe(200);
    expect(decodeJwt(r2.body.access_token as string).roles).toEqual(["fixture-writer"]);
    s.idp.user = { ...TEST_USER, groups: READERS };
  });
});

// ---------------------------------------------------------------------------
// Cap stack: the refresh chain is bounded by BROKER_REFRESH_TOKEN_TTL.
// ---------------------------------------------------------------------------
describe("token lifecycle: refresh chain cap", () => {
  const CAP = 30;
  let s: Stack;
  beforeAll(async () => {
    s = await startStack({ BROKER_ACCESS_TOKEN_TTL: String(ACCESS_TTL), BROKER_REFRESH_TOKEN_TTL: String(CAP) });
    s.idp.user = { ...TEST_USER, groups: READERS };
  }, 60_000);
  afterAll(async () => {
    await s?.close();
  });

  it("3a. a refresh after the cap fails with exactly invalid_grant", async () => {
    fakeDate();
    const p = await signIn(s, 43211);
    jump(CAP + 1);
    const r = await refresh(s, p.info!.client_id, p.tok!.refresh_token!);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_grant");
  });

  it("3b. rotation does not extend the chain past the cap", async () => {
    fakeDate();
    const p = await signIn(s, 43212);
    jump(CAP - 10); // inside the cap
    const r1 = await refresh(s, p.info!.client_id, p.tok!.refresh_token!);
    expect(r1.status).toBe(200);
    jump(20); // 10s past the original cap, inside a re-extended refresh token's own TTL
    const r2 = await refresh(s, p.info!.client_id, r1.body.refresh_token as string);
    expect(r2.status).toBe(400);
    expect(r2.body.error).toBe("invalid_grant");
  });

  it("3c. SDK: invalid_grant after the cap surfaces as InvalidGrantError, and a provider that drops tokens gets a fresh authorization request", async () => {
    fakeDate();
    // Provider without invalidateCredentials handling: auth() retries the same dead refresh token and throws.
    const stuck = await signIn(s, 43213);
    jump(CAP + 1);
    await expect(auth(stuck, { serverUrl: s.resource })).rejects.toMatchObject({ errorCode: "invalid_grant" });
    expect(stuck.authRedirects).toBe(1);

    // Provider that clears tokens on invalidateCredentials('tokens'): auth() restarts the browser flow.
    vi.setSystemTime(Date.now() - (CAP + 1) * 1000);
    const p = await signIn(s, 43214, true);
    jump(CAP + 1);
    expect(await auth(p, { serverUrl: s.resource })).toBe("REDIRECT");
    expect(p.authRedirects).toBe(2);
  });
});
