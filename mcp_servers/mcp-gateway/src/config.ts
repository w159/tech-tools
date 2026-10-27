import { fileURLToPath } from "node:url";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GatewayMode = "direct" | "broker";

// Resource-server settings for direct mode: the IdP issues the access tokens
// and this process only validates them.
export interface DirectAuthConfig {
  readonly issuer: string;
  readonly jwksUri: string;
  readonly audiences: readonly string[];
  readonly tenant?: { readonly claim: string; readonly equals: string };
  readonly scope: string;
  // "entra" selects the Entra-flavoured PRM (adds offline_access) and the
  // default idp label for audit.
  readonly idp: string;
}

export type UpstreamKind = "entra" | "google" | "oidc";

// An identity-assertion issuer the jwt-bearer grant trusts.
export interface TrustedAssertionIssuer {
  readonly issuer: string;
  readonly jwksUri: string;
  // When set, the assertion's "tenant" (or "tid") claim must equal it.
  readonly tenant?: string;
}

// Broker mode: this process is also the OAuth authorization server and
// federates sign-in to one upstream OIDC IdP.
export interface BrokerConfig {
  readonly upstream: {
    readonly issuer: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly kind: UpstreamKind;
  };
  // Private signing keys (JWKS). The first key signs; all stay published.
  readonly signingJwks: { readonly keys: readonly Record<string, unknown>[] };
  readonly cookieKeys: readonly string[];
  readonly trustedAssertionIssuers: readonly TrustedAssertionIssuer[];
  readonly accessTokenTtl: number;
  readonly refreshTokenTtl: number;
  readonly googleGroupsLookup: boolean;
}

export interface GatewayConfig {
  readonly mode: GatewayMode;
  // Canonical origin, no trailing slash. All externally visible URLs derive
  // from it, never from the Host header.
  readonly publicBaseUrl: string;
  // MCP resource identifier (the token audience), normally <base>/mcp.
  readonly resource: string;
  readonly direct?: DirectAuthConfig;
  readonly broker?: BrokerConfig;
  readonly policyFile?: string;
  readonly policyCompat: boolean;
  readonly catalogFile: string;
  readonly backendsRoot: string;
  // undefined = every installed catalog entry.
  readonly enabledBackends?: readonly string[];
  readonly auditHmacKey?: string;
  readonly statefulIdleMs: number;
  readonly statefulMaxChildren: number;
  readonly port: number;
  readonly host: string;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

// https only, except loopback so a local run needs no certificate.
function parseHttpUrl(raw: string): URL | undefined {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname))) return u;
  } catch {
    // fall through
  }
  return undefined;
}

function intVar(env: NodeJS.ProcessEnv, name: string, fallback: number, errors: string[], min = 0): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    errors.push(`${name} (not an integer >= ${min})`);
    return fallback;
  }
  return n;
}

function list(raw: string | undefined): string[] {
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export function loadConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  const errors: string[] = [];

  // Direct stays the default whenever the existing Entra variables are
  // present, so a deployment that predates GATEWAY_MODE needs no env change.
  let mode: GatewayMode = "direct";
  const modeRaw = env.GATEWAY_MODE;
  if (modeRaw === "direct" || modeRaw === "broker") mode = modeRaw;
  else if (modeRaw) errors.push("GATEWAY_MODE (must be broker or direct)");
  else if (!env.ENTRA_TENANT_ID) errors.push("GATEWAY_MODE (required when ENTRA_TENANT_ID is not set)");

  // Base URL and resource.
  let publicBaseUrl = "";
  let resource = "";
  if (env.PUBLIC_BASE_URL) {
    const u = parseHttpUrl(env.PUBLIC_BASE_URL);
    if (!u) errors.push("PUBLIC_BASE_URL (not an https URL)");
    else if (u.pathname !== "/" || u.search || u.hash) errors.push("PUBLIC_BASE_URL (must be an origin without a path)");
    else {
      publicBaseUrl = u.origin;
      resource = `${publicBaseUrl}/mcp`;
    }
  } else if (env.MCP_RESOURCE_URL) {
    const u = parseHttpUrl(env.MCP_RESOURCE_URL);
    if (!u) errors.push("MCP_RESOURCE_URL (not an https URL)");
    else {
      publicBaseUrl = u.origin;
      resource = stripTrailingSlash(u.toString());
    }
  } else {
    errors.push("PUBLIC_BASE_URL");
  }

  let direct: DirectAuthConfig | undefined;
  let broker: BrokerConfig | undefined;
  if (mode === "broker") {
    broker = loadBroker(env, errors);
  } else {
    direct = loadDirect(env, resource, errors);
  }

  const backendsRoot = env.BACKENDS_ROOT || "/app/mcp";
  const enabled = list(env.ENABLED_BACKENDS);
  const statefulIdleMs = intVar(env, "STATEFUL_IDLE_MS", 900_000, errors, 1);
  const statefulMaxChildren = intVar(env, "STATEFUL_MAX_CHILDREN", 50, errors, 1);
  const port = intVar(env, "PORT", 8080, errors);

  if (errors.length > 0) {
    throw new Error(`mcp-gateway: missing/invalid required env vars: ${errors.join(", ")}`);
  }

  return Object.freeze({
    mode,
    publicBaseUrl,
    resource,
    direct,
    broker,
    policyFile: env.POLICY_FILE || undefined,
    policyCompat: env.POLICY_COMPAT === "1",
    catalogFile: env.CATALOG_FILE || fileURLToPath(new URL("../catalog/catalog.json", import.meta.url)),
    backendsRoot,
    enabledBackends: enabled.length > 0 ? Object.freeze(enabled) : undefined,
    auditHmacKey: env.AUDIT_HMAC_KEY || undefined,
    statefulIdleMs,
    statefulMaxChildren,
    port,
    host: env.HOST || "0.0.0.0",
  });
}

