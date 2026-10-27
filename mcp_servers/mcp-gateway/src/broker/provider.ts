import { createLocalJWKSet, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { errors, Provider } from "oidc-provider";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditLogger } from "../audit.js";
import { verifyAccessToken, type Identity } from "../auth.js";
import type { BrokerConfig, GatewayConfig, TrustedAssertionIssuer } from "../config.js";
import { resolveRoles, type Policy } from "../policy.js";
import { createMemoryAdapter, type MemoryAdapter } from "./adapter.js";
import { ACCOUNT_MODEL, AccountStore, type AccountRecord } from "./accounts.js";
import { clientCredentialsTokenProvider, EntraMembership, managedIdentityTokenProvider, type FetchLike } from "./entra-membership.js";
import { lookupGoogleGroups } from "./google-groups.js";
import { createInteractionHandler, UPSTREAM_LOGIN_MODEL } from "./interactions.js";
import { JTI_MODEL, JWT_BEARER_GRANT, registerJwtBearerGrant } from "./jwt-bearer.js";
import { createUpstreamClient, type UpstreamClient } from "./upstream.js";

export const RESOURCE_SCOPE = "mcp";
// Server-side sessions only bridge the sign-in redirect chain; they are not a
// long-lived single sign-on, so role changes are picked up at the next login.
const SESSION_TTL_SECONDS = 8 * 3600;
// Placeholder for the CIMD acknowledgement the experimental feature demands.
const CIMD_ACK = "draft-02";

export interface BrokerOptions {
  config: GatewayConfig;
  policy: Policy;
  audit: AuditLogger;
  // Test seams.
  upstream?: UpstreamClient;
  adapter?: MemoryAdapter;
  lookupGroups?: (email: string) => Promise<string[]>;
  keyResolverFor?: (issuer: TrustedAssertionIssuer) => JWTVerifyGetKey;
  // fetch used for Graph and the Graph token endpoints (tests point it at a fake).
  graphFetch?: FetchLike;
}

export interface Broker {
  provider: Provider;
  // Mounted as the HTTP fallback: interaction pages first, then the provider.
  fallback: (req: IncomingMessage, res: ServerResponse) => void;
  verify: (token: string) => Promise<Identity>;
  prm: () => object;
  wwwAuthenticateScope: string;
  // Stops the housekeeping timer.
  close: () => void;
}

function publicJwk(jwk: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(jwk)) if (!["d", "p", "q", "dp", "dq", "qi", "k"].includes(k)) out[k] = v;
  return out;
}

