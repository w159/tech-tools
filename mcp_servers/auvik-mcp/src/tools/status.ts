import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials } from '../credentials.js';
import { createAuvikClient } from '../client-factory.js';
import { shapeRaw } from './shared.js';
import { describeBaseUrl } from '../../../_shared/base-url.js';

export const statusTool: Tool = {
  name: 'auvik_status',
  description:
    'Preflight check. Reports whether Auvik credentials are configured and, if so, hits GET /v1/authentication/verify to confirm they work (308 region redirects are followed transparently). Call this first if other tools return auth errors.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

export async function handleStatus() {
  const c = getCredentials();
  if (!c) {
    // Boot/preflight must never throw or error when creds are absent. Report the
    // missing-creds state as a successful status read so an agent can act on it.
    return shapeRaw({
      ok: true,
      hasCredentials: false,
      region: null,
      baseUrl: describeBaseUrl('auvik', undefined, 'AUVIK_REGION'),
      verified: false,
      note: 'AUVIK_USERNAME and AUVIK_API_KEY are not set. Configure them, then re-run auvik_status.',
    });
  }

  const region = c.region || 'us1';
  // Build a custom base-url override string so describeBaseUrl can show the
  // active endpoint. The region env var controls the URL, not AUVIK_BASE_URL.
  const activeUrl = `https://auvikapi.${region}.my.auvik.com/v1`;
  const urlDesc = describeBaseUrl('auvik', process.env.AUVIK_REGION ? activeUrl : undefined, 'AUVIK_REGION');

  try {
    await createAuvikClient(c).verify();
    return shapeRaw({
      ok: true,
      hasCredentials: true,
      region,
      baseUrl: urlDesc,
      verified: true,
      note: 'authentication/verify returned 200. The server auto-follows 308 region redirects on every call.',
    });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    // Surface verification failures as an error result (isError: true) so callers
    // can branch on it, while still returning the diagnostic payload as JSON.
    return {
      ...shapeRaw({
        ok: false,
        hasCredentials: true,
        region,
        baseUrl: urlDesc,
        verified: false,
        status: err.status,
        message: err.message,
      }),
      isError: true,
    };
  }
}
