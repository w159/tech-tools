import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from './server.js';
import { getCredentials, exchangeOAuthToken } from './utils/client.js';
import { logger } from './utils/logger.js';

const transports: Record<string, StreamableHTTPServerTransport> = {};

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function startHttpServer(): void {
  const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);
  const host = process.env.MCP_HTTP_HOST || '0.0.0.0';
  const isGatewayMode = process.env.AUTH_MODE === 'gateway';

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Shallow, unauthenticated liveness probe. Always 200 while the process is
    // up — in gateway mode credentials arrive per-request via headers, so a
    // credential-gated status would wrongly fail the Azure liveness probe.
    if (url.pathname === '/health' || url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        transport: 'http',
        credentials: { configured: !!getCredentials() },
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
      // Support new OAuth headers (preferred) and legacy JWT header
      const clientId = req.headers['x-blumira-client-id'] as string;
      const clientSecret = req.headers['x-blumira-client-secret'] as string;
      const jwtToken = req.headers['x-blumira-jwt-token'] as string;

      if (clientId && clientSecret) {
        try {
          const token = await exchangeOAuthToken(clientId, clientSecret);
          process.env.BLUMIRA_JWT_TOKEN = token;
          // Also store for OAuth-aware path in client.ts
          process.env.BLUMIRA_CLIENT_ID = clientId;
          process.env.BLUMIRA_CLIENT_SECRET = clientSecret;
        } catch (err) {
          logger.error('OAuth token exchange failed', { error: (err as Error).message });
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'OAuth token exchange failed', detail: (err as Error).message }));
          return;
        }
      } else if (jwtToken) {
        process.env.BLUMIRA_JWT_TOKEN = jwtToken;
      }
      // Allow unauthenticated tools/list — credentials checked only when tools are called
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (req.method === 'POST') {
      const body = await readBody(req);
      const parsed = JSON.parse(body);

      // Allow initialize and tools/list without credentials (unauthenticated discovery)
      const isUnauthMethod = !Array.isArray(parsed) &&
        (parsed?.method === 'tools/list' || parsed?.method === 'initialize');
      if (isGatewayMode && !isUnauthMethod) {
        const creds = getCredentials();
        if (!creds) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Missing credentials',
            detail: 'Provide X-Blumira-Client-ID + X-Blumira-Client-Secret or X-Blumira-JWT-Token headers',
          }));
          return;
        }
      }

      if (sessionId && transports[sessionId]) {
        await transports[sessionId].handleRequest(req, res, parsed);
        return;
      }

      if (!sessionId && isInitializeRequest(parsed)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => { transports[sid] = transport; },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) delete transports[sid];
        };

        const server = await createServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, parsed);
        return;
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: missing or invalid session' },
        id: null,
      }));
      return;
    }

    if (req.method === 'GET') {
      if (!sessionId || !transports[sessionId]) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid or missing session ID');
        return;
      }
      await transports[sessionId].handleRequest(req, res);
      return;
    }

    if (req.method === 'DELETE') {
      if (!sessionId || !transports[sessionId]) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid or missing session ID');
        return;
      }
      await transports[sessionId].handleRequest(req, res);
      return;
    }

    res.writeHead(405).end();
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
