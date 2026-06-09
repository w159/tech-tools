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
  description: 'GET /v1/alert/history/info — list alerts. Returns compact summary (id, name, severity, status, detectedTime, message, dismissed, entityId) by default. Pass full=true or fields=[...] for more. Filter by severity, status, dismissed, time window, or the entity/definition that raised them.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
      ...SHAPE_PROPS,
      filter_severity: { type: 'string', enum: [...ALERT_SEVERITIES], description: 'filter[severity].' },
      filter_status: { type: 'string', enum: [...ALERT_STATUSES], description: 'filter[status] — created / resolved / paused / unpaused.' },
      filter_entityId: { type: 'string', description: 'filter[entityId] — alerts for a specific device/network/interface.' },
      filter_alertDefinitionId: { type: 'string', description: 'filter[alertDefinitionId].' },
      filter_alertSpecificationId: { type: 'string', description: 'filter[alertSpecificationId].' },
      filter_dismissed: { type: 'boolean', description: 'filter[dismissed].' },
      filter_dispatched: { type: 'boolean', description: 'filter[dispatched].' },
      filter_detectedTimeAfter: { type: 'string', description: 'filter[detectedTimeAfter] ISO 8601.' },
      filter_detectedTimeBefore: { type: 'string', description: 'filter[detectedTimeBefore] ISO 8601.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const alertsGetTool: Tool = {
  name: 'auvik_alerts_get',
  description:
    'GET /v1/alert/history/info/{id} — single alert detail. Returns compact summary by default; pass full=true or fields=[...] for more. Note: may return 404 for a sub-tenant alert when called under a parent-tenant credential, even if it appeared in a list — that is an Auvik authorization quirk, not a missing alert.',
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
