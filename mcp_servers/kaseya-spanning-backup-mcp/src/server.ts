import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult as SdkCallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toZodShape } from '@shared/zod-shape.js';
import {
  createToolRegistrar, navigateDomain, registerDomainTools, registerNavigationTools, runAuthCheck, statusResult,
} from '@shared/mcp-server-kit.js';
import { getNavigationTools, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials, getClient } from './utils/client.js';
import { logger } from './utils/logger.js';
import type { DomainName } from './utils/types.js';
import { annotate } from './annotate-tool.js';
import { toolErrorFromCatch } from './domains/_helpers.js';

const SERVER_INSTRUCTIONS =
  'Kaseya Spanning Backup for Microsoft 365, Google Workspace, and Salesforce: backed-up users, per-user service inventory, daily backup runs, restores, audit log, and license usage. ' +
  'Call the users tools first to find a user ID before per-user services, backups, or restores tools. ' +
  'On 401/403/440, "not configured", or a connection failure, call spanning_status once and report its output to the user instead of retrying other tools. ' +
  'When credentials are missing only spanning_status and spanning_navigate are listed; the user must set SPANNING_ADMIN_EMAIL and SPANNING_API_TOKEN and restart the session.';

/** One authenticated read (users page of 1) with a 10 s cap. Never throws; never prints response data. */
const liveAuthCheck = (): Promise<string> =>
  runAuthCheck(async () => getClient().users.list({ limit: 1 }), '10000 ms');

// Status must never throw, even with missing credentials.
async function statusTool(): Promise<SdkCallToolResult> {
  const creds = getCredentials();
  if (!creds) {
    return {
      content: [{
        type: 'text' as const,
        text: `Kaseya Spanning Backup MCP Server Status\n\nCredentials: NOT CONFIGURED (set SPANNING_ADMIN_EMAIL and SPANNING_API_TOKEN)\nAuth check: SKIPPED (no credentials)\nAvailable domains: ${DOMAINS.join(', ')}\n\nOnly spanning_status and spanning_navigate are listed until credentials are set and the session is restarted.`,
      }],
    };
  }

  // Per-platform default URL logic lives in getCredentials (creds.apiUrl is the effective URL).
  const urlDesc = creds.apiUrlIsOverride
    ? `${creds.apiUrl} (from SPANNING_API_URL env var)`
    : `${creds.apiUrl} (vendor default for platform=${creds.platform}; set SPANNING_API_URL to override)`;
  // "Configured" only proves values are present; make one cheap call so status shows whether Spanning accepts them.
  const authCheck = await liveAuthCheck();
  return {
    content: [{
      type: 'text' as const,
      text: `Kaseya Spanning Backup MCP Server Status\n\nCredentials: Configured (adminEmail=${creds.adminEmail}, platform=${creds.platform}, baseUrl=${urlDesc})\nAuth check: ${authCheck}\nAvailable domains: ${DOMAINS.join(', ')}\n\nDomain tools are listed because credentials are configured. Use spanning_navigate to discover tools by domain.`,
    }],
    isError: authCheck.startsWith('FAILED'),
  };
}

const navigateTool = (domain: string): Promise<SdkCallToolResult> =>
  navigateDomain({
    domains: DOMAINS, domain, getHandler: getDomainHandler,
    heading: (d) => `${d} domain`,
    footer: '',
  });

export async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: 'kaseya-spanning-backup-mcp', version: '1.1.3' },
    { capabilities: { logging: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  const register = createToolRegistrar({ server, z, toZodShape, annotate, vendorTitle: 'Spanning' });
  registerNavigationTools(register, getNavigationTools(), 'spanning_navigate', navigateTool, statusTool);

  // Progressive disclosure: status + navigate only until credentials resolve.
  if (!getCredentials()) return server;

  // Last-resort safety net for throws that escape the domain handler.
  await registerDomainTools(register, DOMAINS, getDomainHandler, (toolName, err) => {
    logger.error('Unhandled exception in domain handler', { tool: toolName, err });
    return toolErrorFromCatch(toolName, err, {
      hint: 'Check SPANNING_ADMIN_EMAIL, SPANNING_API_TOKEN, and SPANNING_PLATFORM (m365, gws, or salesforce).',
    });
  });

  return server;
}
