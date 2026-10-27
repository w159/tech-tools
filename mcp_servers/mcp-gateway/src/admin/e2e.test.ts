import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync, readFileSync } from "node:fs";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateJwkThumbprint, decodeJwt, exportJWK, generateKeyPair } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { AuditLogger } from "../audit.js";
import { Backend, BackendPool, type BackendSpec } from "../backends.js";
import { loadConfig, type GatewayConfig } from "../config.js";
import { Gateway } from "../gateway.js";
import { createHttpServer } from "../http.js";
import { parsePolicy, type Policy } from "../policy.js";
import { buildAuthRuntime, type AuthRuntime } from "../runtime.js";
import { allFileText, cli, fixturePath, tempDir } from "../test-fixtures/admin-helpers.js";
import { CookieJar } from "../test-fixtures/cookie-jar.js";
import { FAKE_TENANT_ID, FakeGraph } from "../test-fixtures/fake-graph.js";
import { spec } from "../test-fixtures/helpers.js";
import { IDP_CLIENT_ID, IDP_CLIENT_SECRET, MockIdp } from "../test-fixtures/mock-idp.js";
import type { Plan } from "./plan.js";

// discover -> plan -> provision --apply against a fake Graph, then the broker
// is started with the generated env and policy and a mock Entra user signs in.

const GRAPH_TOKEN = "e2e-graph-token-0006";
const COOKIE_KEY = "cookie-signing-key-for-tests-0123456789";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

let fake: FakeGraph;
let idp: MockIdp;
let tmp: { dir: string; cleanup: () => void };
let plan: Plan;
let policy: Policy;
let config: GatewayConfig;
let runtime: AuthRuntime;
let httpServer: HttpServer;
let pool: BackendPool;
let resource: string;

// What Entra would put in the ID token's "roles" claim for a user: the values of
// the app roles assigned (through groups) in the tenant state `provision` built.
function rolesClaimFor(userId: string): string[] {
  const app = fake.applications[0]!;
  const sp = fake.servicePrincipals.find((s) => s.appId === app.appId)!;
  const roles = new Set<string>();
  for (const a of fake.assignments.filter((x) => x.resourceId === sp.id)) {
    const group = fake.groups.find((g) => g.id === a.principalId);
    if (group?.members.includes(userId)) roles.add(String(app.appRoles.find((r) => r.id === a.appRoleId)!.value));
  }
  return [...roles].sort();
}

beforeAll(async () => {
  fake = new FakeGraph({ token: GRAPH_TOKEN, pageSize: 3 });
  await fake.start();
  tmp = tempDir();
  const env = { GRAPH_TOKEN, GRAPH_BASE_URL: fake.baseUrl };
  const p = (n: string): string => join(tmp.dir, n);
  copyFileSync(fixturePath("answers.yaml"), p("answers.yaml"));
  expect((await cli(["discover", "--out", p("org-model.json")], env)).code).toBe(0);
  expect((await cli(["plan", "--org", p("org-model.json"), "--answers", p("answers.yaml"), "--out", p("plan.json"), "--policy", p("policy.yaml")], env)).code).toBe(0);
  const applied = await cli(["provision", "--plan", p("plan.json"), "--apply"], env);
  expect(applied.code).toBe(0);
  plan = JSON.parse(readFileSync(p("plan.json"), "utf8")) as Plan;
  policy = parsePolicy(readFileSync(p("policy.yaml"), "utf8"), ["ninjaone", "connectwise"]);

  idp = new MockIdp();
  await idp.start();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  resource = `${base}/mcp`;

  const pair = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(pair.privateKey);
  jwk.kid = await calculateJwkThumbprint(jwk);
  jwk.alg = "RS256";
  jwk.use = "sig";

  // The generated env, with only what a laptop test cannot share with production
  // replaced: the public URL, the upstream issuer (a mock IdP stands in for
  // login.microsoftonline.com) and the secrets.
  config = loadConfig({
    ...plan.gatewayEnv,
    PUBLIC_BASE_URL: base,
    PORT: String(port),
    HOST: "127.0.0.1",
    BROKER_UPSTREAM_ISSUER: idp.issuer,
    ENTRA_TENANT_ID: FAKE_TENANT_ID,
    BROKER_UPSTREAM_CLIENT_ID: IDP_CLIENT_ID,
    BROKER_UPSTREAM_CLIENT_SECRET: IDP_CLIENT_SECRET,
    BROKER_SIGNING_JWKS: JSON.stringify({ keys: [jwk] }),
    BROKER_COOKIE_KEYS: COOKIE_KEY,
    // This suite checks policy output; the Graph membership check has its own suite.
    ENTRA_MEMBERSHIP_CHECK: "0",
  });

  const server = fileURLToPath(new URL("./fixtures/tool-server.mjs", import.meta.url));
  const specs: BackendSpec[] = ["ninjaone", "connectwise"].map((id) => ({ ...spec(id), command: process.execPath, args: [server, id] }));
  pool = new BackendPool(specs, (s) => new Backend(s), { idleMs: 60_000, maxPerUserChildren: 5 });
  const audit = new AuditLogger({ hmacKey: "k", sink: () => undefined });
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
  await idp?.stop();
  await fake?.stop();
  tmp?.cleanup();
});

