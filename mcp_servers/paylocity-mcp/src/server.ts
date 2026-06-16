import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getNavigationTools, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials } from './utils/client.js';
import { logger } from './utils/logger.js';
import type { DomainName } from './utils/types.js';
import { annotate } from './annotate-tool.js';
import { toolErrorFromCatch, describeBaseUrl } from './domains/_helpers.js';

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'paylocity-mcp', version: '0.1.3' },
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
    return { tools: annotate(allTools, 'Paylocity') };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    if (name === 'paylocity_navigate') {
      const domain = (args?.domain as string) as DomainName;
      if (!DOMAINS.includes(domain)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid domain: ${domain}. Valid: ${DOMAINS.join(', ')}`,
            },
          ],
          isError: true,
        };
      }
      const handler = await getDomainHandler(domain);
      const tools = handler.getTools();
      const toolSummary = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
      return {
        content: [
          {
            type: 'text' as const,
            text: `Domain: ${domain}\n\nAvailable tools:\n${toolSummary}\n\nYou can call any of these tools directly.`,
          },
        ],
      };
    }

    if (name === 'paylocity_status') {
      const creds = getCredentials();
      const urlDesc = describeBaseUrl('paylocity', process.env.PAYLOCITY_BASE_URL, 'PAYLOCITY_BASE_URL');
      const sandboxActive =
        creds?.sandbox &&
        !process.env.PAYLOCITY_BASE_URL?.trim();
      const effectiveUrl = sandboxActive
        ? 'https://apisandbox.paylocity.com (sandbox toggle active)'
        : urlDesc;

      const credStatus = creds
        ? `Configured (clientId=${creds.clientId.slice(0, 6)}..., baseUrl=${effectiveUrl}, defaultCompanyId=${creds.defaultCompanyId || '(none — must pass per call)'})`
        : 'NOT CONFIGURED — set PAYLOCITY_CLIENT_ID and PAYLOCITY_CLIENT_SECRET (and ideally PAYLOCITY_COMPANY_ID).';
      return {
        content: [
          {
            type: 'text' as const,
            text: `Paylocity MCP Server Status\n\nCredentials: ${credStatus}\nDomains: ${DOMAINS.join(', ')}\n\nAll tools are registered upfront. Use paylocity_navigate to discover tools by domain.`,
          },
        ],
      };
    }

    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      const toolNames = handler.getTools().map(t => t.name);
      if (toolNames.includes(name)) {
        try {
          return await handler.handleCall(
            name,
            (args || {}) as Record<string, unknown>,
            extra
          );
        } catch (error: unknown) {
          logger.error('Tool call failed', { tool: name, error: (error as Error)?.message });
          return toolErrorFromCatch(name, error, {
            hint: 'Check that PAYLOCITY_CLIENT_ID, PAYLOCITY_CLIENT_SECRET, and PAYLOCITY_COMPANY_ID are set.',
          });
        }
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Unknown tool: ${name}. Use paylocity_navigate to discover available tools.`,
        },
      ],
      isError: true,
    };
  });

  return server;
}
