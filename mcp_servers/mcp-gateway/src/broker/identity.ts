import type { UpstreamKind } from "../config.js";

export interface UpstreamIdentity {
  sub: string;
  email?: string;
  name?: string;
  tenant?: string;
  // Claims the policy's subject rules are evaluated against.
  policyClaims: Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// Maps verified ID token claims to a gateway identity. extraGroups are groups
// resolved out of band (Google Cloud Identity); they are merged into the
// "groups" claim so one policy subject rule works for every IdP.
export function identityFromClaims(
  kind: UpstreamKind,
  claims: Record<string, unknown>,
  extraGroups: readonly string[] = [],
): UpstreamIdentity | undefined {
  // Entra's sub is pairwise per application; oid is the stable user id there.
  const sub = kind === "entra" ? (str(claims.oid) ?? str(claims.sub)) : str(claims.sub);
  if (!sub) return undefined;

  // An address the IdP says is unverified is not an identity: drop it so a
  // policy rule on email cannot match it.
  const emailVerified = claims.email_verified !== false && claims.email_verified !== "false";
  const email = emailVerified ? (str(claims.email) ?? str(claims.preferred_username) ?? str(claims.upn)) : undefined;

  const tenant = kind === "entra" ? str(claims.tid) : kind === "google" ? str(claims.hd) : str(claims.tenant);

  const groups = new Set<string>(Array.isArray(claims.groups) ? claims.groups.filter((g): g is string => typeof g === "string") : []);
  for (const g of extraGroups) groups.add(g);

  const policyClaims: Record<string, unknown> = { ...claims, groups: [...groups] };
  if (!emailVerified) delete policyClaims.email;
  if (email) policyClaims.email = email;

  return { sub, email, name: str(claims.name), tenant, policyClaims };
}
