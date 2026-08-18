/**
 * Directory domain handler
 *
 * Provides read tools for the NinjaOne org-structure surface: policies,
 * saved device groups, and the flat catalogs (users, locations, roles,
 * node-classes). These resolve a saved group to devices, list technicians,
 * and read policy assignments.
 *
 * Response field names for these endpoints are not documented anywhere
 * reachable from this repo, so every tool passes vendor records through
 * unshaped (shapeRaw) rather than guessing a summary shape.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { logger } from "../utils/logger.js";
import {
  shapeRaw,
  SHAPE_PROPS,
  toolError,
  toolErrorFromCatch,
} from "./_helpers.js";

// ---------------------------------------------------------------------------
// Client extension
// ---------------------------------------------------------------------------

/**
 * The four flat catalogs reachable through GET /v2/{kind}.
 */
type DirectoryListKind = "users" | "locations" | "roles" | "node-classes";

const DIRECTORY_LIST_KINDS: DirectoryListKind[] = ["users", "locations", "roles", "node-classes"];

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

function getTools(): Tool[] {
  return [
    {
      name: "ninjaone_policies_list",
      description: "List NinjaOne policies. Returns policy IDs and names used to scope device and organization configuration.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
        },
      },
    },
    {
      name: "ninjaone_policies_get",
      description:
        "Get a NinjaOne policy by policy_id (required). Set include_conditions to also fetch and return the conditions configured on the policy.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          policy_id: {
            type: "number",
            description: "Integer NinjaOne policy ID.",
          },
          include_conditions: {
            type: "boolean",
            description: "When true, also fetch the policy's conditions and include them in the response.",
          },
        },
        required: ["policy_id"],
      },
    },
    {
      name: "ninjaone_groups_list",
      description: "List NinjaOne saved device groups. Returns group IDs and names used with ninjaone_groups_device_ids to resolve group membership.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
        },
      },
    },
    {
      name: "ninjaone_groups_device_ids",
      description:
        "Resolve a NinjaOne saved group (group_id, required) to its member device IDs. Use this output as the device_id list for other device tools.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          group_id: {
            type: "number",
            description: "Integer NinjaOne saved group ID. Use ninjaone_groups_list to get IDs.",
          },
        },
        required: ["group_id"],
      },
    },
    {
      name: "ninjaone_directory_list",
      description:
        "List a flat NinjaOne directory catalog: users (technicians and end users), locations (sites across all organizations), roles (device roles), or node-classes (available device classes).",
      inputSchema: {
        type: "object" as const,
        properties: {
          ...SHAPE_PROPS,
          kind: {
            type: "string",
            enum: DIRECTORY_LIST_KINDS,
            description: "Which flat catalog to list.",
          },
        },
        required: ["kind"],
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

  switch (toolName) {
    case "ninjaone_policies_list": {
      logger.info("API call: directory.listPolicies");
      try {
        const policies = await client.directory.listPolicies();
        return shapeRaw(policies);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_policies_list", err, {
          hint: "Verify NINJAONE_CLIENT_ID, NINJAONE_CLIENT_SECRET, and NINJAONE_REGION are set.",
        });
      }
    }

    case "ninjaone_policies_get": {
      const policyId = args.policy_id as number;
      const includeConditions = args.include_conditions === true;
      logger.info("API call: directory.getPolicy", { policyId, includeConditions });
      try {
        const policy = await client.directory.getPolicy(policyId);
        if (!includeConditions) {
          return shapeRaw(policy);
        }
        const conditions = await client.directory.getPolicyConditions(policyId);
        return shapeRaw({ policy, conditions });
      } catch (err) {
        return toolErrorFromCatch("ninjaone_policies_get", err, {
          hint: "Verify policy_id with ninjaone_policies_list first.",
        });
      }
    }

    case "ninjaone_groups_list": {
      logger.info("API call: directory.listGroups");
      try {
        const groups = await client.directory.listGroups();
        return shapeRaw(groups);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_groups_list", err, {
          hint: "Verify NINJAONE_CLIENT_ID, NINJAONE_CLIENT_SECRET, and NINJAONE_REGION are set.",
        });
      }
    }

    case "ninjaone_groups_device_ids": {
      const groupId = args.group_id as number;
      logger.info("API call: directory.getGroupDeviceIds", { groupId });
      try {
        const deviceIds = await client.directory.getGroupDeviceIds(groupId);
        return shapeRaw(deviceIds);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_groups_device_ids", err, {
          hint: "Verify group_id with ninjaone_groups_list first.",
        });
      }
    }

    case "ninjaone_directory_list": {
      const kind = args.kind as DirectoryListKind;
      if (!DIRECTORY_LIST_KINDS.includes(kind)) {
        return toolError(
          "INVALID_ARGS",
          `Invalid kind "${String(args.kind)}". Must be one of: ${DIRECTORY_LIST_KINDS.join(", ")}.`
        );
      }
      logger.info("API call: directory.list", { kind });
      try {
        const items = await client.directory.list(kind);
        return shapeRaw(items);
      } catch (err) {
        return toolErrorFromCatch("ninjaone_directory_list", err, {
          hint: `Verify NINJAONE_CLIENT_ID, NINJAONE_CLIENT_SECRET, and NINJAONE_REGION are set.`,
        });
      }
    }

    default:
      return toolError("INVALID_ARGS", `Unknown directory tool: ${toolName}`);
  }
}

export const directoryHandler: DomainHandler = {
  getTools,
  handleCall,
};
