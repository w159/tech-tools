import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toZodShape, type JsonObjectSchema } from '@shared/zod-shape.js';
import { toMcpError } from './errors.js';
import { annotate } from './annotate-tool.js';
import { getCredentials } from './credentials.js';

import { statusTool, handleStatus } from './tools/status.js';
import { navigateTool, handleNavigate } from './tools/navigate.js';

import {
  tenantsListTool,
  tenantsDetailTool,
  tenantsGetDetailTool,
  handleTenantsList,
  handleTenantsDetail,
  handleTenantsGetDetail,
} from './tools/tenants.js';

import {
  devicesListTool,
  devicesGetTool,
  devicesGetDetailsTool,
  devicesListDetailsTool,
  devicesGetExtendedTool,
  devicesListExtendedTool,
  devicesListWarrantyTool,
  devicesGetWarrantyTool,
  devicesListLifecycleTool,
  devicesGetLifecycleTool,
  handleDevicesList,
  handleDevicesGet,
  handleDevicesGetDetails,
  handleDevicesListDetails,
  handleDevicesGetExtended,
  handleDevicesListExtended,
  handleDevicesListWarranty,
  handleDevicesGetWarranty,
  handleDevicesListLifecycle,
  handleDevicesGetLifecycle,
} from './tools/devices.js';

import {
  networksListTool,
  networksGetTool,
  networksListDetailTool,
  networksGetDetailTool,
  handleNetworksList,
  handleNetworksGet,
  handleNetworksListDetail,
  handleNetworksGetDetail,
} from './tools/networks.js';

import { interfacesListTool, interfacesGetTool, handleInterfacesList, handleInterfacesGet } from './tools/interfaces.js';

import {
  configurationsListTool,
  configurationsGetTool,
  handleConfigurationsList,
  handleConfigurationsGet,
} from './tools/configurations.js';

import { componentsListTool, componentsGetTool, handleComponentsList, handleComponentsGet } from './tools/components.js';

import {
  entitiesListNotesTool,
  entitiesGetNoteTool,
  entitiesListAuditsTool,
  entitiesGetAuditTool,
  handleEntitiesListNotes,
  handleEntitiesGetNote,
  handleEntitiesListAudits,
  handleEntitiesGetAudit,
} from './tools/entities.js';

import { alertsListTool, alertsGetTool, handleAlertsList, handleAlertsGet } from './tools/alerts.js';

import {
  statisticsDeviceTool,
  statisticsDeviceAvailabilityTool,
  statisticsInterfaceTool,
  statisticsServiceTool,
  statisticsComponentTool,
  statisticsOidTool,
  handleStatisticsDevice,
  handleStatisticsDeviceAvailability,
  handleStatisticsInterface,
  handleStatisticsService,
  handleStatisticsComponent,
  handleStatisticsOid,
} from './tools/statistics.js';

import {
  billingClientUsageTool,
  billingDeviceUsageTool,
  handleBillingClientUsage,
  handleBillingDeviceUsage,
} from './tools/billing.js';

