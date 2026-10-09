import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult as SdkCallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toZodShape } from '@shared/zod-shape.js';
import {
  createToolRegistrar, credentialStatusResult, makeNavigate, registerCredentialGatedTools, runAuthCheck,
} from '@shared/mcp-server-kit.js';
import { getNavigationTools, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials, getClient } from './utils/client.js';
import { logger } from './utils/logger.js';
import { annotate } from './annotate-tool.js';
import { describeBaseUrl, toolErrorFromCatch } from './domains/_helpers.js';

/** One cheap authenticated read with a hard timeout. Never throws, never prints response data. */
const liveAuthCheck = (): Promise<string> =>
  runAuthCheck(async () => (await getClient()).frameworks.list({ pageSize: 1 }), '10s');

const SERVER_INSTRUCTIONS =
  `Vanta compliance data: frameworks, controls, tests, documents, policies, integrations, people, vendors, risk scenarios, monitored computers, and vulnerabilities. Use the list tool for a domain to find IDs before calling its get-by-id tool. On a 401, 403, or 440 response, a not-configured message, or a connection failure, call vanta_status once and report its output to the user instead of retrying other tools. When credentials are missing only vanta_status and vanta_navigate are listed; the user must set VANTA_CLIENT_ID and VANTA_CLIENT_SECRET and restart the session.`;

const navigateTool = makeNavigate(DOMAINS, getDomainHandler);

// Status must never throw, even with missing creds.
async function statusTool(): Promise<SdkCallToolResult> {
  const creds = getCredentials();
  const urlDesc = describeBaseUrl('vanta', process.env.VANTA_BASE_URL, 'VANTA_BASE_URL');
  const credStatus = creds
    ? `Configured (clientId=${creds.clientId.slice(0, 6)}…, baseUrl=${urlDesc})`
    : 'NOT CONFIGURED — set VANTA_CLIENT_ID and VANTA_CLIENT_SECRET';
  // "Configured" only proves values are present; one live read shows whether Vanta accepts them.
  const authCheck = creds ? await liveAuthCheck() : 'SKIPPED (no client credentials)';
  // Unconfigured is a reduced mode; only a rejected credential flips isError.
  return credentialStatusResult({
    vendor: 'Vanta', credStatus, authCheck, domains: DOMAINS,
    footer: creds ? 'Use vanta_navigate to discover tools by domain.' : 'Only vanta_status and vanta_navigate are listed until VANTA_CLIENT_ID and VANTA_CLIENT_SECRET are set and the session is restarted.',
  });
}

export async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: 'vanta-mcp', version: '0.2.3' },
    { capabilities: { logging: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  const register = createToolRegistrar({ server, z, toZodShape, annotate, vendorTitle: 'Vanta' });
  await registerCredentialGatedTools({
    register, navigationTools: getNavigationTools(), navigateName: 'vanta_navigate',
    navigate: navigateTool, status: statusTool, hasCredentials: () => !!getCredentials(),
    domains: DOMAINS, getHandler: getDomainHandler,
    // Domain handlers handle their own errors; this catch is a last-resort
    // safety net for unexpected throws that escape the handler.
    onError: (toolName, err) => {
      logger.error('Unhandled error from domain handler', { tool: toolName, err });
      return toolErrorFromCatch(toolName, err, {
        hint: 'Check VANTA_CLIENT_ID and VANTA_CLIENT_SECRET are set correctly.',
      });
    },
  });

  return server;
}
