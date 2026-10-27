import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, exportJWK, generateKeyPair, jwtVerify, calculateJwkThumbprint } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { AuditLogger, type AuditEvent } from "../audit.js";
import { Backend, BackendPool, type BackendSpec } from "../backends.js";
import { loadConfig, type GatewayConfig } from "../config.js";
import { Gateway } from "../gateway.js";
import { createHttpServer } from "../http.js";
import { parsePolicy } from "../policy.js";
import { buildAuthRuntime, type AuthRuntime } from "../runtime.js";
import { CookieJar } from "../test-fixtures/cookie-jar.js";
import { spec } from "../test-fixtures/helpers.js";
import { IDP_CLIENT_ID, IDP_CLIENT_SECRET, MockIdp } from "../test-fixtures/mock-idp.js";
import { escapeHtml, renderConsent } from "./interactions.js";
import { JWT_BEARER_GRANT } from "./jwt-bearer.js";

const COOKIE_KEY = "cookie-signing-key-for-tests-0123456789";
const POLICY_YAML = `version: 1
subjects:
  - role: fixture-reader
    when: { claim: groups, equals: mcp-readers }
grants:
  - role: fixture-reader
    connectors: [fixture]
    effects: [read]
`;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

let idp: MockIdp;
let rogueIdp: MockIdp;
let config: GatewayConfig;
let runtime: AuthRuntime;
let httpServer: HttpServer;
let base: string;
let resource: string;
let pool: BackendPool;
const lines: string[] = [];
const events = (): AuditEvent[] => lines.map((l) => JSON.parse(l) as AuditEvent);

beforeAll(async () => {
  idp = new MockIdp();
  rogueIdp = new MockIdp();
  await Promise.all([idp.start(), rogueIdp.start()]);

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  resource = `${base}/mcp`;

  const pair = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(pair.privateKey);
  jwk.kid = await calculateJwkThumbprint(jwk);
  jwk.alg = "RS256";
  jwk.use = "sig";

  config = loadConfig({
    GATEWAY_MODE: "broker",
    PUBLIC_BASE_URL: base,
    PORT: String(port),
    HOST: "127.0.0.1",
    BROKER_UPSTREAM_ISSUER: idp.issuer,
    BROKER_UPSTREAM_CLIENT_ID: IDP_CLIENT_ID,
    BROKER_UPSTREAM_CLIENT_SECRET: IDP_CLIENT_SECRET,
    BROKER_UPSTREAM_KIND: "oidc",
    BROKER_SIGNING_JWKS: JSON.stringify({ keys: [jwk] }),
    BROKER_COOKIE_KEYS: COOKIE_KEY,
    BROKER_TRUSTED_ASSERTION_ISSUERS: JSON.stringify([{ issuer: idp.issuer, jwks_uri: idp.jwksUri }]),
  });

  const fixtureSpec: BackendSpec = {
    ...spec("fixture"),
    command: process.execPath,
    args: [fileURLToPath(new URL("../test-fixtures/fixture-server.mjs", import.meta.url))],
  };
  const policy = parsePolicy(POLICY_YAML, ["fixture"]);
  pool = new BackendPool([fixtureSpec], (s) => new Backend(s), { idleMs: 60_000, maxPerUserChildren: 5 });
  const audit = new AuditLogger({ hmacKey: "k", sink: (l) => lines.push(l) });
  const gateway = new Gateway(pool, policy, audit);
  await gateway.init();

  runtime = buildAuthRuntime(config, policy, audit);
  httpServer = createHttpServer({
    config,
    gateway,
    audit,
    verify: runtime.verify,
    prm: runtime.prm,
    wwwAuthenticateScope: runtime.wwwAuthenticateScope,
    fallback: runtime.fallback,
    health: () => ({ status: "ok" }),
  });
  await new Promise<void>((resolve) => httpServer.listen(port, "127.0.0.1", resolve));
}, 60_000);

afterAll(async () => {
  runtime?.close?.();
  httpServer?.closeAllConnections();
  await new Promise<void>((resolve) => (httpServer ? httpServer.close(() => resolve()) : resolve()));
  await pool?.closeAll();
  await Promise.all([idp?.stop(), rogueIdp?.stop()]);
});

// ---------------------------------------------------------------------------
// Helpers: an OAuthClientProvider for the real MCP SDK, and a browser stand-in
// that follows the redirect chain with a cookie jar.
// ---------------------------------------------------------------------------

