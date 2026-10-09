import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JWTVerifyGetKey } from "jose";
import type { GatewayConfig } from "./config.js";
import { AuthError, verifyAccessToken, type Identity } from "./auth.js";
import type { Gateway } from "./gateway.js";

const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function protectedResourceMetadata(config: GatewayConfig): Record<string, unknown> {
  return {
    resource: config.mcpResourceUrl,
    authorization_servers: [`https://login.microsoftonline.com/${config.entraTenantId}/v2.0`],
    bearer_methods_supported: ["header"],
    scopes_supported: [`${config.mcpResourceUrl}/access_as_user`, "offline_access"],
  };
}

async function authenticate(
  req: IncomingMessage,
  res: ServerResponse,
  config: GatewayConfig,
  keyResolver: JWTVerifyGetKey,
  origin: string,
): Promise<Identity | undefined> {
  const authHeader = req.headers.authorization;
  const wwwAuthenticate = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="${config.mcpResourceUrl}/access_as_user"`;

  if (!authHeader?.startsWith("Bearer ")) {
    sendJson(res, 401, { error: "invalid_token" }, { "WWW-Authenticate": wwwAuthenticate });
    return undefined;
  }

  try {
    return await verifyAccessToken(authHeader.slice(7), config, keyResolver);
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) {
      sendJson(res, 401, { error: "invalid_token" }, { "WWW-Authenticate": wwwAuthenticate });
    } else {
      sendJson(res, 500, { error: "internal_error" });
    }
    return undefined;
  }
}

function createMcpServer(gateway: Gateway, identity: Identity): Server {
  const server = new Server({ name: "henssler-mcp-gateway", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await gateway.listToolsFor(identity.roles),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    gateway.callTool(identity, request.params.name, request.params.arguments),
  );

  return server;
}

async function handleMcpPost(
  req: IncomingMessage,
  res: ServerResponse,
  config: GatewayConfig,
  gateway: Gateway,
  keyResolver: JWTVerifyGetKey,
  origin: string,
): Promise<void> {
  const contentLength = Number(req.headers["content-length"] ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    sendJson(res, 413, { error: "payload_too_large" });
    return;
  }

  const identity = await authenticate(req, res, config, keyResolver, origin);
  if (!identity) return;

  if (identity.roles.length === 0) {
    sendJson(res, 403, { error: "insufficient_scope" });
    return;
  }

  const server = createMcpServer(gateway, identity);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  await server.connect(transport as unknown as Transport);
  await transport.handleRequest(req, res);
}

function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
}

export function createHttpServer(
  config: GatewayConfig,
  gateway: Gateway,
  keyResolver: JWTVerifyGetKey,
  backendIds: readonly string[],
): HttpServer {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    // This process only ever runs behind Container Apps external ingress
    // with allowInsecure:false, so every request that reaches it arrived
    // over HTTPS from the caller's perspective - verified live: the ingress
    // config on gwh-mcp-gateway carries "allowInsecure": false and
    // "transport": "Auto". x-forwarded-proto was tried first and measured
    // live to still read as non-https (Container Apps' internal edge->
    // container hop does not reliably forward the original external
    // scheme), so a header-sniffed value here would rebuild the exact
    // WWW-Authenticate/RFC-9728 "http://" defect this fix exists to close.
    // If this code ever runs somewhere the external edge legitimately
    // serves plain HTTP, that deployment needs its own explicit override,
    // not a guess from a header this platform does not set trustworthily.
    const origin = `https://${req.headers.host ?? `${config.host}:${config.port}`}`;
    const url = new URL(req.url ?? "/", origin);

    if (url.pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, { status: "ok", backends: backendIds });
      return;
    }

    if (
      (url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname === "/.well-known/oauth-protected-resource/mcp") &&
      req.method === "GET"
    ) {
      sendJson(res, 200, protectedResourceMetadata(config));
      return;
    }

    if (url.pathname === "/mcp") {
      if (req.method === "POST") {
        handleMcpPost(req, res, config, gateway, keyResolver, origin).catch((err) => {
          console.error("[http] /mcp error:", err instanceof Error ? err.message : err);
          if (!res.headersSent) sendJson(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
        });
        return;
      }
      if (req.method === "GET" || req.method === "DELETE") {
        methodNotAllowed(res);
        return;
      }
    }

    sendJson(res, 404, { error: "not_found" });
  });
}
