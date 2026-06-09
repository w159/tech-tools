/**
 * Users domain handler
 *
 * Provides tools for KnowBe4 user management:
 * - List users with filtering
 * - Get user details
 * - Get user risk score history
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { apiRequest } from "../utils/client.js";
import { logger } from "../utils/logger.js";
import { elicitText, elicitSelection } from "../utils/elicitation.js";
import { shapeList, shapeItem, extractShapeArgs, type SummaryFn } from "../../../_shared/response-shaper.js";
import { toolErrorFromCatch, toolError } from "../../../_shared/error-envelope.js";

// Compact summary for user list results
const userSummary: SummaryFn = (u) => ({
  id: u["id"],
  email: u["email"],
  first_name: u["first_name"],
  last_name: u["last_name"],
  status: u["status"],
  phish_prone_percentage: u["phish_prone_percentage"],
  current_risk_score: u["current_risk_score"],
  groups_count: Array.isArray(u["groups"]) ? (u["groups"] as unknown[]).length : u["groups_count"],
});

// Compact summary for risk score history entries
const riskHistorySummary: SummaryFn = (item) => ({
  risk_score: item["risk_score"],
  date: item["date"],
});

function getTools(): Tool[] {
  return [
    {
      name: "knowbe4_users_list",
      description:
        "List KnowBe4 users; optionally filter by status (active/archived) or group_id. Returns a compact summary (id, email, name, status, phish-prone %, risk score, groups count) by default — pass full=true or fields=[...] for more. Use to get user IDs for other tools.",
      inputSchema: {
        type: "object" as const,
        properties: {
          status: {
            type: "string",
            enum: ["active", "archived"],
            description: "Filter by user status (active or archived)",
          },
          group_id: {
            type: "number",
            description: "Filter by group ID to list only members of a specific group",
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
              "Optional. When true, return the complete vendor object without field filtering. Use only when you need fields not present in the default summary.",
          },
        },
      },
    },
    {
      name: "knowbe4_users_get",
      description:
        "Get detailed information about a specific KnowBe4 user by ID. Returns a compact summary (id, email, name, status, phish-prone %, risk score, groups count) by default — pass full=true or fields=[...] for more, including training status and full group memberships.",
      inputSchema: {
        type: "object" as const,
        properties: {
          user_id: {
            type: "number",
            description: "The user ID to retrieve (required)",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description:
              'Optional. Array of field names to include in the response (e.g. ["id","email","phish_prone_percentage","groups"]). Overrides the default compact summary.',
          },
          full: {
            type: "boolean",
            description:
              "Optional. When true, return the complete vendor object without field filtering.",
          },
        },
        required: ["user_id"],
      },
    },
    {
      name: "knowbe4_users_risk_score_history",
      description:
        "Get a specific user's risk score history over time. Useful for tracking individual improvement in security awareness.",
      inputSchema: {
        type: "object" as const,
        properties: {
          user_id: {
            type: "number",
            description: "The user ID to get risk score history for (required)",
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
        required: ["user_id"],
      },
    },
  ];
}

async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (toolName) {
    case "knowbe4_users_list": {
      try {
        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;
        let status = args.status as string | undefined;
        const groupId = args.group_id as number | undefined;

        // If no filters provided, ask the user what they want to see
        if (!status && !groupId) {
          const filterChoice = await elicitSelection(
            "No filters specified. Would you like to filter users?",
            "filter",
            [
              { value: "active", label: "Active users only" },
              { value: "archived", label: "Archived users only" },
              { value: "all", label: "All users" },
            ]
          );
          if (filterChoice && filterChoice !== "all") {
            status = filterChoice;
          }
        }

        logger.info("API call: users.list", { page, perPage, status, groupId });

        const params: Record<string, string | number | boolean | undefined> = {
          page,
          per_page: perPage,
        };
        if (status) params.status = status;
        if (groupId) params.group_id = groupId;

        const result = await apiRequest<unknown>("/v1/users", { params });
        const users = Array.isArray(result) ? result : (result as Record<string, unknown>)?.users ?? result;
        const items = Array.isArray(users) ? users as Record<string, unknown>[] : [];

        logger.debug("API response: users.list", { count: items.length });

        const shapeArgs = extractShapeArgs(args);
        return shapeList(
          items,
          userSummary,
          shapeArgs,
          undefined,
          `Pass page=${page + 1} to get the next page.`
        );
      } catch (err) {
        return toolErrorFromCatch("knowbe4_users_list", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    case "knowbe4_users_get": {
      try {
        const userId = args.user_id as number;
        if (!userId) {
          return toolError("INVALID_ARGS", "user_id is required.", {
            hint: "Pass the integer user ID returned by knowbe4_users_list.",
          });
        }

        logger.info("API call: users.get", { userId });
        const result = await apiRequest<Record<string, unknown>>(`/v1/users/${userId}`);
        logger.debug("API response: users.get", { userId });

        const shapeArgs = extractShapeArgs(args);
        return shapeItem(result, userSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_users_get", err, {
          hint: "Verify the user_id with knowbe4_users_list first.",
        });
      }
    }

    case "knowbe4_users_risk_score_history": {
      try {
        const userId = args.user_id as number;
        if (!userId) {
          return toolError("INVALID_ARGS", "user_id is required.", {
            hint: "Pass the integer user ID returned by knowbe4_users_list.",
          });
        }

        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;

        logger.info("API call: users.riskScoreHistory", { userId, page, perPage });
        const result = await apiRequest<unknown>(`/v1/users/${userId}/risk_score_history`, {
          params: { page, per_page: perPage },
        });

        const history = Array.isArray(result) ? result : (result as Record<string, unknown>)?.data ?? result;
        const items = Array.isArray(history) ? history as Record<string, unknown>[] : [];

        logger.debug("API response: users.riskScoreHistory", { count: items.length });

        const shapeArgs = extractShapeArgs(args);
        return shapeList(
          items,
          riskHistorySummary,
          shapeArgs,
          undefined,
          `Pass page=${page + 1} to get the next page.`
        );
      } catch (err) {
        return toolErrorFromCatch("knowbe4_users_risk_score_history", err, {
          hint: "Verify the user_id with knowbe4_users_list first.",
        });
      }
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown users tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const usersHandler: DomainHandler = {
  getTools,
  handleCall,
};
