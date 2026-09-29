import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials } from '../credentials.js';
import { createAuvikClient } from '../client-factory.js';
import { shapeRaw } from './shared.js';
import { describeBaseUrl } from '@shared/base-url.js';

const AUTH_CHECK_TIMEOUT_MS = 10_000;

export const statusTool: Tool = {
  name: 'auvik_status',
  description:
    'Verify Auvik credentials and connectivity by calling the authentication endpoint; call this first when other tools return auth errors or before running any workflow. Region redirects (308) are followed transparently. (GET /v1/authentication/verify)',
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
      authCheck: 'SKIPPED (no credentials)',
      note: 'AUVIK_USERNAME and AUVIK_API_KEY are not set. Configure them, then re-run auvik_status.',
    });
  }

  const region = c.region || 'us1';
  // Build a custom base-url override string so describeBaseUrl can show the
  // active endpoint. The region env var controls the URL, not AUVIK_BASE_URL.
  const activeUrl = `https://auvikapi.${region}.my.auvik.com/v1`;
  const urlDesc = describeBaseUrl('auvik', process.env.AUVIK_REGION ? activeUrl : undefined, 'AUVIK_REGION');

  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    // One authenticated read, capped at 10 s so status can never hang.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${AUTH_CHECK_TIMEOUT_MS} ms`)), AUTH_CHECK_TIMEOUT_MS);
    });
    await Promise.race([createAuvikClient(c).verify(), timeout]);
    return shapeRaw({
      ok: true,
      hasCredentials: true,
      region,
      baseUrl: urlDesc,
      verified: true,
      authCheck: `OK (HTTP 200, ${Date.now() - started} ms)`,
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
        authCheck: `FAILED${err.status ? ` HTTP ${err.status}` : ''}: ${String(err.message ?? e).slice(0, 200)}`,
        status: err.status,
        message: err.message,
      }),
      isError: true,
    };
  } finally {
    clearTimeout(timer);
  }
}
