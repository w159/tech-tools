/**
 * Devices domain handler
 *
 * Provides tools for device operations in NinjaOne.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { logger } from "../utils/logger.js";
import { elicitSelection } from "../utils/elicitation.js";
import {
  shapeList,
  shapeItem,
  shapeRaw,
  extractShapeArgs,
  SHAPE_PROPS,
  toolError,
  toolErrorFromCatch,
  type SummaryFn,
} from "./_helpers.js";

// ---------------------------------------------------------------------------
// Summary functions
// ---------------------------------------------------------------------------

/**
 * Compact summary for a device list entry.
 * Full detail is available via ninjaone_devices_get or fields=[...].
 */
const deviceSummary: SummaryFn = (item) => ({
  id:          item.id,
  systemName:  item.systemName,
  displayName: item.displayName,
  deviceClass: item.deviceClass,
  online:      item.online ?? false,
  status:      item.status,
  locationId:  item.locationId,
  organizationId: item.organizationId,
  lastContact: item.lastContact,
});

/**
 * Compact summary for a Windows service entry.
 */
const serviceSummary: SummaryFn = (item) => ({
  name:        item.name,
  displayName: item.displayName,
  state:       item.state,
  startType:   item.startType,
});

/**
 * Compact summary for an alert entry returned by device-scoped alert calls.
 */
const alertSummary: SummaryFn = (item) => ({
  uid:            item.uid,
  severity:       item.severity,
  message:        item.message,
  deviceId:       item.deviceId,
  organizationId: item.organizationId,
  createTime:     item.createTime,
});

/**
 * Compact summary for an activity log entry.
 */
