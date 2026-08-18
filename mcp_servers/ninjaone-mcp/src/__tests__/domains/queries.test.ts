/**
 * Tests for queries domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQueriesRun, mockOsPatchInstallsForDevice, mockClient } = vi.hoisted(() => {
  const mockQueriesRun = vi.fn();
  const mockOsPatchInstallsForDevice = vi.fn();

  const mockClient = {
    queries: {
      run: mockQueriesRun,
      osPatchInstallsForDevice: mockOsPatchInstallsForDevice,
    },
  };

  return { mockQueriesRun, mockOsPatchInstallsForDevice, mockClient };
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

import { queriesHandler } from "../../domains/queries.js";

describe("Queries Domain Handler", () => {
  beforeEach(() => {
    mockQueriesRun.mockClear();
    mockOsPatchInstallsForDevice.mockClear();

    mockQueriesRun.mockResolvedValue({
      cursor: { name: "after", offset: 0, expires: 0 },
      results: [{ deviceId: 1 }],
    });
    mockOsPatchInstallsForDevice.mockResolvedValue([{ id: 1 }]);
  });

  describe("getTools", () => {
    it("should return both tools", () => {
      const tools = queriesHandler.getTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("ninjaone_queries_run");
      expect(names).toContain("ninjaone_devices_os_patch_installs");
    });

    it("ninjaone_queries_run should require query", () => {
      const tool = queriesHandler.getTools().find((t) => t.name === "ninjaone_queries_run");
      expect(tool?.inputSchema.required).toContain("query");
    });
  });

  describe("organization_id / device_filter translation", () => {
    it("translates organization_id to df=\"org = <id>\" and sends no organizationId param", async () => {
      await queriesHandler.handleCall("ninjaone_queries_run", {
        query: "software",
        organization_id: 42,
      });

      expect(mockQueriesRun).toHaveBeenCalledWith(
        "software",
        expect.objectContaining({ df: "org = 42" })
      );
      const sentParams = mockQueriesRun.mock.calls[0][1];
      expect(sentParams.organizationId).toBeUndefined();
    });

    it("explicit device_filter overrides organization_id", async () => {
      await queriesHandler.handleCall("ninjaone_queries_run", {
        query: "software",
        organization_id: 42,
        device_filter: "os = WINDOWS_SERVER",
      });

      expect(mockQueriesRun).toHaveBeenCalledWith(
        "software",
        expect.objectContaining({ df: "os = WINDOWS_SERVER" })
      );
    });
  });

  describe("installed_after / installed_before normalization", () => {
    it("drops an unparseable installed_after instead of sending NaN", async () => {
      await queriesHandler.handleCall("ninjaone_queries_run", {
        query: "os-patch-installs",
        installed_after: "not-a-date",
      });

      const sentParams = mockQueriesRun.mock.calls[0][1];
      expect(sentParams.installedAfter).toBeUndefined();
      expect(Number.isNaN(sentParams.installedAfter)).toBe(false);
    });

    it("normalizes an ISO 8601 string to epoch seconds", async () => {
      await queriesHandler.handleCall("ninjaone_queries_run", {
        query: "os-patch-installs",
        installed_after: "2024-01-01T00:00:00Z",
      });

      const sentParams = mockQueriesRun.mock.calls[0][1];
      expect(sentParams.installedAfter).toBe(1704067200);
    });

    it("normalizes an epoch-seconds string the same way", async () => {
      await queriesHandler.handleCall("ninjaone_queries_run", {
        query: "os-patch-installs",
        installed_after: "1704067200",
      });

      const sentParams = mockQueriesRun.mock.calls[0][1];
      expect(sentParams.installedAfter).toBe(1704067200);
    });
  });

  describe("ninjaone_devices_os_patch_installs routing", () => {
    it("routes to /device/{id}/os-patch-installs when device_id is given", async () => {
      const result = await queriesHandler.handleCall("ninjaone_devices_os_patch_installs", {
        device_id: 7,
      });

      expect(result.isError).toBeUndefined();
      expect(mockOsPatchInstallsForDevice).toHaveBeenCalledWith(7, expect.any(Object));
      expect(mockQueriesRun).not.toHaveBeenCalled();
    });

    it("routes to /queries/os-patch-installs when device_id is absent", async () => {
      const result = await queriesHandler.handleCall("ninjaone_devices_os_patch_installs", {
        organization_id: 9,
      });

      expect(result.isError).toBeUndefined();
      expect(mockQueriesRun).toHaveBeenCalledWith(
        "os-patch-installs",
        expect.objectContaining({ df: "org = 9" })
      );
      expect(mockOsPatchInstallsForDevice).not.toHaveBeenCalled();
    });
  });

  describe("unknown query", () => {
    it("rejects an unsupported query value", async () => {
      const result = await queriesHandler.handleCall("ninjaone_queries_run", {
        query: "not-a-real-query",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("query is required");
    });
  });

  describe("unknown tool", () => {
    it("should return error for unknown tool", async () => {
      const result = await queriesHandler.handleCall("ninjaone_queries_unknown", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown queries tool");
    });
  });
});
