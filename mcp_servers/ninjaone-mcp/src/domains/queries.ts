/**
 * Queries domain handler
 *
 * Provides tools for the NinjaOne cross-org fleet-reporting surface
 * (GET /v2/queries/*, docs/vendors/ninjaone/api-reference.md:118-136).
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { logger } from "../utils/logger.js";
import {
  shapeRaw,
  extractShapeArgs,
  SHAPE_PROPS,
  toolError,
  toolErrorFromCatch,
} from "./_helpers.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Every GET /v2/queries/{name} endpoint in the NinjaRMM v2 spec.
 *
 * All 24 take the same df/pageSize/cursor contract and return
 * { cursor, results }. Keeping the list complete here is what lets an agent
 * answer a fleet question without knowing the REST surface.
 */
const QUERY_NAMES = [
  "antivirus-status",
  "antivirus-threats",
  "backup/usage",
  "computer-systems",
  "custom-fields",
  "custom-fields-detailed",
  "device-health",
  "disks",
  "logged-on-users",
  "network-interfaces",
  "operating-systems",
  "os-patch-installs",
  "os-patches",
  "policy-overrides",
  "processors",
  "raid-controllers",
  "raid-drives",
  "scoped-custom-fields",
  "scoped-custom-fields-detailed",
  "software",
  "software-patch-installs",
  "software-patches",
  "volumes",
  "windows-services",
] as const;

/** One-line purpose per query, inlined into the tool description. */
const QUERY_GUIDE = [
  "antivirus-status: AV product name, state and definition age per device",
  "antivirus-threats: detected threats with device and detection time",
  "backup/usage: backup storage consumed per device",
  "computer-systems: make, model, serial, chassis and BIOS per device",
  "custom-fields / custom-fields-detailed: device custom field values (detailed adds metadata)",
  "device-health: overall health rollup per device",
  "disks: physical disk model, size, SMART status",
  "logged-on-users: last logged-on user per device",
  "network-interfaces: NICs, MACs and IP addresses",
  "operating-systems: OS name, build, install date, architecture",
  "os-patches: pending, failed and rejected OS patches (supports status/type/severity)",
  "os-patch-installs: OS patch installation history (supports installed_after/before)",
  "policy-overrides: per-device deviations from assigned policy",
  "processors: CPU model, cores, clock speed",
  "raid-controllers / raid-drives: RAID hardware health",
  "scoped-custom-fields / scoped-custom-fields-detailed: custom fields limited to the API app's scope",
  "software: installed software inventory across the fleet",
  "software-patches: pending, failed and rejected third-party patches",
  "software-patch-installs: third-party patch installation history",
  "volumes: logical volumes with capacity and free space",
  "windows-services: service name, state and start type across the fleet",
].join("; ");

type QueryName = (typeof QUERY_NAMES)[number];

// ---------------------------------------------------------------------------
// Param helpers
// ---------------------------------------------------------------------------

/**
 * Normalize an ISO 8601 timestamp or epoch-seconds value (number or numeric
 * string) to epoch seconds. Returns undefined on anything unparseable so a
 * typo drops the filter instead of sending NaN — a silent empty-result set
 * that reads like a real (if narrow) answer is the failure being prevented.
 */
function toEpochSeconds(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.floor(value) : undefined;
  }
  const str = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(str)) {
    const n = Number(str);
    return Number.isFinite(n) ? Math.floor(n) : undefined;
  }
  const parsedMs = Date.parse(str);
  return Number.isNaN(parsedMs) ? undefined : Math.floor(parsedMs / 1000);
}

/**
 * Build the /v2/queries/* request params from tool args.
 *
 * organization_id is translated to `df: "org = <id>"` because these endpoints
 * have no organizationId param — sending one filters nothing and returns a
 * whole-tenant result that reads like a scoped one. device_filter, when
 * given, is a raw df and overrides the organization_id translation.
 */
