import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getNavigationTools, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials } from './utils/client.js';
import { logger } from './utils/logger.js';
import type { DomainName } from './utils/types.js';
import { annotate } from './annotate-tool.js';
import { describeBaseUrl } from './domains/_helpers.js';
import { toolErrorFromCatch } from './domains/_helpers.js';

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'vanta-mcp', version: '0.2.0' },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const allTools = [...getNavigationTools()];
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      allTools.push(...handler.getTools());
    }
    return { tools: annotate(allTools, 'Vanta') };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    if (name === 'vanta_navigate') {
      const domain = (args?.domain as string) as DomainName;
      if (!DOMAINS.includes(domain)) {
        return {
          content: [{ type: 'text' as const, text: `Invalid domain: ${domain}. Valid: ${DOMAINS.join(', ')}` }],
          isError: true,
        };
      }
      const handler = await getDomainHandler(domain);
      const tools = handler.getTools();
      const toolSummary = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
      return {
        content: [{
          type: 'text' as const,
          text: `Domain: ${domain}\n\nAvailable tools:\n${toolSummary}\n\nYou can call any of these tools directly.`,
        }],
      };
    }

    if (name === 'vanta_status') {
      const creds = getCredentials();
      const urlDesc = describeBaseUrl('vanta', process.env.VANTA_BASE_URL, 'VANTA_BASE_URL');
      const credStatus = creds
        ? `Configured (clientId=${creds.clientId.slice(0, 6)}…, baseUrl=${urlDesc})`
        : 'NOT CONFIGURED — set VANTA_CLIENT_ID and VANTA_CLIENT_SECRET';
      return {
        content: [{
          type: 'text' as const,
          text: `Vanta MCP Server Status\n\nCredentials: ${credStatus}\nDomains: ${DOMAINS.join(', ')}\n\nAll tools are registered upfront. Use vanta_navigate to discover tools by domain.`,
        }],
      };
    }

    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      const toolNames = handler.getTools().map(t => t.name);
      if (toolNames.includes(name)) {
        // Domain handlers now handle their own errors; this catch is a last-resort
        // safety net for unexpected throws that escape the handler.
        try {
          return await handler.handleCall(name, (args || {}) as Record<string, unknown>, extra);
        } catch (err) {
          logger.error('Unhandled error from domain handler', { tool: name, err });
          return toolErrorFromCatch(name, err, {
            hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET are set correctly.',
          });
        }
      }
    }

    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}. Use vanta_navigate to discover available tools.` }],
      isError: true,
    };
  });

  return server;
}
