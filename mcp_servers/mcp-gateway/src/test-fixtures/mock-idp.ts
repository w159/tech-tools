import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";

export const IDP_CLIENT_ID = "gateway-upstream-client";
export const IDP_CLIENT_SECRET = "upstream-client-secret-for-tests";

export interface TestUser {
  sub: string;
  email: string;
  name: string;
  groups: string[];
  // Entra puts assigned app role values in the ID token's "roles" claim.
  roles?: string[];
}

export const TEST_USER: TestUser = {
  sub: "upstream-user-1",
  email: "alice@example.com",
  name: "Alice Example",
  groups: ["mcp-readers"],
};

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

// In-process upstream OIDC IdP. /authorize signs the fixed test user in with
// no prompt; /token verifies PKCE and client authentication and returns a
// jose-signed ID token.
export class MockIdp {
  readonly kid = "mock-idp-key";
  private server!: Server;
  private privateKey!: CryptoKey;
  private publicJwk!: JWK;
  private readonly codes = new Map<string, { nonce: string; challenge: string; redirectUri: string }>();
  issuer = "";
  user: TestUser = TEST_USER;
  tokenRequests = 0;

  async start(): Promise<void> {
    const pair = await generateKeyPair("RS256", { extractable: true });
    this.privateKey = pair.privateKey;
    this.publicJwk = { ...(await exportJWK(pair.publicKey)), kid: this.kid, alg: "RS256", use: "sig" };
    this.server = createServer((req, res) => void this.handle(req, res).catch(() => res.end()));
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  // Signs any JWT with this IdP's key (used for assertions in the jwt-bearer tests).
  async sign(claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: this.kid, ...header })
      .sign(this.privateKey);
  }

  get jwksUri(): string {
    return `${this.issuer}/jwks`;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.issuer);
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(res, 200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: this.jwksUri,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") return json(res, 200, { keys: [this.publicJwk] });

    if (url.pathname === "/authorize") {
      const p = url.searchParams;
      if (p.get("client_id") !== IDP_CLIENT_ID || p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256") {
        return json(res, 400, { error: "invalid_request" });
      }
      const code = randomBytes(16).toString("hex");
      this.codes.set(code, { nonce: p.get("nonce") ?? "", challenge: p.get("code_challenge") ?? "", redirectUri: p.get("redirect_uri") ?? "" });
      const back = new URL(p.get("redirect_uri") ?? "");
      back.searchParams.set("code", code);
      back.searchParams.set("state", p.get("state") ?? "");
      res.writeHead(302, { Location: back.toString() });
      return void res.end();
    }

    if (url.pathname === "/token" && req.method === "POST") {
      this.tokenRequests += 1;
      const form = await readForm(req);
      const basic = req.headers.authorization?.startsWith("Basic ")
        ? Buffer.from(req.headers.authorization.slice(6), "base64").toString("utf8").split(":")
        : [];
      const id = form.get("client_id") ?? basic[0];
      const secret = form.get("client_secret") ?? basic[1];
      if (id !== IDP_CLIENT_ID || secret !== IDP_CLIENT_SECRET) return json(res, 401, { error: "invalid_client" });
      const code = this.codes.get(form.get("code") ?? "");
      this.codes.delete(form.get("code") ?? "");
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (!code || code.challenge !== challenge || code.redirectUri !== form.get("redirect_uri")) {
        return json(res, 400, { error: "invalid_grant" });
      }
      const idToken = await new SignJWT({
        nonce: code.nonce,
        email: this.user.email,
        email_verified: true,
        name: this.user.name,
        groups: this.user.groups,
        ...(this.user.roles ? { roles: this.user.roles } : {}),
      })
        .setProtectedHeader({ alg: "RS256", kid: this.kid })
        .setIssuer(this.issuer)
        .setSubject(this.user.sub)
        .setAudience(IDP_CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(this.privateKey);
      return json(res, 200, { access_token: "upstream-access-token-never-used", token_type: "Bearer", expires_in: 3600, id_token: idToken });
    }
    json(res, 404, { error: "not_found" });
  }
}
