import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClientList,
  withClientItem,
  extractShapeArgs,
  SHAPE_PROPS,
  tenantsProp,
  type SummaryFn,
  type FlatResource,
} from './shared.js';

const clientUsageSummary: SummaryFn<FlatResource> = (u: FlatResource) => ({
  id: u.id,
  creditDate: u.creditDate,
  managedDevicesBillable: u.managedDevicesBillable,
  billedDevices: u.billedDevices,
  totalDevices: u.totalDevices,
});

const deviceUsageSummary: SummaryFn<FlatResource> = (u: FlatResource) => ({
  id: u.id,
  deviceName: u.deviceName,
  creditDate: u.creditDate,
  deviceType: u.deviceType,
  billable: u.billable,
});

export const billingClientUsageTool: Tool = {
  name: 'auvik_billing_client_usage',
  description: 'GET /v1/billing/usage/client — per-client billable device counts for a date range. Dates are calendar dates (YYYY-MM-DD), not timestamps. Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      fromDate: { type: 'string', description: 'Start date YYYY-MM-DD. Sent as filter[fromDate].' },
      thruDate: { type: 'string', description: 'End date YYYY-MM-DD. Sent as filter[thruDate].' },
      ...tenantsProp,
      ...SHAPE_PROPS,
    },
    required: ['fromDate', 'thruDate'],
    additionalProperties: false,
  },
};

export const billingDeviceUsageTool: Tool = {
  name: 'auvik_billing_device_usage',
  description:
    'GET /v1/billing/usage/device/{id} — billable usage for a single device over a date range. Returns 404 if the device has no billing record. Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', description: 'Auvik device ID.' },
      fromDate: { type: 'string', description: 'Start date YYYY-MM-DD. Sent as filter[fromDate].' },
      thruDate: { type: 'string', description: 'End date YYYY-MM-DD. Sent as filter[thruDate].' },
      ...SHAPE_PROPS,
    },
    required: ['deviceId', 'fromDate', 'thruDate'],
    additionalProperties: false,
  },
};

export const handleBillingClientUsage = (args: { fromDate: string; thruDate: string; tenants?: string } & Record<string, unknown>) =>
  withClientList(
    (c) => c.billing.clientUsage({ filter_fromDate: args.fromDate, filter_thruDate: args.thruDate, tenants: args.tenants }),
    clientUsageSummary,
    extractShapeArgs(args),
    'auvik_billing_client_usage'
  );

export const handleBillingDeviceUsage = (args: { deviceId: string; fromDate: string; thruDate: string } & Record<string, unknown>) =>
  withClientItem(
    (c) => c.billing.deviceUsage(args.deviceId, { filter_fromDate: args.fromDate, filter_thruDate: args.thruDate }),
    deviceUsageSummary,
    extractShapeArgs(args),
    'auvik_billing_device_usage'
  );
