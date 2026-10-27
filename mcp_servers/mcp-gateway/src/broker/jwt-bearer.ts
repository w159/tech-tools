import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { errors, type Provider, type ProviderCtx } from "oidc-provider";
import { buildTokenResponse } from "oidc-provider/lib/helpers/grants.js";
import type { AuditLogger } from "../audit.js";
import type { TrustedAssertionIssuer } from "../config.js";
import { resolveRoles, type Policy } from "../policy.js";
import type { StorageAdapter } from "./adapter.js";
import { accountIdFor, type AccountStore } from "./accounts.js";
import { identityFromClaims } from "./identity.js";

export const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
export const ID_JAG_TYP = "oauth-id-jag+jwt";
export const JTI_MODEL = "AssertionJti";
const CLOCK_TOLERANCE_SECONDS = 60;
// An assertion is meant to be redeemed right away; anything older than this is
// refused even when its exp is further out.
const MAX_ASSERTION_AGE_SECONDS = 600;

export interface JwtBearerDeps {
  provider: Provider;
  issuer: string;
  resource: string;
  resourceInfo: Record<string, unknown>;
  trusted: readonly TrustedAssertionIssuer[];
  policy: Policy;
  accounts: AccountStore;
  jtis: StorageAdapter;
  audit: AuditLogger;
  // Test seam: key resolvers per trusted issuer instead of remote JWKS fetches.
  keyResolverFor?: (issuer: TrustedAssertionIssuer) => JWTVerifyGetKey;
}

class AssertionRejected extends Error {}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// Peeks at iss without trusting it: only used to pick which allowlisted key
// set to verify against. Anything unparsable is rejected.
function unverifiedIssuer(assertion: string): string | undefined {
  const parts = assertion.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as JWTPayload;
    return str(payload.iss);
  } catch {
    return undefined;
  }
}

export function registerJwtBearerGrant(deps: JwtBearerDeps): void {
  const { provider, audit } = deps;
  const trusted = new Map(deps.trusted.map((t) => [t.issuer, t]));
  const resolvers = new Map<string, JWTVerifyGetKey>();
  const keysFor = (t: TrustedAssertionIssuer): JWTVerifyGetKey => {
    let r = resolvers.get(t.issuer);
    if (!r) {
      r = deps.keyResolverFor ? deps.keyResolverFor(t) : createRemoteJWKSet(new URL(t.jwksUri));
      resolvers.set(t.issuer, r);
    }
    return r;
  };
  const inFlight = new Set<string>();

  async function verify(assertion: string, clientId: string): Promise<JWTPayload> {
    const iss = unverifiedIssuer(assertion);
    const issuer = iss ? trusted.get(iss) : undefined;
    if (!issuer) throw new AssertionRejected("issuer_not_trusted");

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(assertion, keysFor(issuer), {
        issuer: issuer.issuer,
        audience: deps.issuer,
        typ: ID_JAG_TYP,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ["iss", "sub", "aud", "exp", "iat", "jti", "client_id"],
      }));
    } catch (err) {
      // jose names the failed check (claim, signature, key lookup). That detail
      // goes to the audit log by code only, never to the client.
      const code = (err as { code?: string }).code ?? "verify_failed";
      throw new AssertionRejected(`assertion_${code.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`);
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.iat !== "number" || payload.iat > now + CLOCK_TOLERANCE_SECONDS) throw new AssertionRejected("assertion_iat_invalid");
    if (now - payload.iat > MAX_ASSERTION_AGE_SECONDS + CLOCK_TOLERANCE_SECONDS) throw new AssertionRejected("assertion_too_old");
    if (payload.client_id !== clientId) throw new AssertionRejected("assertion_client_mismatch");
    if (issuer.tenant !== undefined && (str(payload.tenant) ?? str(payload.tid)) !== issuer.tenant) {
      throw new AssertionRejected("assertion_tenant_mismatch");
    }
    return payload;
  }

  // Marks a jti used. The in-flight set closes the gap between the lookup and
  // the write when two requests carry the same assertion at once.
  async function consumeJti(issuer: string, jti: string, exp: number): Promise<void> {
    const key = `${issuer}|${jti}`;
    if (inFlight.has(key)) throw new AssertionRejected("assertion_replayed");
    inFlight.add(key);
    try {
      if (await deps.jtis.find(key)) throw new AssertionRejected("assertion_replayed");
      const ttl = Math.max(60, exp - Math.floor(Date.now() / 1000) + CLOCK_TOLERANCE_SECONDS);
      await deps.jtis.upsert(key, { issuer, jti }, ttl);
    } finally {
      inFlight.delete(key);
    }
  }

  async function handler(ctx: ProviderCtx): Promise<void> {
    const rid = String(ctx.res.getHeader("X-Request-Id") ?? "") || randomUUID();
    const client = ctx.oidc.client;
    const reject = (reason: string): never => {
      audit.emit({ request_id: rid, event: "auth_failed", client_id: client.clientId, reason });
      throw new errors.InvalidGrant();
    };

    const params = ctx.oidc.params;
    const assertion = str(params.assertion);
    if (!assertion) return reject("assertion_missing");

    // Resource, when sent, must be this gateway's MCP endpoint.
    const requestedResource = str(params.resource);
    if (requestedResource !== undefined && requestedResource !== deps.resource) {
      audit.emit({ request_id: rid, event: "auth_failed", client_id: client.clientId, reason: "resource_mismatch" });
      throw new errors.InvalidTarget();
    }
    const requestedScope = str(params.scope);
    if (requestedScope && requestedScope.split(" ").some((s) => s !== "mcp")) throw new errors.InvalidScope();

    let payload: JWTPayload;
    try {
      payload = await verify(assertion, client.clientId);
    } catch (err) {
      return reject(err instanceof AssertionRejected ? err.message : "assertion_error");
    }

    const claims = payload as Record<string, unknown>;
    const identity = identityFromClaims("oidc", claims);
    if (!identity) return reject("assertion_no_subject");
    const roles = resolveRoles(deps.policy, identity.policyClaims);
    if (roles.length === 0) return reject("no_roles");

    try {
      await consumeJti(payload.iss!, payload.jti!, payload.exp!);
    } catch (err) {
      return reject(err instanceof AssertionRejected ? err.message : "assertion_error");
    }

    const accountId = accountIdFor(payload.iss!, identity.sub);
    await deps.accounts.upsert({
      accountId,
      issuer: payload.iss!,
      sub: identity.sub,
      email: identity.email,
      name: identity.name,
      idp: "assertion",
      tenant: identity.tenant ?? str(claims.tid),
      roles,
    });

    const grant = new provider.Grant({ accountId, clientId: client.clientId });
    grant.addResourceScope(deps.resource, "mcp");
    await grant.save();

    const token = new provider.AccessToken({ accountId, client, grantId: grant.jti, gty: JWT_BEARER_GRANT });
    token.resourceServer = new provider.ResourceServer(deps.resource, deps.resourceInfo);
    token.scope = "mcp";
    ctx.oidc.entity("AccessToken", token);
    const accessToken = await token.save();

    ctx.body = buildTokenResponse(provider, {
      accessToken,
      tokenType: token.tokenType,
      expiresIn: token.expiration,
      scope: token.scope,
    });
  }

  provider.registerGrantType(JWT_BEARER_GRANT, handler, ["assertion", "resource", "scope"]);
}
