/**
 * Tests for the phishing domain handler
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

import { phishingHandler } from "../../domains/phishing.js";
import { apiRequest } from "../../utils/client.js";

const mockApiRequest = vi.mocked(apiRequest);

describe("Phishing Domain Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getTools", () => {
    it("should return phishing tools", () => {
      const tools = phishingHandler.getTools();
      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("knowbe4_phishing_campaigns_list");
      expect(toolNames).toContain("knowbe4_phishing_campaigns_get");
      expect(toolNames).toContain("knowbe4_phishing_security_tests_list");
      expect(toolNames).toContain("knowbe4_phishing_campaign_tests");
      expect(toolNames).toContain("knowbe4_phishing_security_test_get");
      expect(toolNames).toContain("knowbe4_phishing_security_test_recipients");
      expect(toolNames).toContain("knowbe4_phishing_security_test_recipient");
    });
  });

  describe("handleCall", () => {
    it("should list phishing campaigns", async () => {
      const mockCampaigns = [
        { campaign_id: 1, name: "Q1 Phishing Test", status: "Active" },
        { campaign_id: 2, name: "Monthly Phish", status: "Closed" },
      ];
      mockApiRequest.mockResolvedValueOnce(mockCampaigns);

      const result = await phishingHandler.handleCall("knowbe4_phishing_campaigns_list", {});

      expect(mockApiRequest).toHaveBeenCalledWith("/v1/phishing/campaigns", {
        params: { page: 1, per_page: 100 },
      });
      expect(result.isError).toBeUndefined();

      // shapeList returns a compact JSON array (not an object envelope).
      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });

    it("should get a specific phishing campaign", async () => {
      const mockCampaign = { campaign_id: 1, name: "Q1 Phishing Test", status: "Active" };
      mockApiRequest.mockResolvedValueOnce(mockCampaign);

      const result = await phishingHandler.handleCall("knowbe4_phishing_campaigns_get", {
        campaign_id: 1,
      });

      expect(mockApiRequest).toHaveBeenCalledWith("/v1/phishing/campaigns/1");
      expect(result.isError).toBeUndefined();
    });

    it("should require campaign_id for get", async () => {
      const result = await phishingHandler.handleCall("knowbe4_phishing_campaigns_get", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("campaign_id is required");
    });

    it("should list security tests", async () => {
      const mockTests = [
        { pst_id: 10, name: "Test 1", phish_prone_percentage: 15.5 },
      ];
      mockApiRequest.mockResolvedValueOnce(mockTests);

      const result = await phishingHandler.handleCall("knowbe4_phishing_security_tests_list", {});

      expect(mockApiRequest).toHaveBeenCalledWith("/v1/phishing/security_tests", {
        params: { page: 1, per_page: 100 },
      });
      expect(result.isError).toBeUndefined();
    });

    it("should get PST recipients", async () => {
      const mockRecipients = [
        { recipient_id: 100, email: "user@example.com", clicked: true },
      ];
      mockApiRequest.mockResolvedValueOnce(mockRecipients);

      const result = await phishingHandler.handleCall("knowbe4_phishing_security_test_recipients", {
        pst_id: 10,
      });

      expect(mockApiRequest).toHaveBeenCalledWith("/v1/phishing/security_tests/10/recipients", {
        params: { page: 1, per_page: 100 },
      });
      expect(result.isError).toBeUndefined();
    });

    it("should return error for unknown tool", async () => {
      const result = await phishingHandler.handleCall("knowbe4_phishing_unknown", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown phishing tool");
    });
  });
});
