/**
 * server-entry.ts
 *
 * Entry-point plumbing the flat-tool connectors repeat: text results, the
 * "- name: description" tool listing, the stateless per-request HTTP hookup,
 * and the fatal-startup exit. Nothing is imported at runtime (_shared has no
 * node_modules); the SDK and node:http imports are type-only.
 */

import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

/** Text result; `isError` is only present when true, matching the hand-written literals. */
export function textResult(text: string, isError?: boolean): CallToolResult {
  return isError ? { content: [{ type: "text", text }], isError } : { content: [{ type: "text", text }] };
}

/** One "- name: description" line per tool. */
export function formatToolSummary(tools: Tool[]): string {
  return tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}

interface Closable {
  close(): unknown;
}

interface StatelessTransport extends Closable {
  handleRequest(req: IncomingMessage, res: ServerResponse): unknown;
}

interface ConnectableServer<T> extends Closable {
  connect(transport: T): Promise<void>;
}

/**
 * Serve one HTTP request from a fresh server + transport pair and tear both
 * down when the response closes. The request handler is not awaited.
 */
export async function serveStatelessRequest<T extends StatelessTransport>(
  server: ConnectableServer<NoInfer<T>>,
  transport: T,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  transport.handleRequest(req, res);
}

/** Listen address and auth mode from MCP_HTTP_PORT, MCP_HTTP_HOST and AUTH_MODE. */
export function httpConfigFromEnv(): { port: number; host: string; isGatewayMode: boolean } {
  return {
    port: parseInt(process.env.MCP_HTTP_PORT || "8080", 10),
    host: process.env.MCP_HTTP_HOST || "0.0.0.0",
    isGatewayMode: process.env.AUTH_MODE === "gateway",
  };
}

/** Request URL resolved against the Host header. */
export function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Shallow, unauthenticated liveness probe; returns true when it answered.
 * It must not read credentials or call upstream: in gateway mode credentials
 * only arrive per request, so a credential check would always 503 and trip
 * upstream restart loops.
 */
export function respondHealth(url: URL, res: ServerResponse): boolean {
  if (url.pathname !== "/health" && url.pathname !== "/healthz") return false;
  writeJson(res, 200, { status: "ok" });
  return true;
}

/** 401 for a gateway-mode request that lacks its credential headers. */
export function respondMissingCredentials(
  res: ServerResponse,
  message: string,
  required: string[],
  optional: string[],
): void {
  writeJson(res, 401, { error: "Missing credentials", message, required, optional });
}

export function respondNotFound(res: ServerResponse, endpoints: string[]): void {
  writeJson(res, 404, { error: "Not found", endpoints });
}

/** Resolve once the server is listening. */
export function listenHttp(httpServer: Server, port: number, host: string, onListening: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      onListening();
      resolve();
    });
  });
}

/** Close the HTTP server on SIGINT/SIGTERM, run `afterClose`, then exit 0. */
export function exitOnSignals(
  httpServer: Server,
  logShutdown: () => void,
  afterClose: () => Promise<unknown> = async () => {},
): void {
  const shutdown = async () => {
    logShutdown();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    await afterClose();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Run the entry point; a rejection is logged through `logFatal` and exits 1. */
export function runMain(
  main: () => Promise<void>,
  logFatal: (message: string, fields: { error: string; stack?: string }) => void,
): void {
  main().catch((error: unknown) => {
    logFatal("Fatal startup error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  });
}
