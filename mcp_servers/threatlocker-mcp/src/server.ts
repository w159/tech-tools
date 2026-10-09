import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult as SdkCallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toZodShape } from '@shared/zod-shape.js';
import {
  createToolRegistrar, credentialStatusResult, makeNavigate, registerCredentialGatedTools,
} from '@shared/mcp-server-kit.js';
import { redactSecrets } from '@shared/error-envelope.js';
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
    const body = e.response !== undefined ? ` ${redactSecrets(JSON.stringify(e.response)).slice(0, 200)}` : '';
    return `FAILED${e.statusCode ? ` HTTP ${e.statusCode}` : ''}: ${e.message ?? String(err)}${body}`;
  }
}

const SERVER_INSTRUCTIONS =
  `ThreatLocker application control: computers, computer groups, approval requests, unified audit log, organizations, policies, applications, Config Manager, DAC Health Center, system audit, and tags. Look up IDs with the matching list or search tool (for example computers or approval requests) before calling a get-by-id tool. On a 401, 403, or 440 response, a not-configured message, or a connection failure, call threatlocker_status once and report its output to the user instead of retrying other tools. When credentials are missing only threatlocker_status and threatlocker_navigate are listed; the user must set THREATLOCKER_API_KEY and restart the session.`;

// One-line domain summary, read from the navigate tool's own `domain` description.
function navigateDomainLines(): string[] {
  const navTool = getNavigationTools().find(t => t.name === 'threatlocker_navigate');
  const domainProp = navTool?.inputSchema?.properties?.domain as { description?: string } | undefined;
  return (domainProp?.description ?? '').split('\n');
}

function domainDescription(domain: DomainName): string {
  const domainLine = navigateDomainLines().find((line) => line.includes(`- ${domain}:`));
  return domainLine?.replace(`- ${domain}: `, '') ?? `${domain} domain`;
}

const navigateTool = makeNavigate(DOMAINS, getDomainHandler, domainDescription);

// Status must never throw, even with missing creds.
async function statusTool(): Promise<SdkCallToolResult> {
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

  // Unconfigured is a reduced mode, not an error (see AUDIT_2026-06-12);
  // only a rejected key flips isError.
  return credentialStatusResult({
    vendor: 'ThreatLocker', credStatus, authCheck, domains: DOMAINS, domainsLabel: 'Available domains',
    footer: creds ? 'Domains above are listed by threatlocker_navigate.' : 'Only threatlocker_status and threatlocker_navigate are listed until THREATLOCKER_API_KEY is set and the session is restarted.',
  });
}

export async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: 'threatlocker-mcp', version: '1.5.0' },
    { capabilities: { logging: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  const register = createToolRegistrar({ server, z, toZodShape, annotate, vendorTitle: 'ThreatLocker' });
  await registerCredentialGatedTools({
    register, navigationTools: getNavigationTools(), navigateName: 'threatlocker_navigate',
    navigate: navigateTool, status: statusTool, hasCredentials: () => !!getCredentials(),
    domains: DOMAINS, getHandler: getDomainHandler,
    // Domain handlers handle their own errors; this catch is a last-resort
    // safety net for unexpected throws that escape the handler.
    onError: (toolName, err) => {
      logger.error('Unhandled error from domain handler', { tool: toolName, err });
      return toolErrorFromCatch(toolName, err, {
        hint: 'Check THREATLOCKER_API_KEY is set. Verify THREATLOCKER_BASE_URL if using a non-default region.',
      });
    },
  });

  return server;
}
