import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult as SdkCallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toZodShape } from '@shared/zod-shape.js';
import {
  createToolRegistrar, makeNavigate, registerDomainTools, registerNavigationTools, runAuthCheck, statusResult,
} from '@shared/mcp-server-kit.js';
import { getNavigationTools, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials, getClient } from './utils/client.js';
import { elicitCredentials } from './elicitation/forms.js';
import { logger } from './utils/logger.js';
import type { DomainName } from './utils/types.js';
import { annotate } from './annotate-tool.js';
import { toolErrorFromCatch, describeBaseUrl } from './domains/_helpers.js';

// "Configured" only proves a value is present. One cheap authenticated read
// (resolutions list, no arguments) shows whether Blumira accepts the credentials.
// Response data is never printed.
const liveAuthCheck = (): Promise<string> =>
  runAuthCheck(async () => (await getClient()).resolutions.list(), '10 s');

async function statusTool(): Promise<SdkCallToolResult> {
  const creds = getCredentials();
  const authCheck = creds ? await liveAuthCheck() : 'SKIPPED (no credentials)';
  const credStatus = creds
    ? 'Configured'
    : 'NOT CONFIGURED - set BLUMIRA_JWT_TOKEN or BLUMIRA_CLIENT_ID + BLUMIRA_CLIENT_SECRET';
  return statusResult(
    `Blumira MCP Server Status\n\nCredentials: ${credStatus}\nBase URL: ${describeBaseUrl('blumira', process.env.BLUMIRA_BASE_URL, 'BLUMIRA_BASE_URL')}\nAuth check: ${authCheck}\nAvailable domains: ${DOMAINS.join(', ')}`,
    authCheck,
  );
}

type ElicitedCredentials = NonNullable<Awaited<ReturnType<typeof elicitCredentials>>>;

// Exported into process.env so getCredentials() sees them on the next call.
function applyElicitedCredentials(creds: ElicitedCredentials): void {
  if (creds.jwtToken) {
    process.env.BLUMIRA_JWT_TOKEN = creds.jwtToken;
  } else if (creds.clientId && creds.clientSecret) {
    process.env.BLUMIRA_CLIENT_ID = creds.clientId;
    process.env.BLUMIRA_CLIENT_SECRET = creds.clientSecret;
  }
}

export async function createServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: 'blumira-mcp', version: '1.1.5' },
    {
      capabilities: { logging: {} },
      instructions:
        'Blumira SIEM and XDR: security findings (list, get, evidence, comments, resolve, assign), agent devices and enrollment keys, organization users, MSP multi-account views, and resolution codes. ' +
        'Call blumira_findings_list before any get, evidence, comment, or resolve tool that needs a finding ID, and the users list tool to get owner UUIDs before assigning; MSP tools need an account ID from the MSP accounts list. ' +
        'On a 401, 403, or 440, a not-configured message, or a connection failure, call blumira_status once and report its output to the user instead of retrying other tools. ' +
        'When credentials are missing only blumira_status and blumira_navigate are listed; the user must set BLUMIRA_JWT_TOKEN (or BLUMIRA_CLIENT_ID and BLUMIRA_CLIENT_SECRET) and restart the session.',
    },
  );

  const register = createToolRegistrar({ server, z, toZodShape, annotate, vendorTitle: 'Blumira' });

  // Domain tools are registered once credentials resolve, either at startup or
  // after navigate elicits them. McpServer sends tools/list_changed on registration.
  let domainToolsRegistered = false;
  const registerAllDomainTools = async () => {
    if (domainToolsRegistered) return;
    domainToolsRegistered = true;
    // Last-resort safety net; domain handlers handle their own errors.
    await registerDomainTools(register, DOMAINS, getDomainHandler, (toolName, error) => {
      logger.error('Tool call failed', { tool: toolName, error });
      return toolErrorFromCatch(toolName, error, {
        hint: 'Verify BLUMIRA_JWT_TOKEN or BLUMIRA_CLIENT_ID + BLUMIRA_CLIENT_SECRET are correct.',
      });
    });
  };

  // Returns an error result when credentials could not be collected, else undefined.
  const ensureCredentials = async (): Promise<SdkCallToolResult | undefined> => {
    const creds = await elicitCredentials(server.server);
    if (!creds) {
      return {
        content: [{ type: 'text' as const, text: 'Blumira credentials are required. Set BLUMIRA_JWT_TOKEN or BLUMIRA_CLIENT_ID + BLUMIRA_CLIENT_SECRET.' }],
        isError: true,
      };
    }
    applyElicitedCredentials(creds);
    await registerAllDomainTools();
    return undefined;
  };

  const navigateDomainTools = makeNavigate(DOMAINS, getDomainHandler);

  // An invalid domain skips elicitation and falls through to navigateDomain's error.
  const navigate = async (domain: string): Promise<SdkCallToolResult> => {
    if ((DOMAINS as readonly string[]).includes(domain) && !getCredentials()) {
      const failure = await ensureCredentials();
      if (failure) return failure;
    }
    return navigateDomainTools(domain);
  };

  registerNavigationTools(register, getNavigationTools(), 'blumira_navigate', navigate, statusTool);

  // Progressive disclosure keyed on credentials only: status + navigate until they resolve.
  if (getCredentials()) await registerAllDomainTools();

  return server;
}
