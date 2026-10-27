// Refresh-time Entra membership check, end to end: real broker, real /mcp
// endpoint, real MCP client, and a fake Microsoft Graph on 127.0.0.1.
//
// Time: only Date is faked (see token-lifecycle.test.ts). Assertions on token
// values compare booleans so a failure never prints a token.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { buildAuthRuntime, buildDirectVerifier, type AuthRuntime } from "../runtime.js";
import { CookieJar } from "../test-fixtures/cookie-jar.js";
import { FakeEntraGraph, G_READERS, G_WRITERS, GRAPH_TOKEN, MI_HEADER, MI_TOKEN, ROLE_DIRECT, TENANT_ID } from "../test-fixtures/fake-entra-graph.js";
import { spec } from "../test-fixtures/helpers.js";
import { IDP_CLIENT_ID, IDP_CLIENT_SECRET, MockIdp, TEST_USER } from "../test-fixtures/mock-idp.js";
import { clientCredentialsTokenProvider, EntraMembership, MembershipUnavailable } from "./entra-membership.js";

// Sign-in sees "groups" from the upstream ID token; a refresh sees "groups"
// (matched group ids) and "roles" (app role values) resolved from Graph.
const POLICY_YAML = `version: 1
subjects:
  - role: fixture-reader
    when: { claim: groups, equals: ${G_READERS} }
  - role: fixture-writer
    when: { claim: groups, equals: ${G_WRITERS} }
  - role: fixture-reader
    when: { claim: roles, equals: mcp-direct }
grants:
  - role: fixture-reader
    connectors: [fixture]
    effects: [read]
  - role: fixture-writer
    connectors: [fixture]
    effects: [read, write]
`;
const USER_OID = "44444444-4444-4444-4444-444444444444";
const ACCESS_TTL = 5; // seconds
const TOLERANCE = 5; // src/auth.ts default

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
  graph: FakeEntraGraph;
  base: string;
  resource: string;
  auditLines: string[];
  // Strings that must never appear in an audit line.
  secrets: Set<string>;
  close: () => Promise<void>;
}

