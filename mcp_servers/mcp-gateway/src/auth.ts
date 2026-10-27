import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export class AuthError extends Error {
  readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403) {
    super(message);
    this.status = status;
  }
}

export interface Identity {
  // "<issuer>|<sub>": stable across display-name and email changes, and unique
  // across IdPs. Keys per-user backend children and audit correlation.
  readonly userKey: string;
  // Entra: oid (sub is pairwise per app there); everywhere else: sub.
  readonly sub: string;
  readonly email?: string;
  readonly name?: string;
  readonly idp: string;
  readonly tenant?: string;
  readonly clientId?: string;
  // Gateway roles (policy subject rules applied to the token claims), not raw
  // IdP roles.
  readonly roles: readonly string[];
}

export interface TokenVerifierOptions {
  issuer: string;
  audiences: string[];
  keyResolver: JWTVerifyGetKey;
  // When set, the named claim must equal the value: pins one tenant.
  tenant?: { claim: string; equals: string };
  rolesFor: (claims: JWTPayload) => string[];
  // Fallback for tokens without an "idp" claim.
  idp: string;
  // Leeway for exp/nbf in seconds; GatewayConfig.tokenClockToleranceSeconds.
  clockToleranceSeconds?: number;
}

export const DEFAULT_CLOCK_TOLERANCE_SECONDS = 5;

export function remoteJwks(jwksUri: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUri));
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// keyResolver is injectable so tests can pass createLocalJWKSet instead of a
// live network fetch.
export async function verifyAccessToken(token: string, opts: TokenVerifierOptions): Promise<Identity> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, opts.keyResolver, {
      issuer: opts.issuer,
      audience: opts.audiences,
      clockTolerance: opts.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS,
    });
    payload = result.payload;
  } catch (err) {
    // Never log the token itself - only the failure reason.
    throw new AuthError(`invalid_token: ${err instanceof Error ? err.message : String(err)}`, 401);
  }

  let tenant: string | undefined;
  if (opts.tenant) {
    tenant = str(payload[opts.tenant.claim]);
    if (tenant !== opts.tenant.equals) throw new AuthError("invalid_token: tenant mismatch", 401);
  } else {
    tenant = str(payload.tenant) ?? str(payload.tid);
  }

  const sub = str(payload.oid) ?? str(payload.sub);
  if (!sub) throw new AuthError("invalid_token: missing subject", 401);

  return {
    userKey: `${opts.issuer}|${sub}`,
    sub,
    email: str(payload.email) ?? str(payload.preferred_username) ?? str(payload.upn),
    name: str(payload.name),
    idp: str(payload.idp) ?? opts.idp,
    tenant,
    clientId: str(payload.client_id) ?? str(payload.azp) ?? str(payload.appid),
    roles: opts.rolesFor(payload),
  };
}
