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
  description: 'List hardware components (CPUs, disks, fans, power supplies, system boards) across devices; use to check component health or get a component ID before calling auvik_statistics_component. (GET /v1/inventory/component/info)',
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
  description: 'Fetch detail for a single hardware component by ID; use after auvik_components_list when you need the full record for one component. (GET /v1/inventory/component/info/{id})',
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
