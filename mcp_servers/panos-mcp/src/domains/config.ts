import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import { TARGET_PROP, destructiveTool, panosToolError, jsonResult, readOnlyTool } from './_helpers.js';

// Grounding sentence required on every xpath-taking write tool by
// docs/panos-connector-design.md safety rule 3.
const GROUNDING =
  'Ground the xpath with panos_config_show or panos_config_complete before calling this. Do not compose an xpath from memory.';
// Safety rule 2: writes touch the candidate config only, never the running config.
const CANDIDATE_ONLY =
  'Changes the candidate config only. Call panos_commit as a separate step to push them live.';

function getTools(): Tool[] {
  return [
    readOnlyTool({
      name: 'panos_config_show',
      description: 'Show the running configuration (the config currently active on the device) at an xpath, or the whole tree if xpath is omitted.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          xpath: { type: 'string', description: 'Optional xpath to a portion of the running configuration.' },
          ...TARGET_PROP,
        },
      },
    }),
    readOnlyTool({
      name: 'panos_config_get',
      description: 'Get the candidate configuration (proposed, uncommitted changes) at an xpath, or the whole tree if xpath is omitted. Uncommitted entries carry admin/time/oldname attributes.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          xpath: { type: 'string', description: 'Optional xpath to a portion of the candidate configuration.' },
          ...TARGET_PROP,
        },
      },
    }),
    readOnlyTool({
      name: 'panos_config_complete',
      description: 'List the possible child values available at an xpath node. Use this (or panos_config_show) to ground an xpath before any write tool instead of composing one from memory.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          xpath: { type: 'string', description: 'Required xpath node to enumerate children for.' },
          ...TARGET_PROP,
        },
        required: ['xpath'],
      },
    }),
    destructiveTool({
      name: 'panos_config_set',
      description: `Create or replace a configuration node at an xpath with an XML element. ${CANDIDATE_ONLY} ${GROUNDING}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          xpath: { type: 'string', description: 'Required xpath to the location to set.' },
          element: { type: 'string', description: 'Required XML fragment for the new element contents.' },
          ...TARGET_PROP,
        },
        required: ['xpath', 'element'],
      },
    }),
    destructiveTool({
      name: 'panos_config_edit',
      description: `Replace the entire contents of an existing configuration node at an xpath with an XML element. Unlike set, edit fully overwrites the node rather than merging. ${CANDIDATE_ONLY} ${GROUNDING}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          xpath: { type: 'string', description: 'Required xpath to the node to replace.' },
          element: { type: 'string', description: 'Required XML fragment for the replacement contents.' },
          ...TARGET_PROP,
        },
        required: ['xpath', 'element'],
      },
    }),
    destructiveTool({
      name: 'panos_config_delete',
      description: `Delete the configuration object or node at an xpath. ${CANDIDATE_ONLY} ${GROUNDING}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          xpath: { type: 'string', description: 'Required xpath to the object or node to delete.' },
          ...TARGET_PROP,
        },
        required: ['xpath'],
      },
    }),
    destructiveTool({
      name: 'panos_config_rename',
      description: `Rename the configuration object at an xpath. ${CANDIDATE_ONLY} ${GROUNDING}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          xpath: { type: 'string', description: 'Required xpath to the object to rename.' },
          newname: { type: 'string', description: 'Required new name for the object.' },
          ...TARGET_PROP,
        },
        required: ['xpath', 'newname'],
      },
    }),
    destructiveTool({
      name: 'panos_config_clone',
      description: `Clone an existing configuration object into a new sibling object. ${CANDIDATE_ONLY} ${GROUNDING}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          xpath: { type: 'string', description: 'Required xpath to the parent location that will hold the clone.' },
          from: { type: 'string', description: 'Required xpath to the source object to clone.' },
          newname: { type: 'string', description: 'Required name for the cloned object.' },
          ...TARGET_PROP,
        },
        required: ['xpath', 'from', 'newname'],
      },
    }),
    destructiveTool({
      name: 'panos_config_move',
      description: `Move the location of an existing configuration object (for example, a security rule's order within a rulebase). ${CANDIDATE_ONLY} ${GROUNDING}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          xpath: { type: 'string', description: 'Required xpath to the object to move.' },
          where: { type: 'string', enum: ['before', 'after', 'top', 'bottom'], description: 'Required type of move.' },
          dst: { type: 'string', description: "Destination object name for relative moves. Required when where is 'before' or 'after'." },
          ...TARGET_PROP,
        },
        required: ['xpath', 'where'],
      },
    }),
    destructiveTool({
      name: 'panos_config_override',
      description: `Override a setting on a managed firewall that was pushed from a Panorama template. ${CANDIDATE_ONLY} ${GROUNDING}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          xpath: { type: 'string', description: 'Required xpath to the templated object to override.' },
          element: { type: 'string', description: 'Required XML fragment for the override contents.' },
          ...TARGET_PROP,
        },
        required: ['xpath', 'element'],
      },
    }),
    destructiveTool({
      name: 'panos_config_multi_move',
      description: `Move address objects across device groups or virtual systems in one call (templates do not support this). ${CANDIDATE_ONLY} ${GROUNDING}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          xpath: { type: 'string', description: 'Required xpath to the destination location for the moved objects.' },
          element: { type: 'string', description: 'Required XML fragment: a <selected-list><source xpath="...">...member entries...</source></selected-list> block naming the source location and members to move.' },
          ...TARGET_PROP,
        },
        required: ['xpath', 'element'],
      },
    }),
    destructiveTool({
      name: 'panos_config_multi_clone',
      description: `Clone address objects across device groups or virtual systems in one call (templates do not support this). ${CANDIDATE_ONLY} ${GROUNDING}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          xpath: { type: 'string', description: 'Required xpath to the destination location for the cloned objects.' },
          element: { type: 'string', description: 'Required XML fragment: a <selected-list><source xpath="...">...member entries...</source></selected-list> block naming the source location and members to clone.' },
          ...TARGET_PROP,
        },
        required: ['xpath', 'element'],
      },
    }),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const target = args.target as string | undefined;
  const hint = { hint: 'Ground the xpath with panos_config_show or panos_config_complete first.' };
  try {
    switch (toolName) {
      case 'panos_config_show': {
        logger.info('API call: config.show', args);
        const result = await client.config('show', { xpath: args.xpath as string | undefined, target });
        return jsonResult(result);
      }
      case 'panos_config_get': {
        logger.info('API call: config.get', args);
        const result = await client.config('get', { xpath: args.xpath as string | undefined, target });
        return jsonResult(result);
      }
      case 'panos_config_complete': {
        logger.info('API call: config.complete', args);
        const result = await client.config('complete', { xpath: args.xpath as string, target });
        return jsonResult(result);
      }
      case 'panos_config_set': {
        logger.info('API call: config.set', { xpath: args.xpath, target });
        const result = await client.config('set', { xpath: args.xpath as string, element: args.element as string, target });
        return jsonResult(result);
      }
      case 'panos_config_edit': {
        logger.info('API call: config.edit', { xpath: args.xpath, target });
        const result = await client.config('edit', { xpath: args.xpath as string, element: args.element as string, target });
        return jsonResult(result);
      }
      case 'panos_config_delete': {
        logger.info('API call: config.delete', { xpath: args.xpath, target });
        const result = await client.config('delete', { xpath: args.xpath as string, target });
        return jsonResult(result);
      }
      case 'panos_config_rename': {
        logger.info('API call: config.rename', { xpath: args.xpath, target });
        const result = await client.config('rename', { xpath: args.xpath as string, newname: args.newname as string, target });
        return jsonResult(result);
      }
      case 'panos_config_clone': {
        logger.info('API call: config.clone', { xpath: args.xpath, target });
        const result = await client.config('clone', {
          xpath: args.xpath as string,
          from: args.from as string,
          newname: args.newname as string,
          target,
        });
        return jsonResult(result);
      }
      case 'panos_config_move': {
        logger.info('API call: config.move', { xpath: args.xpath, target });
        const result = await client.config('move', {
          xpath: args.xpath as string,
          where: args.where as string,
          dst: args.dst as string | undefined,
          target,
        });
        return jsonResult(result);
      }
      case 'panos_config_override': {
        logger.info('API call: config.override', { xpath: args.xpath, target });
        const result = await client.config('override', { xpath: args.xpath as string, element: args.element as string, target });
        return jsonResult(result);
      }
      case 'panos_config_multi_move': {
        logger.info('API call: config.multi-move', { xpath: args.xpath, target });
        const result = await client.config('multi-move', { xpath: args.xpath as string, element: args.element as string, target });
        return jsonResult(result);
      }
      case 'panos_config_multi_clone': {
        logger.info('API call: config.multi-clone', { xpath: args.xpath, target });
        const result = await client.config('multi-clone', { xpath: args.xpath as string, element: args.element as string, target });
        return jsonResult(result);
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
    }
  } catch (err) {
    return panosToolError(toolName, err, hint);
  }
}

export const configHandler: DomainHandler = { getTools, handleCall };
