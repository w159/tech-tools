#!/usr/bin/env node
/**
 * NinjaOne MCP Server with Flat Tool Architecture
 *
 * This MCP server exposes all NinjaOne tools upfront for universal MCP client
 * compatibility. All tools are available immediately without navigation state.
 * The ninjaone_navigate tool provides domain discovery and guidance but is not
 * required to access domain tools.
 *
 * This flattened approach works with all MCP clients including remote connectors
 * (claude.ai, mcp-remote) that do not support dynamic tool-list changes.
 *
 * Supports both stdio and HTTP transports:
 * - stdio (default): For local Claude Desktop / CLI usage
 * - http: For hosted deployment with optional gateway auth
 *
 * Credentials are provided via environment variables:
 * - NINJAONE_CLIENT_ID
 * - NINJAONE_CLIENT_SECRET
 * - NINJAONE_REGION (us, eu, oc, ca, us2, fed)
 *
 * Or via gateway headers (when AUTH_MODE=gateway):
 * - X-Ninja-Client-ID
 * - X-Ninja-Client-Secret
 * - X-Ninja-Region
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toZodShape } from "../../_shared/zod-shape.js";
import { getDomainHandler, getAvailableDomains } from "./domains/index.js";
import { isDomainName, isValidRegion, getBaseUrlForRegion } from "./utils/types.js";
import {
  getCredentials,
  getClient,
  createClientDirect,
  setClientOverride,
  clearClientOverride,
  setCredentialOverrides,
  clearCredentialOverrides,
  ensureUserTokenManager,
  type NinjaOneCredentials,
} from "./utils/client.js";
import { logger } from "./utils/logger.js";
import { setServerRef } from "./utils/server-ref.js";
import { describeUnconfigured } from "./status.js";
import { describeBaseUrl } from "../../_shared/base-url.js";
import { registerPromptHandlers } from "./prompts.js";
import { annotate } from "./annotate-tool.js";
import { runUserFlow, DEFAULT_SCOPES, REDIRECT_URI } from "./oauth/user-flow.js";
import { loadTokens, clearTokens, storagePath, type StoredTokens } from "./oauth/token-store.js";
import { createToolRegistrar, runAuthCheck } from "../../_shared/mcp-server-kit.js";
import {
  textResult, formatToolSummary, serveStatelessRequest, runMain, requestUrl, respondHealth, httpConfigFromEnv,
  respondMissingCredentials, respondNotFound, listenHttp, exitOnSignals,
} from "../../_shared/server-entry.js";

/**
 * Collect all domain tools at startup for flattened tool listing
 */
async function getAllDomainTools(): Promise<Tool[]> {
  const allTools: Tool[] = [];
  const domains = getAvailableDomains();

  for (const domain of domains) {
    const handler = await getDomainHandler(domain);
    const domainTools = handler.getTools();
    allTools.push(...domainTools);
  }

  return allTools;
}

/**
 * Tool name -> declaring domain, built once from the handlers themselves so a
 * tool can never be listed but unroutable. Lazily populated on first call.
 */
let toolDomainIndex: Map<string, DomainName> | null = null;

export async function getDomainForTool(
  toolName: string
): Promise<DomainName | undefined> {
  if (!toolDomainIndex) {
    toolDomainIndex = new Map();
    for (const domain of getAvailableDomains()) {
      const handler = await getDomainHandler(domain);
      for (const tool of handler.getTools()) {
        toolDomainIndex.set(tool.name, domain as DomainName);
      }
    }
  }
  return toolDomainIndex.get(toolName);
}

/**
 * Available domains for navigation
 */
type DomainName = "devices" | "organizations" | "alerts" | "tickets" | "queries" | "automation" | "directory";

/**
 * Domain metadata for discovery
 */
const domainDescriptions: Record<DomainName, string> = {
  devices: "Device management - find and inspect endpoints, run scripts, scan and apply patches, control Windows services, reboot, schedule maintenance, and read per-device hardware, software, patch and job inventory",
  organizations: "Organization management - manage customer accounts, locations, and view organization devices",
  alerts: "Alert management - view, reset, and summarize monitoring alerts across devices and organizations",
  tickets: "Ticket management - create, update, comment on, and track service tickets",
  queries: "Cross-org reporting - 24 fleet-wide queries covering patch compliance, software and hardware inventory, antivirus posture, device health and vulnerability scan groups, without per-device fan-out",
  automation: "Automation - run scripts and built-in actions, browse the script catalog, watch active jobs and scheduled tasks, and read the tenant-wide activity log",
  directory: "Org structure - policies, saved device groups, users, locations, roles, and node classes",
};

