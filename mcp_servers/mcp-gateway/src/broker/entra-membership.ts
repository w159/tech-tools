// Refresh-time membership check against Microsoft Graph (Entra upstream).
//
// Graph surface used, all with application permissions:
//   GET  /servicePrincipals?$filter=appId eq '{appId}'&$select=id,appRoles   Application.Read.All
//   GET  /servicePrincipals/{id}?$select=id,appRoles                         Application.Read.All
//   GET  /servicePrincipals/{id}/appRoleAssignedTo                           Application.Read.All
//   POST /users/{oid}/checkMemberGroups  {groupIds}  (transitive, max 20)    GroupMember.Read.All
//   GET  /users/{oid}?$select=accountEnabled                                 User.Read.All
// Docs: learn.microsoft.com/graph/api/serviceprincipal-list-approleassignedto,
//       learn.microsoft.com/graph/api/directoryobject-checkmembergroups,
//       learn.microsoft.com/graph/api/user-get.
//
// Nothing here logs a token, a group id or a response body.

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAPH_RESOURCE = "https://graph.microsoft.com";
const GRAPH_SCOPE = `${GRAPH_RESOURCE}/.default`;
const MI_API_VERSION = "2019-08-01";
const TOKEN_REFRESH_SKEW_SECONDS = 300;
const CHECK_MEMBER_GROUPS_MAX = 20;
const MAX_PAGES = 20;
const DEFAULT_TIMEOUT_MS = 10_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GraphTokenProvider {
  getToken(signal: AbortSignal): Promise<string>;
  // Drops the cached token (Graph answered 401).
  invalidate(): void;
}

export class MembershipUnavailable extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "MembershipUnavailable";
  }
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  expires_on?: unknown;
}

// Wraps a raw token source: caches until 5 minutes before expiry (or half the
// lifetime for very short tokens) and shares one in-flight request.
function cachingProvider(
  fetchToken: (signal: AbortSignal) => Promise<{ token: string; expiresAtMs: number }>,
  now: () => number,
): GraphTokenProvider {
  let cached: { token: string; refreshAtMs: number } | undefined;
  let inFlight: Promise<string> | undefined;
  return {
    async getToken(signal) {
      if (cached && now() < cached.refreshAtMs) return cached.token;
      inFlight ??= (async () => {
        try {
          const issuedAt = now();
          const { token, expiresAtMs } = await fetchToken(signal);
          const lifetime = Math.max(0, expiresAtMs - issuedAt);
          const skew = Math.min(TOKEN_REFRESH_SKEW_SECONDS * 1000, lifetime / 2);
          cached = { token, refreshAtMs: expiresAtMs - skew };
          return token;
        } finally {
          inFlight = undefined;
        }
      })();
      return inFlight;
    },
    invalidate() {
      cached = undefined;
    },
  };
}

function parseTokenResponse(body: TokenResponse, now: () => number): { token: string; expiresAtMs: number } {
  if (typeof body.access_token !== "string" || body.access_token.length === 0) throw new MembershipUnavailable("graph_token_invalid_response");
  let expiresAtMs: number;
  const onRaw = body.expires_on;
  const inRaw = body.expires_in;
  if ((typeof onRaw === "string" || typeof onRaw === "number") && Number.isFinite(Number(onRaw))) expiresAtMs = Number(onRaw) * 1000;
  else if ((typeof inRaw === "string" || typeof inRaw === "number") && Number.isFinite(Number(inRaw))) expiresAtMs = now() + Number(inRaw) * 1000;
  else throw new MembershipUnavailable("graph_token_invalid_response");
  return { token: body.access_token, expiresAtMs };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

// Azure Container Apps / App Service managed identity. Per Learn
// (azure/container-apps/managed-identity): GET {IDENTITY_ENDPOINT}
// ?resource=...&api-version=2019-08-01 with the X-IDENTITY-HEADER header.
export function managedIdentityTokenProvider(opts: {
  endpoint: string;
  header: string;
  clientId?: string;
  fetch?: FetchLike;
  now?: () => number;
}): GraphTokenProvider {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => Date.now());
  return cachingProvider(async (signal) => {
    const url = new URL(opts.endpoint);
    url.searchParams.set("resource", GRAPH_RESOURCE);
    url.searchParams.set("api-version", MI_API_VERSION);
    if (opts.clientId) url.searchParams.set("client_id", opts.clientId);
    let res: Response;
    try {
      res = await doFetch(url.toString(), { method: "GET", headers: { "X-IDENTITY-HEADER": opts.header }, signal });
    } catch {
      throw new MembershipUnavailable("graph_token_unreachable");
    }
    if (!res.ok) throw new MembershipUnavailable(`graph_token_http_${res.status}`);
    return parseTokenResponse(((await readJson(res)) ?? {}) as TokenResponse, now);
  }, now);
}

