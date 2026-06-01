import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { withClient, tenantsProp, pageProps } from './shared.js';

export const configurationsListTool: Tool = {
  name: 'auvik_configurations_list',
  description: 'GET /v1/inventory/configuration — list device configuration backup records (backupTime, isRunning, device relationship).',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
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
  description: 'GET /v1/inventory/configuration/{id} — single configuration backup record (includes the config text).',
  inputSchema: {
    type: 'object',
    properties: { configurationId: { type: 'string', description: 'Auvik configuration ID.' } },
    required: ['configurationId'],
    additionalProperties: false,
  },
};

export const handleConfigurationsList = (args: Record<string, unknown>) =>
  withClient((c) => c.configurations.list(args));
export const handleConfigurationsGet = (args: { configurationId: string }) =>
  withClient((c) => c.configurations.get(args.configurationId));