class Provider implements OAuthClientProvider {
  info?: OAuthClientInformationMixed;
  tok?: OAuthTokens;
  verifier = "";
  authUrl?: URL;
  constructor(private readonly redirect: string) {}
  get redirectUrl(): string {
    return this.redirect;
  }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: "admin e2e", redirect_uris: [this.redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
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

// Follows the browser redirect chain (mock IdP sign-in, consent form) to the client's redirect.
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
    throw new Error(`unexpected ${res.status} at ${url.pathname}: ${body.slice(0, 200)}`);
  }
  throw new Error("redirect chain too long");
}

async function authorize(userId: string, port: number): Promise<{ provider: Provider; final: URL }> {
  idp.user = { sub: `upstream-${userId}`, email: `${userId}@contoso.example`, name: "Fixture Person", groups: [], roles: rolesClaimFor(userId) };
  const redirect = `http://127.0.0.1:${port}/callback`;
  const provider = new Provider(redirect);
  expect(await auth(provider, { serverUrl: resource })).toBe("REDIRECT");
  return { provider, final: await drive(provider.authUrl!, redirect) };
}

async function signInAs(userId: string, port: number): Promise<{ client: Client; provider: Provider }> {
  const { provider, final } = await authorize(userId, port);
  expect(final.searchParams.get("error")).toBeNull();
  expect(await auth(provider, { serverUrl: resource, authorizationCode: final.searchParams.get("code")! })).toBe("AUTHORIZED");
  const client = new Client({ name: "admin-e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(resource), { authProvider: provider }));
  return { client, provider };
}

describe("admin flow -> broker", () => {
  it("generated an Entra-shaped env and a policy the gateway loads", () => {
    expect(plan.gatewayEnv.BROKER_UPSTREAM_ISSUER).toBe(`https://login.microsoftonline.com/${FAKE_TENANT_ID}/v2.0`);
    expect(config.broker?.upstream.kind).toBe("entra");
    expect(config.broker?.refreshTokenTtl).toBe(28_800);
    expect(policy.subjects.map((s) => s.role)).toEqual(["it-ops", "helpdesk"]);
  });

  it("an IT Operations member sees exactly what the it-ops grants allow", async () => {
    const { client, provider } = await signInAs(fake.users[0]!.id, 43711);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      // ninjaone: read+write minus the denied ninjaone_get_secret; connectwise: read+write; nothing destructive.
      expect(names).toEqual(["connectwise_get_secret", "connectwise_list", "connectwise_update", "ninjaone_list", "ninjaone_update"]);
      expect(decodeJwt(provider.tok!.access_token).roles).toEqual(["it-ops"]);
      const denied = (await client.callTool({ name: "ninjaone_delete", arguments: {} })) as { isError?: boolean };
      expect(denied.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("a Help Desk member sees only the read tools on connectwise", async () => {
    const { client } = await signInAs(fake.users[3]!.id, 43712);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["connectwise_get_secret", "connectwise_list"]);
    } finally {
      await client.close();
    }
  });

  it("a user in neither assigned group gets no role and is refused at sign-in", async () => {
    expect(rolesClaimFor(fake.users[7]!.id)).toEqual([]);
    const { provider, final } = await authorize(fake.users[7]!.id, 43713);
    expect(final.searchParams.get("error")).toBe("access_denied");
    expect(provider.tok).toBeUndefined();
  });

  it("left no graph token in any generated file", () => {
    expect(allFileText(tmp.dir)).not.toContain(GRAPH_TOKEN);
  });
});
