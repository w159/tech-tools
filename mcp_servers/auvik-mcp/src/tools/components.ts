import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { withClient, tenantsProp, pageProps, COMPONENT_CURRENT_STATUSES } from './shared.js';

export const componentsListTool: Tool = {
  name: 'auvik_components_list',
  description: 'GET /v1/inventory/component/info — list device components (CPUs, disks, fans, power supplies, system boards).',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      filter_deviceId: { type: 'string', description: 'filter[deviceId] — components belonging to this device.' },
      filter_deviceName: { type: 'string', description: 'filter[deviceName].' },
      filter_currentStatus: {
        type: 'string',
        enum: [...COMPONENT_CURRENT_STATUSES],
        description: 'filter[currentStatus] — ok / degraded / failed.',
      },
      filter_modifiedAfter: { type: 'string', description: 'filter[modifiedAfter] ISO 8601.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const componentsGetTool: Tool = {
  name: 'auvik_components_get',
  description: 'GET /v1/inventory/component/info/{id} — single component.',
  inputSchema: {
    type: 'object',
    properties: { componentId: { type: 'string', description: 'Auvik component ID.' } },
    required: ['componentId'],
    additionalProperties: false,
  },
};

export const handleComponentsList = (args: Record<string, unknown>) => withClient((c) => c.components.list(args));
export const handleComponentsGet = (args: { componentId: string }) =>
  withClient((c) => c.components.get(args.componentId));
