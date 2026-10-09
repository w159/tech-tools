#!/usr/bin/env node
/**
 * KnowBe4 MCP Server
 *
 * This MCP server provides tools for interacting with the KnowBe4 API.
 * All tools are listed upfront so they work with every MCP client, including
 * remote connectors (claude.ai, mcp-remote) that do not support dynamic
 * tool-list changes. A helper `knowbe4_navigate` tool provides domain
 * discovery and guidance.
 *
 * Supports both stdio and HTTP transports:
 * - stdio (default): For local Claude Desktop / CLI usage
 * - http: For hosted deployment with optional gateway auth
 *
 * Auth modes:
 * - env (default): Credentials from KNOWBE4_API_KEY environment variable
 * - gateway: Credentials injected from request headers by the MCP gateway
 *   - Header: X-KnowBe4-API-Key
 *
 * Domains:
 * - account: Account info and risk score history
 * - users: User management and individual risk scores
 * - groups: Group management, members, and group risk scores
 * - phishing: Phishing campaigns, security tests, and recipient results
 * - training: Training campaigns, enrollments, store purchases, and policies
 * - reporting: Aggregated reports, risk overview, and phishing/training summaries
 */

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { toZodShape } from "@shared/zod-shape.js";
import { getDomainHandler, getAvailableDomains } from "./domains/index.js";
import { isDomainName, KNOWBE4_REGIONS, type DomainName } from "./utils/types.js";
import { getCredentials, credentialStore, describeKnowBe4BaseUrl } from "./utils/client.js";
import { logger } from "./utils/logger.js";
import { toolErrorFromCatch } from "../../_shared/error-envelope.js";
import { setServerRef } from "./utils/server-ref.js";
import { TOOL_CATEGORIES, findDomainForTool, routeIntent } from "./utils/categories.js";
import { annotate } from "./annotate-tool.js";
import { createToolRegistrar } from "../../_shared/mcp-server-kit.js";
import {
  textResult, formatToolSummary, runMain, requestUrl, respondHealth, httpConfigFromEnv, respondMissingCredentials,
  respondNotFound, listenHttp, exitOnSignals,
} from "../../_shared/server-entry.js";

// Navigation state removed - all tools are always available for direct-install compatibility

// Create the MCP server
const server = new McpServer(
  {
    name: "mcp-server-knowbe4",
    version: "1.1.2",
  },
  {
    capabilities: {
      logging: {},
    },
    // Loaded at startup even when Claude Code defers tool schemas, so this is
    // where tool-choice and auth-troubleshooting guidance has to live.
    instructions:
      "KnowBe4 security awareness data: account, users, groups, phishing campaigns and security tests, training campaigns and enrollments, policies, store purchases, and reporting summaries. Find user, group, or campaign IDs with the matching list tool before calling a get-by-id tool. On a 401, 403, or 440 response, a not-configured message, or a connection failure, call knowbe4_status once and report its output to the user instead of retrying other tools. When credentials are missing only knowbe4_status and knowbe4_navigate are listed; the user must set KNOWBE4_API_KEY and restart the session.",
  }
);

setServerRef(server.server);

/**
 * Navigation tool - stateless discovery helper that describes available tools for a domain.
 * All domain tools are always listed in tools/list regardless of navigation state,
 * because many MCP clients (claude.ai connectors, mcp-remote) only fetch the tool
 * list once and do not support notifications/tools/list_changed.
 */
const navigateTool: Tool = {
  name: "knowbe4_navigate",
  description:
    "Discover available KnowBe4 tools by domain. Returns tool names and descriptions for the selected domain. All tools are callable at any time — this is a help/discovery aid, not a prerequisite.",
  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        enum: getAvailableDomains(),
        description: `The domain to explore:
- account: Account info and risk score history
- users: User management and individual risk scores
- groups: Group management, members, and group risk scores
- phishing: Phishing campaigns, security tests, and recipient results
- training: Training campaigns, enrollments, store purchases, and policies
- reporting: Aggregated reports, risk overview, and phishing/training summaries`,
      },
    },
    required: ["domain"],
  },
};

/**
 * Back navigation tool - now a no-op since all tools are always available
 */