export function createBroker(opts: BrokerOptions): Broker {
  const { config, policy, audit } = opts;
  const broker: BrokerConfig | undefined = config.broker;
  if (!broker) throw new Error("createBroker requires broker mode");
  const issuer = config.publicBaseUrl;
  const resource = config.resource;

  const memory = opts.adapter ?? createMemoryAdapter();
  const accounts = new AccountStore(new memory.Adapter(ACCOUNT_MODEL));
  const logins = new memory.Adapter(UPSTREAM_LOGIN_MODEL);
  const jtis = new memory.Adapter(JTI_MODEL);
  const sweeper = setInterval(() => memory.sweep(), 60_000);
  sweeper.unref();

  // Entra only: re-resolve roles from Graph on every token-endpoint grant
  // (authorization_code and refresh_token) that issues tokens for an account.
  const membershipCfg = broker.entraMembership;
  const membership = membershipCfg
    ? new EntraMembership({
        appId: broker.upstream.clientId,
        spObjectId: membershipCfg.spObjectId,
        cacheSeconds: membershipCfg.cacheSeconds,
        graphBaseUrl: membershipCfg.graphBaseUrl,
        fetch: opts.graphFetch,
        tokenProvider: membershipCfg.managedIdentity
          ? managedIdentityTokenProvider({ ...membershipCfg.managedIdentity, fetch: opts.graphFetch })
          : clientCredentialsTokenProvider({
              authorityHost: membershipCfg.authorityHost,
              tenantId: membershipCfg.tenantId,
              clientId: broker.upstream.clientId,
              clientSecret: broker.upstream.clientSecret,
              fetch: opts.graphFetch,
            }),
      })
    : undefined;

  // Returns false when the refresh must fail with invalid_grant. On success the
  // account record carries the fresh roles, so extraTokenClaims and the audit
  // event read them. Audit lines hold reasons only, never ids or tokens.
  // authTimeSeconds is when the user authenticated upstream (oidc-provider's
  // authTime on the code or refresh token, carried through rotation); Entra
  // "Revoke sessions" after that moment ends the entitlement.
  async function refreshStillEntitled(
    ctx: { oidc?: { client?: { clientId?: string } } },
    acct: AccountRecord,
    authTimeSeconds: number | undefined,
  ): Promise<boolean> {
    if (!membership || !membershipCfg) return true;
    const clientId = ctx.oidc?.client?.clientId;
    const fail = (reason: string, outcome: "ok" | "backend_error"): void => {
      audit.emit({
        request_id: randomUUID(),
        event: "auth_failed",
        actor: { sub: acct.accountId, idp: acct.idp, tenant: acct.tenant },
        client_id: clientId,
        reason,
        outcome,
      });
    };
    const result = await membership.resolve(acct.sub, authTimeSeconds);
    if (result.status === "unavailable") {
      if (membershipCfg.failOpen) {
        fail("membership_check_unavailable", "ok");
        return true;
      }
      fail("membership_check_unavailable", "backend_error");
      return false;
    }
    if (result.status === "revoked") {
      fail("membership_revoked", "backend_error");
      return false;
    }
    const roles = resolveRoles(policy, {
      roles: result.appRoles,
      groups: result.groupIds,
      oid: acct.sub,
      ...(acct.tenant ? { tid: acct.tenant } : {}),
      ...(acct.email ? { email: acct.email } : {}),
    });
    if (roles.length === 0) {
      fail("membership_revoked", "backend_error");
      return false;
    }
    if (roles.join("\n") !== [...acct.roles].sort().join("\n")) await accounts.upsert({ ...acct, roles });
    return true;
  }

  const resourceInfo = {
    scope: RESOURCE_SCOPE,
    audience: resource,
    accessTokenTTL: broker.accessTokenTtl,
    accessTokenFormat: "jwt",
  };

  const provider = new Provider(issuer, {
    adapter: memory.Adapter,
    jwks: { keys: broker.signingJwks.keys },
    cookies: { keys: [...broker.cookieKeys] },
    scopes: ["openid", "offline_access", RESOURCE_SCOPE],
    // application_type native: loopback redirects match on any port (Claude
    // Code), and https redirects stay valid (claude.ai). Public clients by
    // default; PKCE is mandatory for them and S256 is the only method.
    clientDefaults: {
      application_type: "native",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token", JWT_BEARER_GRANT],
      response_types: ["code"],
    },
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true, initialAccessToken: false, issueRegistrationAccessToken: true },
      clientIdMetadataDocument: { enabled: true, ack: CIMD_ACK },
      revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource: async () => resource,
        useGrantedResource: async () => true,
        getResourceServerInfo: async (_ctx: unknown, indicator: string) => {
          if (indicator !== resource) throw new errors.InvalidTarget();
          return resourceInfo;
        },
      },
    },
    ttl: {
      AccessToken: broker.accessTokenTtl,
      RefreshToken: broker.refreshTokenTtl,
      // The grant bounds the whole refresh chain, so rotation cannot extend a
      // sign-in past this and role changes always reach a re-login.
      Grant: broker.refreshTokenTtl,
      Session: SESSION_TTL_SECONDS,
    },
    // Rotation on for every client; a replayed refresh token revokes the grant.
    rotateRefreshToken: true,
    issueRefreshToken: async (_ctx: unknown, client: { grantTypeAllowed(t: string): boolean }) => client.grantTypeAllowed("refresh_token"),
    // oidc-provider turns an undefined account into invalid_grant at the token
    // endpoint (grant_common.validateAccount). That runs before tokens are
    // issued or a refresh token is rotated, so a failed check consumes nothing.
    // Every token-endpoint grant carries params.grant_type (authorization
    // endpoint, userinfo and introspection do not); the third argument is the
    // authorization code or refresh token being redeemed.
    findAccount: async (
      ctx: { oidc?: { params?: Record<string, unknown>; client?: { clientId?: string } } },
      id: string,
      source?: { authTime?: unknown },
    ) => {
      const acct = await accounts.find(id);
      if (!acct) return undefined;
      if (membership && typeof ctx?.oidc?.params?.grant_type === "string" && acct.idp === "entra") {
        const authTime = typeof source?.authTime === "number" ? source.authTime : undefined;
        if (!(await refreshStillEntitled(ctx, acct, authTime))) return undefined;
      }
      return {
        accountId: id,
        async claims() {
          return { sub: id, ...(acct.email ? { email: acct.email } : {}), ...(acct.name ? { name: acct.name } : {}) };
        },
      };
    },
    extraTokenClaims: async (_ctx: unknown, token: { accountId?: string }) => {
      const acct = token.accountId ? await accounts.find(token.accountId) : undefined;
      if (!acct) return undefined;
      return {
        roles: acct.roles,
        idp: acct.idp,
        ...(acct.email ? { email: acct.email } : {}),
        ...(acct.tenant ? { tenant: acct.tenant } : {}),
      };
    },
    interactions: { url: async (_ctx: unknown, interaction: { uid: string }) => `/interaction/${interaction.uid}` },
  });
  provider.proxy = true;

  provider.on("server_error", (_ctx: unknown, err: Error) => {
    console.error("[broker] server_error:", err?.name ?? "Error");
  });

  // Audit every access token the authorization server issues. Event payloads
  // are the token model; only identifiers go to the log, never its value.
  provider.on("access_token.issued", (token: { accountId?: string; clientId?: string; gty?: string }) => {
    void (async () => {
      const acct = token.accountId ? await accounts.find(token.accountId) : undefined;
      audit.emit({
        request_id: randomUUID(),
        event: "token_issued",
        actor: acct ? { sub: acct.accountId, email: acct.email, idp: acct.idp, tenant: acct.tenant } : undefined,
        client_id: token.clientId,
        roles: acct?.roles,
        reason: (token.gty ?? "unknown").replace(/[^A-Za-z0-9:_ .-]/g, "").slice(0, 80),
        outcome: "ok",
      });
    })().catch(() => undefined);
  });

  registerJwtBearerGrant({
    provider,
    issuer,
    resource,
    resourceInfo,
    trusted: broker.trustedAssertionIssuers,
    policy,
    accounts,
    jtis,
    audit,
    keyResolverFor: opts.keyResolverFor,
  });

  const upstream = opts.upstream ?? createUpstreamClient(broker.upstream);
  const handleInteraction = createInteractionHandler({
    provider,
    baseUrl: config.publicBaseUrl,
    upstream,
    upstreamKind: broker.upstream.kind,
    upstreamIssuer: broker.upstream.issuer,
    logins,
    accounts,
    policy,
    audit,
    lookupGroups: opts.lookupGroups ?? (broker.googleGroupsLookup ? (email) => lookupGoogleGroups(email) : undefined),
  });

  const callback = provider.callback();
  const fallback = (req: IncomingMessage, res: ServerResponse): void => {
    handleInteraction(req, res)
      .then((handled) => {
        if (!handled) callback(req, res);
      })
      .catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "server_error" }));
        }
      });
  };

  // Resource-server side: tokens must come from this issuer, for this
  // resource, signed by one of the published keys; roles are the claim the
  // authorization server wrote.
  const publicKeys = createLocalJWKSet({ keys: broker.signingJwks.keys.map((k) => publicJwk(k)) as never });
  const verify = (token: string): Promise<Identity> =>
    verifyAccessToken(token, {
      issuer,
      audiences: [resource],
      keyResolver: publicKeys,
      rolesFor: (claims: JWTPayload) =>
        Array.isArray(claims.roles) ? claims.roles.filter((r): r is string => typeof r === "string") : [],
      idp: broker.upstream.kind,
      clockToleranceSeconds: config.tokenClockToleranceSeconds,
    });

  return {
    provider,
    fallback,
    verify,
    prm: () => brokerProtectedResourceMetadata(config),
    wwwAuthenticateScope: RESOURCE_SCOPE,
    close: () => clearInterval(sweeper),
  };
}

// RFC 9728 metadata for broker mode: this gateway is its own authorization
// server, and the only one listed (clients read the first entry).
export function brokerProtectedResourceMetadata(config: GatewayConfig): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.publicBaseUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: [RESOURCE_SCOPE],
  };
}