async function startStack(env: Record<string, string>, graph?: FakeEntraGraph, policyYaml = POLICY_YAML): Promise<Stack> {
  const idp = new MockIdp();
  await idp.start();
  const fake = graph ?? new FakeEntraGraph();
  if (!graph) await fake.start();
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
    BROKER_UPSTREAM_KIND: "entra",
    BROKER_SIGNING_JWKS: JSON.stringify({ keys: [jwk] }),
    BROKER_COOKIE_KEYS: "cookie-signing-key-for-tests-0123456789",
    BROKER_ACCESS_TOKEN_TTL: String(ACCESS_TTL),
    BROKER_REFRESH_TOKEN_TTL: "3600",
    ENTRA_MEMBERSHIP_CHECK: "1",
    ENTRA_TENANT_ID: TENANT_ID,
    ENTRA_ALLOW_UNSAFE_HOST: "1",
    ENTRA_GRAPH_BASE_URL: fake.graphBaseUrl,
    ENTRA_AUTHORITY_HOST: fake.base,
    ...env,
  });
  const fixtureSpec: BackendSpec = {
    ...spec("fixture"),
    command: process.execPath,
    args: [fileURLToPath(new URL("../test-fixtures/fixture-server.mjs", import.meta.url))],
  };
  const policy = parsePolicy(policyYaml, ["fixture"]);
  const pool = new BackendPool([fixtureSpec], (s) => new Backend(s), { idleMs: 60_000, maxPerUserChildren: 5 });
  const auditLines: string[] = [];
  const audit = new AuditLogger({ hmacKey: "k", sink: (line) => auditLines.push(line) });
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
    graph: fake,
    base,
    resource,
    auditLines,
    secrets: new Set([GRAPH_TOKEN, MI_TOKEN, MI_HEADER, IDP_CLIENT_SECRET, G_READERS, G_WRITERS]),
    close: async () => {
      runtime.close?.();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.closeAll();
      await idp.stop();
      if (!graph) await fake.stop();
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
      client_name: "Membership Client",
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

function fakeDate(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
}

afterEach(() => {
  vi.useRealTimers();
});

function auditReasons(s: Stack): Array<{ reason?: string; outcome?: string; event: string }> {
  return s.auditLines.map((l) => JSON.parse(l) as { reason?: string; outcome?: string; event: string });
}

// No audit line may carry a token, a Graph token, the client secret or a group id.
function expectCleanAudit(s: Stack): void {
  for (const line of s.auditLines) for (const secret of s.secrets) expect(line.includes(secret)).toBe(false);
}

function remember(s: Stack, ...tokens: Array<string | undefined>): void {
  for (const t of tokens) if (t) s.secrets.add(t);
}

function enter(s: Stack, user: { enabled?: boolean; groups: string[]; direct?: string[] }): void {
  s.graph.users.set(USER_OID, { enabled: user.enabled ?? true, groups: user.groups, direct: user.direct ?? [] });
}

async function signedIn(s: Stack, port: number, upstreamGroups: string[]): Promise<MemoryOAuthProvider> {
  s.idp.user = { ...TEST_USER, sub: USER_OID, groups: upstreamGroups };
  const p = await signIn(s, port);
  remember(s, p.tok!.access_token, p.tok!.refresh_token);
  return p;
}

async function refreshed(s: Stack, p: MemoryOAuthProvider, refreshToken = p.tok!.refresh_token!): ReturnType<typeof refresh> {
  const r = await refresh(s, p.info!.client_id, refreshToken);
  remember(s, r.body.access_token as string | undefined, r.body.refresh_token as string | undefined);
  return r;
}

// ---------------------------------------------------------------------------
// Main stack: client credentials, fail closed (the defaults).
// ---------------------------------------------------------------------------
describe("entra membership check on refresh (fail closed)", () => {
  let s: Stack;
  beforeAll(async () => {
    s = await startStack({});
  }, 60_000);
  afterAll(async () => {
    expectCleanAudit(s);
    await s?.close();
  });
  beforeEach(() => {
    s.graph.reset();
    s.auditLines.length = 0;
  });

  it("(a) still in the group: refresh succeeds, roles and tools are unchanged", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43301, [G_READERS]);
    jump(ACCESS_TTL + TOLERANCE + 1);

    const r = await refreshed(s, p);
    expect(r.status).toBe(200);
    expect(decodeJwt(r.body.access_token as string).roles).toEqual(["fixture-reader"]);
    expect(await listToolsWith(s, r.body.access_token as string)).toEqual(["fx_read"]);
    expect(s.graph.count((q) => q.path.endsWith("/checkMemberGroups"))).toBe(2); // sign-in code exchange + refresh
    expect(auditReasons(s).filter((l) => l.event === "auth_failed")).toEqual([]);
  });

  it("(b) removed from the group: refresh is invalid_grant; the old access token works only until its own expiry", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43302, [G_READERS]);
    const oldAccess = p.tok!.access_token;
    enter(s, { groups: [] });

    // The access token already issued is stateless and stays valid until exp.
    jump(1);
    expect(await listToolsWith(s, oldAccess)).toEqual(["fx_read"]);

    const r = await refreshed(s, p);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_grant");
    expect(r.body.access_token).toBeUndefined();
    expect(r.body.refresh_token).toBeUndefined();

    // Still inside exp + tolerance: accepted. Past it: 401.
    jump(ACCESS_TTL + TOLERANCE - 3);
    expect((await mcpRaw(s, oldAccess)).status).toBe(200);
    jump(5);
    expect((await mcpRaw(s, oldAccess)).status).toBe(401);

    const revoked = auditReasons(s).filter((l) => l.reason?.startsWith("membership_"));
    expect(revoked.map((l) => l.reason)).toEqual(["membership_revoked"]);
  });

  it("(c) moved from the reader group to the writer group: refresh succeeds with the new roles and tools/list changes", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43303, [G_READERS]);
    const oldAccess = p.tok!.access_token;
    enter(s, { groups: [G_WRITERS] });

    jump(ACCESS_TTL + TOLERANCE + 1);
    const r = await refreshed(s, p);
    expect(r.status).toBe(200);
    expect(decodeJwt(r.body.access_token as string).roles).toEqual(["fixture-writer"]);
    expect(await listToolsWith(s, r.body.access_token as string)).toEqual(["fx_read", "fx_write"]);
    expect(await listToolsWith(s, oldAccess).catch(() => "expired")).toBe("expired");

    // The account record was updated: the next refresh agrees without a new sign-in.
    jump(ACCESS_TTL + TOLERANCE + 1);
    const r2 = await refreshed(s, p, r.body.refresh_token as string);
    expect(r2.status).toBe(200);
    expect(decodeJwt(r2.body.access_token as string).roles).toEqual(["fixture-writer"]);
  });

  it("(d) accountEnabled false: invalid_grant; a deleted user is invalid_grant too", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43304, [G_READERS]);
    enter(s, { enabled: false, groups: [G_READERS] });
    const disabled = await refreshed(s, p);
    expect(disabled.status).toBe(400);
    expect(disabled.body.error).toBe("invalid_grant");

    s.graph.users.delete(USER_OID);
    const gone = await refreshed(s, p);
    expect(gone.status).toBe(400);
    expect(gone.body.error).toBe("invalid_grant");

    expect(auditReasons(s).filter((l) => l.event === "auth_failed").map((l) => l.reason)).toEqual(["membership_revoked", "membership_revoked"]);
  });

  it("(d2) authorization_code exchange: a user disabled after the browser redirect gets no tokens", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    s.idp.user = { ...TEST_USER, sub: USER_OID, groups: [G_READERS] };
    const redirect = "http://127.0.0.1:43341/callback";
    const provider = new MemoryOAuthProvider(redirect);
    expect(await auth(provider, { serverUrl: s.resource })).toBe("REDIRECT");
    const final = await drive(provider.authUrl!, redirect);
    enter(s, { enabled: false, groups: [G_READERS] });
    await expect(auth(provider, { serverUrl: s.resource, authorizationCode: final.searchParams.get("code")! })).rejects.toThrow(/grant/i);
    expect(provider.tok).toBeUndefined();
    expect(auditReasons(s).filter((l) => l.event === "auth_failed").map((l) => l.reason)).toEqual(["membership_revoked"]);
  });

  it("(d3) Revoke sessions after sign-in: refresh is invalid_grant; a fresh sign-in works again", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43342, [G_READERS]);
    jump(2);
    // Entra sets signInSessionsValidFromDateTime to the moment of revocation.
    s.graph.users.get(USER_OID)!.sessionsValidFrom = new Date().toISOString();
    const r = await refreshed(s, p);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_grant");

    // Authenticating upstream after the revocation is accepted.
    jump(2);
    const again = await signedIn(s, 43343, [G_READERS]);
    expect(again.tok!.access_token).toBeTruthy();
    jump(ACCESS_TTL + TOLERANCE + 1);
    expect((await refreshed(s, again)).status).toBe(200);
  });

  it("(d4) a user record without signInSessionsValidFromDateTime cannot be proven valid: fails closed", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43344, [G_READERS]);
    s.graph.users.get(USER_OID)!.sessionsValidFrom = "";
    const r = await refreshed(s, p);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_grant");
  });

  it("(e) Graph 503 or 429: invalid_grant by default, with an audit reason and no inline retry", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43305, [G_READERS]);
    s.graph.requests = []; // count only the refresh attempts below
    s.graph.failStatus = 503;
    const down = await refreshed(s, p);
    expect(down.status).toBe(400);
    expect(down.body.error).toBe("invalid_grant");
    expect(s.graph.count((q) => q.path.startsWith("/v1.0/users/"))).toBe(3); // user GET, checkMemberGroups POST, direct assignments GET: no retry

    s.graph.failStatus = 429;
    s.graph.failHeaders = { "Retry-After": "120" };
    s.graph.requests = [];
    const t0 = Date.now();
    const throttled = await refreshed(s, p);
    expect(throttled.status).toBe(400);
    expect(throttled.body.error).toBe("invalid_grant");
    expect(Date.now() - t0).toBeLessThan(5_000); // Retry-After is not waited on
    expect(s.graph.count((q) => q.path.startsWith("/v1.0/users/"))).toBe(3);

    const failed = auditReasons(s).filter((l) => l.event === "auth_failed");
    expect(failed.map((l) => [l.reason, l.outcome])).toEqual([
      ["membership_check_unavailable", "backend_error"],
      ["membership_check_unavailable", "backend_error"],
    ]);

    // The refresh token was not consumed by the failed attempts.
    s.graph.failStatus = undefined;
    const ok = await refreshed(s, p);
    expect(ok.status).toBe(200);
  });

  it("(e2) a malformed object id cannot be checked and fails closed as revoked", async () => {
    fakeDate();
    s.idp.user = { ...TEST_USER, sub: "not-a-guid", groups: [G_READERS] };
    // The authorization_code exchange runs the same check, so no tokens are issued at all.
    await expect(signIn(s, 43306)).rejects.toThrow(/grant/i);
    expect(s.graph.count((q) => q.path.startsWith("/v1.0/users/"))).toBe(0);
  });

  it("users assigned straight to an app role keep access without any group", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43307, [G_READERS]);
    // Left the group, but holds mcp-direct (policy: roles=mcp-direct -> fixture-reader).
    enter(s, { groups: [], direct: [ROLE_DIRECT] });
    // The role map is cached per process; let it expire so the new direct assignment is read.
    jump(700); // past the 300 s cache, whatever earlier tests jumped
    const r = await refreshed(s, p);
    expect(r.status).toBe(200);
    expect(decodeJwt(r.body.access_token as string).roles).toEqual(["fixture-reader"]);
    expect(s.graph.count((q) => q.path === "/v1.0/servicePrincipals")).toBe(1);
    expect(s.graph.count((q) => q.path.endsWith("/appRoleAssignedTo"))).toBe(2); // two pages
  });

  it("the app role map is cached for ENTRA_MEMBERSHIP_CACHE_SECONDS", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43308, [G_READERS]);
    s.graph.requests = [];
    const a = await refreshed(s, p);
    const b = await refreshed(s, p, a.body.refresh_token as string);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(s.graph.count((q) => q.path === "/v1.0/servicePrincipals")).toBe(0); // loaded by an earlier test within 300 s
    expect(s.graph.count((q) => q.path.endsWith("/appRoleAssignedTo"))).toBe(0);
    expect(s.graph.count((q) => q.path.endsWith("/checkMemberGroups"))).toBe(2); // the per-user checks are never cached
  });

  it("(h) an expired access token is rejected 10 s after exp (5 s tolerance, not 60)", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43309, [G_READERS]);
    const token = p.tok!.access_token;
    jump(ACCESS_TTL + 3);
    expect((await mcpRaw(s, token)).status).toBe(200); // 3 s past exp, inside 5 s
    jump(7); // now 10 s past exp
    const late = await mcpRaw(s, token);
    expect(late.status).toBe(401);
    expect(late.wwwAuth).toMatch(/^Bearer resource_metadata=/);
  });
});

