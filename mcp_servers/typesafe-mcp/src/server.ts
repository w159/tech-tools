import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { annotate } from './annotate-tool.js';
import { getAllTools, callTool } from './domains/index.js';
import { logger } from './utils/logger.js';

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'typesafe-mcp', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Flat tool list, no navigate/domain-gating step (only three tools total):
  // all three are listed up front in every credential state. See
  // domains/index.ts for why typesafe_decide/typesafe_list_models stay
  // listed rather than disappearing when no provider is configured.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: annotate(getAllTools(), 'Typesafe') };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await callTool(name, (args || {}) as Record<string, unknown>);
      if (result === null) {
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}.` }],
          isError: true,
        };
      }
      return result;
    } catch (err) {
      // Last-resort safety net for a throw that escapes a domain handler;
      // domain handlers otherwise handle their own errors via typesafeToolError.
      logger.error('Unhandled error from domain handler', { tool: name, err });
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}.` }],
        isError: true,
      };
    }
  });

  return server;
}
