import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { withClient, tenantsProp, pageProps, ALERT_SEVERITIES, ALERT_STATUSES } from './shared.js';

export const alertsListTool: Tool = {
  name: 'auvik_alerts_list',
  description: 'GET /v1/alert/history/info — list alerts. Filter by severity, status, dismissed, time window, or the entity/definition that raised them.',
  inputSchema: {
    type: 'object',
    properties: {
      ...tenantsProp,
      ...pageProps,
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
    'GET /v1/alert/history/info/{id} — single alert detail. Note: may return 404 for a sub-tenant alert when called under a parent-tenant credential, even if it appeared in a list — that is an Auvik authorization quirk, not a missing alert.',
  inputSchema: {
    type: 'object',
    properties: { alertId: { type: 'string', description: 'Auvik alert ID.' } },
    required: ['alertId'],
    additionalProperties: false,
  },
};

export const handleAlertsList = (args: Record<string, unknown>) => withClient((c) => c.alerts.list(args));
export const handleAlertsGet = (args: { alertId: string }) => withClient((c) => c.alerts.get(args.alertId));