// OAuth 2.0 client credentials against the tenant token endpoint.
export function clientCredentialsTokenProvider(opts: {
  authorityHost: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
  now?: () => number;
}): GraphTokenProvider {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const url = `${opts.authorityHost.replace(/\/$/, "")}/${encodeURIComponent(opts.tenantId)}/oauth2/v2.0/token`;
  return cachingProvider(async (signal) => {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          scope: GRAPH_SCOPE,
        }),
        signal,
      });
    } catch {
      throw new MembershipUnavailable("graph_token_unreachable");
    }
    if (!res.ok) throw new MembershipUnavailable(`graph_token_http_${res.status}`);
    return parseTokenResponse(((await readJson(res)) ?? {}) as TokenResponse, now);
  }, now);
}

export type MembershipResult =
  // appRoles: app role values the user holds now. groupIds stay in memory for
  // policy evaluation and never reach a log.
  | { status: "ok"; appRoles: string[]; groupIds: string[] }
  // Disabled, deleted, or no role left.
  | { status: "revoked" }
  | { status: "unavailable"; detail: string };

export interface EntraMembershipOptions {
  appId: string;
  spObjectId?: string;
  cacheSeconds: number;
  graphBaseUrl: string;
  tokenProvider: GraphTokenProvider;
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

interface RoleMap {
  expiresAtMs: number;
  groupRoles: Map<string, string[]>;
  userRoles: Map<string, string[]>;
}

type GraphReply = { status: number; json: unknown };

export class EntraMembership {
  private readonly doFetch: FetchLike;
  private readonly now: () => number;
  private readonly base: string;
  private roleMap?: RoleMap;
  private roleMapInFlight?: Promise<RoleMap>;

  constructor(private readonly opts: EntraMembershipOptions) {
    this.doFetch = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => Date.now());
    this.base = opts.graphBaseUrl.replace(/\/$/, "");
  }

