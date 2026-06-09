/**
 * Groups domain handler
 *
 * Provides tools for KnowBe4 group management:
 * - List groups
 * - Get group details
 * - Get group members
 * - Get group risk score history
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { apiRequest } from "../utils/client.js";
import { logger } from "../utils/logger.js";
import { elicitText } from "../utils/elicitation.js";
import { shapeList, shapeItem, extractShapeArgs, type SummaryFn } from "../../../_shared/response-shaper.js";
import { toolErrorFromCatch, toolError } from "../../../_shared/error-envelope.js";

// Compact summary for group list results
const groupSummary: SummaryFn = (g) => ({
  id: g["id"],
  name: g["name"],
  member_count: g["member_count"],
  current_risk_score: g["current_risk_score"],
  status: g["status"],
});

// Compact summary for group member results (same fields as userSummary but standalone)
const memberSummary: SummaryFn = (u) => ({
  id: u["id"],
  email: u["email"],
  first_name: u["first_name"],
  last_name: u["last_name"],
  status: u["status"],
  phish_prone_percentage: u["phish_prone_percentage"],
  current_risk_score: u["current_risk_score"],
});

// Compact summary for risk score history entries
const riskHistorySummary: SummaryFn = (item) => ({
  risk_score: item["risk_score"],
  date: item["date"],
});

function getTools(): Tool[] {
  return [
    {
      name: "knowbe4_groups_list",
      description:
        "List all KnowBe4 groups. Returns a compact summary (id, name, member count, current risk score, status) by default — pass full=true or fields=[...] for more.",
      inputSchema: {
        type: "object" as const,
        properties: {
          page: {
            type: "number",
            description: "Page number for pagination (default: 1)",
          },
          per_page: {
            type: "number",
            description: "Number of results per page (default: 100, max: 500)",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description:
              'Optional. Array of field names to include in the response (e.g. ["id","name","member_count"]). Overrides the default compact summary.',
          },
          full: {
            type: "boolean",
            description:
              "Optional. When true, return the complete vendor object without field filtering.",
          },
        },
      },
    },
    {
      name: "knowbe4_groups_get",
      description:
        "Get detailed information about a specific KnowBe4 group by ID. Returns a compact summary (id, name, member count, risk score, status) by default — pass full=true or fields=[...] for more.",
      inputSchema: {
        type: "object" as const,
        properties: {
          group_id: {
            type: "number",
            description: "The group ID to retrieve (required)",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description:
              'Optional. Array of field names to include in the response (e.g. ["id","name","current_risk_score"]). Overrides the default compact summary.',
          },
          full: {
            type: "boolean",
            description:
              "Optional. When true, return the complete vendor object without field filtering.",
          },
        },
        required: ["group_id"],
      },
    },
    {
      name: "knowbe4_groups_members",
      description:
        "Get all members of a specific group. Returns a compact user summary (id, email, name, status, phish-prone %, risk score) by default — pass full=true or fields=[...] for more.",
      inputSchema: {
        type: "object" as const,
        properties: {
          group_id: {
            type: "number",
            description: "The group ID to get members for (required)",
          },
          page: {
            type: "number",
            description: "Page number for pagination (default: 1)",
          },
          per_page: {
            type: "number",
            description: "Number of results per page (default: 100, max: 500)",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description:
              'Optional. Array of field names to include in the response (e.g. ["id","email","phish_prone_percentage"]). Overrides the default compact summary.',
          },
          full: {
            type: "boolean",
            description:
              "Optional. When true, return the complete vendor object without field filtering.",
          },
        },
        required: ["group_id"],
      },
    },
    {
      name: "knowbe4_groups_risk_score_history",
      description:
        "Get a group's risk score history over time. Useful for comparing security posture across departments or teams.",
      inputSchema: {
        type: "object" as const,
        properties: {
          group_id: {
            type: "number",
            description: "The group ID to get risk score history for (required)",
          },
          page: {
            type: "number",
            description: "Page number for pagination (default: 1)",
          },
          per_page: {
            type: "number",
            description: "Number of results per page (default: 100, max: 500)",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description:
              'Optional. Array of field names to include in the response (e.g. ["risk_score","date"]). Overrides the default compact summary.',
          },
          full: {
            type: "boolean",
            description:
              "Optional. When true, return the complete vendor object without field filtering.",
          },
        },
        required: ["group_id"],
      },
    },
  ];
}

async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (toolName) {
    case "knowbe4_groups_list": {
      try {
        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;

        logger.info("API call: groups.list", { page, perPage });
        const result = await apiRequest<unknown>("/v1/groups", {
          params: { page, per_page: perPage },
        });

        const groups = Array.isArray(result) ? result : (result as Record<string, unknown>)?.groups ?? result;
        const items = Array.isArray(groups) ? groups as Record<string, unknown>[] : [];

        logger.debug("API response: groups.list", { count: items.length });

        const shapeArgs = extractShapeArgs(args);
        return shapeList(
          items,
          groupSummary,
          shapeArgs,
          undefined,
          `Pass page=${page + 1} to get the next page.`
        );
      } catch (err) {
        return toolErrorFromCatch("knowbe4_groups_list", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    case "knowbe4_groups_get": {
      try {
        const groupId = args.group_id as number;
        if (!groupId) {
          return toolError("INVALID_ARGS", "group_id is required.", {
            hint: "Pass the integer group ID returned by knowbe4_groups_list.",
          });
        }

        logger.info("API call: groups.get", { groupId });
        const result = await apiRequest<Record<string, unknown>>(`/v1/groups/${groupId}`);
        logger.debug("API response: groups.get", { groupId });

        const shapeArgs = extractShapeArgs(args);
        return shapeItem(result, groupSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_groups_get", err, {
          hint: "Verify the group_id with knowbe4_groups_list first.",
        });
      }
    }

    case "knowbe4_groups_members": {
      try {
        const groupId = args.group_id as number;
        if (!groupId) {
          return toolError("INVALID_ARGS", "group_id is required.", {
            hint: "Pass the integer group ID returned by knowbe4_groups_list.",
          });
        }

        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;

        logger.info("API call: groups.members", { groupId, page, perPage });
        const result = await apiRequest<unknown>(`/v1/groups/${groupId}/members`, {
          params: { page, per_page: perPage },
        });

        const members = Array.isArray(result) ? result : (result as Record<string, unknown>)?.members ?? result;
        const items = Array.isArray(members) ? members as Record<string, unknown>[] : [];

        logger.debug("API response: groups.members", { count: items.length });

        const shapeArgs = extractShapeArgs(args);
        return shapeList(
          items,
          memberSummary,
          shapeArgs,
          undefined,
          `Pass page=${page + 1} to get the next page.`
        );
      } catch (err) {
        return toolErrorFromCatch("knowbe4_groups_members", err, {
          hint: "Verify the group_id with knowbe4_groups_list first.",
        });
      }
    }

    case "knowbe4_groups_risk_score_history": {
      try {
        const groupId = args.group_id as number;
        if (!groupId) {
          return toolError("INVALID_ARGS", "group_id is required.", {
            hint: "Pass the integer group ID returned by knowbe4_groups_list.",
          });
        }

        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;

        logger.info("API call: groups.riskScoreHistory", { groupId, page, perPage });
        const result = await apiRequest<unknown>(`/v1/groups/${groupId}/risk_score_history`, {
          params: { page, per_page: perPage },
        });

        const history = Array.isArray(result) ? result : (result as Record<string, unknown>)?.data ?? result;
        const items = Array.isArray(history) ? history as Record<string, unknown>[] : [];

        logger.debug("API response: groups.riskScoreHistory", { count: items.length });

        const shapeArgs = extractShapeArgs(args);
        return shapeList(
          items,
          riskHistorySummary,
          shapeArgs,
          undefined,
          `Pass page=${page + 1} to get the next page.`
        );
      } catch (err) {
        return toolErrorFromCatch("knowbe4_groups_risk_score_history", err, {
          hint: "Verify the group_id with knowbe4_groups_list first.",
        });
      }
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown groups tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const groupsHandler: DomainHandler = {
  getTools,
  handleCall,
};
