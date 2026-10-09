import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { RestLocation } from 'node-panos';
import type { DomainHandler, CallToolResult } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { logger } from '../utils/logger.js';
import {
  shapeList,
  shapeItem,
  extractShapeArgs,
  SHAPE_PROPS,
  panosToolError,
  destructiveTool,
  TARGET_PROP,
  jsonResult,
  readOnlyTool,
} from './_helpers.js';

// REST object resources under /restapi/{version}/Objects/{Resource}.
// Reference: https://docs.paloaltonetworks.com/ngfw/api/pan-os-rest-api-use-cases/work-with-address-objects-rest-api
const RESOURCE_ENUM = [
  'Addresses',
  'AddressGroups',
  'Services',
  'ServiceGroups',
  'Tags',
  'ApplicationGroups',
  'ExternalDynamicLists',
] as const;
type Resource = (typeof RESOURCE_ENUM)[number];

// PAN-OS REST requires `location` on every call, plus the companion argument
// that location implies. Reference: same page as above, "Get Address Objects".
const LOCATION_ENUM = ['vsys', 'device-group', 'shared', 'panorama-pushed', 'template', 'predefined'] as const;

const LOCATION_DESC =
  'Mandatory on every PAN-OS REST call. Which scope the object lives in. ' +
  '"vsys" requires vsys (e.g. "vsys1") on a firewall. "device-group" requires deviceGroup on Panorama. ' +
  '"template" requires template. ' +
  '"shared", "panorama-pushed", and "predefined" take no companion. ' +
  'Getting this wrong writes the object into the wrong scope silently - never default it.';

const LOCATION_PROPS = {
  location: { type: 'string', enum: [...LOCATION_ENUM], description: LOCATION_DESC },
  vsys: { type: 'string', description: 'Required when location=vsys, e.g. "vsys1".' },
  deviceGroup: { type: 'string', description: 'Required when location=device-group.' },
  template: { type: 'string', description: 'Required when location=template.' },
};

/**
 * Build the node-panos RestLocation from the tool's location args, failing loud
 * on a missing companion.
 *
 * Tool arguments are camelCase for the model; RestLocation carries PAN-OS's own
 * wire spelling, so `deviceGroup` maps to the hyphenated `device-group` key. Get
 * that mapping wrong and the query parameter is simply never sent, which lands
 * the object in the default scope instead of the requested one.
 */
function buildLocation(args: Record<string, unknown>): RestLocation {
  const location = args.location as RestLocation['location'] | undefined;
  if (!location) throw new Error('location is required (vsys | device-group | shared | panorama-pushed | template | predefined).');
  if (location === 'vsys' && !args.vsys) throw new Error('location=vsys requires vsys (e.g. "vsys1").');
  if (location === 'device-group' && !args.deviceGroup) throw new Error('location=device-group requires deviceGroup.');
  if (location === 'template' && !args.template) throw new Error('location=template requires template.');
  return {
    location,
    vsys: args.vsys as string | undefined,
    'device-group': args.deviceGroup as string | undefined,
    template: args.template as string | undefined,
    target: args.target as string | undefined,
  };
}

/** PAN-OS REST returns attributes with an '@' prefix; summarize an entry by them. */
const entrySummary = (e: Record<string, unknown>) => ({
  name: e['@name'],
  location: e['@location'],
});

const RESOURCE_PROP = {
  resource: {
    type: 'string',
    enum: [...RESOURCE_ENUM],
    description: 'The REST object type: Addresses, AddressGroups, Services, ServiceGroups, Tags, ApplicationGroups, or ExternalDynamicLists.',
  },
};

const BODY_EXAMPLE =
  'Example body for resource=Addresses: ' +
  '{"entry":[{"@name":"web-servers-production","@location":"shared","ip-netmask":"10.2.1.4/32","description":"prod web tier"}]}';

