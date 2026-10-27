// Refresh-time membership check against Microsoft Graph (Entra upstream).
//
// Graph surface used, all with application permissions:
//   GET  /servicePrincipals?$filter=appId eq '{appId}'&$select=id,appRoles   Application.Read.All
//   GET  /servicePrincipals/{id}?$select=id,appRoles                         Application.Read.All
//   GET  /servicePrincipals/{id}/appRoleAssignedTo                           Application.Read.All
//   GET  /users/{oid}/appRoleAssignments?$filter=resourceId eq {spId}        User.Read.All (live, every check)
//   POST /users/{oid}/checkMemberGroups  {groupIds}  (transitive, max 20)    GroupMember.Read.All
//   GET  /users/{oid}?$select=accountEnabled,signInSessionsValidFromDateTime  User.Read.All
// Docs: learn.microsoft.com/graph/api/serviceprincipal-list-approleassignedto,
//       learn.microsoft.com/graph/api/user-list-approleassignments,
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

// Resolves with p, or rejects as soon as signal aborts. The shared work behind p
// keeps running for the other waiters.
function untilAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

// Wraps a raw token source: caches until 5 minutes before expiry (or half the
// lifetime for very short tokens) and shares one in-flight request. The shared
// request has its own timeout, so one caller's deadline cannot fail the others.
function cachingProvider(
  fetchToken: (signal: AbortSignal) => Promise<{ token: string; expiresAtMs: number }>,
  now: () => number,
  timeoutMs: number,
): GraphTokenProvider {
  let cached: { token: string; refreshAtMs: number } | undefined;
  let inFlight: Promise<string> | undefined;
  return {
    async getToken(signal) {
      if (cached && now() < cached.refreshAtMs) return cached.token;
      inFlight ??= (async () => {
        try {
          const issuedAt = now();
          const { token, expiresAtMs } = await fetchToken(AbortSignal.timeout(timeoutMs));
          const lifetime = Math.max(0, expiresAtMs - issuedAt);
          const skew = Math.min(TOKEN_REFRESH_SKEW_SECONDS * 1000, lifetime / 2);
          cached = { token, refreshAtMs: expiresAtMs - skew };
          return token;
        } finally {
          inFlight = undefined;
        }
      })();
      return untilAbort(inFlight, signal);
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
  timeoutMs?: number;
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
  }, now, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

// OAuth 2.0 client credentials against the tenant token endpoint.
export function clientCredentialsTokenProvider(opts: {
  authorityHost: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
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
  }, now, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
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

// Cached for cacheSeconds: role definitions and which groups hold which role.
// A user's own direct assignments are never cached; they are read on each check.
interface RoleMap {
  expiresAtMs: number;
  spId: string;
  roleValueById: Map<string, string>;
  groupRoles: Map<string, string[]>;
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

  // authTimeSeconds: when the user last authenticated upstream (epoch seconds).
  // A signInSessionsValidFromDateTime later than that means "Revoke sessions"
  // ran since, so the grant is revoked. Unknown auth time cannot be proven
  // newer, so it counts as revoked too.
  // knownGroupIds: groups the user was in at sign-in (e.g. the "groups" claim).
  // They are re-checked live along with the groups that hold an app role, so a
  // policy rule on a group that holds no app role still sees the current answer.
  // No app role is not "revoked" here: the caller evaluates its policy on the
  // result and treats zero gateway roles as revoked.
  async resolve(oid: string, authTimeSeconds?: number, knownGroupIds: readonly string[] = []): Promise<MembershipResult> {
    if (!GUID_RE.test(oid)) return { status: "revoked" };
    const signal = AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const map = await this.getRoleMap(signal);
      const candidates = new Set<string>(map.groupRoles.keys());
      for (const g of knownGroupIds) if (GUID_RE.test(g)) candidates.add(g.toLowerCase());
      const [user, memberOf, direct] = await Promise.all([
        this.userState(oid, signal),
        this.memberGroups(oid, [...candidates], signal),
        this.directRoles(oid, map, signal),
      ]);
      if (!user.enabled || memberOf === "gone" || direct === "gone") return { status: "revoked" };
      if (authTimeSeconds === undefined || user.sessionsValidFromMs > authTimeSeconds * 1000) return { status: "revoked" };
      const roles = new Set<string>(direct);
      for (const g of memberOf) for (const r of map.groupRoles.get(g.toLowerCase()) ?? []) roles.add(r);
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

  // The shared load runs on its own timeout, not the first caller's signal; each
  // caller only abandons its own wait when its signal aborts.
  private getRoleMap(signal: AbortSignal): Promise<RoleMap> {
    if (this.roleMap && this.now() < this.roleMap.expiresAtMs) return Promise.resolve(this.roleMap);
    this.roleMapInFlight ??= this.loadRoleMap(AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS))
      .then((m) => {
        this.roleMap = m;
        return m;
      })
      .finally(() => {
        this.roleMapInFlight = undefined;
      });
    return untilAbort(this.roleMapInFlight, signal);
  }

  // Follows @odata.nextLink pages and returns every item. A continuation that
  // leaves the Graph origin we call is rejected.
  private async pagedValues(firstUrl: string, signal: AbortSignal): Promise<{ status: number; items: unknown[] }> {
    const items: unknown[] = [];
    let url: string | undefined = firstUrl;
    for (let page = 0; url; page++) {
      if (page >= MAX_PAGES) throw new MembershipUnavailable("graph_too_many_pages");
      const reply: GraphReply = await this.graphUrl("GET", url, signal);
      if (reply.status === 404) return { status: 404, items: [] };
      if (reply.status !== 200) throw new MembershipUnavailable(`graph_http_${reply.status}`);
      const doc = reply.json as { value?: unknown; "@odata.nextLink"?: unknown } | undefined;
      if (!doc || !Array.isArray(doc.value)) throw new MembershipUnavailable("graph_invalid_response");
      items.push(...doc.value);
      const next = doc["@odata.nextLink"];
      if (typeof next === "string") {
        if (new URL(next).origin !== new URL(this.base).origin) throw new MembershipUnavailable("graph_invalid_response");
        url = next;
      } else url = undefined;
    }
    return { status: 200, items };
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
    const assigned = await this.pagedValues(`${this.base}/servicePrincipals/${encodeURIComponent(spId)}/appRoleAssignedTo?$top=999`, signal);
    if (assigned.status !== 200) throw new MembershipUnavailable(`graph_http_${assigned.status}`);
    for (const a of assigned.items as Array<{ appRoleId?: unknown; principalId?: unknown; principalType?: unknown }>) {
      if (typeof a.appRoleId !== "string" || typeof a.principalId !== "string" || a.principalType !== "Group") continue;
      const value = roleValueById.get(a.appRoleId.toLowerCase());
      if (!value) continue; // default access role or a disabled role
      const key = a.principalId.toLowerCase();
      groupRoles.set(key, [...(groupRoles.get(key) ?? []), value]);
    }
    return { expiresAtMs: this.now() + this.opts.cacheSeconds * 1000, spId, roleValueById, groupRoles };
  }

  // The user's own direct assignments to this app, read live so removing one
  // takes effect on the next check. The endpoint also lists assignments the user
  // inherits through groups; those are principalType Group and are ignored here
  // (checkMemberGroups covers them).
  private async directRoles(oid: string, map: RoleMap, signal: AbortSignal): Promise<string[] | "gone"> {
    const filter = encodeURIComponent(`resourceId eq ${map.spId}`);
    const { status, items } = await this.pagedValues(`${this.base}/users/${encodeURIComponent(oid)}/appRoleAssignments?$filter=${filter}&$top=999`, signal);
    if (status === 404) return "gone";
    const out: string[] = [];
    for (const a of items as Array<{ appRoleId?: unknown; principalId?: unknown; principalType?: unknown; resourceId?: unknown }>) {
      if (a.principalType !== "User" || typeof a.appRoleId !== "string") continue;
      if (typeof a.resourceId !== "string" || a.resourceId.toLowerCase() !== map.spId.toLowerCase()) continue;
      if (typeof a.principalId !== "string" || a.principalId.toLowerCase() !== oid.toLowerCase()) continue;
      const value = map.roleValueById.get(a.appRoleId.toLowerCase());
      if (value) out.push(value);
    }
    return out;
  }

  // enabled is false also when the user does not exist. sessionsValidFromMs is
  // signInSessionsValidFromDateTime (Learn: user resource type, updated by
  // revokeSignInSessions; User.Read.All is enough to read it). A missing or
  // unparseable value cannot prove the sign-in is still valid, so it is an error.
  private async userState(oid: string, signal: AbortSignal): Promise<{ enabled: boolean; sessionsValidFromMs: number }> {
    const reply = await this.graph("GET", `/users/${encodeURIComponent(oid)}?$select=accountEnabled,signInSessionsValidFromDateTime`, signal);
    if (reply.status === 404) return { enabled: false, sessionsValidFromMs: 0 };
    if (reply.status !== 200) throw new MembershipUnavailable(`graph_http_${reply.status}`);
    const u = reply.json as { accountEnabled?: unknown; signInSessionsValidFromDateTime?: unknown } | undefined;
    const from = typeof u?.signInSessionsValidFromDateTime === "string" ? Date.parse(u.signInSessionsValidFromDateTime) : NaN;
    if (!Number.isFinite(from)) throw new MembershipUnavailable("graph_invalid_response");
    return { enabled: u?.accountEnabled === true, sessionsValidFromMs: from };
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
