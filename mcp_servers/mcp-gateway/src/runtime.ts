import { readFileSync } from "node:fs";
import type { JWTPayload } from "jose";
import { remoteJwks, verifyAccessToken, type Identity } from "./auth.js";
import type { BackendSpec } from "./backends.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditLogger } from "./audit.js";
import { createBroker } from "./broker/index.js";
import { directProtectedResourceMetadata, type GatewayConfig } from "./config.js";
import { compatPolicy, mergePolicies, parsePolicy, resolveRoles, type Policy } from "./policy.js";

// Compat profile alone when no policy file is given; the file's rules plus the
// compat profile when POLICY_COMPAT=1; the file alone otherwise.
export function buildPolicy(config: GatewayConfig, specs: readonly BackendSpec[]): Policy {
  const compat = compatPolicy(specs.map((s) => ({ id: s.id, compatRole: s.compatRole })));
  if (!config.policyFile) return compat;
  const parsed = parsePolicy(readFileSync(config.policyFile, "utf8"), specs.map((s) => s.id));
  return config.policyCompat ? mergePolicies(parsed, compat) : parsed;
}

// Direct-mode verifier: the IdP's JWKS, with gateway roles derived from the
// token claims by the policy's subject rules.
export function buildDirectVerifier(config: GatewayConfig, policy: Policy): (token: string) => Promise<Identity> {
  const d = config.direct;
  if (!d) throw new Error("buildDirectVerifier requires direct mode");
  const keyResolver = remoteJwks(d.jwksUri);
  return (token) =>
    verifyAccessToken(token, {
      issuer: d.issuer,
      audiences: [...d.audiences],
      keyResolver,
      tenant: d.tenant,
      rolesFor: (claims: JWTPayload) => resolveRoles(policy, claims),
      idp: d.idp,
      clockToleranceSeconds: config.tokenClockToleranceSeconds,
    });
}

// Everything http.ts needs from the auth side, for either mode.
export interface AuthRuntime {
  verify: (token: string) => Promise<Identity>;
  prm: () => object;
  wwwAuthenticateScope: string;
  // Broker mode mounts the authorization server here.
  fallback?: (req: IncomingMessage, res: ServerResponse) => void;
  close?: () => void;
}

export function buildAuthRuntime(config: GatewayConfig, policy: Policy, audit: AuditLogger): AuthRuntime {
  if (config.mode === "broker") {
    const broker = createBroker({ config, policy, audit });
    return {
      verify: broker.verify,
      prm: broker.prm,
      wwwAuthenticateScope: broker.wwwAuthenticateScope,
      fallback: broker.fallback,
      close: broker.close,
    };
  }
  const direct = config.direct;
  if (!direct) throw new Error("direct mode configuration missing");
  return {
    verify: buildDirectVerifier(config, policy),
    prm: () => directProtectedResourceMetadata(config),
    wwwAuthenticateScope: direct.scope,
  };
}
