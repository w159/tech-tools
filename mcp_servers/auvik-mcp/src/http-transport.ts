import fastify from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { credentialsStorage, resolveRegion, type AuvikCredentials } from './credentials.js';

const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);
const host = process.env.MCP_HTTP_HOST || '0.0.0.0';

export async function startHttpTransport(): Promise<void> {
  const app = fastify({ logger: true });

  // Health endpoint - UNCONDITIONALLY returns 200
  app.get('/health', async (request, reply) => {
    return { status: 'ok' };
  });

  // MCP endpoint
  app.all('/messages', async (request, reply) => {
    // Extract credentials from headers for gateway mode
    const username = request.headers['x-auvik-username'] as string;
    const apiKey = request.headers['x-auvik-api-key'] as string;
    const region = request.headers['x-auvik-region'] as string;

    if (username && apiKey) {
      const credentials: AuvikCredentials = {
        username,
        apiKey,
        region: resolveRegion(region, 'x-auvik-region header'),
      };

      // Run the MCP handler within AsyncLocalStorage context
      return credentialsStorage.run(credentials, async () => {
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        // Clean up on request end
        request.raw.on('close', () => {
          transport.close();
          server.close();
        });

        await server.connect(transport);

        // Convert Fastify request/response to Node.js IncomingMessage/ServerResponse
        return transport.handleRequest(request.raw, reply.raw);
      });
    }

    // Fall back to handling without AsyncLocalStorage (single-tenant mode)
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    request.raw.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    return transport.handleRequest(request.raw, reply.raw);
  });

  // 404 handler
  app.setNotFoundHandler(async (request, reply) => {
    reply.status(404);
    return {
      error: 'Not found',
      endpoints: ['/messages', '/health']
    };
  });

  await app.listen({ port, host });
  console.log(`Auvik MCP HTTP server listening on ${host}:${port}`);
}