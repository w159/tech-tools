import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClientList,
  withClientItem,
  extractShapeArgs,
  SHAPE_PROPS,
  tenantsProp,
  pageProps,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  type SummaryFn,
  type FlatResource,
} from './shared.js';

const alertSummary: SummaryFn<FlatResource> = (a: FlatResource) => ({
  id: a.id,
  name: a.name,
  severity: a.severity,
  status: a.status,
  detectedTime: a.detectedTime,
  message: a.message,
  dismissed: a.dismissed,
  entityId: (a.relationships as Record<string, unknown> | undefined) &&
    ((a.relationships as Record<string, unknown>)['entity'] as Record<string, unknown> | undefined) &&
    (((a.relationships as Record<string, unknown>)['entity'] as Record<string, unknown>)['data'] as Record<string, unknown> | undefined)?.id,
});

export const alertsListTool: Tool = {
  name: 'auvik_alerts_list',
  description: 'List alerts across a tenant, returning severity, status, detectedTime, message, and entityId; call this to check what alerts are active or to pull alert history for a device/network/interface. (GET /v1/alert/history/info)',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
      filter_severity: { type: 'string', enum: [...ALERT_SEVERITIES], description: 'Alert severity level to filter on (e.g. "warning", "critical").' },
      filter_status: { type: 'string', enum: [...ALERT_STATUSES], description: 'Alert lifecycle status: created, resolved, paused, or unpaused.' },
      filter_entityId: { type: 'string', description: 'Return only alerts for this specific entity (device, network, or interface ID).' },
      filter_alertDefinitionId: { type: 'string', description: 'Return only alerts triggered by this alert definition ID.' },
      filter_alertSpecificationId: { type: 'string', description: 'Return only alerts matching this alert specification ID.' },
      filter_dismissed: { type: 'boolean', description: 'When true, return only dismissed alerts; when false, only active ones.' },
      filter_dispatched: { type: 'boolean', description: 'When true, return only alerts that have been dispatched to a notification channel.' },
      filter_detectedTimeAfter: { type: 'string', description: 'ISO 8601 timestamp; return only alerts detected after this time.' },
      filter_detectedTimeBefore: { type: 'string', description: 'ISO 8601 timestamp; return only alerts detected before this time.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const alertsGetTool: Tool = {
  name: 'auvik_alerts_get',
  description:
    'Fetch full detail for a single alert by ID; use after auvik_alerts_list to inspect the message, entity, and dismissal state. Note: may return 404 for sub-tenant alerts under a parent credential — that is an Auvik authorization quirk, not a missing alert. (GET /v1/alert/history/info/{id})',
  inputSchema: {
    type: 'object',
    properties: {
      alertId: { type: 'string', description: 'Auvik alert ID.' },
      ...SHAPE_PROPS,
    },
    required: ['alertId'],
    additionalProperties: false,
  },
};

export const handleAlertsList = (args: Record<string, unknown>) =>
  withClientList((c) => c.alerts.list(args), alertSummary, extractShapeArgs(args), 'auvik_alerts_list');

export const handleAlertsGet = (args: { alertId: string } & Record<string, unknown>) =>
  withClientItem((c) => c.alerts.get(args.alertId), alertSummary, extractShapeArgs(args), 'auvik_alerts_get');
