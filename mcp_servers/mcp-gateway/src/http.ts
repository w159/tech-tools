import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { GatewayConfig } from "./config.js";
import { AuthError, type Identity } from "./auth.js";
import { requestIdFrom, type AuditLogger } from "./audit.js";
import type { Gateway, ToolCallResult } from "./gateway.js";

const MAX_BODY_BYTES = 1024 * 1024;

export const SERVER_INFO = { name: "mcp-gateway", version: "0.2.0" };

export interface HttpDeps {
  config: GatewayConfig;
  gateway: Gateway;
  verify: (token: string) => Promise<Identity>;
  audit: AuditLogger;
  health: () => object;
  // RFC 9728 Protected Resource Metadata document.
  prm: () => object;
  // Scope advertised in WWW-Authenticate challenges.
  wwwAuthenticateScope: string;
  // Anything the resource server does not own (broker mode mounts the
  // authorization server here).
  fallback?: (req: IncomingMessage, res: ServerResponse) => void;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

class BodyTooLarge extends Error {}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    // Counted as it streams: a missing or lying Content-Length cannot get past.
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createMcpServer(gateway: Gateway, identity: Identity, requestId: string): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await gateway.listTools(identity, requestId),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    (await gateway.callTool(identity, request.params.name, request.params.arguments, requestId)) as ToolCallResult & {
      content: never[];
    },
  );

  return server;
}

function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, { Allow: "POST" });
}

async function handleMcpPost(req: IncomingMessage, res: ServerResponse, deps: HttpDeps, requestId: string): Promise<void> {
  const { config, audit } = deps;
  const metadataUrl = `${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp`;
  const scope = deps.wwwAuthenticateScope;
  const challenge = `Bearer resource_metadata="${metadataUrl}", scope="${scope}"`;

  if (Number(req.headers["content-length"] ?? "0") > MAX_BODY_BYTES) {
    sendJson(res, 413, { error: "payload_too_large" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !/^Bearer /i.test(authHeader)) {
    audit.emit({ request_id: requestId, event: "auth_failed", reason: "missing_bearer" });
    sendJson(res, 401, { error: "invalid_token" }, { "WWW-Authenticate": challenge });
    return;
  }

  let identity: Identity;
  try {
    identity = await deps.verify(authHeader.slice(7).trim());
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) {
      // The reason comes from jose or the tenant pin; it never contains the token.
      audit.emit({ request_id: requestId, event: "auth_failed", reason: err.message.slice(0, 200) });
      sendJson(res, 401, { error: "invalid_token" }, { "WWW-Authenticate": challenge });
    } else {
      console.error("[http] token verification error:", err instanceof Error ? err.message : err);
      sendJson(res, 500, { error: "internal_error" });
    }
    return;
  }

  const actor = { sub: identity.sub, email: identity.email, idp: identity.idp, tenant: identity.tenant };
  if (identity.roles.length === 0) {
    audit.emit({ request_id: requestId, event: "auth_failed", actor, client_id: identity.clientId, reason: "no_roles" });
    sendJson(
      res,
      403,
      { error: "insufficient_scope" },
      { "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${metadataUrl}"` },
    );
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err instanceof BodyTooLarge) sendJson(res, 413, { error: "payload_too_large" }, { Connection: "close" });
    else sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    return;
  }

  const server = createMcpServer(deps.gateway, identity, requestId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport as unknown as Transport);
  await transport.handleRequest(req, res, body);
}

export function createHttpServer(deps: HttpDeps): HttpServer {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("X-Request-Id", requestIdFrom(req.headers["x-request-id"]));
    const requestId = res.getHeader("X-Request-Id") as string;
    // Only the path matters; the base is a placeholder for URL parsing.
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path === "/health" && req.method === "GET") {
      sendJson(res, 200, deps.health());
      return;
    }

    if (
      (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") &&
      req.method === "GET"
    ) {
      sendJson(res, 200, deps.prm());
      return;
    }

    if (path === "/mcp") {
      if (req.method === "POST") {
        handleMcpPost(req, res, deps, requestId).catch((err) => {
          console.error("[http] /mcp error:", err instanceof Error ? err.message : err);
          if (!res.headersSent) sendJson(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
        });
        return;
      }
      methodNotAllowed(res);
      return;
    }

    if (deps.fallback) {
      deps.fallback(req, res);
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  });
}