function loadDirect(env: NodeJS.ProcessEnv, resource: string, errors: string[]): DirectAuthConfig | undefined {
  const hasEntra = Boolean(env.ENTRA_TENANT_ID || env.ENTRA_CLIENT_ID);
  const hasGeneric = Boolean(env.DIRECT_ISSUER || env.DIRECT_JWKS_URI || env.DIRECT_AUDIENCES);
  if (hasEntra && hasGeneric) {
    errors.push("ENTRA_* and DIRECT_* are mutually exclusive");
    return undefined;
  }

  if (hasEntra) {
    const tid = env.ENTRA_TENANT_ID;
    const cid = env.ENTRA_CLIENT_ID;
    if (!tid) errors.push("ENTRA_TENANT_ID");
    else if (!GUID_RE.test(tid)) errors.push("ENTRA_TENANT_ID (not a GUID)");
    if (!cid) errors.push("ENTRA_CLIENT_ID");
    else if (!GUID_RE.test(cid)) errors.push("ENTRA_CLIENT_ID (not a GUID)");
    if (!tid || !cid || !resource || !GUID_RE.test(tid) || !GUID_RE.test(cid)) return undefined;
    return {
      issuer: `https://login.microsoftonline.com/${tid}/v2.0`,
      jwksUri: `https://login.microsoftonline.com/${tid}/discovery/v2.0/keys`,
      audiences: [cid, `api://${cid}`, resource],
      tenant: { claim: "tid", equals: tid },
      scope: `${resource}/access_as_user`,
      idp: "entra",
    };
  }

  if (!hasGeneric) {
    errors.push("ENTRA_TENANT_ID and ENTRA_CLIENT_ID, or DIRECT_ISSUER, DIRECT_JWKS_URI and DIRECT_AUDIENCES");
    return undefined;
  }
  const before = errors.length;
  const issuer = env.DIRECT_ISSUER;
  const jwksUri = env.DIRECT_JWKS_URI;
  const audiences = list(env.DIRECT_AUDIENCES);
  if (!issuer) errors.push("DIRECT_ISSUER");
  if (!jwksUri) errors.push("DIRECT_JWKS_URI");
  else if (!parseHttpUrl(jwksUri)) errors.push("DIRECT_JWKS_URI (not an https URL)");
  if (audiences.length === 0) errors.push("DIRECT_AUDIENCES");
  const claim = env.DIRECT_TENANT_CLAIM;
  const equals = env.DIRECT_TENANT;
  if (Boolean(claim) !== Boolean(equals)) errors.push("DIRECT_TENANT_CLAIM and DIRECT_TENANT (set both or neither)");
  if (errors.length > before) return undefined;
  return {
    issuer: issuer!,
    jwksUri: jwksUri!,
    audiences,
    tenant: claim && equals ? { claim, equals } : undefined,
    scope: env.DIRECT_SCOPE || "mcp",
    idp: "direct",
  };
}

const UPSTREAM_KINDS: readonly string[] = ["entra", "google", "oidc"];
const PRIVATE_JWK_PARAMS = ["d", "p", "q", "dp", "dq", "qi", "k"];

