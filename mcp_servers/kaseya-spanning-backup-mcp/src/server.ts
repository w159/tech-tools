import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getNavigationTools, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials } from './utils/client.js';
import { logger } from './utils/logger.js';
import type { DomainName } from './utils/types.js';
import { annotate } from './annotate-tool.js';
import { missingCredsError, toolErrorFromCatch, describeBaseUrl } from './domains/_helpers.js';

// Per-platform default base URLs (from docs/vendors/spanning/README.md).
// M365 is the primary documented default for the o365-api.spanning.com surface.
const PLATFORM_DEFAULTS: Record<string, string> = {
  m365:        'https://o365-api.spanningbackup.com/external',
  gws:         'https://api.spanningbackup.com/external',
  salesforce:  'https://salesforce-api.spanningbackup.com',
};

function resolveSpanningUrl(platform: string, apiUrlOverride?: string): string {
  if (apiUrlOverride) return apiUrlOverride;
  return PLATFORM_DEFAULTS[platform] ?? PLATFORM_DEFAULTS['m365'];
}

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'kaseya-spanning-backup-mcp', version: '1.1.0' },
    { capabilities: { tools: {}, logging: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const all = [...getNavigationTools()];
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      all.push(...handler.getTools());
    }
    return { tools: annotate(all, 'Spanning') };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // -----------------------------------------------------------------------
    // spanning_status — must never throw, even with missing credentials.
    // -----------------------------------------------------------------------
    if (name === 'spanning_status') {
      const creds = getCredentials();
      if (!creds) {
        return missingCredsError('Kaseya Spanning Backup', [
          'SPANNING_ADMIN_EMAIL',
          'SPANNING_API_TOKEN',
        ]);
      }

      // Use kaseya_spanning vendor key for the _shared base-url helper.
      // The per-platform URL is handled locally since spanning uses per-platform
      // defaults rather than a single vendor default.
      const effectiveUrl = resolveSpanningUrl(creds.platform, creds.apiUrl);
      const urlDesc = creds.apiUrl
        ? `${creds.apiUrl} (from SPANNING_API_URL env var)`
        : `${effectiveUrl} (vendor default for platform=${creds.platform}; set SPANNING_API_URL to override)`;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              server:       'kaseya-spanning-backup-mcp',
              status:       'configured',
              adminEmail:   creds.adminEmail,
              platform:     creds.platform,
              baseUrl:      urlDesc,
              domains:      DOMAINS,
              note:         'All tools are available at all times. Use spanning_navigate to discover tools by domain.',
            }, null, 2),
          },
        ],
      };
    }

    // -----------------------------------------------------------------------
    // spanning_navigate — domain discovery aid.
    // -----------------------------------------------------------------------
    if (name === 'spanning_navigate') {
      const domain = (args?.domain as string) as DomainName;
      if (!DOMAINS.includes(domain)) {
        return {
          content: [{ type: 'text' as const, text: `Invalid domain: ${domain}. Valid: ${DOMAINS.join(', ')}` }],
          isError: true,
        };
      }
      const handler = await getDomainHandler(domain);
      const tools   = handler.getTools();
      const summary = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
      return {
        content: [{ type: 'text' as const, text: `${domain} domain\n\nAvailable tools:\n${summary}` }],
      };
    }

    // -----------------------------------------------------------------------
    // Domain tool dispatch.
    // -----------------------------------------------------------------------
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      const names   = handler.getTools().map((t) => t.name);
      if (names.includes(name)) {
        try {
          return await handler.handleCall(name, (args || {}) as Record<string, unknown>);
        } catch (err) {
          logger.error('Unhandled exception in domain handler', { tool: name, err });
          return toolErrorFromCatch(name, err, {
            hint: 'Check SPANNING_ADMIN_EMAIL, SPANNING_API_TOKEN, and SPANNING_PLATFORM (m365, gws, or salesforce).',
          });
        }
      }
    }

    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}. Use spanning_navigate to discover.` }],
      isError: true,
    };
  });

  return server;
}
