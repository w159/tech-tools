import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult as SdkCallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toZodShape } from '@shared/zod-shape.js';
import { cleanEnv } from '@shared/clean-env.js';
import {
  createToolRegistrar, makeNavigate, type ToolRegistrar, registerDomainTools, registerHandlerTool, registerNavigationTools, runAuthCheck,
} from '@shared/mcp-server-kit.js';
import { getNavigationTools, DOMAINS } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials, getClient } from './utils/client.js';
import { logger } from './utils/logger.js';
import type { DomainName } from './utils/types.js';
import { annotate } from './annotate-tool.js';
import { panosToolError } from './domains/_helpers.js';

/** One cheap authenticated read with a hard timeout. Never throws, never prints response data. */
const liveAuthCheck = (): Promise<string> =>
  runAuthCheck(async () => (await getClient()).op('<show><system><info/></system></show>'), '10s');

const SERVER_INSTRUCTIONS =
  'Palo Alto PAN-OS firewall and Panorama management: candidate config, commits, operational commands, logs, reports, file export/import, REST objects and policies, updates, and certificates. ' +
  'Config writes never auto-commit; use the commits tools to commit and to poll job IDs returned by async operations. ' +
  'On 401/403, "not configured", or a connection failure, call panos_status once and report its output to the user instead of retrying other tools. ' +
  'When credentials are missing only panos_status and panos_navigate are listed, plus panos_keygen when only PANOS_USERNAME and PANOS_PASSWORD are set; the user must set PANOS_HOST and PANOS_API_KEY and restart the session.';

const navigateTool = makeNavigate(DOMAINS, getDomainHandler);

const orNotSet = (value: string): string => value || 'not set';
const describeApiKey = (apiKey: string): string => (apiKey ? `configured (${apiKey.length} chars)` : 'not set');
const describePassword = (password: string): string => (password ? '(set)' : 'not set');
const describeVerifyTls = (env: { verifyTls: boolean; verifyTlsRaw: string }): string =>
  `${env.verifyTls} ${env.verifyTlsRaw ? '' : '(default)'}`.trim();
const NOT_CONFIGURED_STATUS = 'NOT CONFIGURED - set PANOS_HOST and PANOS_API_KEY';

function readStatusEnv() {
  const host = cleanEnv(process.env.PANOS_HOST);
  const apiKey = cleanEnv(process.env.PANOS_API_KEY);
  const verifyTlsRaw = cleanEnv(process.env.PANOS_VERIFY_TLS);
  return {
    host,
    apiKey,
    configured: !!(host && apiKey),
    username: cleanEnv(process.env.PANOS_USERNAME),
    password: cleanEnv(process.env.PANOS_PASSWORD),
    target: cleanEnv(process.env.PANOS_TARGET),
    verifyTlsRaw,
    verifyTls: verifyTlsRaw.toLowerCase() !== 'false',
    restVersion: cleanEnv(process.env.PANOS_REST_VERSION) || 'v11.1',
  };
}

function statusLines(env: ReturnType<typeof readStatusEnv>, authCheck: string): string[] {
  return [
    `PAN-OS MCP Server Status`,
    ``,
    `Credentials: ${env.configured ? 'Configured' : NOT_CONFIGURED_STATUS}`,
    `Auth check: ${authCheck}`,
    `PANOS_HOST: ${orNotSet(env.host)} (no vendor default - the base URL is the appliance itself)`,
    // Presence plus length, never a prefix: `LUFRPT...` is the opening
    // characters of a long-lived PAN-OS API key, and panos_status renders
    // into a conversation transcript that gets shared and archived, which
    // under the FTC Safeguards Rule and Reg S-P it has no business doing.
    // The length answers the only question an operator has here: did the
    // whole key reach the env var, or was it truncated?
    `PANOS_API_KEY: ${describeApiKey(env.apiKey)}`,
    `PANOS_USERNAME: ${orNotSet(env.username)}`,
    `PANOS_PASSWORD: ${describePassword(env.password)}`,
    `PANOS_TARGET (default managed-firewall serial): ${orNotSet(env.target)}`,
    `PANOS_VERIFY_TLS: ${describeVerifyTls(env)}`,
    `PANOS_REST_VERSION: ${env.restVersion}`,
    `Domains: ${DOMAINS.join(', ')}`,
    ``,
    env.configured
      ? `Configured: domain tools are listed. Use panos_navigate to discover tools by domain.`
      : `Not configured: only panos_status and panos_navigate are listed (plus panos_keygen when PANOS_HOST, PANOS_USERNAME and PANOS_PASSWORD are set) until PANOS_HOST and PANOS_API_KEY are set and the session is restarted.`,
  ];
}

// Status must never throw, even with missing creds: report what is set rather
// than requiring a working client first.
async function statusTool(): Promise<SdkCallToolResult> {
  const env = readStatusEnv();
  // "Configured" only proves values are present; one live op shows whether the appliance accepts the key.
  const authCheck = env.configured ? await liveAuthCheck() : 'SKIPPED (PANOS_HOST and PANOS_API_KEY not both set)';
  return { content: [{ type: 'text' as const, text: statusLines(env, authCheck).join('\n') }], isError: authCheck.startsWith('FAILED') };
}

async function registerKeygenIfBootstrappable(register: ToolRegistrar, onError: (toolName: string, err: unknown) => SdkCallToolResult): Promise<void> {
  if (!(cleanEnv(process.env.PANOS_USERNAME) && cleanEnv(process.env.PANOS_PASSWORD))) return;
  const opsHandler = await getDomainHandler('operations');
  for (const tool of opsHandler.getTools().filter(t => t.name === 'panos_keygen')) registerHandlerTool(register, opsHandler, tool, onError);
}

export async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: 'panos-mcp', version: '0.1.0' },
    { capabilities: { logging: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  const register = createToolRegistrar({ server, z, toZodShape, annotate, vendorTitle: 'Panos' });
  // Domain handlers handle their own errors; this catch is a last-resort safety net.
  // No hint: an unexpected throw that escaped a domain handler has no
  // known remedy, and guessing "check your credentials" is how an
  // operator ends up debugging a credential that is fine.
  const onHandlerError = (toolName: string, err: unknown) => {
    logger.error('Unhandled error from domain handler', { tool: toolName, err });
    return panosToolError(toolName, err);
  };
  registerNavigationTools(register, getNavigationTools(), 'panos_navigate', navigateTool, statusTool);

  // Progressive disclosure, per docs/panos-connector-design.md "Credential
  // bootstrap": three states rather than the usual on/off gate, because
  // panos_keygen must be reachable with only a username/password so an
  // operator without an API key yet can mint one.
  if (!cleanEnv(process.env.PANOS_HOST)) return server;

  if (!getCredentials()) {
    await registerKeygenIfBootstrappable(register, onHandlerError);
    return server;
  }

  await registerDomainTools(register, DOMAINS, getDomainHandler, onHandlerError);

  return server;
}