// ---------------------------------------------------------------------------
// Fail open.
// ---------------------------------------------------------------------------
describe("entra membership check on refresh (ENTRA_MEMBERSHIP_FAIL_OPEN=1)", () => {
  let s: Stack;
  beforeAll(async () => {
    s = await startStack({ ENTRA_MEMBERSHIP_FAIL_OPEN: "1" });
  }, 60_000);
  afterAll(async () => {
    expectCleanAudit(s);
    await s?.close();
  });
  beforeEach(() => {
    s.graph.reset();
    s.auditLines.length = 0;
  });

  it("(e) Graph 503: refresh succeeds with the previous roles and the audit line says why", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43321, [G_READERS]);
    s.graph.failStatus = 503;
    jump(ACCESS_TTL + TOLERANCE + 1);
    const r = await refreshed(s, p);
    expect(r.status).toBe(200);
    expect(decodeJwt(r.body.access_token as string).roles).toEqual(["fixture-reader"]);
    expect(await listToolsWith(s, r.body.access_token as string)).toEqual(["fx_read"]);
    const lines = auditReasons(s).filter((l) => l.reason === "membership_check_unavailable");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "auth_failed", outcome: "ok" });
  });

  it("fail open does not apply to a confirmed removal", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43322, [G_READERS]);
    enter(s, { groups: [] });
    const r = await refreshed(s, p);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_grant");
  });
});