const backTool: Tool = {
  name: "knowbe4_back",
  description: "No-op tool for backwards compatibility. All tools are always available.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

/**
 * Status tool - shows credentials status and available domains
 */
const statusTool: Tool = {
  name: "knowbe4_status",
  description:
    "Show credentials status and available domains. Also verifies API credentials are configured.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

// ---------------------------------------------------------------------------
// Lazy-loading meta-tools (used when LAZY_LOADING=true)
// ---------------------------------------------------------------------------

const metaTools: Tool[] = [
  {
    name: "knowbe4_list_categories",
    description:
      "List all available KnowBe4 tool categories with descriptions and tool counts. Use this first to discover what the server can do before loading individual tool schemas.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "knowbe4_list_category_tools",
    description:
      "List all tools in a specific category with their full schemas. Call this after knowbe4_list_categories to see exactly what parameters a tool accepts.",
    inputSchema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: Object.keys(TOOL_CATEGORIES),
          description:
            "The category to list tools for (e.g. account, users, groups, phishing, training, reporting)",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "knowbe4_execute_tool",
    description:
      "Execute any KnowBe4 tool by name. Use knowbe4_list_category_tools first to discover the tool's required arguments.",
    inputSchema: {
      type: "object" as const,
      properties: {
        toolName: {
          type: "string",
          description: "The full tool name to execute (e.g. knowbe4_users_list)",
        },
        // Free-form object: the target tool validates its own keys.
        arguments: {
          type: "object",
          description: "The arguments to pass to the tool",
        },
      },
      required: ["toolName"],
    },
  },
  {
    name: "knowbe4_router",
    description:
      "Suggest the best KnowBe4 tool(s) for a given intent. Describe what you want to do in plain language and this tool will recommend which tool(s) to call.",
    inputSchema: {
      type: "object" as const,
      properties: {
        intent: {
          type: "string",
          description:
            "A plain-language description of what you want to accomplish (e.g. 'list all users', 'get phishing test results', 'risk overview')",
        },
      },
      required: ["intent"],
    },
  },
];

/**
 * Check whether lazy-loading mode is enabled via environment variable.
 */
function isLazyLoadingEnabled(): boolean {
  return process.env.LAZY_LOADING === "true";
}

/**
 * Map from domain name to its tool definitions (loaded lazily)
 */
const domainToolMap = new Map<DomainName, Tool[]>();

/**
 * All domain tools, collected once at startup
 */
let allDomainTools: Tool[] | null = null;

/**
 * Load all domain tools (lazy-loaded on first access)
 */
async function getAllDomainTools(): Promise<Tool[]> {
  if (allDomainTools !== null) {
    return allDomainTools;
  }

  const domains = getAvailableDomains();
  const tools: Tool[] = [];

  for (const domain of domains) {
    if (!domainToolMap.has(domain)) {
      const handler = await getDomainHandler(domain);
      const domainTools = handler.getTools();
      domainToolMap.set(domain, domainTools);
    }
    tools.push(...domainToolMap.get(domain)!);
  }

  allDomainTools = tools;
  return tools;
}

const AUTH_CHECK_TIMEOUT_MS = 10_000;

/** The vendor's short "message" field from an error body, else the status text. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string") return body.message;
  } catch {
    // non-JSON error body: keep the status text
  }
  return res.statusText;
}

/**
 * One authenticated read of the account endpoint. "Configured" only proves a key
 * is present; this reports whether KnowBe4 accepts it. Never throws and never
 * prints response data or the key (only the vendor's short "message" field).
 */
async function liveAuthCheck(creds: { apiKey: string; baseUrl: string }): Promise<string> {
  const started = Date.now();
  try {
    const res = await fetch(new URL("/v1/account", creds.baseUrl), {
      headers: { Authorization: `Bearer ${creds.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(AUTH_CHECK_TIMEOUT_MS),
    });
    if (res.ok) return `OK (HTTP ${res.status}, ${Date.now() - started} ms)`;
    return `FAILED HTTP ${res.status}: ${(await errorMessage(res)).slice(0, 200)}`;
  } catch (err) {
    return `FAILED: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`;
  }
}

async function statusResult(): Promise<CallToolResult> {
  const creds = getCredentials();
  if (!creds) {
    return textResult(`KnowBe4 MCP Server Status\n\nCredentials: NOT CONFIGURED (set KNOWBE4_API_KEY)\nAuth check: SKIPPED (no API key)\nAvailable domains: ${getAvailableDomains().join(", ")}\n\nOnly knowbe4_status and knowbe4_navigate are listed until KNOWBE4_API_KEY is set and the session is restarted.`);
  }

  const authCheck = await liveAuthCheck(creds);
  // isError is always present here (false when the check passed), unlike textResult.
  return {
    ...textResult(`KnowBe4 MCP Server Status\n\nCredentials: Configured\nBase URL: ${describeKnowBe4BaseUrl()}\nAuth check: ${authCheck}\nAvailable domains: ${getAvailableDomains().join(", ")}\n\nDomain tools are listed because credentials are configured. Use knowbe4_navigate to discover tools by domain.`),
    isError: authCheck.startsWith("FAILED"),
  };
}

type ToolArgs = Record<string, unknown>;
type ToolHandler = (args: ToolArgs) => Promise<CallToolResult>;

const jsonResult = (value: unknown): CallToolResult => textResult(JSON.stringify(value, null, 2));

const domainDescriptions: Record<DomainName, string> = {
  account: "Account info and risk score history",
  users: "User management and individual risk scores",
  groups: "Group management, members, and group risk scores",
  phishing: "Phishing campaigns, security tests, and recipient results",
  training: "Training campaigns, enrollments, store purchases, and policies",
  reporting: "Aggregated reports, risk overview, and phishing/training summaries",
};

// ---------------------------------------------------------------------------
// Lazy-loading meta-tool handlers
// ---------------------------------------------------------------------------

async function listCategories(): Promise<CallToolResult> {
  const categories = Object.entries(TOOL_CATEGORIES).map(([categoryName, cat]) => ({
    name: categoryName,
    description: cat.description,
    toolCount: cat.tools.length,
  }));
  return jsonResult({ categories });
}

async function listCategoryTools(args: ToolArgs): Promise<CallToolResult> {
  const category = (args as { category: string }).category;
  if (!isDomainName(category)) {
    return textResult(`Invalid category: '${category}'. Available categories: ${Object.keys(TOOL_CATEGORIES).join(", ")}`, true);
  }
  const tools = (await getDomainHandler(category)).getTools();
  return jsonResult({
    category,
    description: TOOL_CATEGORIES[category].description,
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  });
}

async function executeTool(args: ToolArgs): Promise<CallToolResult> {
  const { toolName, arguments: toolArgs = {} } = args as { toolName: string; arguments?: ToolArgs };

  if (!getCredentials()) {
    return textResult("Error: No API credentials configured. Please set the KNOWBE4_API_KEY environment variable.", true);
  }

  const domain = findDomainForTool(toolName);
  if (!domain) {
    return textResult(`Unknown tool: '${toolName}'. Use knowbe4_list_categories and knowbe4_list_category_tools to discover available tools.`, true);
  }

  const result = await (await getDomainHandler(domain)).handleCall(toolName, toolArgs);
  logger.debug("Meta-tool execute completed", {
    tool: toolName,
    domain,
    responseSize: JSON.stringify(result).length,
  });
  return result;
}

async function routeTool(args: ToolArgs): Promise<CallToolResult> {
  const intent = (args as { intent: string }).intent;
  const suggestions = routeIntent(intent);
  if (suggestions.length === 0) {
    return jsonResult({
      intent,
      suggestions: [],
      message: "No matching tools found for that intent. Use knowbe4_list_categories to browse all available categories.",
    });
  }

  // Enrich suggestions with their category
  const enriched = suggestions.map((toolName) => {
    const domain = findDomainForTool(toolName);
    return {
      tool: toolName,
      category: domain,
      categoryDescription: domain ? TOOL_CATEGORIES[domain].description : null,
    };
  });
  return jsonResult({ intent, suggestions: enriched });
}

// ---------------------------------------------------------------------------
// Flat-mode handlers
// ---------------------------------------------------------------------------

/** Navigate to a domain - stateless discovery helper. */
async function navigate(args: ToolArgs): Promise<CallToolResult> {
  const domain = (args as { domain: string }).domain;
  if (!isDomainName(domain)) {
    return textResult(`Invalid domain: '${domain}'. Available domains: ${getAvailableDomains().join(", ")}`, true);
  }
  const toolSummary = formatToolSummary((await getDomainHandler(domain)).getTools());
  return textResult(`${domainDescriptions[domain]}\n\nAvailable tools:\n${toolSummary}\n\nYou can call any of these tools directly.`);
}

/** Now a no-op, kept for backwards compatibility. */
async function back(): Promise<CallToolResult> {
  return textResult(`All tools are always available.\n\nAvailable domains: ${getAvailableDomains().join(", ")}\n\nUse knowbe4_navigate to discover tools by domain.`);
}

/** Route to the domain handler whose name prefix matches. */
async function routeDomainTool(name: string, args: ToolArgs): Promise<CallToolResult> {
  const domain = getAvailableDomains().find((d) => name.startsWith(`knowbe4_${d}_`));
  if (!domain) {
    return textResult(`Unknown tool: '${name}'. Use knowbe4_navigate to discover available tools by domain.`, true);
  }
  return await (await getDomainHandler(domain)).handleCall(name, args);
}

const localToolHandlers = new Map<string, ToolHandler>([
  ["knowbe4_list_categories", listCategories],
  ["knowbe4_list_category_tools", listCategoryTools],
  ["knowbe4_execute_tool", executeTool],
  ["knowbe4_router", routeTool],
  ["knowbe4_navigate", navigate],
  ["knowbe4_back", back],
  // Status check must never throw, even with missing credentials
  ["knowbe4_status", statusResult],
]);

function toolFailure(name: string, error: unknown): CallToolResult {
  const stack = error instanceof Error ? error.stack : undefined;
  logger.error("Tool call failed", { tool: name, stack });
  return toolErrorFromCatch(name, error, {
    hint: "Check that KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
  });
}

/**
 * Handle one tool call. Registered per tool with McpServer.registerTool below,
 * which validates args against the zod shape before this runs.
 */
async function callTool(name: string, args: ToolArgs | undefined): Promise<CallToolResult> {
  logger.info("Tool call received", { tool: name, arguments: args });

  try {
    const handler = localToolHandlers.get(name);
    return await (handler ? handler(args as ToolArgs) : routeDomainTool(name, args ?? {}));
  } catch (error: unknown) {
    return toolFailure(name, error);
  }
}

/**
 * Register every tool the current credential state allows. Called once before
 * the transport connects: registering afterwards would emit tools/list_changed,
 * which the claude.ai connectors this server targets ignore.
 */
async function registerTools(): Promise<void> {
  const registrar = createToolRegistrar({ server, z, toZodShape, annotate, vendorTitle: "KnowBe4" });
  const register = (tool: Tool) => registrar(tool, (args) => callTool(tool.name, args));

  // Progressive disclosure: shell tools only until credentials resolve. In
  // gateway mode credentials arrive per request (X-KnowBe4-API-Key), so they
  // cannot be known here and the full set is registered; a request without a
  // key is rejected with 401 before it reaches any tool.
  const credentialsKnown = process.env.AUTH_MODE === "gateway" || getCredentials() !== null;
  if (!credentialsKnown) {
    [navigateTool, statusTool].forEach(register);
  } else if (isLazyLoadingEnabled()) {
    metaTools.forEach(register);
  } else {
    [navigateTool, backTool, statusTool, ...(await getAllDomainTools())].forEach(register);
  }
}

/**
 * Start the server with stdio transport (default)
 */
async function startStdioTransport(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const mode = isLazyLoadingEnabled() ? "lazy loading" : "flattened";
  logger.info(`KnowBe4 MCP server running on stdio (${mode} mode)`);
}

/**
 * Start the server with HTTP Streamable transport.
 * In gateway mode (AUTH_MODE=gateway), credentials are extracted
 * from the X-KnowBe4-API-Key request header.
 */
async function startHttpTransport(): Promise<void> {
  const { port, host, isGatewayMode } = httpConfigFromEnv();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });

  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const url = requestUrl(req);
    if (respondHealth(url, res)) return;

    // MCP endpoint
    if (url.pathname === "/mcp") {
      // Gateway mode: extract credentials from headers
      if (isGatewayMode) {
        const apiKey = req.headers["x-knowbe4-api-key"] as string | undefined;
        const region = req.headers["x-knowbe4-region"] as string | undefined;

        if (!apiKey) {
          respondMissingCredentials(
            res,
            "Gateway mode requires X-KnowBe4-API-Key header",
            ["X-KnowBe4-API-Key"],
            ["X-KnowBe4-Region"],
          );
          return;
        }

        // Build credentials with region-to-baseUrl resolution
        const regionKey = (region || "us").toLowerCase();
        const baseUrl = KNOWBE4_REGIONS[regionKey] || KNOWBE4_REGIONS.us;

        // Run the request handler within a credential-scoped context
        // so all downstream getCredentials()/apiRequest() calls use these creds
        credentialStore.run({ apiKey, baseUrl }, () => {
          transport.handleRequest(req, res);
        });
        return;
      }

      transport.handleRequest(req, res);
      return;
    }

    // 404 for everything else
    respondNotFound(res, ["/mcp", "/health", "/healthz"]);
  });

  await server.connect(transport);

  await listenHttp(httpServer, port, host, () => {
    logger.info(`KnowBe4 MCP server listening on http://${host}:${port}/mcp`);
    logger.info(`Health check available at http://${host}:${port}/health`);
    logger.info(
      `Authentication mode: ${isGatewayMode ? "gateway (X-KnowBe4-API-Key header)" : "env (KNOWBE4_API_KEY environment variable)"}`
    );
  });
  exitOnSignals(httpServer, () => logger.info("Shutting down KnowBe4 MCP server..."), () => server.close());
}

/**
 * Main entry point - select transport based on MCP_TRANSPORT env var
 */
async function main() {
  const transportType = process.env.MCP_TRANSPORT || "stdio";
  logger.info("Starting KnowBe4 MCP server", {
    transport: transportType,
    logLevel: process.env.LOG_LEVEL || "info",
    nodeVersion: process.version,
  });

  await registerTools();

  if (transportType === "http") {
    await startHttpTransport();
  } else {
    await startStdioTransport();
  }
}

runMain(main, (message, fields) => logger.error(message, fields));
