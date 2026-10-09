/**
 * Automation domain handler
 *
 * Script catalog, built-in actions, running jobs, scheduled tasks, and the
 * tenant-wide activity log. Paths are transcribed from the NinjaRMM v2 OpenAPI
 * spec (getAutomationScripts, getActiveJobs, getScheduledTasks, getActivities).
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { logger } from "../utils/logger.js";
import {
  shapeList,
  shapeRaw,
  extractShapeArgs,
  SHAPE_PROPS,
  toolError,
  toolErrorFromCatch,
} from "./_helpers.js";

// ---------------------------------------------------------------------------
// Param helpers
// ---------------------------------------------------------------------------

/**
 * Translate organization_id to a device filter.
 *
 * /v2/jobs and /v2/activities have no organizationId param - sending one
 * filters nothing and returns a whole-tenant result that reads like a scoped
 * one. device_filter, when given, is a raw df and wins.
 */
function scopeParams(args: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
  const params: Record<string, string | number | boolean | undefined> = {};
  const deviceFilter = args.device_filter as string | undefined;
  const organizationId = args.organization_id as number | undefined;
  if (deviceFilter) {
    params.df = deviceFilter;
  } else if (organizationId !== undefined) {
    params.df = `org = ${organizationId}`;
  }
  return params;
}

