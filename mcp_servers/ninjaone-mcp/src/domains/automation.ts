/**
 * Automation domain handler
 *
 * Provides tools for the NinjaOne script catalog and job visibility surface
 * (GET /v2/scripts, GET /v2/jobs, docs/vendors/ninjaone/api-reference.md:148-149).
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { logger } from "../utils/logger.js";
import {
  shapeList,
  extractShapeArgs,
  SHAPE_PROPS,
  toolError,
  toolErrorFromCatch,
} from "./_helpers.js";

// ---------------------------------------------------------------------------
// Param helpers
// ---------------------------------------------------------------------------

/**
 * Build the /v2/jobs request params from tool args.
 *
 * organization_id is translated to `df: "org = <id>"` because /v2/jobs has no
 * organizationId param — sending one filters nothing and returns a
 * whole-tenant result that reads like a scoped one. device_filter, when
 * given, is a raw df and overrides the organization_id translation.
 */
function buildJobParams(args: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
  const params: Record<string, string | number | boolean | undefined> = {};

  const deviceFilter = args.device_filter as string | undefined;
  const organizationId = args.organization_id as number | undefined;
  if (deviceFilter) {
    params.df = deviceFilter;
  } else if (organizationId !== undefined) {
    params.df = `org = ${organizationId}`;
  }

  if (args.page_size !== undefined) params.pageSize = args.page_size as number;
  if (args.cursor !== undefined) params.cursor = args.cursor as string;

  return params;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function getTools(): Tool[] {
  return [
    {
      name: "ninjaone_scripts_list",
      description:
        "List the NinjaOne script catalog (GET /v2/scripts). This is how you find a scriptId to pass to ninjaone_devices_script_run.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
        },
      },
    },
    {
      name: "ninjaone_jobs_list",
      description:
        "List scheduled and running NinjaOne jobs (GET /v2/jobs). Use organization_id or device_filter to scope results — this endpoint accepts no organizationId param.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          organization_id: {
            type: "number",
            description:
              'Integer NinjaOne organization ID; translated to df="org = <id>" since /jobs has no organizationId param. Overridden by device_filter when both are given.',
          },
          device_filter: {
            type: "string",
            description: "Raw device filter (df) expression. Overrides organization_id when both are given.",
          },
          page_size: {
            type: "number",
            description: "Page size — maximum jobs to return in one call.",
          },
          cursor: {
            type: "string",
            description: "Opaque pagination cursor from the previous page response.",
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
      logger.info("API call: automation.listScripts", {});
      try {
        const scripts = await client.automation.listScripts();
        logger.debug("API response: automation.listScripts", { count: scripts.length });
        // Response field names for /scripts are undocumented; pass records
        // through unshaped rather than guess a schema.
        return shapeList(scripts as Record<string, unknown>[], undefined, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_scripts_list", err, {
          hint: "Verify NINJAONE_CLIENT_ID, NINJAONE_CLIENT_SECRET, and NINJAONE_REGION are set.",
        });
      }
    }

    case "ninjaone_jobs_list": {
      const params = buildJobParams(args);
      logger.info("API call: automation.listJobs", { params });
      try {
        const jobs = await client.automation.listJobs(params);
        logger.debug("API response: automation.listJobs", { count: jobs.length });
        // Response field names for /jobs are undocumented; pass records
        // through unshaped rather than guess a schema.
        return shapeList(jobs as Record<string, unknown>[], undefined, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_jobs_list", err, {
          hint: "Verify NINJAONE_CLIENT_ID, NINJAONE_CLIENT_SECRET, and NINJAONE_REGION are set.",
        });
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
