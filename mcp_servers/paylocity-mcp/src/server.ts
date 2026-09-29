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
import type { DomainName } from './utils/types.js';
import { annotate } from './annotate-tool.js';
import { toolErrorFromCatch, describeBaseUrl } from './domains/_helpers.js';

/** One cheap authenticated read with a hard timeout. Never throws, never prints response data. */
const liveAuthCheck = (): Promise<string> =>
  runAuthCheck(async () => (await getClient()).auth.getAccessToken(), '10s');

const SERVER_INSTRUCTIONS =
  `Paylocity payroll and HR data: employees, earnings, deductions, taxes, direct deposit, cost centers, pay grades, and related company records. Find employee IDs with the employee list or search tool before calling a get-by-id tool, and pass the company ID when no default is configured. On a 401, 403, or 440 response, a not-configured message, or a connection failure, call paylocity_status once and report its output to the user instead of retrying other tools. When credentials are missing only paylocity_status and paylocity_navigate are listed; the user must set PAYLOCITY_CLIENT_ID and PAYLOCITY_CLIENT_SECRET and restart the session.`;

const navigateTool = makeNavigate(DOMAINS, getDomainHandler);

const NOT_CONFIGURED = 'NOT CONFIGURED — set PAYLOCITY_CLIENT_ID and PAYLOCITY_CLIENT_SECRET (and ideally PAYLOCITY_COMPANY_ID).';

function describeConfigured(creds: NonNullable<ReturnType<typeof getCredentials>>, urlDesc: string): string {
  const sandboxActive = creds.sandbox && !process.env.PAYLOCITY_BASE_URL?.trim();
  const effectiveUrl = sandboxActive ? 'https://apisandbox.paylocity.com (sandbox toggle active)' : urlDesc;
  return `Configured (clientId=${creds.clientId.slice(0, 6)}..., baseUrl=${effectiveUrl}, defaultCompanyId=${creds.defaultCompanyId || '(none — must pass per call)'})`;
}

// Status must never throw, even with missing creds.
async function statusTool(): Promise<SdkCallToolResult> {
  const creds = getCredentials();
  const urlDesc = describeBaseUrl('paylocity', process.env.PAYLOCITY_BASE_URL, 'PAYLOCITY_BASE_URL');
  const credStatus = creds ? describeConfigured(creds, urlDesc) : NOT_CONFIGURED;
  // The OAuth token mint is the cheapest authenticated call and needs no company ID.
  const authCheck = creds ? await liveAuthCheck() : 'SKIPPED (no client credentials)';
  return credentialStatusResult({
    vendor: 'Paylocity', credStatus, authCheck, domains: DOMAINS,
    footer: creds ? 'Use paylocity_navigate to discover tools by domain.' : 'Only paylocity_status and paylocity_navigate are listed until PAYLOCITY_CLIENT_ID and PAYLOCITY_CLIENT_SECRET are set and the session is restarted.',
  });
}

export async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: 'paylocity-mcp', version: '0.1.4' },
    { capabilities: { logging: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  const register = createToolRegistrar({ server, z, toZodShape, annotate, vendorTitle: 'Paylocity' });
  await registerCredentialGatedTools({
    register, navigationTools: getNavigationTools(), navigateName: 'paylocity_navigate',
    navigate: navigateTool, status: statusTool, hasCredentials: () => !!getCredentials(),
    domains: DOMAINS, getHandler: getDomainHandler,
    onError: (toolName, error) => {
      logger.error('Tool call failed', { tool: toolName, error: (error as Error)?.message });
      return toolErrorFromCatch(toolName, error, {
        hint: 'Check that PAYLOCITY_CLIENT_ID, PAYLOCITY_CLIENT_SECRET, and PAYLOCITY_COMPANY_ID are set.',
      });
    },
  });

  return server;
}