// Messages name the variable and the problem only, never a value: the
// broker variables hold secrets.
function loadBroker(env: NodeJS.ProcessEnv, errors: string[]): BrokerConfig | undefined {
  const before = errors.length;

  const issuer = env.BROKER_UPSTREAM_ISSUER;
  if (!issuer) errors.push("BROKER_UPSTREAM_ISSUER");
  else if (!parseHttpUrl(issuer)) errors.push("BROKER_UPSTREAM_ISSUER (not an https URL)");
  const clientId = env.BROKER_UPSTREAM_CLIENT_ID;
  if (!clientId) errors.push("BROKER_UPSTREAM_CLIENT_ID");
  const clientSecret = env.BROKER_UPSTREAM_CLIENT_SECRET;
  if (!clientSecret) errors.push("BROKER_UPSTREAM_CLIENT_SECRET");
  const kind = env.BROKER_UPSTREAM_KIND || "oidc";
  if (!UPSTREAM_KINDS.includes(kind)) errors.push("BROKER_UPSTREAM_KIND (must be entra, google or oidc)");

  let signingJwks: BrokerConfig["signingJwks"] | undefined;
  if (!env.BROKER_SIGNING_JWKS) errors.push("BROKER_SIGNING_JWKS");
  else {
    try {
      const doc = JSON.parse(env.BROKER_SIGNING_JWKS) as { keys?: unknown };
      const keys = Array.isArray(doc.keys) ? (doc.keys as Record<string, unknown>[]) : [];
      const ok =
        keys.length > 0 &&
        keys.every(
          (k) =>
            k !== null &&
            typeof k === "object" &&
            typeof k.kid === "string" &&
            k.kid.length > 0 &&
            PRIVATE_JWK_PARAMS.some((p) => typeof k[p] === "string"),
        );
      if (ok) signingJwks = { keys };
      else errors.push("BROKER_SIGNING_JWKS (needs keys[] of private JWKs, each with a kid)");
    } catch {
      errors.push("BROKER_SIGNING_JWKS (not valid JSON)");
    }
  }

  const cookieKeys = list(env.BROKER_COOKIE_KEYS);
  if (cookieKeys.length === 0) errors.push("BROKER_COOKIE_KEYS");
  else if (cookieKeys.some((k) => k.length < 32)) errors.push("BROKER_COOKIE_KEYS (each key needs at least 32 characters)");

  const trusted: TrustedAssertionIssuer[] = [];
  if (env.BROKER_TRUSTED_ASSERTION_ISSUERS) {
    let bad = false;
    try {
      const raw = JSON.parse(env.BROKER_TRUSTED_ASSERTION_ISSUERS) as unknown;
      if (!Array.isArray(raw)) bad = true;
      else {
        for (const item of raw as Array<Record<string, unknown> | null>) {
          const jwks = typeof item?.jwks_uri === "string" ? parseHttpUrl(item.jwks_uri) : undefined;
          if (!item || typeof item.issuer !== "string" || !item.issuer || !jwks || (item.tenant !== undefined && typeof item.tenant !== "string")) {
            bad = true;
            break;
          }
          trusted.push({ issuer: item.issuer, jwksUri: jwks.toString(), ...(item.tenant ? { tenant: item.tenant as string } : {}) });
        }
      }
    } catch {
      bad = true;
    }
    if (bad) errors.push("BROKER_TRUSTED_ASSERTION_ISSUERS (JSON list of {issuer, jwks_uri, tenant?})");
  }

  const accessTokenTtl = intVar(env, "BROKER_ACCESS_TOKEN_TTL", 900, errors, 1);
  const refreshTokenTtl = intVar(env, "BROKER_REFRESH_TOKEN_TTL", 28_800, errors, 1);
  const googleGroupsLookup = env.GOOGLE_GROUPS_LOOKUP === "1";
  if (googleGroupsLookup && kind !== "google") errors.push("GOOGLE_GROUPS_LOOKUP (only valid when BROKER_UPSTREAM_KIND=google)");

  if (errors.length > before) return undefined;
  return {
    upstream: { issuer: issuer!, clientId: clientId!, clientSecret: clientSecret!, kind: kind as UpstreamKind },
    signingJwks: signingJwks!,
    cookieKeys,
    trustedAssertionIssuers: trusted,
    accessTokenTtl,
    refreshTokenTtl,
    googleGroupsLookup,
  };
}

// RFC 9728 Protected Resource Metadata for direct mode: the IdP itself is the
// authorization server.
export function directProtectedResourceMetadata(config: GatewayConfig): Record<string, unknown> {
  const d = config.direct;
  if (!d) throw new Error("directProtectedResourceMetadata requires direct mode");
  return {
    resource: config.resource,
    authorization_servers: [d.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: d.idp === "entra" ? [d.scope, "offline_access"] : [d.scope],
  };
}
