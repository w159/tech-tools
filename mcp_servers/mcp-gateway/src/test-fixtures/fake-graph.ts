import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// In-process stand-in for the slice of Microsoft Graph the admin tool uses.
// Stateful (apps, service principals, assignments, grants), pages with
// @odata.nextLink, can throttle with 429 + Retry-After, and records every
// request so tests can assert exactly what was sent. Generic fixture data only.

export const FAKE_TENANT_ID = "11111111-2222-4333-8444-555555555555";
export const FAKE_GRAPH_SP_ID = "99999999-0000-4000-8000-000000000001";
export const GRAPH_RESOURCE_APP_ID = "00000003-0000-0000-c000-000000000000";

export const GROUP_IT_OPS = "aaaaaaaa-0000-4000-8000-000000000001";
export const GROUP_HELPDESK = "aaaaaaaa-0000-4000-8000-000000000002";
export const GROUP_ALL_STAFF = "aaaaaaaa-0000-4000-8000-000000000003";

export interface RecordedRequest {
  method: string;
  path: string; // pathname + search, as sent
  body: unknown;
  authorized: boolean;
}

interface FakeUser {
  id: string;
  userPrincipalName: string;
  displayName: string;
  department?: string;
  companyName?: string;
  jobTitle?: string;
  officeLocation?: string;
  employeeOrgData?: { division?: string; costCenter?: string };
}

interface FakeGroup {
  id: string;
  displayName: string;
  securityEnabled: boolean;
  mailEnabled: boolean;
  groupTypes: string[];
  membershipRule?: string;
  members: string[];
}

export interface FakeApp {
  id: string;
  appId: string;
  displayName: string;
  identifierUris: string[];
  signInAudience?: string;
  api: Record<string, unknown>;
  appRoles: Array<Record<string, unknown> & { id: string; value: string; isEnabled: boolean }>;
  web: Record<string, unknown> & { redirectUris: string[] };
  requiredResourceAccess: Array<{ resourceAppId: string; resourceAccess: Array<{ id: string; type: string }> }>;
}

export interface FakeSp {
  id: string;
  appId: string;
  displayName: string;
  // App roles of a built-in resource (Microsoft Graph); apps created through the fake derive theirs from the application.
  appRoles?: Array<{ id: string; value: string }>;
}
// Application permission ids of Microsoft Graph, copied independently of plan.ts so a wrong id there is caught.
export const FAKE_GRAPH_APP_ROLES = [
  { id: "9a5d68dd-52b0-4cc2-bd40-abcf44ac3a30", value: "Application.Read.All" },
  { id: "98830695-27a2-44f7-8c18-0c3ebc9698f6", value: "GroupMember.Read.All" },
  { id: "df021288-bdef-4463-88db-98f22de89214", value: "User.Read.All" },
  { id: "5b567255-7703-4780-807c-7be8301ae99b", value: "Group.Read.All" },
];
export const FAKE_MANAGED_IDENTITY_SP_ID = "99999999-0000-4000-8000-000000000002";
export interface FakeAssignment {
  id: string;
  appRoleId: string;
  principalId: string;
  principalType: string;
  resourceId: string;
}
export interface FakeGrant {
  id: string;
  clientId: string;
  resourceId: string;
  consentType: string;
  scope: string;
}

function makeUsers(): FakeUser[] {
  const dept = ["IT", "IT", "IT", "Support", "Support", "Finance", "Finance", "Operations"];
  return dept.map((department, i) => ({
    id: `bbbbbbbb-0000-4000-8000-0000000000${String(i + 1).padStart(2, "0")}`,
    userPrincipalName: `user${i + 1}.private@contoso.example`,
    displayName: `Fixture Person ${i + 1}`,
    department,
    companyName: i < 6 ? "Contoso Example" : "Contoso Labs",
    jobTitle: ["Engineer", "Engineer", "Manager", "Analyst", "Analyst", "Accountant", "Accountant", "Coordinator"][i],
    officeLocation: i % 2 === 0 ? "Remote" : "HQ",
    employeeOrgData: i < 7 ? { division: "Corporate", costCenter: i < 3 ? "CC-100" : "CC-200" } : undefined,
  }));
}

