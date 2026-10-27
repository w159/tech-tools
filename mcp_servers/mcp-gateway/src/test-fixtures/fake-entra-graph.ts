import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// In-process stand-in for the slice of Microsoft Graph, the tenant token
// endpoint and the Container Apps managed identity endpoint that
// src/broker/entra-membership.ts calls. Listens on 127.0.0.1 only.

export const SP_ID = "aaaaaaaa-0000-0000-0000-000000000001";
export const G_READERS = "bbbbbbbb-0000-0000-0000-000000000001";
export const G_WRITERS = "bbbbbbbb-0000-0000-0000-000000000002";
export const ROLE_READER = "cccccccc-0000-0000-0000-000000000001";
export const ROLE_WRITER = "cccccccc-0000-0000-0000-000000000002";
export const ROLE_DIRECT = "cccccccc-0000-0000-0000-000000000003";
export const TENANT_ID = "dddddddd-0000-0000-0000-000000000001";
export const GRAPH_TOKEN = "fake-graph-token-client-credentials";
export const MI_TOKEN = "fake-graph-token-managed-identity";
export const MI_HEADER = "mi-header-value-for-tests";

export interface FakeUser {
  enabled: boolean;
  groups: string[];
  // App role ids assigned straight to the user.
  direct: string[];
  // signInSessionsValidFromDateTime (ISO); defaults to long ago, "" omits it.
  sessionsValidFrom?: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  query: URLSearchParams;
  body: string;
}

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

export class FakeEntraGraph {
  private server!: Server;
  base = "";
  users = new Map<string, FakeUser>();
  // When set, every Graph resource call (not the token endpoints) answers with it.
  failStatus?: number;
  failHeaders: Record<string, string> = {};
  // Token the Graph resource endpoints accept.
  acceptedToken = GRAPH_TOKEN;
  tokenExpiresIn = 3600;
  requests: RecordedRequest[] = [];

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res).catch(() => res.end()));
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  get graphBaseUrl(): string {
    return `${this.base}/v1.0`;
  }

  reset(): void {
    this.users.clear();
    this.failStatus = undefined;
    this.failHeaders = {};
    this.requests = [];
  }

  count(match: (r: RecordedRequest) => boolean): number {
    return this.requests.filter(match).length;
  }

  get tokenRequests(): RecordedRequest[] {
    return this.requests.filter((r) => r.path.endsWith("/oauth2/v2.0/token"));
  }

  get miRequests(): RecordedRequest[] {
    return this.requests.filter((r) => r.path === "/msi/token");
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.base);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const rec: RecordedRequest = { method: req.method ?? "GET", path: url.pathname, headers: req.headers, query: url.searchParams, body };
    this.requests.push(rec);

    // Tenant token endpoint (client credentials).
    if (rec.method === "POST" && url.pathname === `/${TENANT_ID}/oauth2/v2.0/token`) {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") !== "client_credentials") return send(res, 400, { error: "unsupported_grant_type" });
      return send(res, 200, { token_type: "Bearer", expires_in: this.tokenExpiresIn, access_token: GRAPH_TOKEN });
    }

    // Managed identity endpoint: GET with X-IDENTITY-HEADER, api-version, resource.
    if (rec.method === "GET" && url.pathname === "/msi/token") {
      if (req.headers["x-identity-header"] !== MI_HEADER || url.searchParams.get("api-version") !== "2019-08-01") {
        return send(res, 400, { error: "bad_request" });
      }
      return send(res, 200, {
        access_token: MI_TOKEN,
        expires_on: String(Math.floor(Date.now() / 1000) + this.tokenExpiresIn),
        resource: url.searchParams.get("resource"),
        token_type: "Bearer",
      });
    }

    if (!url.pathname.startsWith("/v1.0/")) return send(res, 404, { error: "not_found" });
    if (req.headers.authorization !== `Bearer ${this.acceptedToken}`) return send(res, 401, { error: { code: "InvalidAuthenticationToken" } });
    if (this.failStatus !== undefined) return send(res, this.failStatus, { error: { code: "serviceNotAvailable" } }, this.failHeaders);

    const path = url.pathname.slice("/v1.0".length);

    if (rec.method === "GET" && path === "/servicePrincipals") {
      if (!url.searchParams.get("$filter")?.startsWith("appId eq '")) return send(res, 400, { error: "bad_filter" });
      return send(res, 200, { value: [{ id: SP_ID, appRoles: this.appRoles() }] });
    }
    if (rec.method === "GET" && path === `/servicePrincipals/${SP_ID}`) return send(res, 200, { id: SP_ID, appRoles: this.appRoles() });

    if (rec.method === "GET" && path === `/servicePrincipals/${SP_ID}/appRoleAssignedTo`) {
      // Two pages, to exercise @odata.nextLink.
      const assignments = [
        { appRoleId: ROLE_READER, principalId: G_READERS, principalType: "Group" },
        { appRoleId: ROLE_WRITER, principalId: G_WRITERS, principalType: "Group" },
        ...[...this.users].flatMap(([oid, u]) => u.direct.map((appRoleId) => ({ appRoleId, principalId: oid, principalType: "User" }))),
        { appRoleId: "00000000-0000-0000-0000-000000000000", principalId: G_READERS, principalType: "Group" },
      ];
      if (url.searchParams.get("$skiptoken") === "2") return send(res, 200, { value: assignments.slice(1) });
      return send(res, 200, { value: assignments.slice(0, 1), "@odata.nextLink": `${this.graphBaseUrl}/servicePrincipals/${SP_ID}/appRoleAssignedTo?$skiptoken=2` });
    }

    const userMatch = /^\/users\/([^/]+)(\/checkMemberGroups|\/appRoleAssignments)?$/.exec(path);
    if (userMatch) {
      const user = this.users.get(decodeURIComponent(userMatch[1]!));
      if (!user) return send(res, 404, { error: { code: "Request_ResourceNotFound" } });
      if (rec.method === "GET" && userMatch[2] === "/appRoleAssignments") {
        // Direct assignments only, filtered like the real $filter=resourceId eq ...
        if (url.searchParams.get("$filter") !== `resourceId eq ${SP_ID}`) return send(res, 400, { error: "bad_filter" });
        const oid = decodeURIComponent(userMatch[1]!);
        return send(res, 200, { value: user.direct.map((appRoleId) => ({ appRoleId, principalId: oid, principalType: "User", resourceId: SP_ID })) });
      }
      if (rec.method === "GET" && !userMatch[2]) return send(res, 200, { id: userMatch[1], accountEnabled: user.enabled, ...(user.sessionsValidFrom === "" ? {} : { signInSessionsValidFromDateTime: user.sessionsValidFrom ?? "2020-01-01T00:00:00Z" }) });
      if (rec.method === "POST" && userMatch[2] === "/checkMemberGroups") {
        const ids = (JSON.parse(body) as { groupIds?: string[] }).groupIds ?? [];
        if (ids.length > 20) return send(res, 400, { error: { code: "Request_BadRequest" } });
        return send(res, 200, { value: ids.filter((g) => user.groups.includes(g)) });
      }
    }
    return send(res, 404, { error: "not_found" });
  }

  private appRoles(): Array<Record<string, unknown>> {
    return [
      { id: ROLE_READER, value: "mcp-reader", isEnabled: true },
      { id: ROLE_WRITER, value: "mcp-writer", isEnabled: true },
      { id: ROLE_DIRECT, value: "mcp-direct", isEnabled: true },
      { id: "00000000-0000-0000-0000-000000000000", value: "", isEnabled: true },
    ];
  }
}