class TestOAuthProvider implements OAuthClientProvider {
  info?: OAuthClientInformationMixed;
  tok?: OAuthTokens;
  verifier = "";
  authUrl?: URL;
  constructor(
    private readonly redirect: string,
    private readonly name = "Test <b>Client</b>",
  ) {}
  get redirectUrl(): string {
    return this.redirect;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.name,
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
    this.authUrl = u;
  }
  saveCodeVerifier(v: string): void {
    this.verifier = v;
  }
  codeVerifier(): string {
    return this.verifier;
  }
}

interface Driven {
  final: URL;
  consentHtml?: string;
}

async function drive(start: URL, redirectPrefix: string, jar = new CookieJar()): Promise<Driven> {
  let url = start;
  let method = "GET";
  let consentHtml: string | undefined;
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
      if (next.href.startsWith(redirectPrefix)) return { final: next, consentHtml };
      url = next;
      continue;
    }
    const body = await res.text();
    const form = /action="([^"]*\/confirm)"/.exec(body);
    if (res.status === 200 && form) {
      consentHtml = body;
      url = new URL(form[1]!.replaceAll("&#47;", "/"), url);
      method = "POST";
      continue;
    }
    throw new Error(`unexpected ${res.status} at ${url.pathname}: ${body.slice(0, 200)}`);
  }
  throw new Error("redirect chain too long");
}

async function signIn(redirect: string, name?: string): Promise<{ provider: TestOAuthProvider; consentHtml?: string }> {
  const provider = new TestOAuthProvider(redirect, name);
  expect(await auth(provider, { serverUrl: resource })).toBe("REDIRECT");
  const { final, consentHtml } = await drive(provider.authUrl!, redirect);
  expect(final.searchParams.get("error")).toBeNull();
  expect(final.searchParams.get("state")).toBe(provider.authUrl!.searchParams.get("state"));
  expect(await auth(provider, { serverUrl: resource, authorizationCode: final.searchParams.get("code")! })).toBe("AUTHORIZED");
  return { provider, consentHtml };
}

async function postToken(form: Record<string, string>): Promise<Response> {
  return fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
}

// ---------------------------------------------------------------------------
// Acceptance 6
// ---------------------------------------------------------------------------

