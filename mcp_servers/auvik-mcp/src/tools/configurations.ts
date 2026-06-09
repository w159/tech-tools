import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClientList,
  withClientItem,
  extractShapeArgs,
  SHAPE_PROPS,
  tenantsProp,
  pageProps,
  type SummaryFn,
  type FlatResource,
} from './shared.js';

const configSummary: SummaryFn<FlatResource> = (c: FlatResource) => ({
  id: c.id,
  backupTime: c.backupTime,
  isRunning: c.isRunning,
  deviceId: (c.relationships as Record<string, unknown> | undefined) &&
    ((c.relationships as Record<string, unknown>)['device'] as Record<string, unknown> | undefined) &&
    (((c.relationships as Record<string, unknown>)['device'] as Record<string, unknown>)['data'] as Record<string, unknown> | undefined)?.id,
});

export const configurationsListTool: Tool = {
  name: 'auvik_configurations_list',
  description: 'GET /v1/inventory/configuration — list device configuration backup records (backupTime, isRunning, device relationship). Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
      filter_deviceId: { type: 'string', description: 'filter[deviceId] — only configs for this device.' },
      filter_backupTimeAfter: { type: 'string', description: 'filter[backupTimeAfter] ISO 8601.' },
      filter_backupTimeBefore: { type: 'string', description: 'filter[backupTimeBefore] ISO 8601.' },
      filter_isRunning: { type: 'boolean', description: 'filter[isRunning] — true=running config (vs. startup/saved).' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const configurationsGetTool: Tool = {
  name: 'auvik_configurations_get',
  description: 'GET /v1/inventory/configuration/{id} — single configuration backup record (includes the config text). Returns compact summary by default; pass full=true or fields=[...] to retrieve config text.',
  inputSchema: {
    type: 'object',
    properties: {
      configurationId: { type: 'string', description: 'Auvik configuration ID.' },
      ...SHAPE_PROPS,
    },
    required: ['configurationId'],
    additionalProperties: false,
  },
};

export const handleConfigurationsList = (args: Record<string, unknown>) =>
  withClientList((c) => c.configurations.list(args), configSummary, extractShapeArgs(args), 'auvik_configurations_list');

export const handleConfigurationsGet = (args: { configurationId: string } & Record<string, unknown>) =>
  withClientItem(
    (c) => c.configurations.get(args.configurationId),
    configSummary,
    extractShapeArgs(args),
    'auvik_configurations_get'
  );
