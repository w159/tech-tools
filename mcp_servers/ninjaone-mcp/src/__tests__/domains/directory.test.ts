/**
 * Tests for directory domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock functions using vi.hoisted
const {
  mockListPolicies,
  mockGetPolicy,
  mockGetPolicyConditions,
  mockListGroups,
  mockGetGroupDeviceIds,
  mockList,
  mockClient,
} = vi.hoisted(() => {
  const mockListPolicies = vi.fn();
  const mockGetPolicy = vi.fn();
  const mockGetPolicyConditions = vi.fn();
  const mockListGroups = vi.fn();
  const mockGetGroupDeviceIds = vi.fn();
  const mockList = vi.fn();

  const mockClient = {
    directory: {
      listPolicies: mockListPolicies,
      getPolicy: mockGetPolicy,
      getPolicyConditions: mockGetPolicyConditions,
      listGroups: mockListGroups,
      getGroupDeviceIds: mockGetGroupDeviceIds,
      list: mockList,
    },
  };

  return {
    mockListPolicies,
    mockGetPolicy,
    mockGetPolicyConditions,
    mockListGroups,
    mockGetGroupDeviceIds,
    mockList,
    mockClient,
  };
});

// Mock the client module before importing the handler
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

// Import handler after mocking
import { directoryHandler } from "../../domains/directory.js";

describe("Directory Domain Handler", () => {
  beforeEach(() => {
    mockListPolicies.mockClear();
    mockGetPolicy.mockClear();
    mockGetPolicyConditions.mockClear();
    mockListGroups.mockClear();
    mockGetGroupDeviceIds.mockClear();
    mockList.mockClear();

    mockListPolicies.mockResolvedValue([{ id: 1, name: "Policy 1" }]);
    mockGetPolicy.mockResolvedValue({ id: 1, name: "Policy 1" });
    mockGetPolicyConditions.mockResolvedValue([{ id: 10, type: "cpu" }]);
    mockListGroups.mockResolvedValue([{ id: 5, name: "Servers" }]);
    mockGetGroupDeviceIds.mockResolvedValue([100, 101, 102]);
    mockList.mockResolvedValue([{ id: 1, name: "Item 1" }]);
  });

  describe("getTools", () => {
    it("should return all directory tools", () => {
      const tools = directoryHandler.getTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain("ninjaone_policies_list");
      expect(toolNames).toContain("ninjaone_policies_get");
      expect(toolNames).toContain("ninjaone_groups_list");
      expect(toolNames).toContain("ninjaone_groups_device_ids");
      expect(toolNames).toContain("ninjaone_directory_list");
    });

    it("ninjaone_directory_list should enumerate valid kinds", () => {
      const tools = directoryHandler.getTools();
      const listTool = tools.find((t) => t.name === "ninjaone_directory_list");
      const kindProp = (listTool?.inputSchema.properties as any)?.kind;

      expect(kindProp.enum).toEqual(["users", "locations", "roles", "node-classes"]);
    });
  });

  describe("handleCall", () => {
    describe("ninjaone_directory_list", () => {
      it.each(["users", "locations", "roles", "node-classes"] as const)(
        "builds the /v2/%s path for kind=%s",
        async (kind) => {
          const result = await directoryHandler.handleCall("ninjaone_directory_list", { kind });

          expect(result.isError).toBeUndefined();
          expect(mockList).toHaveBeenCalledWith(kind);
        }
      );

      it("rejects an invalid kind", async () => {
        const result = await directoryHandler.handleCall("ninjaone_directory_list", {
          kind: "not-a-real-kind",
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Invalid kind");
        expect(mockList).not.toHaveBeenCalled();
      });
    });

    describe("ninjaone_policies_get", () => {
      it("fetches only the policy when include_conditions is omitted", async () => {
        const result = await directoryHandler.handleCall("ninjaone_policies_get", {
          policy_id: 1,
        });

        expect(result.isError).toBeUndefined();
        expect(mockGetPolicy).toHaveBeenCalledWith(1);
        expect(mockGetPolicyConditions).not.toHaveBeenCalled();

        const data = JSON.parse(result.content[0].text);
        expect(data.id).toBe(1);
      });

      it("fetches both the policy and its conditions when include_conditions is true", async () => {
        const result = await directoryHandler.handleCall("ninjaone_policies_get", {
          policy_id: 1,
          include_conditions: true,
        });

        expect(result.isError).toBeUndefined();
        expect(mockGetPolicy).toHaveBeenCalledWith(1);
        expect(mockGetPolicyConditions).toHaveBeenCalledWith(1);

        const data = JSON.parse(result.content[0].text);
        expect(data.policy.id).toBe(1);
        expect(data.conditions).toHaveLength(1);
      });
    });

    describe("ninjaone_groups_device_ids", () => {
      it("resolves a saved group to device ids via /v2/group/{id}/device-ids", async () => {
        const result = await directoryHandler.handleCall("ninjaone_groups_device_ids", {
          group_id: 5,
        });

        expect(result.isError).toBeUndefined();
        expect(mockGetGroupDeviceIds).toHaveBeenCalledWith(5);

        const data = JSON.parse(result.content[0].text);
        expect(data).toEqual([100, 101, 102]);
      });
    });

    describe("ninjaone_policies_list", () => {
      it("lists policies", async () => {
        const result = await directoryHandler.handleCall("ninjaone_policies_list", {});

        expect(result.isError).toBeUndefined();
        expect(mockListPolicies).toHaveBeenCalled();
      });
    });

    describe("ninjaone_groups_list", () => {
      it("lists saved groups", async () => {
        const result = await directoryHandler.handleCall("ninjaone_groups_list", {});

        expect(result.isError).toBeUndefined();
        expect(mockListGroups).toHaveBeenCalled();
      });
    });

    describe("unknown tool", () => {
      it("should return error for unknown tool", async () => {
        const result = await directoryHandler.handleCall("ninjaone_directory_unknown", {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown directory tool");
      });
    });
  });
});
