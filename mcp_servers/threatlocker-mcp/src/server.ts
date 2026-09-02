import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getNavigationTools, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials, getClient } from './utils/client.js';
import { logger } from './utils/logger.js';
import type { DomainName } from './utils/types.js';
import { annotate } from './annotate-tool.js';
import { describeBaseUrl, toolErrorFromCatch } from './domains/_helpers.js';

// ThreatLocker instance shards that resolve today. A token is only known to the
// instance that issued it; every other instance answers 440 TOKEN_REVOKED, which
// is indistinguishable from a dead token. So on 440 we ask each shard directly.
const THREATLOCKER_INSTANCES = ['b', 'c', 'd', 'e', 'f', 'g', 'h'];

async function findAcceptingInstance(apiKey: string, organizationId?: string): Promise<string | null> {
  for (const inst of THREATLOCKER_INSTANCES) {
    try {
      const headers: Record<string, string> = { Authorization: apiKey };
      if (organizationId) headers.managedOrganizationId = organizationId;
      const res = await fetch(`https://portalapi.${inst}.threatlocker.com/portalapi/ApprovalRequest/ApprovalRequestGetCount`, {
        headers, signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return inst;
    } catch {
      // unreachable shard: keep looking
    }
  }
  return null;
}

/** One authenticated GET (pending approval count). Never throws. */
async function liveAuthCheck(): Promise<string> {
  try {
    const client = await getClient();
    const count = await client.approvalRequests.getPendingCount();
    return `OK (authenticated; pending approvals: ${count})`;
  } catch (err) {
    const e = err as { statusCode?: number; message?: string; response?: unknown };
    if (e.statusCode === 440) {
      const creds = getCredentials();
      const inst = creds ? await findAcceptingInstance(creds.apiKey, creds.organizationId) : null;
      if (inst) {
        return `FAILED HTTP 440 TOKEN_REVOKED at ${creds!.baseUrl}, but instance "${inst}" accepts this key. ` +
          `Set THREATLOCKER_BASE_URL=https://portalapi.${inst}.threatlocker.com/portalapi (plugin option threatlocker_base_url) and restart.`;
      }
      return 'FAILED HTTP 440 TOKEN_REVOKED: no ThreatLocker instance (b-h) recognizes this API key (ThreatLocker answers 440 for any unknown token). Mint a new API User token; tools will fail until then.';
    }
    const body = e.response !== undefined ? ` ${JSON.stringify(e.response).slice(0, 200)}` : '';
    return `FAILED${e.statusCode ? ` HTTP ${e.statusCode}` : ''}: ${e.message ?? String(err)}${body}`;
  }
}

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'threatlocker-mcp', version: '1.4.0' },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    }
  );

  // Return ALL tools upfront — navigation is a stateless help/discovery tool
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Progressive disclosure: status + navigate only until credentials resolve.
    const navTools = getNavigationTools();
    if (!getCredentials()) {
      return { tools: annotate(navTools, 'ThreatLocker') };
    }
    const allTools = [...navTools];
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      allTools.push(...handler.getTools());
    }
    return { tools: annotate(allTools, 'ThreatLocker') };
  });

  // Route tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    // Navigation: navigate (stateless discovery aid)
    if (name === 'threatlocker_navigate') {
      const domain = (args?.domain as string) as DomainName;
      if (!DOMAINS.includes(domain)) {
        return {
          content: [{ type: 'text' as const, text: `Invalid domain: ${domain}. Valid: ${DOMAINS.join(', ')}` }],
          isError: true,
        };
      }

      const handler = await getDomainHandler(domain);
      const tools = handler.getTools();

      const toolSummary = tools
        .map(t => `- ${t.name}: ${t.description}`)
        .join('\n');

      // Get domain description from navigation
      const navTools = getNavigationTools();
      const navTool = navTools.find(t => t.name === 'threatlocker_navigate');
      const domainProp = navTool?.inputSchema?.properties?.domain as { description?: string } | undefined;
      const domainDesc = domainProp?.description ?? '';
      const domainLine = domainDesc.split('\n').find((line: string) => line.includes(`- ${domain}:`));
      const description = domainLine ? domainLine.replace(`- ${domain}: `, '') : `${domain} domain`;

      return {
        content: [{
          type: 'text' as const,
          text: `${description}\n\nAvailable tools:\n${toolSummary}\n\nYou can call any of these tools directly.`,
        }],
      };
    }

    // Navigation: status — must never throw, even with missing creds
    if (name === 'threatlocker_status') {
      const creds = getCredentials();
      const urlDesc = describeBaseUrl('threatlocker', process.env.THREATLOCKER_BASE_URL, 'THREATLOCKER_BASE_URL');
      // Key fingerprint (first 4 chars) lets a caller tell a stale launch-time
      // credential from the one they just saved without exposing the key.
      const credStatus = creds
        ? `Configured (API key present, prefix ${creds.apiKey.slice(0, 4)}...; baseUrl=${urlDesc})`
        : `NOT CONFIGURED — set THREATLOCKER_API_KEY. Base URL: ${urlDesc}`;

      // "Configured" only proves a value is present. Make one cheap authenticated
      // call so status reports whether ThreatLocker actually accepts the key;
      // without this a caller can read "configured" as "working".
      const authCheck = creds ? await liveAuthCheck() : 'SKIPPED (no API key)';

      return {
        content: [{
          type: 'text' as const,
          text: `ThreatLocker MCP Server Status\n\nCredentials: ${credStatus}\nAuth check: ${authCheck}\nAvailable domains: ${DOMAINS.join(', ')}\n\nAll tools are available at all times. Use threatlocker_navigate to discover tools by domain.`,
        }],
        // Unconfigured is a reduced mode, not an error (see AUDIT_2026-06-12);
        // only a rejected key flips isError.
        isError: authCheck.startsWith('FAILED'),
      };
    }

    // Domain tool calls — try every domain handler
    for (const domain of DOMAINS) {
      const handler = await getDomainHandler(domain);
      const toolNames = handler.getTools().map(t => t.name);
      if (toolNames.includes(name)) {
        // Domain handlers handle their own errors; this catch is a last-resort
        // safety net for unexpected throws that escape the handler.
        try {
          return await handler.handleCall(name, (args || {}) as Record<string, unknown>, extra);
        } catch (err) {
          logger.error('Unhandled error from domain handler', { tool: name, err });
          return toolErrorFromCatch(name, err, {
            hint: 'Check THREATLOCKER_API_KEY is set. Verify THREATLOCKER_BASE_URL if using a non-default region.',
          });
        }
      }
    }

    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}. Use threatlocker_navigate to discover available tools.` }],
      isError: true,
    };
  });

  return server;
}
