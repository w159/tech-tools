/**
 * Phishing domain handler
 *
 * Provides tools for KnowBe4 phishing simulation management:
 * - List phishing campaigns
 * - Get phishing campaign details
 * - List phishing security tests (PSTs)
 * - Get PST details
 * - Get PST recipients and their results
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { apiRequest } from "../utils/client.js";
import { logger } from "../utils/logger.js";
import { elicitSelection } from "../utils/elicitation.js";
import { shapeList, shapeItem, extractShapeArgs, type SummaryFn } from "../../../_shared/response-shaper.js";
import { toolErrorFromCatch, toolError } from "../../../_shared/error-envelope.js";

// Compact summary for phishing campaign list results
const campaignSummary: SummaryFn = (c) => ({
  id: c["campaign_id"] ?? c["id"],
  name: c["name"],
  status: c["status"],
  created_at: c["created_at"],
  last_run: c["last_run"],
  psts_count: c["psts_count"],
});

// Compact summary for PST (Phishing Security Test) list results
const pstSummary: SummaryFn = (t) => ({
  pst_id: t["pst_id"] ?? t["id"],
  campaign_id: t["campaign_id"],
  name: t["name"],
  status: t["status"],
  started_at: t["started_at"],
  started_at_count: t["started_at_count"],
  phish_prone_percentage: t["phish_prone_percentage"],
  delivered_count: t["delivered_count"],
  clicked_count: t["clicked_count"],
});

// Compact summary for PST recipient results
const recipientSummary: SummaryFn = (r) => ({
  id: r["recipient_id"] ?? r["id"],
  user: (r["user"] as Record<string, unknown> | undefined)?.email ?? r["email"],
  scheduled_at: r["scheduled_at"],
  delivered_at: r["delivered_at"],
  opened_at: r["opened_at"],
  clicked_at: r["clicked_at"],
  replied_at: r["replied_at"],
  reported_at: r["reported_at"],
});

function getTools(): Tool[] {
  return [
    {
      name: "knowbe4_phishing_campaigns_list",
      description:
        "List all phishing simulation campaigns. Returns a compact summary (id, name, status, dates, PST count) by default — pass full=true or fields=[...] for more.",
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
              'Optional. Array of field names to include in the response (e.g. ["id","name","status"]). Overrides the default compact summary.',
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
      name: "knowbe4_phishing_campaigns_get",
      description:
        "Get detailed information about a specific phishing campaign by ID. Returns a compact summary by default — pass full=true or fields=[...] for all associated security tests.",
      inputSchema: {
        type: "object" as const,
        properties: {
          campaign_id: {
            type: "number",
            description: "The phishing campaign ID (required)",
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
      name: "knowbe4_phishing_security_tests_list",
      description:
        "List all Phishing Security Tests (PSTs) across all campaigns. Returns a compact summary (id, campaign, name, status, dates, phish-prone %, delivered/clicked counts) by default — pass full=true or fields=[...] for more.",
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
              'Optional. Array of field names to include in the response (e.g. ["pst_id","phish_prone_percentage","status"]). Overrides the default compact summary.',
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
      name: "knowbe4_phishing_campaign_tests",
      description:
        "List all Phishing Security Tests (PSTs) for a specific campaign. Returns a compact summary by default — pass full=true or fields=[...] for more.",
      inputSchema: {
        type: "object" as const,
        properties: {
          campaign_id: {
            type: "number",
            description: "The phishing campaign ID (required)",
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
      name: "knowbe4_phishing_security_test_get",
      description:
        "Get detailed results for a specific Phishing Security Test (PST) by ID. Returns a compact summary (id, campaign, name, status, phish-prone %, clicked/opened/reported counts) by default — pass full=true or fields=[...] for more.",
      inputSchema: {
        type: "object" as const,
        properties: {
          pst_id: {
            type: "number",
            description: "The Phishing Security Test ID (required)",
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
        required: ["pst_id"],
      },
    },
    {
      name: "knowbe4_phishing_security_test_recipients",
      description:
        "Get recipient-level results for a specific PST. Returns a compact summary (id, user email, scheduled/delivered/opened/clicked/reported timestamps) by default — pass full=true or fields=[...] for more.",
      inputSchema: {
        type: "object" as const,
        properties: {
          pst_id: {
            type: "number",
            description: "The Phishing Security Test ID (required)",
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
              'Optional. Array of field names to include in the response (e.g. ["id","user","clicked_at"]). Overrides the default compact summary.',
          },
          full: {
            type: "boolean",
            description:
              "Optional. When true, return the complete vendor object without field filtering.",
          },
        },
        required: ["pst_id"],
      },
    },
    {
      name: "knowbe4_phishing_security_test_recipient",
      description:
        "Get a specific recipient's detailed result for a PST, including click time, open time, and reported status.",
      inputSchema: {
        type: "object" as const,
        properties: {
          pst_id: {
            type: "number",
            description: "The Phishing Security Test ID (required)",
          },
          recipient_id: {
            type: "number",
            description: "The recipient (user) ID (required)",
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
        required: ["pst_id", "recipient_id"],
      },
    },
  ];
}

async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (toolName) {
    case "knowbe4_phishing_campaigns_list": {
      try {
        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;

        logger.info("API call: phishing.campaigns.list", { page, perPage });
        const result = await apiRequest<unknown>("/v1/phishing/campaigns", {
          params: { page, per_page: perPage },
        });

        const campaigns = Array.isArray(result) ? result : (result as Record<string, unknown>)?.campaigns ?? result;
        const items = Array.isArray(campaigns) ? campaigns as Record<string, unknown>[] : [];

        logger.debug("API response: phishing.campaigns.list", { count: items.length });

        const shapeArgs = extractShapeArgs(args);
        return shapeList(items, campaignSummary, shapeArgs, undefined, `Pass page=${page + 1} to get the next page.`);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_phishing_campaigns_list", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    case "knowbe4_phishing_campaigns_get": {
      try {
        const campaignId = args.campaign_id as number;
        if (!campaignId) {
          return toolError("INVALID_ARGS", "campaign_id is required.", {
            hint: "Pass the integer campaign ID returned by knowbe4_phishing_campaigns_list.",
          });
        }

        logger.info("API call: phishing.campaigns.get", { campaignId });
        const result = await apiRequest<Record<string, unknown>>(`/v1/phishing/campaigns/${campaignId}`);

        const shapeArgs = extractShapeArgs(args);
        return shapeItem(result, campaignSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_phishing_campaigns_get", err, {
          hint: "Verify the campaign_id with knowbe4_phishing_campaigns_list first.",
        });
      }
    }

    case "knowbe4_phishing_security_tests_list": {
      try {
        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;

        logger.info("API call: phishing.securityTests.list", { page, perPage });
        const result = await apiRequest<unknown>("/v1/phishing/security_tests", {
          params: { page, per_page: perPage },
        });

        const tests = Array.isArray(result) ? result : (result as Record<string, unknown>)?.security_tests ?? result;
        const items = Array.isArray(tests) ? tests as Record<string, unknown>[] : [];

        logger.debug("API response: phishing.securityTests.list", { count: items.length });

        const shapeArgs = extractShapeArgs(args);
        return shapeList(items, pstSummary, shapeArgs, undefined, `Pass page=${page + 1} to get the next page.`);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_phishing_security_tests_list", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    case "knowbe4_phishing_campaign_tests": {
      try {
        const campaignId = args.campaign_id as number;
        if (!campaignId) {
          return toolError("INVALID_ARGS", "campaign_id is required.", {
            hint: "Pass the integer campaign ID returned by knowbe4_phishing_campaigns_list.",
          });
        }

        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;

        logger.info("API call: phishing.campaignTests", { campaignId, page, perPage });
        const result = await apiRequest<unknown>(`/v1/phishing/campaigns/${campaignId}/security_tests`, {
          params: { page, per_page: perPage },
        });

        const tests = Array.isArray(result) ? result : (result as Record<string, unknown>)?.security_tests ?? result;
        const items = Array.isArray(tests) ? tests as Record<string, unknown>[] : [];

        const shapeArgs = extractShapeArgs(args);
        return shapeList(items, pstSummary, shapeArgs, undefined, `Pass page=${page + 1} to get the next page.`);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_phishing_campaign_tests", err, {
          hint: "Verify the campaign_id with knowbe4_phishing_campaigns_list first.",
        });
      }
    }

    case "knowbe4_phishing_security_test_get": {
      try {
        const pstId = args.pst_id as number;
        if (!pstId) {
          return toolError("INVALID_ARGS", "pst_id is required.", {
            hint: "Pass the integer PST ID returned by knowbe4_phishing_security_tests_list.",
          });
        }

        logger.info("API call: phishing.securityTest.get", { pstId });
        const result = await apiRequest<Record<string, unknown>>(`/v1/phishing/security_tests/${pstId}`);

        const shapeArgs = extractShapeArgs(args);
        return shapeItem(result, pstSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_phishing_security_test_get", err, {
          hint: "Verify the pst_id with knowbe4_phishing_security_tests_list first.",
        });
      }
    }

    case "knowbe4_phishing_security_test_recipients": {
      try {
        const pstId = args.pst_id as number;
        if (!pstId) {
          return toolError("INVALID_ARGS", "pst_id is required.", {
            hint: "Pass the integer PST ID returned by knowbe4_phishing_security_tests_list.",
          });
        }

        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 100;

        logger.info("API call: phishing.securityTest.recipients", { pstId, page, perPage });
        const result = await apiRequest<unknown>(`/v1/phishing/security_tests/${pstId}/recipients`, {
          params: { page, per_page: perPage },
        });

        const recipients = Array.isArray(result) ? result : (result as Record<string, unknown>)?.recipients ?? result;
        const items = Array.isArray(recipients) ? recipients as Record<string, unknown>[] : [];

        const shapeArgs = extractShapeArgs(args);
        return shapeList(items, recipientSummary, shapeArgs, undefined, `Pass page=${page + 1} to get the next page.`);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_phishing_security_test_recipients", err, {
          hint: "Verify the pst_id with knowbe4_phishing_security_tests_list first.",
        });
      }
    }

    case "knowbe4_phishing_security_test_recipient": {
      try {
        const pstId = args.pst_id as number;
        const recipientId = args.recipient_id as number;
        if (!pstId || !recipientId) {
          return toolError("INVALID_ARGS", "pst_id and recipient_id are required.", {
            hint: "Get pst_id from knowbe4_phishing_security_tests_list; get recipient_id from knowbe4_phishing_security_test_recipients.",
          });
        }

        logger.info("API call: phishing.securityTest.recipient", { pstId, recipientId });
        const result = await apiRequest<Record<string, unknown>>(
          `/v1/phishing/security_tests/${pstId}/recipients/${recipientId}`
        );

        const shapeArgs = extractShapeArgs(args);
        return shapeItem(result, recipientSummary, shapeArgs);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_phishing_security_test_recipient", err, {
          hint: "Verify pst_id and recipient_id with knowbe4_phishing_security_test_recipients first.",
        });
      }
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown phishing tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const phishingHandler: DomainHandler = {
  getTools,
  handleCall,
};
