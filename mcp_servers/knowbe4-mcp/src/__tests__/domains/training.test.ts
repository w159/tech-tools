/**
 * Tests for the training domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the client module
vi.mock("../../utils/client.js", () => ({
  apiRequest: vi.fn(),
  getCredentials: vi.fn().mockReturnValue({ apiKey: "test-key", baseUrl: "https://us.api.knowbe4.com" }),
}));

// Mock elicitation (always return null = unsupported)
vi.mock("../../utils/elicitation.js", () => ({
  elicitSelection: vi.fn().mockResolvedValue(null),
  elicitText: vi.fn().mockResolvedValue(null),
  elicitConfirmation: vi.fn().mockResolvedValue(null),
}));

import { trainingHandler } from "../../domains/training.js";
import { apiRequest } from "../../utils/client.js";

const mockApiRequest = vi.mocked(apiRequest);

describe("Training Domain Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getTools", () => {
    it("should return training tools", () => {
      const tools = trainingHandler.getTools();
      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("knowbe4_training_campaigns_list");
      expect(toolNames).toContain("knowbe4_training_campaigns_get");
      expect(toolNames).toContain("knowbe4_training_enrollments_list");
      expect(toolNames).toContain("knowbe4_training_enrollments_get");
      expect(toolNames).toContain("knowbe4_store_purchases_list");
      expect(toolNames).toContain("knowbe4_store_purchases_get");
      expect(toolNames).toContain("knowbe4_policies_list");
      expect(toolNames).toContain("knowbe4_policies_get");
    });
  });

  describe("handleCall", () => {
    it("should list training campaigns", async () => {
      const mockCampaigns = [
        { campaign_id: 1, name: "Security Basics", status: "Active" },
      ];
      mockApiRequest.mockResolvedValueOnce(mockCampaigns);

      const result = await trainingHandler.handleCall("knowbe4_training_campaigns_list", {});

      expect(mockApiRequest).toHaveBeenCalledWith("/v1/training/campaigns", {
        params: { page: 1, per_page: 100 },
      });
      expect(result.isError).toBeUndefined();
    });

    it("should get a specific training campaign", async () => {
      const mockCampaign = { campaign_id: 1, name: "Security Basics" };
      mockApiRequest.mockResolvedValueOnce(mockCampaign);

      const result = await trainingHandler.handleCall("knowbe4_training_campaigns_get", {
        campaign_id: 1,
      });

      expect(mockApiRequest).toHaveBeenCalledWith("/v1/training/campaigns/1");
      expect(result.isError).toBeUndefined();
    });

    it("should list training enrollments", async () => {
      const mockEnrollments = [
        { enrollment_id: 100, user_id: 5, status: "In Progress" },
      ];
      mockApiRequest.mockResolvedValueOnce(mockEnrollments);

      const result = await trainingHandler.handleCall("knowbe4_training_enrollments_list", {});

      expect(mockApiRequest).toHaveBeenCalledWith("/v1/training/enrollments", {
        params: { page: 1, per_page: 100 },
      });
      expect(result.isError).toBeUndefined();
    });

    it("should list store purchases", async () => {
      const mockPurchases = [
        { store_purchase_id: 1, content_type: "Training Module" },
      ];
      mockApiRequest.mockResolvedValueOnce(mockPurchases);

      const result = await trainingHandler.handleCall("knowbe4_store_purchases_list", {});

      expect(mockApiRequest).toHaveBeenCalledWith("/v1/training/store_purchases", {
        params: { page: 1, per_page: 100 },
      });
      expect(result.isError).toBeUndefined();
    });

    it("should list policies", async () => {
      const mockPolicies = [
        { policy_id: 1, name: "Acceptable Use Policy" },
      ];
      mockApiRequest.mockResolvedValueOnce(mockPolicies);

      const result = await trainingHandler.handleCall("knowbe4_policies_list", {});

      expect(mockApiRequest).toHaveBeenCalledWith("/v1/training/policies", {
        params: { page: 1, per_page: 100 },
      });
      expect(result.isError).toBeUndefined();
    });

    it("should return error for unknown tool", async () => {
      const result = await trainingHandler.handleCall("knowbe4_training_unknown", {});
      expect(result.isError).toBe(true);
    });
  });
});