export class FakeGraph {
  readonly requests: RecordedRequest[] = [];
  readonly users = makeUsers();
  readonly groups: FakeGroup[] = [
    { id: GROUP_IT_OPS, displayName: "IT Operations", securityEnabled: true, mailEnabled: false, groupTypes: [], members: [this.users[0]!.id, this.users[1]!.id, this.users[2]!.id] },
    { id: GROUP_HELPDESK, displayName: "Help Desk", securityEnabled: true, mailEnabled: false, groupTypes: [], members: [this.users[3]!.id, this.users[4]!.id] },
    {
      id: GROUP_ALL_STAFF,
      displayName: "All Staff",
      securityEnabled: true,
      mailEnabled: true,
      groupTypes: ["DynamicMembership"],
      membershipRule: '(user.accountEnabled -eq true)',
      members: this.users.map((u) => u.id),
    },
  ];
  readonly directoryRoles = [
    { id: "cccccccc-0000-4000-8000-000000000001", displayName: "Global Administrator", members: [this.users[0]!.id] },
    { id: "cccccccc-0000-4000-8000-000000000002", displayName: "Helpdesk Administrator", members: [this.users[3]!.id, this.users[4]!.id] },
  ];
  readonly adminUnits = [{ id: "dddddddd-0000-4000-8000-000000000001", displayName: "Corporate Users", members: [this.users[5]!.id, this.users[6]!.id] }];
  readonly applications: FakeApp[] = [];
  readonly servicePrincipals: FakeSp[] = [{ id: FAKE_GRAPH_SP_ID, appId: GRAPH_RESOURCE_APP_ID, displayName: "Microsoft Graph", appRoles: FAKE_GRAPH_APP_ROLES }];
  readonly assignments: FakeAssignment[] = [];
  readonly grants: FakeGrant[] = [];

  private server!: Server;
  private seq = 0;
  private readonly throttles: Array<{ prefix: string; remaining: number; retryAfter: string }> = [];
  private readonly forbidden = new Set<string>();
  private failures: Array<{ method: string; pattern: RegExp; status: number }> = [];
  baseUrl = "";

