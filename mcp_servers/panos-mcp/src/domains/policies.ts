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

// REST policy resources under /restapi/{version}/Policies/{Resource}.
// Reference: https://docs.paloaltonetworks.com/pan-os/10-1/pan-os-panorama-api/get-started-with-the-pan-os-rest-api/work-with-policy-rules-on-panorama-rest-api
const RESOURCE_ENUM = [
  'SecurityRules',
  'NATRules',
  'DecryptionRules',
  'ApplicationOverrideRules',
  'AuthenticationRules',
] as const;
type Resource = (typeof RESOURCE_ENUM)[number];

// PAN-OS REST requires `location` on every call, plus the companion argument
// that location implies. Same location semantics as the objects domain.
const LOCATION_ENUM = ['vsys', 'device-group', 'shared', 'panorama-pushed', 'template', 'predefined'] as const;

const LOCATION_DESC =
  'Mandatory on every PAN-OS REST call. Which scope the rule lives in. ' +
  '"vsys" requires vsys (e.g. "vsys1") on a firewall. "device-group" requires deviceGroup on Panorama (Pre/Post rulebase). ' +
  '"template" requires template. ' +
  '"shared", "panorama-pushed", and "predefined" take no companion. ' +
  'Getting this wrong writes the rule into the wrong rulebase silently - never default it.';

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
 * that mapping wrong and the query parameter is never sent, which lands the rule
 * in the default rulebase instead of the requested one.
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

/** REST resource name -> the rulebase node name the XML config tree uses. */
const RULEBASE_NODE: Record<Resource, string> = {
  SecurityRules: 'security',
  NATRules: 'nat',
  DecryptionRules: 'decryption',
  ApplicationOverrideRules: 'application-override',
  AuthenticationRules: 'authentication',
};

/**
 * Build the xpath of a single rule for the XML `action=move`.
 *
 * Palo Alto's public REST documentation does not specify a move endpoint, so
 * move goes over the documented XML config API instead. The xpath is composed
 * here from validated arguments and never authored by the model, so the
 * grounding rule still holds.
 */
function ruleXpath(resource: Resource, name: string, args: Record<string, unknown>): string {
  const node = RULEBASE_NODE[resource];
  const location = args.location as string;
  const rulebase = (args.rulebase as string) ?? 'pre-rulebase';
  const rule = `${node}/rules/entry[@name='${name}']`;
  const device = "/config/devices/entry[@name='localhost.localdomain']";

  switch (location) {
    case 'vsys':
      return `${device}/vsys/entry[@name='${args.vsys as string}']/rulebase/${rule}`;
    case 'device-group':
      return `${device}/device-group/entry[@name='${args.deviceGroup as string}']/${rulebase}/${rule}`;
    case 'shared':
      return `/config/shared/${rulebase}/${rule}`;
    default:
      throw new Error(
        `panos_policies_move supports location=vsys, device-group, or shared. Got "${location}". ` +
          'Other locations have no writable rulebase xpath.',
      );
  }
}

/** PAN-OS REST returns attributes with an '@' prefix; summarize a rule by them. */
const ruleSummary = (e: Record<string, unknown>) => ({
  name: e['@name'],
  location: e['@location'],
  action: e.action,
});

const RESOURCE_PROP = {
  resource: {
    type: 'string',
    enum: [...RESOURCE_ENUM],
    description: 'The REST policy type: SecurityRules, NATRules, DecryptionRules, ApplicationOverrideRules, or AuthenticationRules.',
  },
};

const BODY_EXAMPLE =
  'Example body for resource=SecurityRules: ' +
  '{"entry":[{"@name":"allow-dns","@location":"device-group","@device-group":"dg-1",' +
  '"from":{"member":["any"]},"to":{"member":["any"]},"source":{"member":["any"]},' +
  '"destination":{"member":["any"]},"application":{"member":["dns"]},"service":{"member":["application-default"]},' +
  '"action":"allow"}]}';