const activitySummary: SummaryFn = (item) => ({
  id:           item.id,
  activityType: item.activityType,
  status:       item.status,
  message:      item.message,
  createTime:   item.createTime,
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function getTools(): Tool[] {
  return [
    {
      name: "ninjaone_devices_list",
      description:
        "List NinjaOne RMM devices; filter by organization_id, device_class (WINDOWS_WORKSTATION/SERVER/MAC/LINUX/VMWARE_VM), or online status. Returns device IDs needed by other device tools.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          organization_id: {
            type: "number",
            description: "Integer NinjaOne organization ID; scopes results to one customer account.",
          },
          device_class: {
            type: "string",
            enum: ["WINDOWS_WORKSTATION", "WINDOWS_SERVER", "MAC", "LINUX", "VMWARE_VM"],
            description: "Filter by device operating system class.",
          },
          online: {
            type: "boolean",
            description: "When true, returns only currently online devices; false returns only offline devices.",
          },
          limit: {
            type: "number",
            description: "Page size — maximum devices to return in one call (default: 50).",
          },
          cursor: {
            type: "string",
            description: "Opaque pagination cursor from the previous page response.",
          },
        },
      },
    },
    {
      name: "ninjaone_devices_get",
      description: "Get full details of a NinjaOne device by device_id (required): OS, hostname, IP addresses, last-contact time, and policy assignment.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID.",
          },
        },
        required: ["device_id"],
      },
    },
    {
      name: "ninjaone_devices_reboot",
      description: "DESTRUCTIVE: Schedule a reboot for a NinjaOne-managed device. The device will restart immediately, interrupting active user sessions.",
      inputSchema: {
        type: "object" as const,
        properties: {
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID of the target device to reboot.",
          },
          reason: {
            type: "string",
            description: "Human-readable reason for the reboot; recorded in the activity log.",
          },
        },
        required: ["device_id"],
      },
    },
    {
      name: "ninjaone_devices_services",
      description: "List Windows services on a NinjaOne device by device_id (required); optionally filter by state (RUNNING/STOPPED/PAUSED). Use to audit running services or diagnose service issues.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID.",
          },
          state: {
            type: "string",
            enum: ["RUNNING", "STOPPED", "PAUSED"],
            description: "Filter by service state; omit to return services in all states.",
          },
        },
        required: ["device_id"],
      },
    },
    {
      name: "ninjaone_devices_alerts",
      description: "Get active alerts for a NinjaOne device by device_id (required); optionally filter by severity (CRITICAL/MAJOR/MINOR/NONE). Use to check current device health.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID.",
          },
          severity: {
            type: "string",
            enum: ["CRITICAL", "MAJOR", "MINOR", "NONE"],
            description: "Filter alerts to only the specified severity level.",
          },
        },
        required: ["device_id"],
      },
    },
    {
      name: "ninjaone_devices_activities",
      description: "Get the activity log for a NinjaOne device by device_id (required); optionally filter by activity_type (e.g. 'REBOOT'). Returns a timeline of events on the device.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID.",
          },
          activity_type: {
            type: "string",
            description: "Filter by activity type string (e.g. 'REBOOT', 'POLICY_CHANGE').",
          },
          limit: {
            type: "number",
            description: "Page size — maximum activity records to return (default: 50).",
          },
        },
        required: ["device_id"],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);

  switch (toolName) {
    case "ninjaone_devices_list": {
      const limit = (args.limit as number) || 50;
      const cursor = args.cursor as string | undefined;
      let organizationId = args.organization_id as number | undefined;

      // If no organization filter provided, elicit organization selection
      if (organizationId === undefined) {
        try {
          const orgs = await client.organizations.list();
          if (orgs.length > 0) {
            const options = orgs.slice(0, 20).map((org) => ({
              value: String(org.id),
              label: org.name || `Organization ${org.id}`,
            }));
            options.push({ value: "all", label: "All organizations (no filter)" });

            const selection = await elicitSelection(
              "No organization filter provided. Would you like to filter devices by organization?",
              "organization",
              options
            );

            if (selection && selection !== "all") {
              organizationId = parseInt(selection, 10);
            }
          }
        } catch {
          // If org fetch fails, proceed without filter
        }
      }

      logger.info("API call: devices.list", {
        organizationId,
        deviceClass: args.device_class,
        online: args.online,
        limit,
        cursor,
      });

      try {
        const devices = await client.devices.list({
          organizationId,
          pageSize: limit,
          cursor,
        });
        logger.debug("API response: devices.list", { deviceCount: devices.length });
        return shapeList(devices as unknown as Record<string, unknown>[], deviceSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_list", err, {
          hint: "Verify NINJAONE_CLIENT_ID, NINJAONE_CLIENT_SECRET, and NINJAONE_REGION are set.",
        });
      }
    }

    case "ninjaone_devices_get": {
      const deviceId = (args.device_id ?? args.deviceId ?? args.id) as number;
      if (!deviceId) {
        return toolError("INVALID_ARGS", "device_id is required.", {
          hint: "Pass the integer device ID returned by ninjaone_devices_list.",
        });
      }
      logger.info("API call: devices.get", { deviceId });
      try {
        const device = await client.devices.get(deviceId);
        logger.debug("API response: devices.get", { deviceId });
        return shapeItem(device as unknown as Record<string, unknown>, deviceSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_get", err, {
          hint: "Verify device_id with ninjaone_devices_list first.",
        });
      }
    }

    case "ninjaone_devices_reboot": {
      const deviceId = args.device_id as number;
      const reason = args.reason as string | undefined;
      logger.info("API call: devices.reboot", { deviceId, reason });
      try {
        const result = await client.devices.reboot(deviceId, reason);
        logger.debug("API response: devices.reboot", { deviceId });
        return shapeRaw({ success: true, message: "Reboot scheduled", result });
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_reboot", err, {
          hint: "Verify device_id with ninjaone_devices_list and confirm the device is online.",
        });
      }
    }

    case "ninjaone_devices_services": {
      const deviceId = args.device_id as number;
      const stateFilter = args.state as string | undefined;
      logger.info("API call: devices.getServices", { deviceId, state: stateFilter });
      try {
        let services = await client.devices.getServices(deviceId);
        if (stateFilter) {
          services = services.filter((s) => s.state === stateFilter);
        }
        logger.debug("API response: devices.getServices", { count: services.length });
        return shapeList(services as unknown as Record<string, unknown>[], serviceSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_services", err, {
          hint: "Verify device_id with ninjaone_devices_list. Only Windows devices report services.",
        });
      }
    }

    case "ninjaone_devices_alerts": {
      const deviceId = args.device_id as number;
      const severityFilter = args.severity as string | undefined;
      logger.info("API call: alerts.listByDevice", { deviceId, severity: severityFilter });
      try {
        let alerts = await client.alerts.listByDevice(deviceId);
        if (severityFilter) {
          alerts = alerts.filter((a) => a.severity === severityFilter);
        }
        logger.debug("API response: alerts.listByDevice", { count: alerts.length });
        return shapeList(alerts as unknown as Record<string, unknown>[], alertSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_alerts", err, {
          hint: "Verify device_id with ninjaone_devices_list first.",
        });
      }
    }

    case "ninjaone_devices_activities": {
      const deviceId = args.device_id as number;
      const limit = (args.limit as number) || 50;
      logger.info("API call: devices.getActivities", { deviceId, limit });
      try {
        const activitiesResponse = await client.devices.getActivities(deviceId, {
          pageSize: limit,
        });
        const activities = activitiesResponse.activities ?? [];
        logger.debug("API response: devices.getActivities", { count: activities.length });
        return shapeList(activities as unknown as Record<string, unknown>[], activitySummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_activities", err, {
          hint: "Verify device_id with ninjaone_devices_list first.",
        });
      }
    }

    default:
      return toolError("INVALID_ARGS", `Unknown device tool: ${toolName}`);
  }
}

export const devicesHandler: DomainHandler = {
  getTools,
  handleCall,
};
