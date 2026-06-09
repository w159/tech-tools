/**
 * Account domain handler
 *
 * Provides tools for KnowBe4 account-level information:
 * - Get account details and subscription info
 * - Get account risk score history
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { apiRequest } from "../utils/client.js";
import { logger } from "../utils/logger.js";
import { shapeRaw, shapeList, extractShapeArgs, type SummaryFn } from "../../../_shared/response-shaper.js";
import { toolErrorFromCatch } from "../../../_shared/error-envelope.js";

// Compact summary for risk score history entries
const riskHistorySummary: SummaryFn = (item) => ({
  risk_score: item["risk_score"],
  date: item["date"],
});

function getTools(): Tool[] {
  return [
    {
      name: "knowbe4_account_get",
      description:
        "Retrieve KnowBe4 account details: subscription level, seat count, admin info, and current overall risk score. Use to confirm API connectivity or get high-level account stats.",
      inputSchema: {
        type: "object" as const,
        properties: {
          fields: {
            type: "array",
            items: { type: "string" },
            description:
              'Optional. Array of field names to include in the response (e.g. ["name","current_risk_score","number_of_seats"]). Overrides the default compact summary. Use to retrieve specific fields without requesting the full object.',
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
      name: "knowbe4_account_risk_score_history",
      description:
        "Retrieve the KnowBe4 account-level risk score history over time. Returns paginated score snapshots. Use to track security posture improvement trends.",
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
              'Optional. Array of field names to include in the response (e.g. ["risk_score","date"]). Overrides the default compact summary.',
          },
          full: {
            type: "boolean",
            description:
              "Optional. When true, return the complete vendor object without field filtering.",
          },
        },
      },
    },
  ];
}

async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (toolName) {
    case "knowbe4_account_get": {
      try {
        logger.info("API call: account.get");
        const result = await apiRequest<Record<string, unknown>>("/v1/account");
        logger.debug("API response: account.get", { hasResult: !!result });
        return shapeRaw(result);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_account_get", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    case "knowbe4_account_risk_score_history": {
      try {
        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;
        logger.info("API call: account.riskScoreHistory", { page, perPage });
        const result = await apiRequest<unknown>("/v1/account/risk_score_history", {
          params: { page, per_page: perPage },
        });
        const history = Array.isArray(result) ? result : (result as Record<string, unknown>)?.data ?? result;
        const items = Array.isArray(history) ? history as Record<string, unknown>[] : [];
        logger.debug("API response: account.riskScoreHistory", { count: items.length });
        const shapeArgs = extractShapeArgs(args);
        return shapeList(
          items,
          riskHistorySummary,
          shapeArgs,
          undefined,
          `Pass page=${page + 1} to get the next page.`
        );
      } catch (err) {
        return toolErrorFromCatch("knowbe4_account_risk_score_history", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown account tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const accountHandler: DomainHandler = {
  getTools,
  handleCall,
};
