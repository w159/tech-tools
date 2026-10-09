// CIPP MCP Server
// Handles the Model Context Protocol server setup and integration with CIPP.
// Supports both local (env-based) and gateway (header-based) credential modes.

import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toZodShape } from '@shared/zod-shape.js';
import { CippService } from '../services/cipp.service.js';
import { Logger } from '../utils/logger.js';
import { McpServerConfig } from '../types/index.js';
import { EnvironmentConfig, parseCredentialsFromHeaders } from '../utils/config.js';
import { CippToolHandler } from '../handlers/tool.handler.js';
import { annotate } from '../annotate-tool.js';

export class CippMcpServer {
  private server: McpServer;
  private config: McpServerConfig;
  private cippService: CippService;
  private toolHandler: CippToolHandler;
  private logger: Logger;
  private envConfig: EnvironmentConfig | undefined;
  private httpServer?: HttpServer;

  constructor(config: McpServerConfig, logger: Logger, envConfig?: EnvironmentConfig) {
    this.logger = logger;
    this.config = config;
    this.envConfig = envConfig;

    this.cippService = new CippService(config, logger);
    this.toolHandler = new CippToolHandler(this.cippService, logger);

    this.server = this.createFreshServer();
  }

  /**
   * Create a fresh MCP Server with all handlers registered.
   * Called per-request in HTTP (stateless) mode so each initialise gets a clean server.
   */
  private createFreshServer(): McpServer {
    const server = this.buildServer(this.toolHandler, this.hasUsableCredentials());

    server.server.onerror = (error) => {
      this.logger.error('MCP Server error:', error);
    };

    server.server.oninitialized = () => {
      this.logger.info('MCP Server initialized and ready to serve requests');
    };

    return server;
  }

