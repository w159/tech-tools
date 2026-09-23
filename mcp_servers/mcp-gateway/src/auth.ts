import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { GatewayConfig } from "./config.js";

export class AuthError extends Error {
  readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403) {
    super(message);
    this.status = status;
  }
}

export interface Identity {
  readonly oid: string;
  readonly upn: string;
  readonly name?: string;
  readonly roles: readonly string[];
}

interface EntraJwtPayload extends JWTPayload {
  oid?: string;
  upn?: string;
  preferred_username?: string;
  name?: string;
  roles?: string[];
  tid?: string;
}

export function createJwks(tenantId: string): JWTVerifyGetKey {
  return createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
  );
}

// keyResolver is injectable so tests can pass createLocalJWKSet instead of a
// live network fetch against login.microsoftonline.com.
export async function verifyAccessToken(
  token: string,
  config: GatewayConfig,
  keyResolver: JWTVerifyGetKey,
): Promise<Identity> {
  let payload: EntraJwtPayload;
  try {
    const result = await jwtVerify<EntraJwtPayload>(token, keyResolver, {
      issuer: `https://login.microsoftonline.com/${config.entraTenantId}/v2.0`,
      audience: [config.entraClientId, `api://${config.entraClientId}`, config.mcpResourceUrl],
      clockTolerance: 60,
    });
    payload = result.payload;
  } catch (err) {
    // Never log the token itself - only the failure reason.
    throw new AuthError(`invalid_token: ${err instanceof Error ? err.message : String(err)}`, 401);
  }

  if (payload.tid !== config.entraTenantId) {
    throw new AuthError("invalid_token: tenant mismatch", 401);
  }

  const oid = payload.oid ?? payload.sub;
  if (!oid) {
    throw new AuthError("invalid_token: missing oid", 401);
  }

  return {
    oid,
    upn: payload.preferred_username ?? payload.upn ?? oid,
    name: payload.name,
    roles: payload.roles ?? [],
  };
}
