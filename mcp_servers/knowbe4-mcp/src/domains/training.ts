/**
 * Training domain handler
 *
 * Provides tools for KnowBe4 training management:
 * - List and get training campaigns
 * - List and get training enrollments
 * - List and get store purchases
 * - List and get policies
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { apiRequest } from "../utils/client.js";
import { logger } from "../utils/logger.js";
import { elicitSelection } from "../utils/elicitation.js";
import { shapeList, shapeItem, extractShapeArgs, type SummaryFn } from "../../../_shared/response-shaper.js";
import { toolErrorFromCatch, toolError } from "../../../_shared/error-envelope.js";

// Compact summary for training campaign list results
const trainingCampaignSummary: SummaryFn = (c) => ({
  campaign_id: c["campaign_id"] ?? c["id"],
  name: c["name"],
  status: c["status"],
  start_date: c["start_date"],
  end_date: c["end_date"],
  enrollment_count: c["enrollment_count"],
  completion_count: c["completion_count"],
});

// Compact summary for training enrollment list results
const enrollmentSummary: SummaryFn = (e) => ({
  enrollment_id: e["enrollment_id"] ?? e["id"],
  user_id: (e["user"] as Record<string, unknown> | undefined)?.id ?? e["user_id"],
  user_email: (e["user"] as Record<string, unknown> | undefined)?.email ?? e["user_email"],
  module_name: (e["module_name"] as string | undefined) ?? (e["content"] as Record<string, unknown> | undefined)?.name,
  status: e["status"],
  start_date: e["start_date"],
  completion_date: e["completion_date"],
});

// Compact summary for store purchases
const purchaseSummary: SummaryFn = (p) => ({
  store_purchase_id: p["store_purchase_id"] ?? p["id"],
  name: p["name"],
  type: p["type"],
  published_date: p["published_date"],
  publisher: p["publisher"],
});

// Compact summary for policies
const policySummary: SummaryFn = (p) => ({
  policy_id: p["policy_id"] ?? p["id"],
  name: p["name"],
  status: p["status"],
  minimum_time: p["minimum_time"],
  default_language: p["default_language"],
});

function getTools(): Tool[] {
  return [
    {
      name: "knowbe4_training_campaigns_list",
      description:
        "List all training campaigns. Returns a compact summary (id, name, status, start/end dates, enrollment/completion counts) by default — pass full=true or fields=[...] for more.",
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
              'Optional. Array of field names to include in the response (e.g. ["campaign_id","name","status"]). Overrides the default compact summary.',
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
      name: "knowbe4_training_campaigns_get",
      description:
        "Get detailed information about a specific training campaign by ID, including modules, enrollments, and completion statistics. Returns compact summary by default — pass full=true or fields=[...] for more.",
      inputSchema: {
        type: "object" as const,
        properties: {
          campaign_id: {
            type: "number",
            description: "The training campaign ID (required)",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description:
              'Optional. Array of field names to include in the response. Overrides the default compact summary.',
          },
          full: {
            type: "boolean",
            description:
              "Optional. When true, return the complete vendor object without field filtering.",
          },
        },
        required: ["campaign_id"],
      },
    },
    {
      name: "knowbe4_training_enrollments_list",
      description:
        "List all training enrollments. Returns a compact summary (enrollment id, user id/email, module name, status, start/completion dates) by default — pass full=true or fields=[...] for more.",
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
              'Optional. Array of field names to include in the response (e.g. ["enrollment_id","status","completion_date"]). Overrides the default compact summary.',
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
      name: "knowbe4_training_enrollments_get",
      description:
        "Get detailed information about a specific training enrollment by ID, including module progress and completion date. Returns compact summary by default — pass full=true or fields=[...] for more.",
      inputSchema: {
        type: "object" as const,
        properties: {
          enrollment_id: {
            type: "number",
            description: "The enrollment ID (required)",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description:
              'Optional. Array of field names to include in the response. Overrides the default compact summary.',
          },
          full: {
            type: "boolean",
            description:
              "Optional. When true, return the complete vendor object without field filtering.",
          },
        },
        required: ["enrollment_id"],
      },
    },
    {
      name: "knowbe4_store_purchases_list",
      description:
        "List all store purchases (training content bought from the KnowBe4 ModStore). Returns a compact summary (id, name, type, published date, publisher) by default — pass full=true or fields=[...] for more.",
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
              'Optional. Array of field names to include in the response. Overrides the default compact summary.',
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
      name: "knowbe4_store_purchases_get",
      description:
        "Get detailed information about a specific store purchase by ID. Returns compact summary by default — pass full=true or fields=[...] for more.",
      inputSchema: {
        type: "object" as const,
        properties: {
          purchase_id: {
            type: "number",
            description: "The store purchase ID (required)",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description:
              'Optional. Array of field names to include in the response. Overrides the default compact summary.',
          },
          full: {
            type: "boolean",
            description:
              "Optional. When true, return the complete vendor object without field filtering.",
          },
        },
        required: ["purchase_id"],
      },
    },
    {
      name: "knowbe4_policies_list",
      description:
        "List all security policies. Returns a compact summary (id, name, status, minimum time, default language) by default — pass full=true or fields=[...] for more.",
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
              'Optional. Array of field names to include in the response (e.g. ["policy_id","name","status"]). Overrides the default compact summary.',
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
      name: "knowbe4_policies_get",
      description:
        "Get detailed information about a specific policy by ID, including acknowledgment status. Returns compact summary by default — pass full=true or fields=[...] for more.",
      inputSchema: {
        type: "object" as const,
        properties: {
          policy_id: {
            type: "number",
            description: "The policy ID (required)",
          },
          fields: {
            type: "array",
            items: { type: "string" },
            description:
              'Optional. Array of field names to include in the response. Overrides the default compact summary.',
          },
          full: {
            type: "boolean",
            description:
              "Optional. When true, return the complete vendor object without field filtering.",
          },
        },
        required: ["policy_id"],
      },
    },
  ];
}

async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (toolName) {
    case "knowbe4_training_campaigns_list": {
      try {
        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;

        logger.info("API call: training.campaigns.list", { page, perPage });
        const result = await apiRequest<unknown>("/v1/training/campaigns", {
          params: { page, per_page: perPage },
        });

        const campaigns = Array.isArray(result) ? result : (result as Record<string, unknown>)?.campaigns ?? result;
        const items = Array.isArray(campaigns) ? campaigns as Record<string, unknown>[] : [];

        logger.debug("API response: training.campaigns.list", { count: items.length });

        const shapeArgs = extractShapeArgs(args);
        return shapeList(items, trainingCampaignSummary, shapeArgs, undefined, `Pass page=${page + 1} to get the next page.`);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_training_campaigns_list", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    case "knowbe4_training_campaigns_get": {
      try {
        const campaignId = args.campaign_id as number;
        if (!campaignId) {
          return toolError("INVALID_ARGS", "campaign_id is required.", {
            hint: "Pass the integer campaign ID returned by knowbe4_training_campaigns_list.",
          });
        }

        logger.info("API call: training.campaigns.get", { campaignId });
        const result = await apiRequest<Record<string, unknown>>(`/v1/training/campaigns/${campaignId}`);

        const shapeArgs = extractShapeArgs(args);
        return shapeItem(result, trainingCampaignSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_training_campaigns_get", err, {
          hint: "Verify the campaign_id with knowbe4_training_campaigns_list first.",
        });
      }
    }

    case "knowbe4_training_enrollments_list": {
      try {
        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;

        logger.info("API call: training.enrollments.list", { page, perPage });
        const result = await apiRequest<unknown>("/v1/training/enrollments", {
          params: { page, per_page: perPage },
        });

        const enrollments = Array.isArray(result) ? result : (result as Record<string, unknown>)?.enrollments ?? result;
        const items = Array.isArray(enrollments) ? enrollments as Record<string, unknown>[] : [];

        logger.debug("API response: training.enrollments.list", { count: items.length });

        const shapeArgs = extractShapeArgs(args);
        return shapeList(items, enrollmentSummary, shapeArgs, undefined, `Pass page=${page + 1} to get the next page.`);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_training_enrollments_list", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    case "knowbe4_training_enrollments_get": {
      try {
        const enrollmentId = args.enrollment_id as number;
        if (!enrollmentId) {
          return toolError("INVALID_ARGS", "enrollment_id is required.", {
            hint: "Pass the integer enrollment ID returned by knowbe4_training_enrollments_list.",
          });
        }

        logger.info("API call: training.enrollments.get", { enrollmentId });
        const result = await apiRequest<Record<string, unknown>>(`/v1/training/enrollments/${enrollmentId}`);

        const shapeArgs = extractShapeArgs(args);
        return shapeItem(result, enrollmentSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_training_enrollments_get", err, {
          hint: "Verify the enrollment_id with knowbe4_training_enrollments_list first.",
        });
      }
    }

    case "knowbe4_store_purchases_list": {
      try {
        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;

        logger.info("API call: store.purchases.list", { page, perPage });
        const result = await apiRequest<unknown>("/v1/store/purchases", {
          params: { page, per_page: perPage },
        });

        const purchases = Array.isArray(result) ? result : (result as Record<string, unknown>)?.purchases ?? result;
        const items = Array.isArray(purchases) ? purchases as Record<string, unknown>[] : [];

        logger.debug("API response: store.purchases.list", { count: items.length });

        const shapeArgs = extractShapeArgs(args);
        return shapeList(items, purchaseSummary, shapeArgs, undefined, `Pass page=${page + 1} to get the next page.`);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_store_purchases_list", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    case "knowbe4_store_purchases_get": {
      try {
        const purchaseId = args.purchase_id as number;
        if (!purchaseId) {
          return toolError("INVALID_ARGS", "purchase_id is required.", {
            hint: "Pass the integer purchase ID returned by knowbe4_store_purchases_list.",
          });
        }

        logger.info("API call: store.purchases.get", { purchaseId });
        const result = await apiRequest<Record<string, unknown>>(`/v1/store/purchases/${purchaseId}`);

        const shapeArgs = extractShapeArgs(args);
        return shapeItem(result, purchaseSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_store_purchases_get", err, {
          hint: "Verify the purchase_id with knowbe4_store_purchases_list first.",
        });
      }
    }

    case "knowbe4_policies_list": {
      try {
        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;

        logger.info("API call: policies.list", { page, perPage });
        const result = await apiRequest<unknown>("/v1/policies", {
          params: { page, per_page: perPage },
        });

        const policies = Array.isArray(result) ? result : (result as Record<string, unknown>)?.policies ?? result;
        const items = Array.isArray(policies) ? policies as Record<string, unknown>[] : [];

        logger.debug("API response: policies.list", { count: items.length });

        const shapeArgs = extractShapeArgs(args);
        return shapeList(items, policySummary, shapeArgs, undefined, `Pass page=${page + 1} to get the next page.`);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_policies_list", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    case "knowbe4_policies_get": {
      try {
        const policyId = args.policy_id as number;
        if (!policyId) {
          return toolError("INVALID_ARGS", "policy_id is required.", {
            hint: "Pass the integer policy ID returned by knowbe4_policies_list.",
          });
        }

        logger.info("API call: policies.get", { policyId });
        const result = await apiRequest<Record<string, unknown>>(`/v1/policies/${policyId}`);

        const shapeArgs = extractShapeArgs(args);
        return shapeItem(result, policySummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_policies_get", err, {
          hint: "Verify the policy_id with knowbe4_policies_list first.",
        });
      }
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown training tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const trainingHandler: DomainHandler = {
  getTools,
  handleCall,
};
