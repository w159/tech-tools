import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getState, getNavigationTools, getBackTool, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials } from './utils/client.js';
import { elicitCredentials } from './elicitation/forms.js';
import { logger } from './utils/logger.js';
import type { DomainName } from './utils/types.js';
import { annotate } from './annotate-tool.js';
import { missingCredsError, toolErrorFromCatch, describeBaseUrl } from './domains/_helpers.js';

export function createServer(): Server {
  const server = new Server(
    { name: 'blumira-mcp', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    }
  );

  // Dynamic tool list based on navigation state
  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    const sessionId = (extra as any)?.sessionId || 'default';
    const state = getState(sessionId);

    if (!state.currentDomain) {
      return { tools: annotate(getNavigationTools(), 'Blumira') };
    }

    const handler = await getDomainHandler(state.currentDomain);
    return { tools: annotate([...handler.getTools(), getBackTool()], 'Blumira') };
  });

  // Route tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const sessionId = (extra as any)?.sessionId || 'default';
    const state = getState(sessionId);

    // Navigation: navigate
    if (name === 'blumira_navigate') {
      const domain = (args?.domain as string) as DomainName;
      if (!DOMAINS.includes(domain)) {
        return {
          content: [{ type: 'text' as const, text: `Invalid domain: ${domain}. Valid: ${DOMAINS.join(', ')}` }],
          isError: true,
        };
      }

      // Check credentials before navigating
      if (!getCredentials()) {
        const creds = await elicitCredentials(server);
        if (creds) {
          if (creds.jwtToken) {
            process.env.BLUMIRA_JWT_TOKEN = creds.jwtToken;
          } else if (creds.clientId && creds.clientSecret) {
            process.env.BLUMIRA_CLIENT_ID = creds.clientId;
            process.env.BLUMIRA_CLIENT_SECRET = creds.clientSecret;
          }
        } else {
          return {
            content: [{ type: 'text' as const, text: 'Blumira credentials are required. Set BLUMIRA_JWT_TOKEN or BLUMIRA_CLIENT_ID + BLUMIRA_CLIENT_SECRET.' }],
            isError: true,
          };
        }
      }

      state.currentDomain = domain;
      const handler = await getDomainHandler(domain);
      const tools = handler.getTools().map(t => t.name);

      await server.sendToolListChanged();

      return {
        content: [{
          type: 'text' as const,
          text: `Navigated to ${domain}. Available tools: ${tools.join(', ')}`,
        }],
      };
    }

    // Navigation: back
    if (name === 'blumira_back') {
      state.currentDomain = null;
      await server.sendToolListChanged();
      return {
        content: [{ type: 'text' as const, text: 'Returned to domain navigation.' }],
      };
    }

    // Navigation: status — never throws, reports missing creds gracefully
    if (name === 'blumira_status') {
      const creds = getCredentials();
      if (!creds) {
        return missingCredsError('Blumira', [
          'BLUMIRA_JWT_TOKEN',
          'BLUMIRA_CLIENT_ID + BLUMIRA_CLIENT_SECRET',
        ]);
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            connected: true,
            baseUrl: describeBaseUrl('blumira', process.env.BLUMIRA_BASE_URL, 'BLUMIRA_BASE_URL'),
            domains: DOMAINS,
            currentDomain: state.currentDomain,
          }, null, 2),
        }],
      };
    }

    // Domain tool calls
    if (!state.currentDomain) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}. Use blumira_navigate first.` }],
        isError: true,
      };
    }

    const handler = await getDomainHandler(state.currentDomain);
    try {
      return await handler.handleCall(name, (args || {}) as Record<string, unknown>, extra);
    } catch (error: unknown) {
      logger.error('Tool call failed', { tool: name, error });
      return toolErrorFromCatch(name, error, {
        hint: 'Verify BLUMIRA_JWT_TOKEN or BLUMIRA_CLIENT_ID + BLUMIRA_CLIENT_SECRET are correct.',
      });
    }
  });

  return server;
}