// ---------------------------------------------------------------------------
// Graph token source: client credentials and its cache.
// ---------------------------------------------------------------------------
describe("graph token: client credentials", () => {
  let s: Stack;
  beforeAll(async () => {
    s = await startStack({});
  }, 60_000);
  afterAll(async () => {
    expectCleanAudit(s);
    await s?.close();
  });

  it("(f) one token request serves many refreshes; it carries the app credentials and the .default scope", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43331, [G_READERS]);
    expect(s.graph.tokenRequests).toHaveLength(1); // the sign-in code exchange already checks membership

    const a = await refreshed(s, p);
    const b = await refreshed(s, p, a.body.refresh_token as string);
    const c = await refreshed(s, p, b.body.refresh_token as string);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(s.graph.tokenRequests).toHaveLength(1);

    const form = new URLSearchParams(s.graph.tokenRequests[0]!.body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "client_credentials",
      client_id: IDP_CLIENT_ID,
      client_secret: IDP_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
    });
    expect(s.graph.miRequests).toHaveLength(0);
    const graphCalls = s.graph.requests.filter((q) => q.path.startsWith("/v1.0/"));
    expect(graphCalls.length).toBeGreaterThan(0);
    expect(graphCalls.every((q) => q.headers.authorization === `Bearer ${GRAPH_TOKEN}`)).toBe(true);
  });

  it("(f2) the token is reused until 5 minutes before expiry, then fetched again", async () => {
    const graph = new FakeEntraGraph();
    await graph.start();
    try {
      let clock = 1_000_000;
      const provider = clientCredentialsTokenProvider({
        authorityHost: graph.base,
        tenantId: TENANT_ID,
        clientId: "cid",
        clientSecret: "sec",
        now: () => clock,
      });
      const signal = new AbortController().signal;
      expect(await provider.getToken(signal)).toBe(GRAPH_TOKEN);
      clock += 3600_000 - 301_000; // 301 s before expiry
      await provider.getToken(signal);
      expect(graph.tokenRequests).toHaveLength(1);
      clock += 2_000; // 299 s before expiry
      await provider.getToken(signal);
      expect(graph.tokenRequests).toHaveLength(2);
    } finally {
      await graph.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Graph token source: managed identity.
// ---------------------------------------------------------------------------
describe("graph token: managed identity (Container Apps)", () => {
  let s: Stack;
  beforeAll(async () => {
    const graph = new FakeEntraGraph();
    await graph.start();
    graph.acceptedToken = MI_TOKEN;
    s = await startStack({ IDENTITY_ENDPOINT: `${graph.base}/msi/token`, IDENTITY_HEADER: MI_HEADER }, graph);
    s.close = ((close) => async () => {
      await close();
      await graph.stop();
    })(s.close);
  }, 60_000);
  afterAll(async () => {
    expectCleanAudit(s);
    await s?.close();
  });

  it("(g) GETs IDENTITY_ENDPOINT with X-IDENTITY-HEADER, api-version 2019-08-01 and the Graph resource; never uses the app secret", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43341, [G_READERS]);
    const r = await refreshed(s, p);
    expect(r.status).toBe(200);
    expect(await listToolsWith(s, r.body.access_token as string)).toEqual(["fx_read"]);

    expect(s.graph.miRequests).toHaveLength(1);
    const mi = s.graph.miRequests[0]!;
    expect(mi.method).toBe("GET");
    expect(mi.headers["x-identity-header"]).toBe(MI_HEADER);
    expect(mi.query.get("api-version")).toBe("2019-08-01");
    expect(mi.query.get("resource")).toBe("https://graph.microsoft.com");
    expect(s.graph.tokenRequests).toHaveLength(0);
    const graphCalls = s.graph.requests.filter((q) => q.path.startsWith("/v1.0/"));
    expect(graphCalls.every((q) => q.headers.authorization === `Bearer ${MI_TOKEN}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Clock tolerance is configurable and reaches both verifiers.
// ---------------------------------------------------------------------------
describe("TOKEN_CLOCK_TOLERANCE_SECONDS", () => {
  let s: Stack;
  beforeAll(async () => {
    s = await startStack({ TOKEN_CLOCK_TOLERANCE_SECONDS: "30" });
  }, 60_000);
  afterAll(async () => {
    await s?.close();
  });

  it("(h) broker: a configured 30 s tolerance accepts a token 20 s past exp and rejects it 35 s past", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS] });
    const p = await signedIn(s, 43351, [G_READERS]);
    const token = p.tok!.access_token;
    jump(ACCESS_TTL + 20);
    expect((await mcpRaw(s, token)).status).toBe(200);
    jump(15);
    expect((await mcpRaw(s, token)).status).toBe(401);
  });

  it("(h) direct mode: the same setting reaches the direct verifier", async () => {
    const idp = new MockIdp();
    await idp.start();
    try {
      const env = {
        GATEWAY_MODE: "direct",
        PUBLIC_BASE_URL: "http://127.0.0.1:1",
        DIRECT_ISSUER: idp.issuer,
        DIRECT_JWKS_URI: idp.jwksUri,
        DIRECT_AUDIENCES: "http://127.0.0.1:1/mcp",
      };
      const policy = parsePolicy(POLICY_YAML, ["fixture"]);
      const token = await idp.sign({
        iss: idp.issuer,
        aud: "http://127.0.0.1:1/mcp",
        sub: "u1",
        iat: Math.floor(Date.now() / 1000) - 100,
        exp: Math.floor(Date.now() / 1000) - 20,
      });
      await expect(buildDirectVerifier(loadConfig(env), policy)(token)).rejects.toMatchObject({ status: 401 }); // default 5 s
      await expect(buildDirectVerifier(loadConfig({ ...env, TOKEN_CLOCK_TOLERANCE_SECONDS: "30" }), policy)(token)).resolves.toMatchObject({ sub: "u1" });
    } finally {
      await idp.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Review findings 2, 5 and 7.
// ---------------------------------------------------------------------------
const SIGNIN_CLAIM_POLICY_YAML = `version: 1
subjects:
  - role: fixture-reader
    when: { claim: name, equals: ${TEST_USER.name} }
grants:
  - role: fixture-reader
    connectors: [fixture]
    effects: [read]
`;

describe("refresh evaluates the policy on the sign-in claims (review finding 2)", () => {
  let s: Stack;
  beforeAll(async () => {
    s = await startStack({}, undefined, SIGNIN_CLAIM_POLICY_YAML);
  }, 60_000);
  afterAll(async () => {
    expectCleanAudit(s);
    await s?.close();
  });
  beforeEach(() => {
    s.graph.reset();
    s.auditLines.length = 0;
  });

  it("a rule on the name claim (not roles, groups, email or tid) still matches at refresh although the user holds no app role or group", async () => {
    fakeDate();
    enter(s, { groups: [] });
    const p = await signedIn(s, 43401, []);
    const r = await refreshed(s, p);
    expect(r.status).toBe(200);
    expect(await listToolsWith(s, r.body.access_token as string)).toEqual(["fx_read"]);
    expect(auditReasons(s).filter((l) => l.event === "auth_failed")).toEqual([]);
  });

  it("a disabled account is still revoked", async () => {
    fakeDate();
    enter(s, { groups: [] });
    const p = await signedIn(s, 43402, []);
    enter(s, { enabled: false, groups: [] });
    const r = await refreshed(s, p);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_grant");
  });
});

describe("direct app role assignments are checked live (review finding 5)", () => {
  let s: Stack;
  beforeAll(async () => {
    s = await startStack({});
  }, 60_000);
  afterAll(async () => {
    expectCleanAudit(s);
    await s?.close();
  });

  it("removing a direct assignment revokes on the next refresh, inside the role map cache window", async () => {
    fakeDate();
    enter(s, { groups: [G_READERS], direct: [ROLE_DIRECT] });
    const p = await signedIn(s, 43411, [G_READERS]); // loads the role map, user holds mcp-direct
    enter(s, { groups: [], direct: [ROLE_DIRECT] });
    const ok = await refreshed(s, p);
    expect(ok.status).toBe(200); // still entitled through the direct role alone
    enter(s, { groups: [], direct: [] });
    const gone = await refreshed(s, p, ok.body.refresh_token as string);
    expect(gone.status).toBe(400);
    expect(gone.body.error).toBe("invalid_grant");
    expect(s.graph.count((q) => q.path === "/v1.0/servicePrincipals")).toBe(1); // role definitions stayed cached
  });
});

describe("shared in-flight fetches (review finding 7)", () => {
  it("one caller's abort does not fail another caller waiting on the same token fetch", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchFn = async (_url: string, init?: RequestInit): Promise<Response> => {
      await new Promise<void>((resolve, reject) => {
        void gate.then(resolve);
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    };
    const provider = clientCredentialsTokenProvider({ authorityHost: "http://127.0.0.1:1", tenantId: TENANT_ID, clientId: "c", clientSecret: "x", fetch: fetchFn });
    const first = new AbortController();
    const a = provider.getToken(first.signal);
    const b = provider.getToken(new AbortController().signal);
    first.abort(new Error("caller A gave up"));
    await expect(a).rejects.toThrow("caller A gave up");
    release();
    await expect(b).resolves.toBe("t");
  });

  it("the shared fetch times out on its own and every waiter then fails", async () => {
    const hang = (_url: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const provider = clientCredentialsTokenProvider({ authorityHost: "http://127.0.0.1:1", tenantId: TENANT_ID, clientId: "c", clientSecret: "x", fetch: hang, timeoutMs: 20 });
    const results = await Promise.allSettled([provider.getToken(new AbortController().signal), provider.getToken(new AbortController().signal)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(((results[0] as PromiseRejectedResult).reason as MembershipUnavailable).detail).toBe("graph_token_unreachable");
  });

  it("an unreachable role map load reports unavailable for each concurrent resolve", async () => {
    const hang = (_url: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const m = new EntraMembership({
      appId: IDP_CLIENT_ID,
      cacheSeconds: 300,
      graphBaseUrl: "http://127.0.0.1:1/v1.0",
      tokenProvider: { getToken: async () => "t", invalidate: () => undefined },
      fetch: hang,
      timeoutMs: 20,
    });
    const r = await Promise.all([m.resolve(USER_OID, 1), m.resolve(USER_OID, 1)]);
    expect(r.map((x) => x.status)).toEqual(["unavailable", "unavailable"]);
  });
});