function getTools(): Tool[] {
  return [
    readOnlyTool({
      name: 'panos_policies_list',
      description: 'List PAN-OS REST policy rules of a given resource type at a given location, in rule order. Returns the raw entry array from the REST response.',
      inputSchema: {
        type: 'object' as const,
        properties: { ...RESOURCE_PROP, ...LOCATION_PROPS, ...SHAPE_PROPS, ...TARGET_PROP },
        required: ['resource', 'location'],
      },
    }),
    readOnlyTool({
      name: 'panos_policies_get',
      description: 'Get a single PAN-OS REST policy rule by name, resource type, and location.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...RESOURCE_PROP,
          name: { type: 'string', description: 'Rule name (required).' },
          ...LOCATION_PROPS,
          ...SHAPE_PROPS,
          ...TARGET_PROP,
        },
        required: ['resource', 'name', 'location'],
      },
    }),
    destructiveTool({
      name: 'panos_policies_create',
      description:
        `Create a PAN-OS REST policy rule. This writes to the candidate config only - it does not commit; call panos_commit separately to push the change live. New rules land at the end of the rulebase; use panos_policies_move to reposition. ${BODY_EXAMPLE}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...RESOURCE_PROP,
          name: { type: 'string', description: 'Rule name (required).' },
          ...LOCATION_PROPS,
          body: { type: 'object', description: `The REST entry body. ${BODY_EXAMPLE}` },
          ...TARGET_PROP,
        },
        required: ['resource', 'name', 'location', 'body'],
      },
    }),
    destructiveTool({
      name: 'panos_policies_update',
      description:
        `Update an existing PAN-OS REST policy rule. This writes to the candidate config only - it does not commit; call panos_commit separately to push the change live. Fetch the rule with panos_policies_get first and modify that body rather than composing one from memory. ${BODY_EXAMPLE}`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...RESOURCE_PROP,
          name: { type: 'string', description: 'Rule name (required).' },
          ...LOCATION_PROPS,
          body: { type: 'object', description: `The full replacement REST entry body. ${BODY_EXAMPLE}` },
          ...TARGET_PROP,
        },
        required: ['resource', 'name', 'location', 'body'],
      },
    }),
    destructiveTool({
      name: 'panos_policies_delete',
      description:
        'Delete a PAN-OS REST policy rule. This writes to the candidate config only - it does not commit; call panos_commit separately to push the change live.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...RESOURCE_PROP,
          name: { type: 'string', description: 'Rule name (required).' },
          ...LOCATION_PROPS,
          ...TARGET_PROP,
        },
        required: ['resource', 'name', 'location'],
      },
    }),
    destructiveTool({
      name: 'panos_policies_move',
      description:
        'Reorder a policy rule within its rulebase. This writes to the candidate config only - it does not commit; call panos_commit separately to push the change live. ' +
        'where=top or where=bottom move the rule to either end of the rulebase and take no dst. ' +
        'where=before or where=after require dst naming the rule to move relative to. ' +
        'Unlike the other policy tools this one uses the XML config API, because Palo Alto publishes no REST move endpoint. ' +
        'The rule xpath is built from resource, name, location, and rulebase - do not pass an xpath. ' +
        'Supports location=vsys, device-group, and shared only; the other locations have no writable rulebase.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...RESOURCE_PROP,
          name: { type: 'string', description: 'Rule name to move (required).' },
          ...LOCATION_PROPS,
          rulebase: {
            type: 'string',
            enum: ['pre-rulebase', 'post-rulebase'],
            description: 'Which Panorama rulebase the rule lives in. Applies to location=device-group and location=shared; ignored for location=vsys. Defaults to pre-rulebase.',
          },
          where: { type: 'string', enum: ['top', 'bottom', 'before', 'after'], description: 'Move destination relative to the rulebase or to dst (required).' },
          dst: { type: 'string', description: 'Rule name to move before/after. Required when where is "before" or "after".' },
          ...TARGET_PROP,
        },
        required: ['resource', 'name', 'location', 'where'],
      },
    }),
  ];
}

async function handleCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  const resource = args.resource as Resource;
  const category = 'Policies';
  const target = args.target as string | undefined;

  try {
    switch (toolName) {
      case 'panos_policies_list': {
        logger.info('API call: rest.list', { category, resource, ...args });
        const result = await client.rest.list(category, resource, buildLocation(args));
        const entries = ((result as { result?: { entry?: unknown[] } })?.result?.entry ?? []) as Record<string, unknown>[];
        return shapeList(entries, ruleSummary, shapeArgs);
      }
      case 'panos_policies_get': {
        const item = await client.rest.get(category, resource, args.name as string, buildLocation(args));
        const entry = ((item as { result?: { entry?: unknown[] } })?.result?.entry?.[0] ?? item) as Record<string, unknown>;
        return shapeItem(entry, ruleSummary, shapeArgs);
      }
      case 'panos_policies_create': {
        const result = await client.rest.create(category, resource, args.name as string, args.body, buildLocation(args));
        return jsonResult(result);
      }
      case 'panos_policies_update': {
        const result = await client.rest.update(category, resource, args.name as string, args.body, buildLocation(args));
        return jsonResult(result);
      }
      case 'panos_policies_delete': {
        const result = await client.rest.remove(category, resource, args.name as string, buildLocation(args));
        return jsonResult(result);
      }
      case 'panos_policies_move': {
        const where = args.where as string;
        const dst = args.dst as string | undefined;
        if ((where === 'before' || where === 'after') && !dst) {
          throw new Error('where="before"/"after" requires dst naming the rule to move relative to.');
        }
        // Call buildLocation for its validation: it is what enforces that
        // location=vsys carries vsys and location=device-group carries
        // deviceGroup. Without it, ruleXpath would splice "undefined" into the
        // xpath and move the rule in a scope nobody asked for.
        buildLocation(args);
        const xpath = ruleXpath(resource, args.name as string, args);
        logger.info('API call: config.move', { xpath, where, dst, target });
        const result = await client.config('move', { xpath, where, dst, target });
        return jsonResult(result);
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
    }
  } catch (err) {
    return panosToolError(toolName, err, {
      hint: 'Verify the rule name and `location` (with its vsys/deviceGroup/template companion) against panos_policies_list for this rulebase.',
    });
  }
}

export const policiesHandler: DomainHandler = { getTools, handleCall };