  /**
   * Build an McpServer with one registered tool per definition. Shared by the
   * stdio server and the per-request HTTP server (which may carry gateway
   * credentials in its own toolHandler). Progressive disclosure: cipp_status
   * only until credentials resolve. registerTool validates args against the zod
   * shape derived from the tool's JSON schema before the handler runs.
   */
  private buildServer(toolHandler: CippToolHandler, configured: boolean): McpServer {
    const server = new McpServer(
      { name: this.config.name, version: this.config.version },
      { capabilities: { logging: {} }, instructions: this.getServerInstructions() }
    );

    const tools = toolHandler
      .getToolDefinitions()
      .filter((tool) => configured || tool.name === 'cipp_status');

    // Loosely typed view of registerTool: inferring per-tool zod generics exceeds
    // tsc's instantiation depth in this CommonJS/zod 3 build. Runtime is unchanged.
    const registerTool = server.registerTool.bind(server) as unknown as (
      name: string,
      config: object,
      handler: (args: Record<string, unknown>) => Promise<CallToolResult>
    ) => unknown;

    for (const tool of annotate(tools, 'CIPP')) {
      const { title, ...annotations } = tool.annotations ?? {};
      registerTool(
        tool.name,
        {
          title,
          description: tool.description,
          inputSchema: toZodShape(z, tool.inputSchema),
          annotations: { title, ...annotations },
        },
        async (args): Promise<CallToolResult> => {
          this.logger.debug(`Handling tool call: ${tool.name}`);
          try {
            const result = await toolHandler.handleToolCall(tool.name, args || {});
            return { content: result.content, isError: result.isError } as CallToolResult;
          } catch (error) {
            this.logger.error(`Failed to call tool ${tool.name}:`, error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { content: [{ type: 'text', text: message }], isError: true };
          }
        }
      );
    }

    toolHandler.setServer(server.server);
    return server;
  }

  /** True when env/gateway credentials are enough to attempt CIPP API calls. */
  private hasUsableCredentials(configOverride?: McpServerConfig): boolean {
    const c = (configOverride ?? this.config)?.cipp as {
      baseUrl?: string;
      apiKey?: string;
      tenantId?: string;
      clientId?: string;
      clientSecret?: string;
    } | undefined;
    const base = (c?.baseUrl || process.env.CIPP_BASE_URL || '').trim();
    if (!base) return false;
    if ((c?.apiKey || process.env.CIPP_API_KEY || '').trim()) return true;
    const tenant = (c?.tenantId || process.env.CIPP_TENANT_ID || '').trim();
    const clientId = (c?.clientId || process.env.CIPP_CLIENT_ID || '').trim();
    const secret = (c?.clientSecret || process.env.CIPP_CLIENT_SECRET || '').trim();
    return Boolean(tenant && clientId && secret);
  }

  /**
   * Returns instructions that help MCP clients understand how to use this server.
   */
  private getServerInstructions(): string {
    return `
CIPP MCP Server — M365 multi-tenant management platform for MSPs.

Use tenantFilter to scope operations to a specific tenant domain (e.g. "contoso.com").
Most listing tools accept 'allTenants' as tenantFilter to query across every managed tenant.

Always confirm destructive operations (disable user, offboard user, reset password) before executing.

Tool categories:
- Tenants: list and inspect managed tenants
- Users: list, create, edit, disable, offboard, MFA/session management, BEC check
- Groups: list and create Azure AD groups
- Mailboxes: list mailboxes and permissions, configure OoO and forwarding
- Security: Conditional Access policies, named locations
- Standards: compliance standards, BPA results, domain health
- Licenses: per-tenant and CSP-level license reporting
- Alerts: audit logs and alert queue
- GDAP: roles and relationship invites
- Scheduler: list and create scheduled tasks
- Core: ping, version, logs
`.trim();
  }

  /**
   * Start the server using the configured transport type.
   */
  async start(): Promise<void> {
    const transportType = this.envConfig?.transport?.type || 'stdio';
    this.logger.info(`Starting CIPP MCP Server with ${transportType} transport...`);

    if (transportType === 'http') {
      await this.startHttpTransport();
    } else {
      await this.startStdioTransport();
    }
  }

  private async startStdioTransport(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('CIPP MCP Server started on stdio transport');
  }

  private async startHttpTransport(): Promise<void> {
    const port = this.envConfig?.transport?.port || 8080;
    const host = this.envConfig?.transport?.host || '0.0.0.0';
    const isGatewayMode = this.envConfig?.auth?.mode === 'gateway';

    this.httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Method not allowed' },
              id: null,
            })
          );
          return;
        }

        let toolHandler = this.toolHandler;
        let cippService = this.cippService;
        let requestConfig: McpServerConfig | undefined;

        if (isGatewayMode) {
          const credentials = parseCredentialsFromHeaders(
            req.headers as Record<string, string | string[] | undefined>
          );

          const hasOAuth =
            !!credentials.tenantId && !!credentials.clientId && !!credentials.clientSecret;
          const hasStatic = !!credentials.apiKey;

          if (!credentials.baseUrl || (!hasStatic && !hasOAuth)) {
            this.logger.warn('Gateway mode: Missing required credentials in request headers', {
              hasBaseUrl: !!credentials.baseUrl,
              hasApiKey: hasStatic,
              hasOAuthCreds: hasOAuth,
            });
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'Missing credentials',
                message:
                  'Gateway mode requires x-base-url plus either x-api-key or (x-tenant-id + x-client-id + x-client-secret)',
                required: ['x-base-url', 'x-api-key OR (x-tenant-id + x-client-id + x-client-secret)'],
              })
            );
            return;
          }

          requestConfig = {
            name: this.config.name,
            version: this.config.version,
            cipp: {
              baseUrl: credentials.baseUrl,
              ...(credentials.apiKey !== undefined ? { apiKey: credentials.apiKey } : {}),
              ...(credentials.tenantId !== undefined ? { tenantId: credentials.tenantId } : {}),
              ...(credentials.clientId !== undefined ? { clientId: credentials.clientId } : {}),
              ...(credentials.clientSecret !== undefined ? { clientSecret: credentials.clientSecret } : {}),
              ...(credentials.tokenScope !== undefined ? { tokenScope: credentials.tokenScope } : {}),
              ...(credentials.tokenUrl !== undefined ? { tokenUrl: credentials.tokenUrl } : {}),
            },
          };

          cippService = new CippService(requestConfig, this.logger);
          toolHandler = new CippToolHandler(cippService, this.logger);
        }

        const server = this.buildServer(
          toolHandler,
          requestConfig ? this.hasUsableCredentials(requestConfig) : this.hasUsableCredentials()
        );

        server.server.onerror = (error) => this.logger.error('MCP request server error:', error);

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        res.on('close', () => {
          transport.close();
          server.close();
        });

        server
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .connect(transport as any)
          .then(() => {
            transport.handleRequest(req, res);
          })
          .catch((err) => {
            this.logger.error('MCP transport connect error:', err);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  error: { code: -32603, message: 'Internal error' },
                  id: null,
                })
              );
            }
          });

        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health'] }));
    });

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(port, host, () => {
        this.logger.info(`CIPP MCP Server listening on http://${host}:${port}/mcp`);
        this.logger.info(`Health check available at http://${host}:${port}/health`);
        this.logger.info(
          `Authentication mode: ${isGatewayMode ? 'gateway (header-based)' : 'env (environment variables)'}`
        );
        resolve();
      });
    });
  }

  /**
   * Gracefully stop the server.
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping CIPP MCP Server...');
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await this.server.close();
    this.logger.info('CIPP MCP Server stopped');
  }
}
