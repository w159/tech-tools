import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from "jose";
import { AuthError, verifyAccessToken } from "./auth.js";
import type { GatewayConfig } from "./config.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const RESOURCE_URL = "https://mcp.henssler.com/mcp";

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    entraTenantId: TENANT_ID,
    entraClientId: CLIENT_ID,
    mcpResourceUrl: RESOURCE_URL,
    port: 8080,
    host: "0.0.0.0",
    backendsRoot: "/app/mcp",
    enabledBackends: [],
    ...overrides,
  };
}

let privateKey: KeyLike;
let keyResolver: ReturnType<typeof createLocalJWKSet>;

async function sign(payload: Record<string, unknown>, opts: { exp?: string } = {}): Promise<string> {
  let jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h");
  return jwt.sign(privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const publicJwk = (await exportJWK(pair.publicKey)) as JWK;
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  keyResolver = createLocalJWKSet({ keys: [publicJwk] });
});

const validClaims = () => ({
  iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
  aud: CLIENT_ID,
  tid: TENANT_ID,
  oid: "user-oid-1",
  preferred_username: "user@henssler.com",
  roles: ["Vanta.Read"],
});

describe("verifyAccessToken", () => {
  it("returns an identity with roles for a valid token", async () => {
    const token = await sign(validClaims());
    const identity = await verifyAccessToken(token, makeConfig(), keyResolver);
    expect(identity).toEqual({
      oid: "user-oid-1",
      upn: "user@henssler.com",
      name: undefined,
      roles: ["Vanta.Read"],
    });
  });

  it("rejects the wrong issuer", async () => {
    const token = await sign({ ...validClaims(), iss: "https://login.microsoftonline.com/wrong-tenant/v2.0" });
    await expect(verifyAccessToken(token, makeConfig(), keyResolver)).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<AuthError>);
  });

  it("rejects the wrong audience", async () => {
    const token = await sign({ ...validClaims(), aud: "33333333-3333-3333-3333-333333333333" });
    await expect(verifyAccessToken(token, makeConfig(), keyResolver)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a tid mismatch", async () => {
    const token = await sign({ ...validClaims(), tid: "44444444-4444-4444-4444-444444444444" });
    await expect(verifyAccessToken(token, makeConfig(), keyResolver)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects an expired token", async () => {
    const token = await sign(validClaims(), { exp: "-1h" });
    await expect(verifyAccessToken(token, makeConfig(), keyResolver)).rejects.toBeInstanceOf(AuthError);
  });
});