  constructor(
    readonly opts: { token: string; pageSize?: number } = { token: "fake-token-value-for-tests" },
  ) {}

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res).catch(() => res.end()));
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  throttle(pathPrefix: string, times: number, retryAfter = "0"): void {
    this.throttles.push({ prefix: pathPrefix, remaining: times, retryAfter });
  }
  clearThrottles(): void {
    this.throttles.length = 0;
  }
  forbid(pathPrefix: string): void {
    this.forbidden.add(pathPrefix);
  }
  addManagedIdentity(id = FAKE_MANAGED_IDENTITY_SP_ID): string {
    this.servicePrincipals.push({ id, appId: "ffffffff-0000-4000-8000-000000000001", displayName: "fixture-gateway-identity" });
    return id;
  }
  clearForbidden(): void {
    this.forbidden.clear();
  }
  failNext(method: string, pattern: RegExp, status: number): void {
    this.failures.push({ method, pattern, status });
  }
  clearRequests(): void {
    this.requests.length = 0;
  }
  nonGet(): RecordedRequest[] {
    return this.requests.filter((r) => r.method !== "GET");
  }

  private id(): string {
    this.seq += 1;
    return `eeeeeeee-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }
  private err(res: ServerResponse, status: number, code: string, message: string): void {
    this.json(res, status, { error: { code, message } });
  }

  // Pages through `rows` with an absolute @odata.nextLink, like Graph does.
  private page(res: ServerResponse, url: URL, rows: unknown[]): void {
    const size = this.opts.pageSize ?? 3;
    const start = Number(url.searchParams.get("$skiptoken") ?? 0);
    const slice = rows.slice(start, start + size);
    const body: Record<string, unknown> = { value: slice };
    if (start + size < rows.length) {
      const next = new URL(url);
      next.searchParams.set("$skiptoken", String(start + size));
      body["@odata.nextLink"] = next.toString();
    }
    this.json(res, 200, body);
  }

  private filterEq(url: URL): Array<[string, string]> {
    const f = url.searchParams.get("$filter") ?? "";
    return [...f.matchAll(/(\w+) eq '((?:[^']|'')*)'/g)].map((m) => [m[1]!, m[2]!.replaceAll("''", "'")]);
  }

  private async readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? (JSON.parse(text) as unknown) : undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", this.baseUrl);
    const body = method === "GET" || method === "DELETE" ? undefined : await this.readBody(req);
    const authorized = req.headers.authorization === `Bearer ${this.opts.token}`;
    this.requests.push({ method, path: decodeURIComponent(url.pathname + url.search), body, authorized });
    if (!authorized) return this.err(res, 401, "InvalidAuthenticationToken", "bad token");

    const t = this.throttles.find((x) => url.pathname.startsWith(x.prefix) && x.remaining > 0);
    if (t) {
      t.remaining -= 1;
      res.writeHead(429, { "Retry-After": t.retryAfter, "Content-Type": "application/json" });
      return void res.end(JSON.stringify({ error: { code: "TooManyRequests", message: "throttled" } }));
    }
    for (const p of this.forbidden) if (url.pathname.startsWith(p)) return this.err(res, 403, "Authorization_RequestDenied", "Insufficient privileges");
    const fi = this.failures.findIndex((f) => f.method === method && f.pattern.test(url.pathname));
    if (fi >= 0) {
      const f = this.failures.splice(fi, 1)[0]!;
      return this.err(res, f.status, "InternalFailure", "injected failure");
    }

    const path = url.pathname.replace(/^\/v1\.0/, "");
    const seg = path.split("/").filter(Boolean);

    if (method === "GET" && path === "/organization") return this.json(res, 200, { value: [{ id: FAKE_TENANT_ID }] });
    if (method === "GET" && path === "/users") {
      return this.page(res, url, this.users);
    }
    if (method === "GET" && path === "/groups") {
      return this.page(res, url, this.groups.map(({ members: _m, ...g }) => g));
    }
    if (method === "GET" && seg[0] === "groups" && seg[2] === "transitiveMembers" && seg[3] === "$count") {
      const g = this.groups.find((x) => x.id === seg[1]);
      if (!g) return this.err(res, 404, "Request_ResourceNotFound", "group");
      if (req.headers.consistencylevel !== "eventual") return this.err(res, 400, "Request_BadRequest", "ConsistencyLevel: eventual required");
      res.writeHead(200, { "Content-Type": "text/plain" });
      return void res.end(String(g.members.length));
    }
    if (method === "GET" && path === "/directoryRoles") return this.page(res, url, this.directoryRoles.map(({ members: _m, ...r }) => r));
    if (method === "GET" && seg[0] === "directoryRoles" && seg[2] === "members") {
      return this.page(res, url, (this.directoryRoles.find((r) => r.id === seg[1])?.members ?? []).map((id) => ({ id })));
    }
    if (method === "GET" && path === "/directory/administrativeUnits") return this.page(res, url, this.adminUnits.map(({ members: _m, ...a }) => a));
    if (method === "GET" && seg[0] === "directory" && seg[1] === "administrativeUnits" && seg[3] === "members") {
      return this.page(res, url, (this.adminUnits.find((a) => a.id === seg[2])?.members ?? []).map((id) => ({ id })));
    }

    // applications
    if (path === "/applications" && method === "GET") {
      let rows = this.applications as unknown[] as FakeApp[];
      for (const [k, v] of this.filterEq(url)) rows = rows.filter((a) => (a as unknown as Record<string, unknown>)[k] === v);
      return this.page(res, url, rows);
    }
    if (path === "/applications" && method === "POST") {
      const b = body as Partial<FakeApp>;
      const app: FakeApp = {
        id: this.id(),
        appId: this.id(),
        displayName: b.displayName ?? "",
        identifierUris: b.identifierUris ?? [],
        signInAudience: b.signInAudience,
        api: { oauth2PermissionScopes: [], ...(b.api ?? {}) },
        appRoles: (b.appRoles ?? []) as FakeApp["appRoles"],
        web: { implicitGrantSettings: { enableIdTokenIssuance: false }, ...(b.web ?? {}), redirectUris: b.web?.redirectUris ?? [] },
        requiredResourceAccess: b.requiredResourceAccess ?? [],
      };
      if (this.applications.some((a) => a.identifierUris.some((u) => app.identifierUris.includes(u)))) {
        return this.err(res, 400, "Request_BadRequest", "identifier URI already in use");
      }
      this.applications.push(app);
      return this.json(res, 201, app);
    }
    if (seg[0] === "applications" && seg.length === 2 && method === "PATCH") {
      const app = this.applications.find((a) => a.id === seg[1]);
      if (!app) return this.err(res, 404, "Request_ResourceNotFound", "application");
      const b = body as Partial<FakeApp>;
      if (b.appRoles) {
        for (const old of app.appRoles) {
          const next = b.appRoles.find((r) => r.id === old.id);
          if (!next && old.isEnabled) return this.err(res, 400, "Request_BadRequest", "Property value cannot be removed unless it is first disabled");
        }
        app.appRoles = b.appRoles as FakeApp["appRoles"];
      }
      if (b.identifierUris) app.identifierUris = b.identifierUris;
      if (b.api) app.api = b.api;
      if (b.web) app.web = b.web as FakeApp["web"];
      if (b.requiredResourceAccess) app.requiredResourceAccess = b.requiredResourceAccess;
      res.writeHead(204);
      return void res.end();
    }

    // service principals
    if (path === "/servicePrincipals" && method === "GET") {
      let rows = this.servicePrincipals;
      for (const [k, v] of this.filterEq(url)) rows = rows.filter((s) => (s as unknown as Record<string, unknown>)[k] === v);
      return this.page(res, url, rows);
    }
    if (path === "/servicePrincipals" && method === "POST") {
      const appId = (body as { appId?: string }).appId;
      const app = this.applications.find((a) => a.appId === appId);
      if (!app) return this.err(res, 400, "Request_BadRequest", "appId does not reference a valid application object");
      if (this.servicePrincipals.some((s) => s.appId === appId)) return this.err(res, 409, "Request_MultipleObjectsWithSameKeyValue", "exists");
      const sp = { id: this.id(), appId: app.appId, displayName: app.displayName };
      this.servicePrincipals.push(sp);
      return this.json(res, 201, sp);
    }
    // assignments held by a principal (list)
    if (method === "GET" && seg[0] === "servicePrincipals" && seg.length === 3 && seg[2] === "appRoleAssignments") {
      if (!this.servicePrincipals.some((s) => s.id === seg[1])) return this.err(res, 404, "Request_ResourceNotFound", "servicePrincipal");
      return this.page(res, url, this.assignments.filter((a) => a.principalId === seg[1]));
    }
    if (seg[0] === "servicePrincipals" && seg[2] === "appRoleAssignedTo") {
      const sp = this.servicePrincipals.find((s) => s.id === seg[1]);
      if (!sp) return this.err(res, 404, "Request_ResourceNotFound", "servicePrincipal");
      if (method === "GET" && seg.length === 3) return this.page(res, url, this.assignments.filter((a) => a.resourceId === sp.id));
      if (method === "POST" && seg.length === 3) {
        const b = body as { principalId: string; resourceId: string; appRoleId: string };
        const app = this.applications.find((a) => a.appId === sp.appId);
        const role = sp.appRoles ? sp.appRoles.find((r) => r.id === b.appRoleId) : app?.appRoles.find((r) => r.id === b.appRoleId && r.isEnabled);
        if (!role) return this.err(res, 400, "Request_BadRequest", "appRoleId is not an enabled role of the resource");
        if (b.resourceId !== sp.id) return this.err(res, 400, "Request_BadRequest", "resourceId must match the resource service principal");
        // Built-in resources (Graph) hand out application permissions to service principals; apps created here assign roles to groups.
        const principalSp = sp.appRoles ? this.servicePrincipals.find((s) => s.id === b.principalId) : undefined;
        const group = sp.appRoles ? undefined : this.groups.find((g) => g.id === b.principalId);
        if (!group && !principalSp) return this.err(res, 400, "Request_BadRequest", "principal not found");
        if (this.assignments.some((a) => a.principalId === b.principalId && a.appRoleId === b.appRoleId && a.resourceId === sp.id)) {
          return this.err(res, 400, "Request_BadRequest", "Permission being assigned already exists on the object");
        }
        const a: FakeAssignment = { id: this.id(), appRoleId: b.appRoleId, principalId: b.principalId, principalType: principalSp ? "ServicePrincipal" : "Group", resourceId: sp.id };
        this.assignments.push(a);
        return this.json(res, 201, a);
      }
      if (method === "DELETE" && seg.length === 4) {
        const i = this.assignments.findIndex((a) => a.id === seg[3]);
        if (i < 0) return this.err(res, 404, "Request_ResourceNotFound", "assignment");
        this.assignments.splice(i, 1);
        res.writeHead(204);
        return void res.end();
      }
    }

    // delegated consent
    if (path === "/oauth2PermissionGrants" && method === "GET") {
      let rows = this.grants;
      for (const [k, v] of this.filterEq(url)) rows = rows.filter((g) => (g as unknown as Record<string, unknown>)[k] === v);
      return this.page(res, url, rows);
    }
    if (path === "/oauth2PermissionGrants" && method === "POST") {
      const b = body as Omit<FakeGrant, "id">;
      if (!this.servicePrincipals.some((s) => s.id === b.clientId) || !this.servicePrincipals.some((s) => s.id === b.resourceId)) {
        return this.err(res, 400, "Request_BadRequest", "clientId or resourceId not found");
      }
      const g = { id: this.id(), ...b };
      this.grants.push(g);
      return this.json(res, 201, g);
    }
    if (seg[0] === "oauth2PermissionGrants" && seg.length === 2 && method === "PATCH") {
      const g = this.grants.find((x) => x.id === seg[1]);
      if (!g) return this.err(res, 404, "Request_ResourceNotFound", "grant");
      g.scope = (body as { scope: string }).scope;
      res.writeHead(204);
      return void res.end();
    }

    this.err(res, 404, "Request_ResourceNotFound", `no fake route for ${method} ${path}`);
  }
}
