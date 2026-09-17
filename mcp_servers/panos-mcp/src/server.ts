import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getNavigationTools, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials } from './utils/client.js';
import { logger } from './utils/logger.js';
import type { DomainName } from './utils/types.js';
import { annotate } from './annotate-tool.js';
import { panosToolError } from './domains/_helpers.js';

// Strip unresolved MCP host template placeholders and blanks, same rule as
// utils/client.ts, so panos_status reports "not set" rather than a literal
// "${user_config.x}" when an optional field is left blank.
const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? '' : v.trim();

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'panos-mcp', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Progressive disclosure, per docs/panos-connector-design.md "Credential
    // bootstrap": three states rather than the usual on/off gate, because
    // panos_keygen must be reachable with only a username/password so an
    // operator without an API key yet can mint one.
    const navTools = getNavigationTools();
    const host = cleanEnv(process.env.PANOS_HOST);

    if (!host) {
      return { tools: annotate(navTools, 'Panos') };
    }

    if (!getCredentials()) {
      const username = cleanEnv(process.env.PANOS_USERNAME);
      const password = cleanEnv(process.env.PANOS_PASSWORD);
      if (username && password) {
        const opsHandler = await getDomainHandler('operations');
        const keygenTool = opsHandler.getTools().filter(t => t.name === 'panos_keygen');
        return { tools: annotate([...navTools, ...keygenTool], 'Panos') };
      }
      return { tools: annotate(navTools, 'Panos') };
    }

    const allTools = [...navTools];
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      allTools.push(...handler.getTools());
    }
    return { tools: annotate(allTools, 'Panos') };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    if (name === 'panos_navigate') {
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

    if (name === 'panos_status') {
      // Runs without credentials configured, per the safety rule: report what
      // is set rather than requiring a working client first.
      const host = cleanEnv(process.env.PANOS_HOST);
      const apiKey = cleanEnv(process.env.PANOS_API_KEY);
      const username = cleanEnv(process.env.PANOS_USERNAME);
      const password = cleanEnv(process.env.PANOS_PASSWORD);
      const target = cleanEnv(process.env.PANOS_TARGET);
      const verifyTlsRaw = cleanEnv(process.env.PANOS_VERIFY_TLS);
      const restVersion = cleanEnv(process.env.PANOS_REST_VERSION) || 'v11.1';
      const verifyTls = verifyTlsRaw.toLowerCase() !== 'false';

      const credStatus = host && apiKey
        ? 'Configured'
        : 'NOT CONFIGURED - set PANOS_HOST and PANOS_API_KEY';

      const lines = [
        `PAN-OS MCP Server Status`,
        ``,
        `Credentials: ${credStatus}`,
        `PANOS_HOST: ${host || 'not set'} (no vendor default - the base URL is the appliance itself)`,
        // Presence plus length, never a prefix: `LUFRPT...` is the opening
        // characters of a long-lived PAN-OS API key, and panos_status renders
        // into a conversation transcript that gets shared and archived, which
        // under the FTC Safeguards Rule and Reg S-P it has no business doing.
        // The length answers the only question an operator has here: did the
        // whole key reach the env var, or was it truncated?
        `PANOS_API_KEY: ${apiKey ? `configured (${apiKey.length} chars)` : 'not set'}`,
        `PANOS_USERNAME: ${username || 'not set'}`,
        `PANOS_PASSWORD: ${password ? '(set)' : 'not set'}`,
        `PANOS_TARGET (default managed-firewall serial): ${target || 'not set'}`,
        `PANOS_VERIFY_TLS: ${verifyTls} ${verifyTlsRaw ? '' : '(default)'}`.trim(),
        `PANOS_REST_VERSION: ${restVersion}`,
        `Domains: ${DOMAINS.join(', ')}`,
        ``,
        `All tools are registered upfront once credentials resolve. Use panos_navigate to discover tools by domain.`,
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
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
          // No hint: an unexpected throw that escaped a domain handler has no
          // known remedy, and guessing "check your credentials" is how an
          // operator ends up debugging a credential that is fine.
          return panosToolError(name, err);
        }
      }
    }

    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}. Use panos_navigate to discover available tools.` }],
      isError: true,
    };
  });

  return server;
}
