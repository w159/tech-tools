import { beforeAll, describe, expect, it } from "vitest";
import { AuthError, verifyAccessToken, type TokenVerifierOptions } from "./auth.js";
import { makeSigner, type Signer } from "./test-fixtures/helpers.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const RESOURCE_URL = "https://mcp.example.com/mcp";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;

let signer: Signer;

function opts(overrides: Partial<TokenVerifierOptions> = {}): TokenVerifierOptions {
  return {
    issuer: ISSUER,
    audiences: [CLIENT_ID, `api://${CLIENT_ID}`, RESOURCE_URL],
    keyResolver: signer.keyResolver,
    tenant: { claim: "tid", equals: TENANT_ID },
    rolesFor: (claims) => (Array.isArray(claims.roles) ? (claims.roles as string[]) : []),
    idp: "entra",
    ...overrides,
  };
}

beforeAll(async () => {
  signer = await makeSigner();
});

const validClaims = () => ({
  iss: ISSUER,
  aud: CLIENT_ID,
  tid: TENANT_ID,
  oid: "user-oid-1",
  preferred_username: "user@example.com",
  azp: "client-app-1",
  roles: ["Vanta.Read"],
});

describe("verifyAccessToken", () => {
  it("returns an identity with roles for a valid token", async () => {
    const identity = await verifyAccessToken(await signer.sign(validClaims()), opts());
    expect(identity).toEqual({
      userKey: `${ISSUER}|user-oid-1`,
      sub: "user-oid-1",
      email: "user@example.com",
      name: undefined,
      idp: "entra",
      tenant: TENANT_ID,
      clientId: "client-app-1",
      roles: ["Vanta.Read"],
    });
  });

  it("rejects the wrong issuer", async () => {
    const token = await signer.sign({ ...validClaims(), iss: "https://login.microsoftonline.com/wrong-tenant/v2.0" });
    await expect(verifyAccessToken(token, opts())).rejects.toMatchObject({ status: 401 } satisfies Partial<AuthError>);
  });

  it("rejects the wrong audience", async () => {
    const token = await signer.sign({ ...validClaims(), aud: "33333333-3333-3333-3333-333333333333" });
    await expect(verifyAccessToken(token, opts())).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a tid mismatch", async () => {
    const token = await signer.sign({ ...validClaims(), tid: "44444444-4444-4444-4444-444444444444" });
    await expect(verifyAccessToken(token, opts())).rejects.toMatchObject({ status: 401 });
  });

  it("rejects an expired token", async () => {
    const token = await signer.sign(validClaims(), { exp: "-1h" });
    await expect(verifyAccessToken(token, opts())).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a token signed by an unknown key", async () => {
    const other = await makeSigner("other-key");
    await expect(verifyAccessToken(await other.sign(validClaims()), opts())).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a token with no subject", async () => {
    const { oid: _oid, ...noSub } = validClaims();
    await expect(verifyAccessToken(await signer.sign(noSub), opts())).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("missing subject"),
    });
  });

  it("falls back to sub, email, client_id and the idp option for non-Entra tokens", async () => {
    const token = await signer.sign({ iss: ISSUER, aud: CLIENT_ID, sub: "s-1", email: "a@example.com", client_id: "cli", name: "A" });
    const identity = await verifyAccessToken(token, opts({ tenant: undefined, idp: "direct" }));
    expect(identity).toMatchObject({ sub: "s-1", email: "a@example.com", clientId: "cli", name: "A", idp: "direct", roles: [] });
  });

  it("prefers the idp claim over the option", async () => {
    const token = await signer.sign({ ...validClaims(), idp: "google" });
    expect((await verifyAccessToken(token, opts())).idp).toBe("google");
  });
});