function getTools(): Tool[] {
  return [
    readOnlyTool({
      name: 'panos_objects_list',
      description: 'List PAN-OS REST objects of a given resource type at a given location. Returns the raw entry array from the REST response.',
      inputSchema: {
        type: 'object' as const,
        properties: { ...RESOURCE_PROP, ...LOCATION_PROPS, ...SHAPE_PROPS, ...TARGET_PROP },
        required: ['resource', 'location'],
      },
    }),
    readOnlyTool({
      name: 'panos_objects_get',
      description: 'Get a single PAN-OS REST object by name, resource type, and location.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...RESOURCE_PROP,
          name: { type: 'string', description: 'Object name (required).' },
          ...LOCATION_PROPS,
          ...SHAPE_PROPS,
          ...TARGET_PROP,
        },
        required: ['resource', 'name', 'location'],
      },
    }),
    destructiveTool({
      name: 'panos_objects_create',
      description:
        `Create a PAN-OS REST object. This writes to the candidate config only - it does not commit; call panos_commit separately to push the change live. ${BODY_EXAMPLE}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...RESOURCE_PROP,
          name: { type: 'string', description: 'Object name (required).' },
          ...LOCATION_PROPS,
          body: { type: 'object', description: `The REST entry body. ${BODY_EXAMPLE}` },
          ...TARGET_PROP,
        },
        required: ['resource', 'name', 'location', 'body'],
      },
    }),
    destructiveTool({
      name: 'panos_objects_update',
      description:
        `Update an existing PAN-OS REST object. This writes to the candidate config only - it does not commit; call panos_commit separately to push the change live. Fetch the object with panos_objects_get first and modify that body rather than composing one from memory. ${BODY_EXAMPLE}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...RESOURCE_PROP,
          name: { type: 'string', description: 'Object name (required).' },
          ...LOCATION_PROPS,
          body: { type: 'object', description: `The full replacement REST entry body. ${BODY_EXAMPLE}` },
          ...TARGET_PROP,
        },
        required: ['resource', 'name', 'location', 'body'],
      },
    }),
    destructiveTool({
      name: 'panos_objects_delete',
      description:
        'Delete a PAN-OS REST object. This writes to the candidate config only - it does not commit; call panos_commit separately to push the change live.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...RESOURCE_PROP,
          name: { type: 'string', description: 'Object name (required).' },
          ...LOCATION_PROPS,
          ...TARGET_PROP,
        },
        required: ['resource', 'name', 'location'],
      },
    }),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  const resource = args.resource as Resource;
  const category = 'Objects';

  try {
    switch (toolName) {
      case 'panos_objects_list': {
        logger.info('API call: rest.list', { category, resource, ...args });
        const result = await client.rest.list(category, resource, buildLocation(args));
        const entries = ((result as { result?: { entry?: unknown[] } })?.result?.entry ?? []) as Record<string, unknown>[];
        return shapeList(entries, entrySummary, shapeArgs);
      }
      case 'panos_objects_get': {
        const item = await client.rest.get(category, resource, args.name as string, buildLocation(args));
        const entry = ((item as { result?: { entry?: unknown[] } })?.result?.entry?.[0] ?? item) as Record<string, unknown>;
        return shapeItem(entry, entrySummary, shapeArgs);
      }
      case 'panos_objects_create': {
        const result = await client.rest.create(category, resource, args.name as string, args.body, buildLocation(args));
        return jsonResult(result);
      }
      case 'panos_objects_update': {
        const result = await client.rest.update(category, resource, args.name as string, args.body, buildLocation(args));
        return jsonResult(result);
      }
      case 'panos_objects_delete': {
        const result = await client.rest.remove(category, resource, args.name as string, buildLocation(args));
        return jsonResult(result);
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
    }
  } catch (err) {
    return panosToolError(toolName, err, {
      hint: 'Verify the object name and `location` (with its vsys/deviceGroup/template companion) against panos_objects_list for this type.',
    });
  }
}

export const objectsHandler: DomainHandler = { getTools, handleCall };