function buildQueryParams(args: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
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
  if (args.status !== undefined) params.status = args.status as string;
  if (args.type !== undefined) params.type = args.type as string;
  if (args.severity !== undefined) params.severity = args.severity as string;
  if (args.product_name !== undefined) params.productName = args.product_name as string;
  if (args.product_state !== undefined) params.productState = args.product_state as string;

  // Only meaningful for os-patch-installs, but passed through regardless
  // (the query endpoint ignores params it doesn't recognize).
  const after = toEpochSeconds(args.installed_after);
  if (after !== undefined) params.installedAfter = after;
  const before = toEpochSeconds(args.installed_before);
  if (before !== undefined) params.installedBefore = before;

  return params;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const FILTER_PROPS = {
  organization_id: {
    type: "number",
    description:
      'Integer NinjaOne organization ID; translated to df="org = <id>" since /queries/* has no organizationId param. Overridden by device_filter when both are given.',
  },
  device_filter: {
    type: "string",
    description: "Raw device filter (df) expression. Overrides organization_id when both are given.",
  },
  page_size: {
    type: "number",
    description: "Page size for the results array.",
  },
  cursor: {
    type: "string",
    description: "Opaque pagination cursor from a previous response's cursor.name.",
  },
  installed_after: {
    type: "string",
    description:
      "Only meaningful for query=os-patch-installs. ISO 8601 timestamp or epoch seconds; sent as epoch seconds. An unparseable value drops the filter rather than sending an invalid request.",
  },
  installed_before: {
    type: "string",
    description:
      "Only meaningful for query=os-patch-installs. ISO 8601 timestamp or epoch seconds; sent as epoch seconds. An unparseable value drops the filter rather than sending an invalid request.",
  },
  status: {
    type: "string",
    description:
      "Patch status filter for os-patches / software-patches (e.g. APPROVED, FAILED, REJECTED, PENDING). Ignored by queries that do not support it.",
  },
  type: {
    type: "string",
    description:
      "Patch type filter for os-patches / software-patches (e.g. PATCH, INSTALLER, FEATURE_PACK).",
  },
  severity: {
    type: "string",
    description:
      "Patch severity filter for os-patches / software-patches (e.g. CRITICAL, IMPORTANT, MODERATE, LOW, OPTIONAL). Use this for a fleet-wide critical-patch-missing report.",
  },
  product_name: {
    type: "string",
    description: "Antivirus product name filter; only meaningful for query=antivirus-status.",
  },
  product_state: {
    type: "string",
    description: "Antivirus product state filter; only meaningful for query=antivirus-status.",
  },
} as const;

function getTools(): Tool[] {
  return [
    {
      name: "ninjaone_queries_run",
      description:
        "Run a NinjaOne cross-org fleet-reporting query (GET /v2/queries/{query}). This is the primary tool for any fleet-wide question: patch compliance, antivirus posture, hardware and software inventory, disk capacity, logged-on users. It returns data for every device the API app can see in one call, so prefer it over looping ninjaone_devices_inventory per device. " +
        "Scope with organization_id or device_filter (these endpoints accept no organizationId param). Page with page_size plus the cursor from the previous response. Results are unshaped vendor records. " +
        "Available queries -- " + QUERY_GUIDE + ".",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          ...FILTER_PROPS,
          query: {
            type: "string",
            enum: [...QUERY_NAMES],
            description:
              "Which fleet-reporting query to run. See the tool description for what each one returns.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "ninjaone_vulnerability_scan_groups",
      description:
        "List NinjaOne vulnerability scan groups, or read one by scan_group_id (GET /v2/vulnerability/scan-groups). Scope note: the public v2 API exposes only scan-group configuration here, not per-device CVE findings. For actual vulnerability posture use ninjaone_queries_run with query=os-patches (severity=CRITICAL), software-patches, or antivirus-threats.",
      inputSchema: {
        type: "object" as const,
        properties: {
          scan_group_id: {
            type: "string",
            description: "Scan group identifier. Omit to list every scan group.",
          },
        },
      },
    },
    {
      name: "ninjaone_devices_os_patch_installs",
      description:
        "Get OS patch install history. With device_id, hits the device-scoped endpoint (GET /v2/device/{id}/os-patch-installs). Without it, routes to the cross-org query (GET /v2/queries/os-patch-installs), scoped by organization_id or device_filter.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          ...FILTER_PROPS,
          device_id: {
            type: "number",
            description: "Integer NinjaOne device ID. When present, queries that single device directly.",
          },
        },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Shared execution path for both ninjaone_queries_run and
 * ninjaone_devices_os_patch_installs — no duplicated routing logic.
 */
async function runQuery(
  queryName: QueryName,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const client = await getClient();
  const shapeArgs = extractShapeArgs(args);
  const params = buildQueryParams(args);
  const deviceId = args.device_id as number | undefined;

  logger.info("API call: queries.run", { query: queryName, deviceId, params });

  try {
    if (queryName === "os-patch-installs" && deviceId !== undefined) {
      const result = await client.queries.osPatchInstallsForDevice(deviceId, params);
      logger.debug("API response: queries.osPatchInstallsForDevice", { deviceId });
      // Response field names for /queries/* and device-scoped equivalents are
      // undocumented; pass records through unshaped rather than guess a schema.
      return shapeRaw(result);
    }

    const result = await client.queries.run(queryName, params);
    logger.debug("API response: queries.run", { query: queryName });
    return shapeRaw(result);
  } catch (err) {
    return toolErrorFromCatch("ninjaone_queries_run", err);
  }
}

async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (toolName) {
    case "ninjaone_queries_run": {
      const query = args.query as string | undefined;
      if (!query || !(QUERY_NAMES as readonly string[]).includes(query)) {
        return toolError("INVALID_ARGS", "query is required and must be one of the supported /queries/* endpoints.", {
          hint: `Valid values: ${QUERY_NAMES.join(", ")}`,
        });
      }
      return runQuery(query as QueryName, args);
    }

    case "ninjaone_devices_os_patch_installs": {
      return runQuery("os-patch-installs", args);
    }

    case "ninjaone_vulnerability_scan_groups": {
      const client = await getClient();
      const scanGroupId = args.scan_group_id as string | undefined;
      logger.info("API call: vulnerability.scanGroups", { scanGroupId });
      try {
        const result =
          scanGroupId === undefined
            ? await client.vulnerability.listScanGroups()
            : await client.vulnerability.getScanGroup(scanGroupId);
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_vulnerability_scan_groups", err);
      }
    }

    default:
      return toolError("INVALID_ARGS", `Unknown queries tool: ${toolName}`);
  }
}

export const queriesHandler: DomainHandler = {
  getTools,
  handleCall,
};