describe("acceptance 6: broker round trip", () => {
  it("advertises the capabilities MCP clients key on", async () => {
    for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
      const meta = (await (await fetch(`${base}${path}`)).json()) as Record<string, unknown>;
      expect(meta.issuer).toBe(base);
      expect(meta.client_id_metadata_document_supported).toBe(true);
      expect(meta.token_endpoint_auth_methods_supported).toContain("none");
      expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
      expect(meta.grant_types_supported).toContain(JWT_BEARER_GRANT);
      expect(meta.grant_types_supported).toContain("refresh_token");
      expect(meta.registration_endpoint).toBe(`${base}/reg`);
    }
    const prm = (await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()) as Record<string, unknown>;
    expect(prm).toMatchObject({ resource, authorization_servers: [base], scopes_supported: ["mcp"] });
  });

  it("matches loopback redirects on any port for native clients", async () => {
    const reg = await fetch(`${base}/reg`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Loopback client",
        redirect_uris: ["http://127.0.0.1:41000/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(reg.status).toBe(201);
    const { client_id } = (await reg.json()) as { client_id: string };

    const authorize = async (redirectUri: string): Promise<Response> => {
      const u = new URL(`${base}/auth`);
      u.search = new URLSearchParams({
        client_id,
        response_type: "code",
        redirect_uri: redirectUri,
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
        resource,
        scope: "mcp",
      }).toString();
      return fetch(u, { redirect: "manual" });
    };
    const otherPort = await authorize("http://127.0.0.1:52999/callback");
    expect(otherPort.status).toBe(303);
    expect(otherPort.headers.get("location")).toMatch(/^\/interaction\//);
    expect((await authorize("http://127.0.0.1:52999/elsewhere")).status).toBe(400);
  });

  it("runs DCR + PKCE S256 + resource through the real SDK, issues a role-carrying JWT, and rotates refresh tokens", async () => {
    const redirect = "http://127.0.0.1:43111/callback";
    const { provider, consentHtml } = await signIn(redirect);

    // DCR happened and the resource indicator was requested.
    expect(provider.info?.client_id).toBeTruthy();
    expect(provider.authUrl!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(provider.authUrl!.searchParams.get("resource")).toBe(resource);

    // Consent page: client name HTML-escaped, redirect host shown.
    expect(consentHtml).toContain("127.0.0.1:43111");
    expect(consentHtml).toContain("Test &#60;b&#62;Client&#60;/b&#62;");
    expect(consentHtml).not.toContain("<b>Client</b>");

    // Access token: signed JWT, aud = MCP resource, iss = gateway, roles.
    const access = provider.tok!.access_token;
    const header = decodeProtectedHeader(access);
    expect(header.alg).toBe("RS256");
    const claims = decodeJwt(access);
    expect(claims.iss).toBe(base);
    expect(claims.aud).toBe(resource);
    expect(claims.roles).toEqual(["fixture-reader"]);
    expect(claims.email).toBe("alice@example.com");
    const verified = await jwtVerify(access, createRemoteJWKSet(new URL(`${base}/jwks`)), { issuer: base, audience: resource });
    expect(verified.payload.client_id).toBe(provider.info!.client_id);

    // The token works on /mcp through the real SDK client and a real stdio backend.
    const client = new Client({ name: "broker-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(resource), { authProvider: provider });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual(["fx_read"]);
      const result = (await client.callTool({ name: "fx_read", arguments: { q: "hello" } })) as { content: Array<{ text: string }> };
      expect(result.content[0]!.text).toContain("fx_read ok");
    } finally {
      await client.close();
    }

    // Refresh rotates the refresh token; the old one is dead afterwards.
    const firstRefresh = provider.tok!.refresh_token!;
    expect(firstRefresh).toBeTruthy();
    expect(await auth(provider, { serverUrl: resource })).toBe("AUTHORIZED");
    const secondRefresh = provider.tok!.refresh_token!;
    expect(secondRefresh).toBeTruthy();
    expect(secondRefresh).not.toBe(firstRefresh);
    expect(decodeJwt(provider.tok!.access_token).aud).toBe(resource);

    const replay = await postToken({ grant_type: "refresh_token", refresh_token: firstRefresh, client_id: provider.info!.client_id });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe("invalid_grant");

    // Audit: token_issued events exist; no secret or token reaches the log.
    const issued = events().filter((e) => e.event === "token_issued");
    expect(issued.length).toBeGreaterThanOrEqual(2);
    expect(issued[0]).toMatchObject({ client_id: provider.info!.client_id, roles: ["fixture-reader"], outcome: "ok" });
    const log = lines.join("\n");
    for (const secret of [access, firstRefresh, secondRefresh, IDP_CLIENT_SECRET, "upstream-access-token-never-used", COOKIE_KEY]) {
      expect(log).not.toContain(secret);
    }
  }, 30_000);

  it("challenges /mcp requests that carry no token", async () => {
    const none = await fetch(resource, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
    expect(none.headers.get("www-authenticate")).toContain('scope="mcp"');
  });

  it("escapes every interpolated value on the consent page", () => {
    const html = renderConsent({
      uid: 'u"><x>',
      clientName: "<script>alert(1)</script>",
      clientId: "id&'x",
      redirectHost: "evil.example.com\"><i>",
      scopes: ["<mcp>"],
    });
    expect(html).not.toMatch(/<script|<x>|<i>|<mcp>/i);
    expect(escapeHtml(`<>&"'`)).toBe("&#60;&#62;&#38;&#34;&#39;");
  });
});

// ---------------------------------------------------------------------------
// Acceptance 7
// ---------------------------------------------------------------------------

describe("acceptance 7: jwt-bearer (identity assertion) grant", () => {
  let clientId: string;

  beforeAll(async () => {
    const reg = await fetch(`${base}/reg`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Assertion client",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        grant_types: [JWT_BEARER_GRANT],
        response_types: [],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(reg.status).toBe(201);
    clientId = ((await reg.json()) as { client_id: string }).client_id;
  });

  let jtiCounter = 0;
  function assertionClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000);
    return {
      iss: idp.issuer,
      sub: "assertion-user-1",
      aud: base,
      client_id: clientId,
      jti: `jti-${Date.now()}-${jtiCounter++}`,
      iat: now,
      exp: now + 300,
      email: "bob@example.com",
      groups: ["mcp-readers"],
      ...over,
    };
  }

  const exchange = (assertion: string, extra: Record<string, string> = {}): Promise<Response> =>
    postToken({ grant_type: JWT_BEARER_GRANT, client_id: clientId, assertion, ...extra });

  async function expectInvalidGrant(res: Response): Promise<void> {
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; error_description?: string };
    expect(body.error).toBe("invalid_grant");
    // Nothing about signatures, issuers, keys or the allowlist reaches the client.
    expect(JSON.stringify(body)).not.toMatch(/signature|issuer|trust|allow|jwks|key|jti|audience|client_id|expired/i);
  }

  it("exchanges an allowlisted issuer's assertion for an access token that works on /mcp", async () => {
    const assertion = await idp.sign(assertionClaims(), { typ: "oauth-id-jag+jwt" });
    const res = await exchange(assertion, { resource });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; token_type: string; expires_in: number };
    expect(body.token_type).toBe("Bearer");
    const claims = decodeJwt(body.access_token);
    expect(claims).toMatchObject({ iss: base, aud: resource, roles: ["fixture-reader"], client_id: clientId });

    const mcp = await fetch(resource, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${body.access_token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(mcp.status).toBe(200);
    const listed = (await mcp.json()) as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools.map((t) => t.name)).toEqual(["fx_read"]);

    expect(events().some((e) => e.event === "token_issued" && e.client_id === clientId)).toBe(true);
    expect(lines.join("\n")).not.toContain(assertion);
  });

  it("accepts a request without the resource parameter", async () => {
    const res = await exchange(await idp.sign(assertionClaims(), { typ: "oauth-id-jag+jwt" }));
    expect(res.status).toBe(200);
    expect(decodeJwt(((await res.json()) as { access_token: string }).access_token).aud).toBe(resource);
  });

  it("rejects an issuer that is not allowlisted", async () => {
    const assertion = await rogueIdp.sign(assertionClaims({ iss: rogueIdp.issuer }), { typ: "oauth-id-jag+jwt" });
    await expectInvalidGrant(await exchange(assertion, { resource }));
  });

  it("rejects an allowlisted issuer name signed with a different key", async () => {
    const assertion = await rogueIdp.sign(assertionClaims(), { typ: "oauth-id-jag+jwt" });
    await expectInvalidGrant(await exchange(assertion, { resource }));
  });

  it("rejects the wrong audience", async () => {
    const assertion = await idp.sign(assertionClaims({ aud: "https://other.example.com" }), { typ: "oauth-id-jag+jwt" });
    await expectInvalidGrant(await exchange(assertion, { resource }));
  });

  it("rejects the wrong client_id claim", async () => {
    const assertion = await idp.sign(assertionClaims({ client_id: "some-other-client" }), { typ: "oauth-id-jag+jwt" });
    await expectInvalidGrant(await exchange(assertion, { resource }));
  });

  it("rejects a replayed jti", async () => {
    const assertion = await idp.sign(assertionClaims(), { typ: "oauth-id-jag+jwt" });
    expect((await exchange(assertion, { resource })).status).toBe(200);
    await expectInvalidGrant(await exchange(assertion, { resource }));
  });

  it("rejects expired assertions, the wrong typ, a user with no role, and a missing assertion", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expectInvalidGrant(await exchange(await idp.sign(assertionClaims({ iat: now - 900, exp: now - 600 }), { typ: "oauth-id-jag+jwt" })));
    await expectInvalidGrant(await exchange(await idp.sign(assertionClaims(), { typ: "JWT" })));
    await expectInvalidGrant(await exchange(await idp.sign(assertionClaims({ groups: ["nobody"] }), { typ: "oauth-id-jag+jwt" })));
    await expectInvalidGrant(await exchange("not-a-jwt"));
    await expectInvalidGrant(await postToken({ grant_type: JWT_BEARER_GRANT, client_id: clientId }));
  });

  it("rejects a resource other than this gateway with invalid_target", async () => {
    const assertion = await idp.sign(assertionClaims(), { typ: "oauth-id-jag+jwt" });
    const res = await exchange(assertion, { resource: "https://other.example.com/mcp" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_target");
  });

  it("audits rejections by reason code only", () => {
    const reasons = events().filter((e) => e.event === "auth_failed" && e.client_id === clientId).map((e) => e.reason);
    expect(reasons).toEqual(expect.arrayContaining(["issuer_not_trusted", "assertion_replayed", "assertion_client_mismatch"]));
  });
});