const TOOLS = [
  statusTool,
  navigateTool,
  tenantsListTool,
  tenantsDetailTool,
  tenantsGetDetailTool,
  devicesListTool,
  devicesGetTool,
  devicesGetDetailsTool,
  devicesListDetailsTool,
  devicesGetExtendedTool,
  devicesListExtendedTool,
  devicesListWarrantyTool,
  devicesGetWarrantyTool,
  devicesListLifecycleTool,
  devicesGetLifecycleTool,
  networksListTool,
  networksGetTool,
  networksListDetailTool,
  networksGetDetailTool,
  interfacesListTool,
  interfacesGetTool,
  configurationsListTool,
  configurationsGetTool,
  componentsListTool,
  componentsGetTool,
  entitiesListNotesTool,
  entitiesGetNoteTool,
  entitiesListAuditsTool,
  entitiesGetAuditTool,
  alertsListTool,
  alertsGetTool,
  statisticsDeviceTool,
  statisticsDeviceAvailabilityTool,
  statisticsInterfaceTool,
  statisticsServiceTool,
  statisticsComponentTool,
  statisticsOidTool,
  billingClientUsageTool,
  billingDeviceUsageTool,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (args: any) => Promise<any>;

const HANDLERS: Record<string, Handler> = {
  auvik_status: () => handleStatus(),
  auvik_navigate: (args) => handleNavigate(args),

  auvik_tenants_list: () => handleTenantsList(),
  auvik_tenants_detail: (args) => handleTenantsDetail(args),
  auvik_tenants_get_detail: (args) => handleTenantsGetDetail(args),

  auvik_devices_list: (args) => handleDevicesList(args),
  auvik_devices_get: (args) => handleDevicesGet(args),
  auvik_devices_get_details: (args) => handleDevicesGetDetails(args),
  auvik_devices_list_details: (args) => handleDevicesListDetails(args),
  auvik_devices_get_extended: (args) => handleDevicesGetExtended(args),
  auvik_devices_list_extended: (args) => handleDevicesListExtended(args),
  auvik_devices_list_warranty: (args) => handleDevicesListWarranty(args),
  auvik_devices_get_warranty: (args) => handleDevicesGetWarranty(args),
  auvik_devices_list_lifecycle: (args) => handleDevicesListLifecycle(args),
  auvik_devices_get_lifecycle: (args) => handleDevicesGetLifecycle(args),

  auvik_networks_list: (args) => handleNetworksList(args),
  auvik_networks_get: (args) => handleNetworksGet(args),
  auvik_networks_list_detail: (args) => handleNetworksListDetail(args),
  auvik_networks_get_detail: (args) => handleNetworksGetDetail(args),

  auvik_interfaces_list: (args) => handleInterfacesList(args),
  auvik_interfaces_get: (args) => handleInterfacesGet(args),

  auvik_configurations_list: (args) => handleConfigurationsList(args),
  auvik_configurations_get: (args) => handleConfigurationsGet(args),

  auvik_components_list: (args) => handleComponentsList(args),
  auvik_components_get: (args) => handleComponentsGet(args),

  auvik_entities_list_notes: (args) => handleEntitiesListNotes(args),
  auvik_entities_get_note: (args) => handleEntitiesGetNote(args),
  auvik_entities_list_audits: (args) => handleEntitiesListAudits(args),
  auvik_entities_get_audit: (args) => handleEntitiesGetAudit(args),

  auvik_alerts_list: (args) => handleAlertsList(args),
  auvik_alerts_get: (args) => handleAlertsGet(args),

  auvik_statistics_device: (args) => handleStatisticsDevice(args),
  auvik_statistics_device_availability: (args) => handleStatisticsDeviceAvailability(args),
  auvik_statistics_interface: (args) => handleStatisticsInterface(args),
  auvik_statistics_service: (args) => handleStatisticsService(args),
  auvik_statistics_component: (args) => handleStatisticsComponent(args),
  auvik_statistics_oid: (args) => handleStatisticsOid(args),

  auvik_billing_client_usage: (args) => handleBillingClientUsage(args),
  auvik_billing_device_usage: (args) => handleBillingDeviceUsage(args),
};

export function createServer(): McpServer {
  const server = new McpServer({ name: 'auvik-mcp', version: '0.4.2' }, {
    capabilities: { logging: {} },
    instructions:
      'Auvik network monitoring: tenants, devices (details, warranty, lifecycle), networks, interfaces, configurations, components, entity notes and audits, alerts, statistics, and billing usage. ' +
      'Call auvik_tenants_list or the matching list tool to find IDs before any get-by-id tool. ' +
      'On 401/403, "not configured", or a connection failure, call auvik_status once and report its output to the user instead of retrying other tools. ' +
      'When credentials are missing only auvik_status and auvik_navigate are listed; the user must set AUVIK_USERNAME and AUVIK_API_KEY and restart the session.',
  });

  // Progressive disclosure: status + navigate only until credentials resolve.
  // (HTTP gateway mode builds a server per request inside the credential
  // context, so getCredentials() here sees that request's headers.)
  const tools = getCredentials()
    ? TOOLS
    : TOOLS.filter((t) => t.name === 'auvik_status' || t.name === 'auvik_navigate');

  for (const tool of tools) {
    // annotate() derives title + read/destructive hints; registerTool validates
    // args against the zod shape before the handler runs.
    const { title, ...annotations } = annotate([tool], 'Auvik')[0].annotations ?? {};
    server.registerTool(
      tool.name,
      { title, description: tool.description, inputSchema: toZodShape(z, tool.inputSchema as JsonObjectSchema), annotations: { title, ...annotations } },
      async (args) => {
        try {
          return await HANDLERS[tool.name](args);
        } catch (error) {
          const mcpError = toMcpError(error);
          return { content: [{ type: 'text' as const, text: mcpError.message }], isError: true };
        }
      },
    );
  }

  return server;
}
