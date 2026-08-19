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
        "List NinjaOne RMM devices, filtered by organization_id, device_class, or online status. Returns the device IDs every other device tool needs. " +
        "All three filters are compiled into one NinjaOne device filter (df) expression, since /v2/devices takes no organizationId, class or online params of its own. Pass device_filter to write the df yourself. " +
        "To find one machine by name or user, ninjaone_devices_search is faster than paging this.",
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
          device_filter: {
            type: "string",
            description:
              'Raw NinjaOne device filter (df) expression, e.g. "org = 12 AND class = WINDOWS_SERVER". Overrides organization_id, device_class and online when given.',
          },
          limit: {
            type: "number",
            description: "Page size - maximum devices to return in one call (default: 50).",
          },
          after: {
            type: "number",
            description:
              "Pagination: the highest device id from the previous page. /v2/devices pages by last-seen ID, not by an opaque cursor.",
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
      description:
        "DESTRUCTIVE: Reboot a NinjaOne-managed device now. The device restarts immediately and active user sessions are interrupted. Confirm with the user before calling.",
      inputSchema: {
        type: "object" as const,
        properties: {
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID of the target device to reboot.",
          },
          mode: {
            type: "string",
            enum: ["NORMAL", "FORCED"],
            description:
              "NORMAL (default) asks the OS to close applications gracefully and can be blocked by a hung process. FORCED restarts immediately and can lose unsaved user work.",
          },
          reason: {
            type: "string",
            description: "Human-readable reason for the reboot; recorded in the device activity log.",
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
    {
      name: "ninjaone_devices_inventory",
      description:
        "Read any per-device sub-resource by device_id and kind (GET /v2/device/{id}/{kind}). This one tool covers the whole per-device surface: hardware (disks, processors, volumes, network-interfaces), software inventory, patch state (os-patches, software-patches and their -installs history), running jobs, policy overrides, the last logged-on user, custom field values, and the scripting options that tell you what can run on this device. " +
        "For the same data across many devices at once, use ninjaone_queries_run instead of looping this tool. Records are passed through unshaped since vendor field names are undocumented.",
      inputSchema: {
        type: "object" as const,
        properties: {
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID, from ninjaone_devices_list or ninjaone_devices_search.",
          },
          kind: {
            type: "string",
            enum: [
              "disks",
              "processors",
              "volumes",
              "software",
              "network-interfaces",
              "custom-fields",
              "last-logged-on-user",
              "os-patches",
              "software-patches",
              "os-patch-installs",
              "software-patch-installs",
              "jobs",
              "policy/overrides",
              "scripting/options",
              "windows-services",
            ],
            description:
              "Which sub-resource to fetch. os-patches / software-patches return pending, failed and rejected patches (filter with status, type, severity); the -installs variants return install history; jobs returns what is running on the device right now; scripting/options lists the scripts, built-in actions and run_as credential roles this device accepts.",
          },
          status: {
            type: "string",
            description:
              "Patch status filter for kind=os-patches or software-patches (e.g. APPROVED, FAILED, REJECTED, PENDING). Ignored by other kinds.",
          },
          type: {
            type: "string",
            description: "Patch type filter for kind=os-patches or software-patches (e.g. PATCH, FEATURE_PACK).",
          },
          severity: {
            type: "string",
            description:
              "Patch severity filter for kind=os-patches or software-patches (e.g. CRITICAL, IMPORTANT, MODERATE, LOW, OPTIONAL).",
          },
        },
        required: ["device_id", "kind"],
      },
    },
    {
      name: "ninjaone_devices_custom_fields_update",
      description: "DESTRUCTIVE: Update custom field values on a NinjaOne device by device_id (required). fields (required) is a map of custom field name to new value; this overwrites the existing values.",
      inputSchema: {
        type: "object" as const,
        properties: {
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID of the target device.",
          },
          fields: {
            type: "object",
            description: "Map of custom field name to new value.",
          },
        },
        required: ["device_id", "fields"],
      },
    },
    {
      name: "ninjaone_devices_script_run",
      description:
        "DESTRUCTIVE: Run a script or a built-in action on a NinjaOne-managed device. This is how you execute a command on an endpoint: the work starts immediately on the target device. Confirm with the user before calling. " +
        "Two modes. type='SCRIPT' with script_id runs a script from the catalog (get IDs from ninjaone_scripts_list). type='ACTION' with action_uid runs a NinjaOne built-in action such as a service restart or a defrag (get UIDs from ninjaone_scripts_list or ninjaone_devices_inventory with kind='scripting/options'). " +
        "The call returns as soon as the job is queued, not when the script finishes: poll ninjaone_jobs_list or read the result from ninjaone_activities_list with activity_type='SCRIPTING'.",
      inputSchema: {
        type: "object" as const,
        properties: {
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID of the target device.",
          },
          type: {
            type: "string",
            enum: ["SCRIPT", "ACTION"],
            description:
              "SCRIPT runs a catalog script identified by script_id. ACTION runs a NinjaOne built-in identified by action_uid. Defaults to SCRIPT when script_id is given and ACTION when action_uid is given.",
          },
          script_id: {
            type: "number",
            description: "Integer ID of a catalog script, from ninjaone_scripts_list. Required when type is SCRIPT.",
          },
          action_uid: {
            type: "string",
            description:
              "UUID of a built-in action, from ninjaone_scripts_list or kind='scripting/options'. Required when type is ACTION.",
          },
          parameters: {
            type: "string",
            description:
              "Parameter string passed to the script or action, exactly as it would be typed on the command line.",
          },
          run_as: {
            type: "string",
            description:
              "Credential role to execute under (e.g. 'system', 'loggedonuser', or a named credential). Valid values for a given device come from ninjaone_devices_inventory with kind='scripting/options'.",
          },
        },
        required: ["device_id"],
      },
    },
    {
      name: "ninjaone_devices_patch_run",
      description:
        "DESTRUCTIVE: Trigger a patch scan or a patch apply on a device (POST /v2/device/{id}/patch/{os|software}/{scan|apply}). " +
        "action='scan' is safe and read-only in effect: it refreshes what the device reports as missing, and is the right first step when patch data looks stale. action='apply' installs the approved pending patches and can reboot the device - confirm with the user before calling it. " +
        "Both return as soon as the job is queued. Check progress with ninjaone_jobs_list, and the result with ninjaone_devices_inventory kind='os-patch-installs' or 'software-patch-installs'.",
      inputSchema: {
        type: "object" as const,
        properties: {
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID of the target device.",
          },
          patch_type: {
            type: "string",
            enum: ["os", "software"],
            description:
              "'os' covers operating system updates (Windows Update, macOS updates). 'software' covers NinjaOne third-party application patching.",
          },
          action: {
            type: "string",
            enum: ["scan", "apply"],
            description:
              "'scan' re-detects missing patches without installing anything. 'apply' installs approved pending patches and may reboot the device.",
          },
        },
        required: ["device_id", "patch_type", "action"],
      },
    },
    {
      name: "ninjaone_devices_service_control",
      description:
        "DESTRUCTIVE: Start, stop, pause, or restart a Windows service on a device (POST /v2/device/{id}/windows-service/{serviceId}/control). Stopping a service can take a production application offline - confirm with the user first. " +
        "Get the service_id from ninjaone_devices_services; it is the service's short name (e.g. 'Spooler'), not its display name.",
      inputSchema: {
        type: "object" as const,
        properties: {
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID. Windows devices only.",
          },
          service_id: {
            type: "string",
            description:
              "Windows service short name from ninjaone_devices_services (e.g. 'Spooler', 'W32Time'), not the display name.",
          },
          action: {
            type: "string",
            enum: ["START", "STOP", "PAUSE", "RESTART"],
            description: "Which control verb to send to the service.",
          },
        },
        required: ["device_id", "service_id", "action"],
      },
    },
    {
      name: "ninjaone_devices_search",
      description:
        "Find devices by free text (GET /v2/devices/search): hostname, display name, logged-on user, or IP address. Use this when the user names a machine or a person and you need the numeric device_id every other device tool requires. Prefer it over paging ninjaone_devices_list looking for a match.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          query: {
            type: "string",
            description:
              "Search text: a hostname, partial device name, username, or IP address (e.g. 'LAPTOP-42', 'jsmith', '10.1.2.').",
          },
          limit: {
            type: "number",
            description: "Maximum devices to return (default: 25).",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "ninjaone_devices_maintenance",
      description:
        "DESTRUCTIVE: Schedule or cancel a maintenance window on a device. During the window the chosen subsystems stop firing: use it before a planned reboot or patch run so on-call is not paged. " +
        "action='start' requires end (a Unix epoch in seconds); omit start to begin now. action='cancel' clears the window immediately.",
      inputSchema: {
        type: "object" as const,
        properties: {
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID of the target device.",
          },
          action: {
            type: "string",
            enum: ["start", "cancel"],
            description: "Whether to schedule a maintenance window or cancel the existing one.",
          },
          end: {
            type: "number",
            description:
              "Window end as a Unix epoch in SECONDS (not milliseconds). Required when action is 'start' - the API rejects an open-ended window.",
          },
          start: {
            type: "number",
            description: "Window start as a Unix epoch in seconds. Omit to begin the window immediately.",
          },
          disabled_features: {
            type: "array",
            items: {
              type: "string",
              enum: ["ALERTS", "PATCHING", "AVSCANS", "TASKS"],
            },
            description:
              "Which subsystems to suppress during the window. Defaults to ALERTS alone, which is the usual intent.",
          },
          reason: {
            type: "string",
            description: "Reason recorded on the device activity log.",
          },
        },
        required: ["device_id", "action"],
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
      const after = args.after as number | undefined;
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

      // /v2/devices has no organizationId, class or online params: every filter
      // is one clause of the df expression. Setting them as separate params
      // filters nothing and returns a whole-tenant list that reads like a
      // scoped one, which is how device_class and online were silently inert.
      const deviceFilter = args.device_filter as string | undefined;
      let df = deviceFilter;
      if (!df) {
        const clauses: string[] = [];
        if (organizationId !== undefined) clauses.push(`org = ${organizationId}`);
        if (args.device_class !== undefined) clauses.push(`class = ${args.device_class as string}`);
        if (args.online !== undefined) clauses.push(`online = ${args.online as boolean}`);
        df = clauses.length > 0 ? clauses.join(" AND ") : undefined;
      }

      logger.info("API call: devices.list", { df, limit, after });

      try {
        const devices = await client.devices.list({
          df,
          pageSize: limit,
          after,
        });
        logger.debug("API response: devices.list", { deviceCount: devices.length });
        return shapeList(devices as unknown as Record<string, unknown>[], deviceSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_list", err);
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
        const result = await client.devices.reboot(deviceId, (args.mode as "NORMAL" | "FORCED" | undefined) ?? "NORMAL", args.reason as string | undefined);
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
      const activityType = args.activity_type as string | undefined;
      logger.info("API call: devices.getActivities", { deviceId, limit, activityType });
      try {
        const activitiesResponse = await client.devices.getActivities(deviceId, {
          pageSize: limit,
          type: activityType,
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

    case "ninjaone_devices_inventory": {
      const deviceId = args.device_id as number;
      const kind = args.kind as string;
      if (!deviceId || !kind) {
        return toolError("INVALID_ARGS", "device_id and kind are required.", {
          hint: "Pass the integer device ID and one of the supported inventory kinds.",
        });
      }
      logger.info("API call: devices.getInventoryByKind", { deviceId, kind });
      try {
        const filters: Record<string, string | undefined> = {
          status: args.status as string | undefined,
          type: args.type as string | undefined,
          severity: args.severity as string | undefined,
        };
        const data = await client.devices.getInventoryByKind(deviceId, kind, filters);
        logger.debug("API response: devices.getInventoryByKind", { deviceId, kind });
        return shapeRaw(data as Record<string, unknown>);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_inventory", err, {
          hint: "Verify device_id with ninjaone_devices_list first.",
        });
      }
    }

    case "ninjaone_devices_custom_fields_update": {
      const deviceId = args.device_id as number;
      const fields = args.fields as Record<string, unknown>;
      if (!deviceId || !fields) {
        return toolError("INVALID_ARGS", "device_id and fields are required.");
      }
      logger.info("API call: devices.updateCustomFields", { deviceId });
      try {
        await client.devices.updateCustomFields(deviceId, fields);
        return shapeRaw({ success: true, message: "Custom fields updated" });
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_custom_fields_update", err, {
          hint: "Verify device_id with ninjaone_devices_list and field names with ninjaone_devices_inventory kind='custom-fields'.",
        });
      }
    }

    case "ninjaone_devices_script_run": {
      const deviceId = args.device_id as number;
      const scriptId = args.script_id as number | undefined;
      const actionUid = args.action_uid as string | undefined;
      // The caller may name the mode explicitly; otherwise infer it from
      // whichever identifier was supplied, since only one applies at a time.
      const runType = (args.type as "SCRIPT" | "ACTION" | undefined) ??
        (actionUid !== undefined ? "ACTION" : "SCRIPT");

      if (!deviceId) {
        return toolError("INVALID_ARGS", "device_id is required.");
      }
      if (runType === "SCRIPT" && scriptId === undefined) {
        return toolError("INVALID_ARGS", "script_id is required when type is SCRIPT.", {
          hint: "List catalog scripts with ninjaone_scripts_list and pass the numeric id.",
        });
      }
      if (runType === "ACTION" && actionUid === undefined) {
        return toolError("INVALID_ARGS", "action_uid is required when type is ACTION.", {
          hint: "List built-in actions with ninjaone_scripts_list and pass the uid.",
        });
      }

      logger.info("API call: devices.runScript", { deviceId, runType, scriptId, actionUid });
      try {
        const result = await client.devices.runScript(deviceId, {
          type: runType,
          id: runType === "SCRIPT" ? scriptId : undefined,
          uid: runType === "ACTION" ? actionUid : undefined,
          parameters: args.parameters as string | undefined,
          runAs: args.run_as as string | undefined,
        });
        return shapeRaw({
          success: true,
          message: "Script run queued. Poll ninjaone_jobs_list for progress, or ninjaone_activities_list with activity_type='SCRIPTING' for the result.",
          result,
        });
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_script_run", err, {
          hint: "Confirm the script exists with ninjaone_scripts_list, and that this device accepts it with ninjaone_devices_inventory kind='scripting/options'.",
        });
      }
    }

    case "ninjaone_devices_patch_run": {
      const deviceId = args.device_id as number;
      const patchType = args.patch_type as "os" | "software";
      const action = args.action as "scan" | "apply";
      if (!deviceId || !patchType || !action) {
        return toolError("INVALID_ARGS", "device_id, patch_type and action are all required.");
      }
      logger.info("API call: devices.runPatchAction", { deviceId, patchType, action });
      try {
        const result = await client.devices.runPatchAction(deviceId, patchType, action);
        return shapeRaw({
          success: true,
          message: `${patchType} patch ${action} queued. Poll ninjaone_jobs_list for progress.`,
          result,
        });
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_patch_run", err, {
          hint: "Verify device_id with ninjaone_devices_list and confirm the device is online.",
        });
      }
    }

    case "ninjaone_devices_service_control": {
      const deviceId = args.device_id as number;
      const serviceId = args.service_id as string;
      const action = args.action as "START" | "STOP" | "PAUSE" | "RESTART";
      if (!deviceId || !serviceId || !action) {
        return toolError("INVALID_ARGS", "device_id, service_id and action are all required.");
      }
      logger.info("API call: devices.controlService", { deviceId, serviceId, action });
      try {
        await client.devices.controlService(deviceId, serviceId, action);
        return shapeRaw({ success: true, message: `Sent ${action} to ${serviceId}` });
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_service_control", err, {
          hint: "service_id is the service short name from ninjaone_devices_services, not its display name. Windows devices only.",
        });
      }
    }

    case "ninjaone_devices_search": {
      const query = args.query as string;
      if (!query) {
        return toolError("INVALID_ARGS", "query is required.");
      }
      const limit = (args.limit as number) || 25;
      logger.info("API call: devices.search", { query, limit });
      try {
        const result = await client.devices.search(query, limit);
        return shapeRaw(result as Record<string, unknown>);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_search", err);
      }
    }

    case "ninjaone_devices_maintenance": {
      const deviceId = args.device_id as number;
      const action = args.action as string;
      if (!deviceId || !action) {
        return toolError("INVALID_ARGS", "device_id and action are required.");
      }
      logger.info("API call: devices.maintenance", { deviceId, action });
      try {
        if (action === "start") {
          const end = args.end as number | undefined;
          if (end === undefined) {
            return toolError("INVALID_ARGS", "end is required when action is 'start'.", {
              hint: "Pass a Unix epoch in SECONDS for when the window should close; the API rejects an open-ended window.",
            });
          }
          await client.devices.scheduleMaintenance(deviceId, {
            end,
            start: args.start as number | undefined,
            disabledFeatures:
              (args.disabled_features as Array<"ALERTS" | "PATCHING" | "AVSCANS" | "TASKS"> | undefined) ?? ["ALERTS"],
            reasonMessage: args.reason as string | undefined,
          });
          return shapeRaw({ success: true, message: "Maintenance window scheduled" });
        } else if (action === "cancel") {
          await client.devices.cancelMaintenance(deviceId);
          return shapeRaw({ success: true, message: "Maintenance window cancelled" });
        }
        return toolError("INVALID_ARGS", `Unknown maintenance action: ${action}`);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_devices_maintenance", err, {
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