  async resolve(oid: string): Promise<MembershipResult> {
    if (!GUID_RE.test(oid)) return { status: "revoked" };
    const signal = AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const map = await this.getRoleMap(signal);
      const candidateGroups = [...map.groupRoles.keys()];
      const [enabled, memberOf] = await Promise.all([this.accountEnabled(oid, signal), this.memberGroups(oid, candidateGroups, signal)]);
      if (enabled !== true || memberOf === "gone") return { status: "revoked" };
      const roles = new Set<string>(map.userRoles.get(oid.toLowerCase()) ?? []);
      for (const g of memberOf) for (const r of map.groupRoles.get(g.toLowerCase()) ?? []) roles.add(r);
      if (roles.size === 0) return { status: "revoked" };
      return { status: "ok", appRoles: [...roles].sort(), groupIds: memberOf };
    } catch (err) {
      if (err instanceof MembershipUnavailable) return { status: "unavailable", detail: err.detail };
      return { status: "unavailable", detail: "graph_unreachable" };
    }
  }

  private async graph(method: "GET" | "POST", path: string, signal: AbortSignal, body?: unknown): Promise<GraphReply> {
    return this.graphUrl(method, `${this.base}${path}`, signal, body);
  }

  private async graphUrl(method: "GET" | "POST", url: string, signal: AbortSignal, body?: unknown): Promise<GraphReply> {
    const token = await this.opts.tokenProvider.getToken(signal);
    let res: Response;
    try {
      res = await this.doFetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal,
      });
    } catch {
      throw new MembershipUnavailable("graph_unreachable");
    }
    if (res.status === 401) this.opts.tokenProvider.invalidate();
    const json = res.ok ? await readJson(res) : undefined;
    // Drain error bodies without keeping them.
    if (!res.ok) await res.arrayBuffer().catch(() => undefined);
    return { status: res.status, json };
  }

  private getRoleMap(signal: AbortSignal): Promise<RoleMap> {
    if (this.roleMap && this.now() < this.roleMap.expiresAtMs) return Promise.resolve(this.roleMap);
    this.roleMapInFlight ??= this.loadRoleMap(signal)
      .then((m) => {
        this.roleMap = m;
        return m;
      })
      .finally(() => {
        this.roleMapInFlight = undefined;
      });
    return this.roleMapInFlight;
  }

  private async loadRoleMap(signal: AbortSignal): Promise<RoleMap> {
    const { spObjectId, appId } = this.opts;
    const spReply = spObjectId
      ? await this.graph("GET", `/servicePrincipals/${encodeURIComponent(spObjectId)}?$select=id,appRoles`, signal)
      : await this.graph("GET", `/servicePrincipals?$filter=${encodeURIComponent(`appId eq '${appId}'`)}&$select=id,appRoles`, signal);
    if (spReply.status !== 200) throw new MembershipUnavailable(`graph_http_${spReply.status}`);
    const sp = spObjectId ? spReply.json : (spReply.json as { value?: unknown[] } | undefined)?.value?.[0];
    const spId = (sp as { id?: unknown } | undefined)?.id;
    const appRoles = (sp as { appRoles?: unknown } | undefined)?.appRoles;
    if (typeof spId !== "string" || !Array.isArray(appRoles)) throw new MembershipUnavailable("graph_service_principal_missing");

    const roleValueById = new Map<string, string>();
    for (const r of appRoles as Array<{ id?: unknown; value?: unknown; isEnabled?: unknown }>) {
      if (typeof r.id === "string" && typeof r.value === "string" && r.value.length > 0 && r.isEnabled !== false) {
        roleValueById.set(r.id.toLowerCase(), r.value);
      }
    }

    const groupRoles = new Map<string, string[]>();
    const userRoles = new Map<string, string[]>();
    let url: string | undefined = `${this.base}/servicePrincipals/${encodeURIComponent(spId)}/appRoleAssignedTo?$top=999`;
    for (let page = 0; url; page++) {
      if (page >= MAX_PAGES) throw new MembershipUnavailable("graph_too_many_pages");
      const reply: GraphReply = await this.graphUrl("GET", url, signal);
      if (reply.status !== 200) throw new MembershipUnavailable(`graph_http_${reply.status}`);
      const doc = reply.json as { value?: unknown; "@odata.nextLink"?: unknown } | undefined;
      if (!doc || !Array.isArray(doc.value)) throw new MembershipUnavailable("graph_invalid_response");
      for (const a of doc.value as Array<{ appRoleId?: unknown; principalId?: unknown; principalType?: unknown }>) {
        if (typeof a.appRoleId !== "string" || typeof a.principalId !== "string") continue;
        const value = roleValueById.get(a.appRoleId.toLowerCase());
        if (!value) continue; // default access role or a disabled role
        const target = a.principalType === "Group" ? groupRoles : a.principalType === "User" ? userRoles : undefined;
        if (!target) continue;
        const key = a.principalId.toLowerCase();
        target.set(key, [...(target.get(key) ?? []), value]);
      }
      const next = doc["@odata.nextLink"];
      if (typeof next === "string") {
        // Only follow a continuation that stays on the Graph origin we call.
        if (new URL(next).origin !== new URL(this.base).origin) throw new MembershipUnavailable("graph_invalid_response");
        url = next;
      } else url = undefined;
    }
    return { expiresAtMs: this.now() + this.opts.cacheSeconds * 1000, groupRoles, userRoles };
  }

  // true/false from accountEnabled; false also when the user does not exist.
  private async accountEnabled(oid: string, signal: AbortSignal): Promise<boolean> {
    const reply = await this.graph("GET", `/users/${encodeURIComponent(oid)}?$select=accountEnabled`, signal);
    if (reply.status === 404) return false;
    if (reply.status !== 200) throw new MembershipUnavailable(`graph_http_${reply.status}`);
    return (reply.json as { accountEnabled?: unknown } | undefined)?.accountEnabled === true;
  }

  private async memberGroups(oid: string, groupIds: string[], signal: AbortSignal): Promise<string[] | "gone"> {
    if (groupIds.length === 0) return [];
    const chunks: string[][] = [];
    for (let i = 0; i < groupIds.length; i += CHECK_MEMBER_GROUPS_MAX) chunks.push(groupIds.slice(i, i + CHECK_MEMBER_GROUPS_MAX));
    const replies = await Promise.all(chunks.map((c) => this.graph("POST", `/users/${encodeURIComponent(oid)}/checkMemberGroups`, signal, { groupIds: c })));
    const out: string[] = [];
    for (const r of replies) {
      if (r.status === 404) return "gone";
      if (r.status !== 200) throw new MembershipUnavailable(`graph_http_${r.status}`);
      const value = (r.json as { value?: unknown } | undefined)?.value;
      if (!Array.isArray(value)) throw new MembershipUnavailable("graph_invalid_response");
      for (const g of value) if (typeof g === "string") out.push(g);
    }
    return out;
  }
}
