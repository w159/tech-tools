import { createServer as createHttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';
import { getCredentials, resetClient } from './utils/client.js';
import { logger } from './utils/logger.js';

function startHttpServer(): void {
  const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);
  const host = process.env.MCP_HTTP_HOST || '0.0.0.0';
  const isGatewayMode = process.env.AUTH_MODE === 'gateway';

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Shallow liveness probe — always 200 when the process is up.
    // In gateway mode credentials arrive per-request via headers, so a
    // credential check here would always fail and incorrectly fail
    // upstream health checks. Credential status is reported informationally.
    if (url.pathname === '/health' || url.pathname === '/healthz') {
      const creds = getCredentials();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        transport: 'http',
        credentials: { configured: !!creds },
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health', '/healthz'] }));
      return;
    }

    if (isGatewayMode) {
      const apiKey = req.headers['x-threatlocker-api-key'] as string;
      const organizationId = req.headers['x-threatlocker-organization-id'] as string;
      if (apiKey && organizationId) {
        // Reset client when credentials change
        resetClient();
        process.env.THREATLOCKER_API_KEY = apiKey;
        process.env.THREATLOCKER_ORGANIZATION_ID = organizationId;
      }
      // Don't reject — tools/list works without credentials
    }

    // Create fresh server + transport per request (stateless)
    const server = await createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  httpServer.listen(port, host, () => {
    logger.info(`HTTP streaming server listening on ${host}:${port}`);
  });
}

const transport = process.env.MCP_TRANSPORT;
if (transport === 'http') {
  startHttpServer();
} else {
  import('./index.js');
}