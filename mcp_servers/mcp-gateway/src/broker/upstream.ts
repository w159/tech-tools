import * as oidc from "openid-client";
import type { BrokerConfig } from "../config.js";

// The slice of an OIDC relying party the interaction handlers need. Kept as
// an interface so tests can inject a stub and so the handlers never touch
// openid-client types.
export interface UpstreamClient {
  authorizationUrl(p: { redirectUri: string; state: string; nonce: string; codeVerifier: string }): Promise<URL>;
  // Exchanges the callback for tokens and returns only the verified ID token
  // claims. The access and refresh tokens are dropped inside this call.
  exchange(p: { callbackUrl: URL; state: string; nonce: string; codeVerifier: string }): Promise<Record<string, unknown>>;
}

export function newPkceVerifier(): string {
  return oidc.randomPKCECodeVerifier();
}
export function newState(): string {
  return oidc.randomState();
}
export function newNonce(): string {
  return oidc.randomNonce();
}

const SCOPE = "openid email profile";

export function createUpstreamClient(cfg: BrokerConfig["upstream"]): UpstreamClient {
  const server = new URL(cfg.issuer);
  const insecure = server.protocol === "http:";
  let configuration: Promise<oidc.Configuration> | undefined;

  // Discovery is lazy so the gateway starts while the IdP is unreachable, and
  // a failed attempt is retried on the next sign-in.
  function config(): Promise<oidc.Configuration> {
    if (!configuration) {
      configuration = oidc
        .discovery(server, cfg.clientId, cfg.clientSecret, undefined, insecure ? { execute: [oidc.allowInsecureRequests] } : undefined)
        .catch((err: unknown) => {
          configuration = undefined;
          throw err;
        });
    }
    return configuration;
  }

  return {
    async authorizationUrl(p) {
      const c = await config();
      return oidc.buildAuthorizationUrl(c, {
        response_type: "code",
        redirect_uri: p.redirectUri,
        scope: SCOPE,
        state: p.state,
        nonce: p.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(p.codeVerifier),
        code_challenge_method: "S256",
      });
    },
    async exchange(p) {
      const c = await config();
      const tokens = await oidc.authorizationCodeGrant(c, p.callbackUrl, {
        pkceCodeVerifier: p.codeVerifier,
        expectedState: p.state,
        expectedNonce: p.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error("upstream returned no ID token");
      return { ...claims };
    },
  };
}
