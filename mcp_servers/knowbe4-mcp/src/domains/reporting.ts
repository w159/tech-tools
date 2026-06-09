/**
 * Reporting domain handler
 *
 * Provides tools for KnowBe4 reporting and analytics:
 * - Phishing test summary statistics
 * - Training completion overview
 * - User event tracking (clicks, opens, reported phishing)
 * - Cross-domain risk analysis helpers
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { apiRequest } from "../utils/client.js";
import { logger } from "../utils/logger.js";
import { elicitSelection } from "../utils/elicitation.js";
import { shapeRaw } from "../../../_shared/response-shaper.js";
import { toolErrorFromCatch } from "../../../_shared/error-envelope.js";

function getTools(): Tool[] {
  return [
    {
      name: "knowbe4_reporting_phishing_summary",
      description:
        "Get a summary of all phishing security tests including overall phish-prone percentage, total tests run, and aggregate click/open/report rates. Fetches all PSTs and computes statistics.",
      inputSchema: {
        type: "object" as const,
        properties: {
          page: {
            type: "number",
            description: "Page number for pagination (default: 1)",
          },
          per_page: {
            type: "number",
            description: "Number of results per page (default: 500, max: 500)",
          },
        },
      },
    },
    {
      name: "knowbe4_reporting_training_summary",
      description:
        "Get a summary of all training campaigns including total enrollments, completion counts, and overall completion rate.",
      inputSchema: {
        type: "object" as const,
        properties: {
          page: {
            type: "number",
            description: "Page number for pagination (default: 1)",
          },
          per_page: {
            type: "number",
            description: "Number of results per page (default: 500, max: 500)",
          },
        },
      },
    },
    {
      name: "knowbe4_reporting_risk_overview",
      description:
        "Get an overview of account risk posture including current risk score, recent risk score trend, and highest-risk groups.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ];
}

async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  switch (toolName) {
    case "knowbe4_reporting_phishing_summary": {
      try {
        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 500;

        logger.info("API call: reporting.phishingSummary", { page, perPage });

        // Fetch PSTs
        const result = await apiRequest<unknown>("/v1/phishing/security_tests", {
          params: { page, per_page: perPage },
        });

        const tests = Array.isArray(result) ? result : (result as Record<string, unknown>)?.security_tests ?? [];

        // Compute summary statistics from the PST data
        let totalTests = 0;
        let totalDelivered = 0;
        let totalOpened = 0;
        let totalClicked = 0;
        let totalReported = 0;
        let phishProneSum = 0;
        let phishProneCount = 0;

        if (Array.isArray(tests)) {
          totalTests = tests.length;
          for (const test of tests) {
            const t = test as Record<string, unknown>;
            if (typeof t.delivered_count === "number") totalDelivered += t.delivered_count;
            if (typeof t.opened_count === "number") totalOpened += t.opened_count;
            if (typeof t.clicked_count === "number") totalClicked += t.clicked_count;
            if (typeof t.reported_count === "number") totalReported += t.reported_count;
            if (typeof t.phish_prone_percentage === "number") {
              phishProneSum += t.phish_prone_percentage;
              phishProneCount++;
            }
          }
        }

        const summary = {
          total_security_tests: totalTests,
          total_emails_delivered: totalDelivered,
          total_opened: totalOpened,
          total_clicked: totalClicked,
          total_reported: totalReported,
          average_phish_prone_percentage: phishProneCount > 0
            ? Math.round((phishProneSum / phishProneCount) * 100) / 100
            : null,
          click_rate: totalDelivered > 0
            ? Math.round((totalClicked / totalDelivered) * 10000) / 100
            : null,
          report_rate: totalDelivered > 0
            ? Math.round((totalReported / totalDelivered) * 10000) / 100
            : null,
          page,
          per_page: perPage,
        };

        return shapeRaw(summary);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_reporting_phishing_summary", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    case "knowbe4_reporting_training_summary": {
      try {
        const page = (args.page as number) || 1;
        const perPage = (args.per_page as number) || 500;

        logger.info("API call: reporting.trainingSummary", { page, perPage });

        const result = await apiRequest<unknown>("/v1/training/campaigns", {
          params: { page, per_page: perPage },
        });

        const campaigns = Array.isArray(result) ? result : (result as Record<string, unknown>)?.campaigns ?? [];

        let totalCampaigns = 0;
        let activeCampaigns = 0;
        let completedCampaigns = 0;

        if (Array.isArray(campaigns)) {
          totalCampaigns = campaigns.length;
          for (const campaign of campaigns) {
            const c = campaign as Record<string, unknown>;
            if (c.status === "Closed" || c.status === "closed") {
              completedCampaigns++;
            } else {
              activeCampaigns++;
            }
          }
        }

        const summary = {
          total_campaigns: totalCampaigns,
          active_campaigns: activeCampaigns,
          completed_campaigns: completedCampaigns,
          page,
          per_page: perPage,
        };

        return shapeRaw(summary);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_reporting_training_summary", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    case "knowbe4_reporting_risk_overview": {
      try {
        logger.info("API call: reporting.riskOverview");

        // Fetch account info for current risk score
        const account = await apiRequest<Record<string, unknown>>("/v1/account");

        // Fetch recent risk score history
        const historyResult = await apiRequest<unknown>("/v1/account/risk_score_history", {
          params: { page: 1, per_page: 10 },
        });
        const history = Array.isArray(historyResult)
          ? historyResult
          : (historyResult as Record<string, unknown>)?.data ?? [];

        // Fetch groups for highest-risk groups
        const groupsResult = await apiRequest<unknown>("/v1/groups", {
          params: { page: 1, per_page: 500 },
        });
        const groups = Array.isArray(groupsResult)
          ? groupsResult
          : (groupsResult as Record<string, unknown>)?.groups ?? [];

        // Sort groups by risk score descending, take top 5
        let topRiskGroups: unknown[] = [];
        if (Array.isArray(groups)) {
          topRiskGroups = [...groups]
            .filter((g) => {
              const group = g as Record<string, unknown>;
              return typeof group.current_risk_score === "number" && group.current_risk_score > 0;
            })
            .sort((a, b) => {
              const aScore = (a as Record<string, unknown>).current_risk_score as number;
              const bScore = (b as Record<string, unknown>).current_risk_score as number;
              return bScore - aScore;
            })
            .slice(0, 5)
            .map((g) => {
              const group = g as Record<string, unknown>;
              return {
                id: group.id,
                name: group.name,
                risk_score: group.current_risk_score,
                member_count: group.member_count,
              };
            });
        }

        const overview = {
          account_name: account.name,
          current_risk_score: account.current_risk_score,
          number_of_seats: account.number_of_seats,
          subscription_level: account.subscription_level,
          recent_risk_history: history,
          highest_risk_groups: topRiskGroups,
        };

        return shapeRaw(overview);
      } catch (err) {
        return toolErrorFromCatch("knowbe4_reporting_risk_overview", err, {
          hint: "Verify KNOWBE4_API_KEY is set and KNOWBE4_REGION matches your account region (us, eu, ca, uk, de).",
        });
      }
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown reporting tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const reportingHandler: DomainHandler = {
  getTools,
  handleCall,
};
