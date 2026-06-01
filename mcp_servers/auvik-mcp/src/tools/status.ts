import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials } from '../credentials.js';
import { createAuvikClient } from '../client-factory.js';

export const statusTool: Tool = {
  name: 'auvik_status',
  description:
    'Preflight check. Reports whether Auvik credentials are configured and, if so, hits GET /v1/authentication/verify to confirm they work (308 region redirects are followed transparently). Call this first if other tools return auth errors.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

export async function handleStatus() {
  const c = getCredentials();
  if (!c) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              ok: true,
              hasCredentials: false,
              region: null,
              note: 'No Auvik credentials configured. Set AUVIK_USERNAME and AUVIK_API_KEY (and optionally AUVIK_REGION).',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const region = c.region || 'us1';
  try {
    await createAuvikClient(c).verify();
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              ok: true,
              hasCredentials: true,
              region,
              verified: true,
              note: 'authentication/verify returned 200. The server auto-follows 308 region redirects on every call.',
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              ok: false,
              hasCredentials: true,
              region,
              verified: false,
              status: err.status,
              message: err.message,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}
