import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList, extractShapeArgs, SHAPE_PROPS,
  toolErrorFromCatch, withSummary,
  type SummaryFn,
} from './_helpers.js';

const tagSummary: SummaryFn = (item: Record<string, unknown>) => ({
  name: item.label,
});

function getTools(): Tool[] {
  return [
    {
      name: 'threatlocker_tags_list',
      description: 'List ThreatLocker tags by name as {label, value} options (value is the tag GUID). Set includeBuiltIns to also list ThreatLocker built-in tags.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...SHAPE_PROPS,
          includeBuiltIns: { type: 'boolean', description: 'Include built-in ThreatLocker tags (default false).' },
        },
      },
    },
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const shapeArgs = extractShapeArgs(args);
  if (toolName !== 'threatlocker_tags_list') {
    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
  }
  const includeBuiltIns = args.includeBuiltIns === true;
  logger.info('API call: tags.list', { includeBuiltIns });
  try {
    const client = await getClient();
    const tags = await client.tags.list(includeBuiltIns);
    return withSummary(shapeList(tags, tagSummary, shapeArgs), { tags: tags.length, includeBuiltIns });
  } catch (err) {
    return toolErrorFromCatch(toolName, err, { hint: 'Call threatlocker_status to confirm the key and instance letter.' });
  }
}

export const tagsHandler: DomainHandler = { getTools, handleCall };