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
  description: 'Return per-client billable device counts for a date range (YYYY-MM-DD calendar dates); use to audit MSP billing or reconcile device counts across clients. (GET /v1/billing/usage/client)',
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
    'Return billable usage for a single device over a date range (YYYY-MM-DD); returns 404 if the device has no billing record. (GET /v1/billing/usage/device/{id})',
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
