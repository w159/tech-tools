import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClientList,
  withClientItem,
  extractShapeArgs,
  SHAPE_PROPS,
  tenantsProp,
  pageProps,
  COMPONENT_CURRENT_STATUSES,
  type SummaryFn,
  type FlatResource,
} from './shared.js';

const componentSummary: SummaryFn<FlatResource> = (c: FlatResource) => ({
  id: c.id,
  componentName: c.componentName,
  componentType: c.componentType,
  currentStatus: c.currentStatus,
  deviceName: c.deviceName,
});

export const componentsListTool: Tool = {
  name: 'auvik_components_list',
  description: 'GET /v1/inventory/component/info — list device components (CPUs, disks, fans, power supplies, system boards). Returns compact summary (id, componentName, componentType, currentStatus, deviceName) by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
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
  description: 'GET /v1/inventory/component/info/{id} — single component. Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      componentId: { type: 'string', description: 'Auvik component ID.' },
      ...SHAPE_PROPS,
    },
    required: ['componentId'],
    additionalProperties: false,
  },
};

export const handleComponentsList = (args: Record<string, unknown>) =>
  withClientList((c) => c.components.list(args), componentSummary, extractShapeArgs(args), 'auvik_components_list');

export const handleComponentsGet = (args: { componentId: string } & Record<string, unknown>) =>
  withClientItem((c) => c.components.get(args.componentId), componentSummary, extractShapeArgs(args), 'auvik_components_get');
