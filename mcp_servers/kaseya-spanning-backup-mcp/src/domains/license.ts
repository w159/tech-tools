import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeRaw,
  toolErrorFromCatch,
  unknownTool,
} from './_helpers.js';

function getTools(): Tool[] {
  return [
    {
      name: 'spanning_license_get',
      description:
        'Returns current Spanning licence and seat usage for the connected org: total seats, used seats, and licence type. ' +
        'Use for capacity planning or billing verification.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
  ];
}

async function handleCall(toolName: string, _args: Record<string, unknown>): Promise<CallToolResult> {
  switch (toolName) {
    case 'spanning_license_get': {
      try {
        const client = getClient();
        logger.info('API call: license.get');
        const result = await client.license.get();
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch('spanning_license_get', err, {
          hint: 'Verify SPANNING_ADMIN_EMAIL and SPANNING_API_TOKEN are correct.',
        });
      }
    }

    default:
      return unknownTool(toolName);
  }
}

export const licenseHandler: DomainHandler = { getTools, handleCall };