const SCOPE_PROPS = {
  organization_id: {
    type: "number",
    description:
      'Integer NinjaOne organization ID; translated to df="org = <id>" since this endpoint has no organizationId param. Overridden by device_filter when both are given.',
  },
  device_filter: {
    type: "string",
    description:
      'Raw NinjaOne device filter (df) expression, e.g. "org = 12", "class = WINDOWS_SERVER", "online = true". Overrides organization_id when both are given.',
  },
} as const;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function getTools(): Tool[] {
  return [
    {
      name: "ninjaone_scripts_list",
      description:
        "List every automation script and built-in action available in this NinjaOne instance (GET /v2/automation/scripts). " +
        "This is step one of running anything on a device: take the numeric id of a script (run it with type='SCRIPT') or the uid of a built-in action (type='ACTION') and pass it to ninjaone_devices_script_run. " +
        "Use ninjaone_devices_inventory with kind='scripting/options' instead when you need only what a specific device can run, including its valid run_as credential roles.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          lang: {
            type: "string",
            description: "Language tag for localized script names and descriptions (e.g. 'en').",
          },
        },
      },
    },
    {
      name: "ninjaone_jobs_list",
      description:
        "List currently running and queued NinjaOne jobs (GET /v2/jobs). Use this to confirm a script run, patch scan, or patch apply you triggered is actually executing, and to see what else is in flight. " +
        "Scope with organization_id or device_filter - this endpoint accepts no organizationId param. For one device, ninjaone_devices_inventory with kind='jobs' is narrower.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          ...SCOPE_PROPS,
          job_type: {
            type: "string",
            description:
              "Filter by job type (e.g. 'SCRIPTING', 'PATCH_MANAGEMENT', 'SOFTWARE_PATCH_MANAGEMENT').",
          },
          tz: {
            type: "string",
            description: "IANA time zone for returned timestamps (e.g. 'America/New_York').",
          },
        },
      },
    },
    {
      name: "ninjaone_tasks_list",
      description:
        "List scheduled tasks configured in NinjaOne (GET /v2/tasks): recurring scripts and automations and the devices or groups they target. Read-only, no parameters. Use it to answer what is scheduled to run, versus ninjaone_jobs_list which shows what is running now.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
        },
      },
    },
    {
      name: "ninjaone_activities_list",
      description:
        "Read the tenant-wide NinjaOne activity log (GET /v2/activities): script results, patch events, alerts, reboots, policy changes, and technician actions across every device. " +
        "This is the audit trail - use it to find out what happened and when, including the outcome of a script you ran. Filter by activity_class, activity_type, status, user, or time window, and scope with organization_id or device_filter. For a single device, ninjaone_devices_activities is narrower.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          ...SCOPE_PROPS,
          activity_class: {
            type: "string",
            enum: ["SYSTEM", "DEVICE", "USER", "ALL"],
            description: "Which activity stream to read. Defaults to ALL.",
          },
          activity_type: {
            type: "string",
            description:
              "Filter to one activity type (e.g. 'SCRIPTING', 'PATCH_MANAGEMENT', 'CONDITION', 'REBOOT').",
          },
          status: {
            type: "string",
            description: "Filter by activity status (e.g. 'COMPLETED', 'FAILED', 'IN_PROGRESS').",
          },
          user: {
            type: "string",
            description: "Filter to activities attributed to one user.",
          },
          series_uid: {
            type: "string",
            description:
              "Alert (series) UID from ninjaone_alerts_list; returns every activity tied to that alert.",
          },
          after: {
            type: "string",
            description: "Return activities recorded after this date (ISO 8601).",
          },
          before: {
            type: "string",
            description: "Return activities recorded before this date (ISO 8601).",
          },
          newer_than: {
            type: "number",
            description:
              "Return activities with an ID greater than this one. Use the highest id from a previous page to poll for new events.",
          },
          older_than: {
            type: "number",
            description: "Return activities with an ID lower than this one. Use to page backwards.",
          },
          page_size: {
            type: "number",
            description: "Records per page, 10 to 1000. Defaults to 200.",
          },
          tz: {
            type: "string",
            description: "IANA time zone for returned timestamps (e.g. 'America/New_York').",
          },
        },
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
    case "ninjaone_scripts_list": {
      const lang = args.lang as string | undefined;
      logger.info("API call: automation.listScripts", { lang });
      try {
        const scripts = await client.automation.listScripts(lang);
        logger.debug("API response: automation.listScripts", { count: scripts.length });
        // Response field names for the script catalog are undocumented; pass
        // records through unshaped rather than guess a schema.
        return shapeList(scripts as Record<string, unknown>[], undefined, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_scripts_list", err);
      }
    }

    case "ninjaone_jobs_list": {
      const params = scopeParams(args);
      if (args.job_type !== undefined) params.jobType = args.job_type as string;
      if (args.tz !== undefined) params.tz = args.tz as string;
      logger.info("API call: automation.listJobs", { params });
      try {
        const jobs = await client.automation.listJobs(params);
        logger.debug("API response: automation.listJobs", { count: jobs.length });
        return shapeList(jobs as Record<string, unknown>[], undefined, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_jobs_list", err);
      }
    }

    case "ninjaone_tasks_list": {
      logger.info("API call: automation.listTasks", {});
      try {
        const tasks = await client.automation.listTasks();
        logger.debug("API response: automation.listTasks", { count: tasks.length });
        return shapeList(tasks as Record<string, unknown>[], undefined, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_tasks_list", err);
      }
    }

    case "ninjaone_activities_list": {
      const params = scopeParams(args);
      if (args.activity_class !== undefined) params.class = args.activity_class as string;
      if (args.activity_type !== undefined) params.type = args.activity_type as string;
      if (args.status !== undefined) params.status = args.status as string;
      if (args.user !== undefined) params.user = args.user as string;
      if (args.series_uid !== undefined) params.seriesUid = args.series_uid as string;
      if (args.after !== undefined) params.after = args.after as string;
      if (args.before !== undefined) params.before = args.before as string;
      if (args.newer_than !== undefined) params.newerThan = args.newer_than as number;
      if (args.older_than !== undefined) params.olderThan = args.older_than as number;
      if (args.page_size !== undefined) params.pageSize = args.page_size as number;
      if (args.tz !== undefined) params.tz = args.tz as string;
      logger.info("API call: activities.list", { params });
      try {
        // Field names on the activities envelope are undocumented, so the raw
        // response goes through unshaped.
        const result = await client.devices.listActivities(params as never);
        logger.debug("API response: activities.list", {});
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_activities_list", err);
      }
    }

    default:
      return toolError("INVALID_ARGS", `Unknown automation tool: ${toolName}`);
  }
}

export const automationHandler: DomainHandler = {
  getTools,
  handleCall,
};