/**
 * Navigation/discovery tool - helps find relevant tools by domain
 *
 * This is a stateless helper that describes available tools for a domain.
 * All domain tools are always callable - this is a discovery aid, not a prerequisite.
 */
const navigateTool: Tool = {
  name: "ninjaone_navigate",
  description:
    "Discover available NinjaOne tools by domain. Returns tool names and descriptions for the selected domain. All tools are callable at any time — this is a help/discovery aid, not a prerequisite.",
  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        enum: getAvailableDomains(),
        description: `The domain to explore:
- devices: ${domainDescriptions.devices}
- organizations: ${domainDescriptions.organizations}
- alerts: ${domainDescriptions.alerts}
- tickets: ${domainDescriptions.tickets}
- queries: ${domainDescriptions.queries}
- automation: ${domainDescriptions.automation}
- directory: ${domainDescriptions.directory}`,
      },
    },
    required: ["domain"],
  },
};

/**
 * Status tool - shows API credential status and available tools
 */
const statusTool: Tool = {
  name: "ninjaone_status",
  description:
    "Show NinjaOne MCP server configuration status: credential presence, configured region, and available tool domains. Use to verify setup before calling other tools.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

/**
 * Auth tools — only meaningful when NINJAONE_AUTH_MODE=user.
 */
const signInTool: Tool = {
  name: "ninjaone_sign_in",
  description:
    "Start the browser-based NinjaOne sign-in flow (authorization_code + PKCE). Opens your default browser, listens on http://127.0.0.1:53682/oauth/callback for the redirect, exchanges the code for tokens, and stores the refresh token to disk. Requires NINJAONE_AUTH_MODE=user. The OAuth app at NinjaOne must list http://127.0.0.1:53682/oauth/callback as an allowed redirect URI.",
  inputSchema: { type: "object", properties: {} },
};

const signOutTool: Tool = {
  name: "ninjaone_sign_out",
  description:
    "DESTRUCTIVE: Forget the stored NinjaOne refresh token (deletes ~/.atlas/ninjaone-tokens.json). The token cannot be recovered - after sign-out you must call ninjaone_sign_in and complete the browser flow again before any read/write tools will work.",
  inputSchema: { type: "object", properties: {} },
};

const authStatusTool: Tool = {
  name: "ninjaone_auth_status",
  description:
    "Report the current auth mode and whether a usable user-OAuth token is present. Use to debug 'not signed in' errors.",
  inputSchema: { type: "object", properties: {} },
};

/** Attach the numeric HTTP status (`status` or `statusCode`) that runAuthCheck reads. */
function withStatusCode(err: unknown): Error {
  const e = err as { statusCode?: number; status?: number; message?: string };
  return Object.assign(new Error(e.message ?? String(err)), { statusCode: e.statusCode ?? e.status });
}

/**
 * "Configured" only proves credentials are present. One cheap authenticated
 * read (organizations, page size 1) shows whether NinjaOne accepts them.
 * Response data is never printed. Never throws.
 */
const liveAuthCheck = (): Promise<string> =>
  runAuthCheck(async () => {
    try {
      const client = await getClient();
      await client.organizations.list({ pageSize: 1 });
    } catch (err) {
      throw withStatusCode(err);
    }
  }, "10 s");

type ToolArgs = Record<string, unknown>;
type ToolHandler = (args: ToolArgs) => Promise<CallToolResult>;

/** Navigation / discovery helper (stateless). */
async function navigate(args: ToolArgs): Promise<CallToolResult> {
  const domain = args.domain as string;
  if (!isDomainName(domain)) {
    return textResult(`Invalid domain: ${domain}. Available domains: ${getAvailableDomains().join(", ")}`, true);
  }
  const handler = await getDomainHandler(domain);
  const toolSummary = formatToolSummary(handler.getTools());
  return textResult(`${domainDescriptions[domain]}\n\nAvailable tools:\n${toolSummary}\n\nYou can call any of these tools directly.`);
}

async function status(): Promise<CallToolResult> {
  const creds = getCredentials();
  if (!creds) return describeUnconfigured(getAvailableDomains());

  const urlDesc = describeBaseUrl("ninjaone", process.env.NINJAONE_BASE_URL, "NINJAONE_BASE_URL");
  const credStatus = `Configured (region: ${creds.region}, base URL: ${urlDesc}, auth: ${creds.authMode})`;
  const authCheck = await liveAuthCheck();
  return {
    content: [
      {
        type: "text",
        text: `NinjaOne MCP Server Status\n\nCredentials: ${credStatus}\nAuth check: ${authCheck}\nAvailable domains: ${getAvailableDomains().join(", ")}\n\nUse ninjaone_navigate to discover tools by domain.`,
      },
    ],
    isError: authCheck.startsWith("FAILED"),
  };
}

/** Explains why sign-in cannot start, or null when it can. */
function signInBlocker(creds: NinjaOneCredentials | null): string | null {
  if (!creds) return "Set NINJAONE_CLIENT_ID, NINJAONE_REGION, and NINJAONE_AUTH_MODE=user before signing in.";
  if (creds.authMode !== "user") return `Auth mode is "${creds.authMode}". Set NINJAONE_AUTH_MODE=user to enable browser sign-in.`;
  return null;
}

async function signIn(): Promise<CallToolResult> {
  const creds = getCredentials();
  const blocker = signInBlocker(creds);
  if (blocker !== null || !creds) return textResult(blocker ?? "", true);
  return runSignIn(creds);
}

async function runSignIn(creds: NinjaOneCredentials): Promise<CallToolResult> {
  try {
    let authorizeUrl = "";
    const tokens = await runUserFlow({
      baseUrl: creds.baseUrl,
      clientId: creds.clientId,
      region: creds.region,
      scopes: DEFAULT_SCOPES,
      onAuthorizeUrl: (u) => { authorizeUrl = u; },
    });
    ensureUserTokenManager(creds).setTokens(tokens);
    return textResult(`Signed in to NinjaOne (region: ${creds.region}). Refresh token stored at ${storagePath()}.\n\nIf the browser did not open, manually visit:\n${authorizeUrl}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return textResult(`Sign-in failed: ${msg}\n\nVerify your NinjaOne OAuth app includes the redirect URI ${REDIRECT_URI} and the scopes ${DEFAULT_SCOPES.join(" ")}.`, true);
  }
}

async function signOut(): Promise<CallToolResult> {
  await clearTokens();
  return textResult(`Cleared stored NinjaOne tokens.`);
}

/** The "Status:" line for user-OAuth mode. */
function describeStoredToken(stored: StoredTokens | null, creds: NinjaOneCredentials): string {
  if (!stored) return `Status: NOT SIGNED IN — call ninjaone_sign_in to authenticate.`;
  const remainingMs = stored.expiresAt - Date.now();
  const human = remainingMs > 0 ? `${Math.floor(remainingMs / 60000)}m remaining` : `EXPIRED (refresh will mint a new one on next call)`;
  const regionMatch = stored.region === creds.region ? "region matches" : `region MISMATCH (stored=${stored.region}, current=${creds.region})`;
  return `Status: signed in — access token ${human}, scope="${stored.scope}", ${regionMatch}`;
}

async function authStatus(): Promise<CallToolResult> {
  const creds = getCredentials();
  const stored = await loadTokens().catch(() => null);
  return textResult([...authHeaderLines(creds), describeAuthStatus(creds, stored)].join("\n"));
}

function authHeaderLines(creds: NinjaOneCredentials | null): string[] {
  const { authMode, region } = creds ?? { authMode: "unknown", region: "unknown" };
  return [`Auth mode: ${authMode}`, `Region: ${region}`, `Storage: ${storagePath()}`];
}

function describeAuthStatus(creds: NinjaOneCredentials | null, stored: StoredTokens | null): string {
  return creds?.authMode === "user"
    ? describeStoredToken(stored, creds)
    : `Status: using client_credentials. Set NINJAONE_AUTH_MODE=user to switch to interactive sign-in.`;
}

/**
 * Route by the tool's declaring domain, not by name prefix. A prefix chain
 * silently drops any tool whose name does not match its domain
 * (ninjaone_scripts_list in "automation", ninjaone_devices_os_patch_installs
 * in "queries"), which surfaces to the caller as "Unknown tool".
 */
async function routeDomainTool(name: string, args: ToolArgs): Promise<CallToolResult> {
  const domain = await getDomainForTool(name);
  if (!domain) {
    return textResult(`Unknown tool: ${name}. Use ninjaone_navigate to discover available tools by domain.`, true);
  }
  const handler = await getDomainHandler(domain);
  return await handler.handleCall(name, args);
}

const localToolHandlers = new Map<string, ToolHandler>([
  ["ninjaone_navigate", navigate],
  ["ninjaone_status", status],
  ["ninjaone_sign_in", signIn],
  ["ninjaone_sign_out", signOut],
  ["ninjaone_auth_status", authStatus],
]);

function dispatchTool(name: string, args: ToolArgs): Promise<CallToolResult> {
  const handler = localToolHandlers.get(name);
  return handler ? handler(args) : routeDomainTool(name, args ?? {});
}

type HttpStatus = number | string;

/** Operator hint for an API failure, keyed on the HTTP status. */
function errorHint(status: HttpStatus): string {
  if (status === 401 || status === 403) return "Verify NINJAONE_CLIENT_ID, NINJAONE_CLIENT_SECRET, and NINJAONE_REGION are correct.";
  if (status === 429) return "NinjaOne API rate limit hit. Wait before retrying.";
  return "Check that NINJAONE_CLIENT_ID and NINJAONE_CLIENT_SECRET are set. Verify NINJAONE_REGION (us, eu, oc, ca, us2, fed).";
}

/** HTTP status from `status`, `statusCode` or `response.status`; empty string when absent. */
function errorStatus(error: unknown): HttpStatus {
  const err = (typeof error === "object" && error !== null ? error : {}) as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown } | null;
  };
  const found = [err.status, err.statusCode, err.response?.status].find(
    (v): v is HttpStatus => typeof v === "number" || typeof v === "string",
  );
  return found ?? "";
}

function toolFailure(name: string, error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const status = errorStatus(error);
  const msg = `NinjaOne API error${status ? ` (HTTP ${status})` : ''}: ${message}. ${errorHint(status)}`;
  logger.error("Tool call failed", { tool: name, error: msg, stack });
  return textResult(msg, true);
}

/**
 * Handle a tool call. Registered per tool; registerTool has already validated
 * args against the tool's schema by the time this runs. Per-request
 * credentials (gateway mode) get an isolated client that every domain handler
 * picks up via getClient(), cleared again when the call ends.
 */
async function callTool(
  name: string,
  args: ToolArgs,
  credentialOverrides?: NinjaOneCredentials,
): Promise<CallToolResult> {
  logger.info("Tool call received", { tool: name, arguments: args });

  if (credentialOverrides) {
    setCredentialOverrides(credentialOverrides);
    setClientOverride(await createClientDirect(credentialOverrides));
  }

  try {
    return await dispatchTool(name, args);
  } catch (error) {
    return toolFailure(name, error);
  } finally {
    if (credentialOverrides) {
      clearClientOverride();
      clearCredentialOverrides();
    }
  }
}

const SERVER_INSTRUCTIONS =
  "NinjaOne RMM: devices, organizations, locations, alerts, activities, tickets, policies, scripts, groups, patching, and queries. " +
  "Use ninjaone_devices_list or ninjaone_devices_search and ninjaone_organizations_list to find IDs before calling a get-by-id, update, or action tool. " +
  "On a 401, 403, or 440, a not-configured message, or a connection failure, call ninjaone_status once and report its output to the user instead of retrying other tools. " +
  "When credentials are missing only the status, navigate, and sign-in/auth tools are listed; the user must set NINJAONE_CLIENT_ID and NINJAONE_CLIENT_SECRET and restart the session.";

/**
 * Create a fresh MCP server instance with all handlers registered.
 * Called once for stdio, or per-request for HTTP transport.
 *
 * @param credentialOverrides - Optional credentials for gateway mode.
 *   When provided, a per-request client is created from these credentials
 *   instead of reading from process.env.
 */
async function createMcpServer(credentialOverrides?: NinjaOneCredentials): Promise<McpServer> {
  // Collect all domain tools once at startup for flattened tool listing
  const allDomainTools = await getAllDomainTools();

  const server = new McpServer(
    { name: "ninjaone-mcp", version: "1.8.0" },
    {
      // registerTool adds the tools capability itself; prompts are served by the
      // low-level handlers in registerPromptHandlers.
      capabilities: { logging: {}, prompts: {} },
      instructions: SERVER_INSTRUCTIONS,
    }
  );
  setServerRef(server.server);
  registerPromptHandlers(server.server);

  // Progressive disclosure: status/auth shell until credentials resolve. Gateway
  // requests carry their credentials in credentialOverrides, not process.env.
  const shell = [navigateTool, statusTool, signInTool, signOutTool, authStatusTool];
  const tools = credentialOverrides || getCredentials() ? [...shell, ...allDomainTools] : shell;
  const register = createToolRegistrar({ server, z, toZodShape, annotate, vendorTitle: "NinjaOne" });
  for (const tool of tools) {
    register(tool, (args) => callTool(tool.name, args, credentialOverrides));
  }

  return server;
}

/**
 * Start the server with stdio transport (default)
 */
async function startStdioTransport(): Promise<void> {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("NinjaOne MCP server running on stdio (flattened mode)");
}

/**
 * Start the server with HTTP Streamable transport.
 * Each request gets a fresh Server + Transport (stateless).
 */
async function startHttpTransport(): Promise<void> {
  const { port, host, isGatewayMode } = httpConfigFromEnv();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = requestUrl(req);
    if (respondHealth(url, res)) return;

    // MCP endpoint
    if (url.pathname === "/mcp") {
      // In gateway mode, extract per-request credentials from headers
      // and pass them directly to createMcpServer() for isolation.
      // No process.env mutation — each request gets its own client.
      let credOverrides: NinjaOneCredentials | undefined;
      if (isGatewayMode) {
        const clientId = req.headers["x-ninja-client-id"] as string | undefined;
        const clientSecret = req.headers["x-ninja-client-secret"] as string | undefined;
        const region = req.headers["x-ninja-region"] as string | undefined;

        if (!clientId || !clientSecret) {
          respondMissingCredentials(
            res,
            "Gateway mode requires X-Ninja-Client-ID and X-Ninja-Client-Secret headers",
            ["X-Ninja-Client-ID", "X-Ninja-Client-Secret"],
            ["X-Ninja-Region"],
          );
          return;
        }

        const regionVal = (region?.toLowerCase() || "us") as string;
        const validRegion = isValidRegion(regionVal) ? regionVal : "us" as const;
        credOverrides = {
          clientId,
          clientSecret,
          region: validRegion,
          baseUrl: getBaseUrlForRegion(validRegion),
          authMode: "client_credentials",
        };
      }

      // Create fresh server + transport per request (stateless)
      const server = await createMcpServer(credOverrides);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await serveStatelessRequest(server, transport, req, res);
      return;
    }

    // 404 for everything else
    respondNotFound(res, ["/mcp", "/health"]);
  });

  await listenHttp(httpServer, port, host, () => {
    logger.info(`NinjaOne MCP server listening on http://${host}:${port}/mcp`);
    logger.info(`Health check available at http://${host}:${port}/health`);
    logger.info(`Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env (environment variables)"}`);
  });
  exitOnSignals(httpServer, () => logger.info("Shutting down NinjaOne MCP server..."));
}

/**
 * Main entry point - select transport based on MCP_TRANSPORT env var
 */
async function main() {
  const transportType = process.env.MCP_TRANSPORT || "stdio";
  logger.info("Starting NinjaOne MCP server", {
    transport: transportType,
    logLevel: process.env.LOG_LEVEL || "info",
    nodeVersion: process.version,
  });

  if (transportType === "http") {
    await startHttpTransport();
  } else {
    await startStdioTransport();
  }
}

runMain(main, (message, fields) => logger.error(message, fields));
