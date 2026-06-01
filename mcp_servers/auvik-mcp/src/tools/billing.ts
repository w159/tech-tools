import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { withClient, tenantsProp } from './shared.js';

export const billingClientUsageTool: Tool = {
  name: 'auvik_billing_client_usage',
  description: 'GET /v1/billing/usage/client — per-client billable device counts for a date range. Dates are calendar dates (YYYY-MM-DD), not timestamps.',
  inputSchema: {
    type: 'object',
    properties: {
      fromDate: { type: 'string', description: 'Start date YYYY-MM-DD. Sent as filter[fromDate].' },
      thruDate: { type: 'string', description: 'End date YYYY-MM-DD. Sent as filter[thruDate].' },
      ...tenantsProp,
    },
    required: ['fromDate', 'thruDate'],
    additionalProperties: false,
  },
};

export const billingDeviceUsageTool: Tool = {
  name: 'auvik_billing_device_usage',
  description:
    'GET /v1/billing/usage/device/{id} — billable usage for a single device over a date range. Returns 404 if the device has no billing record.',
  inputSchema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', description: 'Auvik device ID.' },
      fromDate: { type: 'string', description: 'Start date YYYY-MM-DD. Sent as filter[fromDate].' },
      thruDate: { type: 'string', description: 'End date YYYY-MM-DD. Sent as filter[thruDate].' },
    },
    required: ['deviceId', 'fromDate', 'thruDate'],
    additionalProperties: false,
  },
};

export const handleBillingClientUsage = (args: { fromDate: string; thruDate: string; tenants?: string }) =>
  withClient((c) =>
    c.billing.clientUsage({ filter_fromDate: args.fromDate, filter_thruDate: args.thruDate, tenants: args.tenants })
  );

export const handleBillingDeviceUsage = (args: { deviceId: string; fromDate: string; thruDate: string }) =>
  withClient((c) =>
    c.billing.deviceUsage(args.deviceId, { filter_fromDate: args.fromDate, filter_thruDate: args.thruDate })
  );
