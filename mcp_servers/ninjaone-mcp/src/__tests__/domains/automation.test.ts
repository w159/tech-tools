/**
 * Tests for automation domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockListScripts, mockListJobs, mockClient } = vi.hoisted(() => {
  const mockListScripts = vi.fn();
  const mockListJobs = vi.fn();

  const mockClient = {
    automation: {
      listScripts: mockListScripts,
      listJobs: mockListJobs,
    },
  };

  return { mockListScripts, mockListJobs, mockClient };
});

vi.mock("../../utils/client.js", () => ({
  getClient: () => Promise.resolve(mockClient),
  clearClient: vi.fn(),
  getCredentials: () => ({
    clientId: "test",
    clientSecret: "test",
    region: "us",
    baseUrl: "https://app.ninjarmm.com",
  }),
}));

import { automationHandler } from "../../domains/automation.js";

describe("Automation Domain Handler", () => {
  beforeEach(() => {
    mockListScripts.mockClear();
    mockListJobs.mockClear();

    mockListScripts.mockResolvedValue([{ id: 1, name: "Test Script" }]);
    mockListJobs.mockResolvedValue([{ uid: "job-1", status: "RUNNING" }]);
  });

  describe("getTools", () => {
    it("should return both tools", () => {
      const tools = automationHandler.getTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("ninjaone_scripts_list");
      expect(names).toContain("ninjaone_jobs_list");
    });
  });

  describe("ninjaone_scripts_list", () => {
    it("hits /v2/scripts via automation.listScripts", async () => {
      const result = await automationHandler.handleCall("ninjaone_scripts_list", {});

      expect(result.isError).toBeUndefined();
      expect(mockListScripts).toHaveBeenCalledTimes(1);
    });
  });

  describe("ninjaone_jobs_list organization_id / device_filter translation", () => {
    it('translates organization_id to df="org = <id>" and sends no organizationId param', async () => {
      await automationHandler.handleCall("ninjaone_jobs_list", {
        organization_id: 42,
      });

      expect(mockListJobs).toHaveBeenCalledWith(
        expect.objectContaining({ df: "org = 42" })
      );
      const sentParams = mockListJobs.mock.calls[0][0];
      expect(sentParams.organizationId).toBeUndefined();
    });

    it("explicit device_filter overrides organization_id", async () => {
      await automationHandler.handleCall("ninjaone_jobs_list", {
        organization_id: 42,
        device_filter: "os = WINDOWS_SERVER",
      });

      expect(mockListJobs).toHaveBeenCalledWith(
        expect.objectContaining({ df: "os = WINDOWS_SERVER" })
      );
    });
  });

  describe("unknown tool", () => {
    it("should return error for unknown tool", async () => {
      const result = await automationHandler.handleCall("ninjaone_automation_unknown", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown automation tool");
    });
  });
});
