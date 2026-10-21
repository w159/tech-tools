import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult as SdkCallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toZodShape } from '@shared/zod-shape.js';
import { cleanEnv } from '@shared/clean-env.js';
import {
  createToolRegistrar, navigateDomain, registerDomainTools, runAuthCheck,
} from '@shared/mcp-server-kit.js';
import { getNavigationTools, DOMAINS, domainLine } from './domains/navigation.js';
import { getDomainHandler } from './domains/index.js';
import { getCredentials, getClient, logoutClient } from './utils/client.js';
import { logger } from './utils/logger.js';
import { search } from './utils/inventory.js';
import type { DomainName } from './utils/types.js';
import { annotate } from './annotate-tool.js';
import { sonicwallToolError } from './domains/_helpers.js';

const SERVER_INSTRUCTIONS =
  'SonicWall firewall management over the SonicOS 7 REST API: system status, objects, policies, interfaces, VPN, logs, and a grounded generic request tool. ' +
  'Every write is staged in the pending config and takes effect only when sonicwall_config_commit is called as a separate step. ' +
  'SonicOS allows a single API session; the server logs in itself and releases it on exit. ' +
  'On 401/403, "not configured", or a connection failure, call sonicwall_status once and report its output to the user instead of retrying other tools. ' +
  'When credentials are missing only sonicwall_status and sonicwall_navigate are listed; the user must set SONICWALL_HOST, SONICWALL_USERNAME and SONICWALL_PASSWORD and restart the session.';

const orNotSet = (value: string): string => value || 'not set';
const NOT_CONFIGURED = 'NOT CONFIGURED - set SONICWALL_HOST, SONICWALL_USERNAME and SONICWALL_PASSWORD';

function readStatusEnv() {
  const verifyRaw = cleanEnv(process.env.SONICWALL_VERIFY_TLS);
  const overrideRaw = cleanEnv(process.env.SONICWALL_SESSION_OVERRIDE);
  const portRaw = cleanEnv(process.env.SONICWALL_PORT);
  return {
    host: cleanEnv(process.env.SONICWALL_HOST),
    username: cleanEnv(process.env.SONICWALL_USERNAME),
    password: cleanEnv(process.env.SONICWALL_PASSWORD),
    portRaw,
    verifyRaw,
    overrideRaw,
    verifyTls: verifyRaw.toLowerCase() !== 'false',
    override: overrideRaw.toLowerCase() === 'true',
  };
}

// Presence plus length, never a prefix: status renders into a transcript that
// is shared and archived, which under the FTC Safeguards Rule and Reg S-P it
// has no business doing. The length answers "did the whole value arrive?".
const describePassword = (pw: string): string => (pw ? `configured (${pw.length} chars)` : 'not set');
const dflt = (raw: string, shown: string): string => `${shown}${raw ? '' : ' (default)'}`;

async function statusTool(): Promise<SdkCallToolResult> {
  const env = readStatusEnv();
  const configured = getCredentials() !== null;
  let authCheck = 'SKIPPED (SONICWALL_HOST, SONICWALL_USERNAME and SONICWALL_PASSWORD not all set)';
  let sessionLine = '';
  if (configured) {
    const client = await getClient();
    authCheck = await runAuthCheck(() => client.request('GET', '/version'), '10s');
    const s = client.session();
    sessionLine = `Session: loggedIn=${s.loggedIn}, bearer=${s.bearer}, re-logins=${s.relogins}${s.startManagementError ? ', start-management failed (tolerated)' : ''}`;
  }
  const lines = [
    'SonicWall MCP Server Status',
    '',
    `Credentials: ${configured ? 'Configured' : NOT_CONFIGURED}`,
    `Auth check: ${authCheck}`,
    ...(sessionLine ? [sessionLine] : []),
    `SONICWALL_HOST: ${orNotSet(env.host)} (no vendor default - the base URL is the appliance itself)`,
    `SONICWALL_PORT: ${dflt(env.portRaw, env.portRaw || '443')}`,
    `SONICWALL_USERNAME: ${orNotSet(env.username)}`,
    `SONICWALL_PASSWORD: ${describePassword(env.password)}`,
    `SONICWALL_VERIFY_TLS: ${dflt(env.verifyRaw, String(env.verifyTls))}`,
    ...(env.verifyTls ? [] : ['WARNING: TLS verification is disabled; the connection is not protected against interception. Install a trusted certificate on the appliance.']),
    `SONICWALL_SESSION_OVERRIDE: ${dflt(env.overrideRaw, String(env.override))}`,
    ...(env.override ? ['WARNING: session override is on; login and config-mode will log out a human admin who holds the session.'] : []),
    `Domains: ${DOMAINS.join(', ')}`,
    '',
    configured
      ? 'Configured: domain tools are listed. Use sonicwall_navigate to discover tools and endpoints.'
      : 'Not configured: only sonicwall_status and sonicwall_navigate are listed until all three credentials are set and the session is restarted.',
  ];
  return { content: [{ type: 'text' as const, text: lines.join('\n') }], isError: authCheck.startsWith('FAILED') };
}

async function navigateTool(args: Record<string, unknown>): Promise<SdkCallToolResult> {
  const terms = typeof args.search === 'string' ? args.search.trim() : '';
  if (terms) {
    const rows = search(terms);
    const text = rows.length
      ? `${rows.length} inventory row(s) (cap 50):\n` + rows.map((r) => `${r.method} ${r.path}  [${r.tag}]`).join('\n') + '\n\nCall sonicwall_request with an exact row, or a curated tool from sonicwall_navigate {domain}.'
      : `No inventory rows match "${terms}". Try fewer or broader terms.`;
    return { content: [{ type: 'text' as const, text }] };
  }
  if (typeof args.domain === 'string' && args.domain) {
    return navigateDomain({
      domains: DOMAINS, domain: args.domain, getHandler: getDomainHandler,
      heading: (d) => `Domain: ${d}`, footer: '\n\nYou can call any of these tools directly.',
    });
  }
  return { content: [{ type: 'text' as const, text: `SonicWall domains:\n${DOMAINS.map(domainLine).join('\n')}\n\nPass domain to list tools, or search to find endpoints in the inventory.` }] };
}

let exitHandlersInstalled = false;
/** The firewall allows one API session; release it however the process ends. */
function installLogoutOnExit(): void {
  if (exitHandlersInstalled) return;
  exitHandlersInstalled = true;
  const bye = () => { void logoutClient().finally(() => process.exit(0)); };
  process.once('SIGINT', bye);
  process.once('SIGTERM', bye);
  process.on('beforeExit', () => { void logoutClient(); });
}

export async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: 'sonicwall-mcp', version: '0.1.0' },
    { capabilities: { logging: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  installLogoutOnExit();

  const register = createToolRegistrar({ server, z, toZodShape, annotate, vendorTitle: 'Sonicwall' });
  // Domain handlers report their own errors; this is the last-resort net. No
  // hint: an unexpected throw has no known remedy, and guessing "check your
  // credentials" is how an operator ends up debugging a credential that is fine.
  const onHandlerError = (toolName: string, err: unknown) => {
    logger.error('Unhandled error from domain handler', { tool: toolName, err });
    return sonicwallToolError(toolName, err);
  };

  for (const tool of getNavigationTools()) {
    register(tool, tool.name === 'sonicwall_navigate' ? (args) => navigateTool(args) : () => statusTool());
  }

  // Progressive disclosure: host, username and password all resolve, or only status + navigate.
  if (getCredentials() === null) return server;
  await registerDomainTools<DomainName>(register, DOMAINS, getDomainHandler, onHandlerError);
  return server;
}
