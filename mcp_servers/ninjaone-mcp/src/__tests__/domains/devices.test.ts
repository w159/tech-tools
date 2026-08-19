/**
 * Tests for devices domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock functions using vi.hoisted so they're available when vi.mock is hoisted
const {
  mockDevicesList,
  mockDevicesGet,
  mockDevicesReboot,
  mockDevicesGetServices,
  mockAlertsListByDevice,
  mockDevicesGetActivities,
  mockDevicesGetInventoryByKind,
  mockDevicesUpdateCustomFields,
  mockDevicesRunScript,
  mockDevicesScheduleMaintenance,
    mockDevicesRunPatchAction,
    mockDevicesControlService,
    mockDevicesSearch,
  mockDevicesCancelMaintenance,
  mockClient,
} = vi.hoisted(() => {
  const mockDevicesList = vi.fn();
  const mockDevicesGet = vi.fn();
  const mockDevicesReboot = vi.fn();
  const mockDevicesGetServices = vi.fn();
  const mockAlertsListByDevice = vi.fn();
  const mockDevicesGetActivities = vi.fn();
  const mockDevicesGetInventoryByKind = vi.fn();
  const mockDevicesUpdateCustomFields = vi.fn();
  const mockDevicesRunScript = vi.fn();
  const mockDevicesScheduleMaintenance = vi.fn();
  const mockDevicesCancelMaintenance = vi.fn();
  const mockDevicesRunPatchAction = vi.fn();
  const mockDevicesControlService = vi.fn();
  const mockDevicesSearch = vi.fn();

  const mockClient = {
    devices: {
      list: mockDevicesList,
      get: mockDevicesGet,
      reboot: mockDevicesReboot,
      getServices: mockDevicesGetServices,
      getActivities: mockDevicesGetActivities,
      getInventoryByKind: mockDevicesGetInventoryByKind,
      updateCustomFields: mockDevicesUpdateCustomFields,
      runScript: mockDevicesRunScript,
      scheduleMaintenance: mockDevicesScheduleMaintenance,
      cancelMaintenance: mockDevicesCancelMaintenance,
      runPatchAction: mockDevicesRunPatchAction,
      controlService: mockDevicesControlService,
      search: mockDevicesSearch,
    },
    alerts: {
      listByDevice: mockAlertsListByDevice,
    },
  };

  return {
    mockDevicesList,
    mockDevicesGet,
    mockDevicesReboot,
    mockDevicesGetServices,
    mockAlertsListByDevice,
    mockDevicesGetActivities,
    mockDevicesGetInventoryByKind,
    mockDevicesUpdateCustomFields,
    mockDevicesRunScript,
    mockDevicesScheduleMaintenance,
    mockDevicesRunPatchAction,
    mockDevicesControlService,
    mockDevicesSearch,
    mockDevicesCancelMaintenance,
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
import { devicesHandler } from "../../domains/devices.js";

describe("Devices Domain Handler", () => {
  beforeEach(() => {
    // Clear call history
    mockDevicesList.mockClear();
    mockDevicesGet.mockClear();
    mockDevicesReboot.mockClear();
    mockDevicesGetServices.mockClear();
    mockAlertsListByDevice.mockClear();
    mockDevicesGetActivities.mockClear();
    mockDevicesGetInventoryByKind.mockClear();
    mockDevicesUpdateCustomFields.mockClear();
    mockDevicesRunScript.mockClear();
    mockDevicesScheduleMaintenance.mockClear();
    mockDevicesCancelMaintenance.mockClear();

    // Reset mock implementations - list returns Device[] directly
    mockDevicesList.mockResolvedValue([
      { id: 1, systemName: "Device 1", organizationId: 1 },
      { id: 2, systemName: "Device 2", organizationId: 1 },
    ]);
    mockDevicesGet.mockResolvedValue({
      id: 1,
      systemName: "Device 1",
      organizationId: 1,
      online: true,
    });
    mockDevicesReboot.mockResolvedValue(undefined);
    // getServices returns DeviceService[] directly
    mockDevicesGetServices.mockResolvedValue([
      { name: "Service 1", state: "RUNNING" },
      { name: "Service 2", state: "STOPPED" },
    ]);
    // alerts.listByDevice returns Alert[] directly
    mockAlertsListByDevice.mockResolvedValue([
      { uid: "alert-1", message: "Alert 1", severity: "CRITICAL", deviceId: 1, organizationId: 1 },
    ]);
    mockDevicesGetActivities.mockResolvedValue({
      activities: [
        { id: 1, type: "LOGIN", timestamp: "2024-01-01T00:00:00Z" },
      ],
    });
    mockDevicesGetInventoryByKind.mockResolvedValue({ some: "raw-field" });
    mockDevicesUpdateCustomFields.mockResolvedValue(undefined);
    mockDevicesRunScript.mockResolvedValue(undefined);
    mockDevicesScheduleMaintenance.mockResolvedValue(undefined);
    mockDevicesRunPatchAction.mockResolvedValue({ jobId: 7 });
    mockDevicesControlService.mockResolvedValue(undefined);
    mockDevicesSearch.mockResolvedValue({ devices: [] });
    mockDevicesCancelMaintenance.mockResolvedValue(undefined);
  });

  describe("getTools", () => {
    it("should return all device tools", () => {
      const tools = devicesHandler.getTools();

      expect(tools.length).toBe(13);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("ninjaone_devices_list");
      expect(toolNames).toContain("ninjaone_devices_get");
      expect(toolNames).toContain("ninjaone_devices_reboot");
      expect(toolNames).toContain("ninjaone_devices_services");
      expect(toolNames).toContain("ninjaone_devices_alerts");
      expect(toolNames).toContain("ninjaone_devices_activities");
      expect(toolNames).toContain("ninjaone_devices_inventory");
      expect(toolNames).toContain("ninjaone_devices_custom_fields_update");
      expect(toolNames).toContain("ninjaone_devices_script_run");
      expect(toolNames).toContain("ninjaone_devices_maintenance");
      expect(toolNames).toContain("ninjaone_devices_patch_run");
      expect(toolNames).toContain("ninjaone_devices_service_control");
      expect(toolNames).toContain("ninjaone_devices_search");
    });

    it("ninjaone_devices_get should require device_id", () => {
      const tools = devicesHandler.getTools();
      const getTool = tools.find((t) => t.name === "ninjaone_devices_get");

      expect(getTool).toBeDefined();
      expect(getTool?.inputSchema.required).toContain("device_id");
    });

    it("ninjaone_devices_reboot should require device_id", () => {
      const tools = devicesHandler.getTools();
      const rebootTool = tools.find((t) => t.name === "ninjaone_devices_reboot");

      expect(rebootTool).toBeDefined();
      expect(rebootTool?.inputSchema.required).toContain("device_id");
    });
  });

  describe("handleCall", () => {
    describe("ninjaone_devices_list", () => {
      it("should list devices with default parameters", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_list", {});

        expect(result.isError).toBeUndefined();
        expect(result.content[0].type).toBe("text");

        const data = JSON.parse(result.content[0].text);
        expect(data.devices).toHaveLength(2);
      });

      it("lets a raw device_filter override the compiled clauses", async () => {
        await devicesHandler.handleCall("ninjaone_devices_list", {
          organization_id: 5,
          device_filter: 'class = MAC',
        });

        expect(mockDevicesList).toHaveBeenCalledWith(
          expect.objectContaining({ df: 'class = MAC' })
        );
      });

      it("should pass filters to API", async () => {
        await devicesHandler.handleCall("ninjaone_devices_list", {
          organization_id: 5,
          device_class: "WINDOWS_SERVER",
          online: true,
          limit: 10,
        });

        // Regression: device_class and online were logged but never sent, so a
        // class-filtered request returned the whole tenant. /v2/devices honours
        // only df, so all three filters compile into one expression.
        expect(mockDevicesList).toHaveBeenCalledWith({
          df: 'org = 5 AND class = WINDOWS_SERVER AND online = true',
          pageSize: 10,
          after: undefined,
        });
      });
    });

    describe("ninjaone_devices_get", () => {
      it("should get a single device", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_get", {
          device_id: 1,
        });

        expect(result.isError).toBeUndefined();

        const data = JSON.parse(result.content[0].text);
        expect(data.id).toBe(1);
        expect(data.systemName).toBe("Device 1");
      });

      it("should accept camelCase deviceId param", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_get", {
          deviceId: 1,
        });

        expect(result.isError).toBeUndefined();
        expect(mockDevicesGet).toHaveBeenCalledWith(1);
      });

      it("should return error when no device_id provided", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_get", {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("device_id is required");
      });
    });

    describe("ninjaone_devices_reboot", () => {
      it("should schedule a reboot", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_reboot", {
          device_id: 1,
          reason: "Scheduled maintenance",
        });

        expect(result.isError).toBeUndefined();

        const data = JSON.parse(result.content[0].text);
        expect(data.success).toBe(true);
        expect(data.message).toBe("Reboot scheduled");
        // The mode is a path segment on the API, so it must reach the client as
        // its own argument; 1.7.0 passed the reason in that slot.
        expect(mockDevicesReboot).toHaveBeenCalledWith(1, "NORMAL", "Scheduled maintenance");
      });

      it("passes FORCED through when the caller asks for it", async () => {
        await devicesHandler.handleCall("ninjaone_devices_reboot", {
          device_id: 1,
          mode: "FORCED",
        });

        expect(mockDevicesReboot).toHaveBeenCalledWith(1, "FORCED", undefined);
      });
    });

    describe("ninjaone_devices_services", () => {
      it("should list services", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_services", {
          device_id: 1,
        });

        expect(result.isError).toBeUndefined();

        const data = JSON.parse(result.content[0].text);
        expect(data).toHaveLength(2);
      });

      it("should filter services by state client-side", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_services", {
          device_id: 1,
          state: "RUNNING",
        });

        expect(result.isError).toBeUndefined();

        const data = JSON.parse(result.content[0].text);
        expect(data).toHaveLength(1);
        expect(data[0].state).toBe("RUNNING");
      });
    });

    describe("ninjaone_devices_alerts", () => {
      it("should list device alerts via alerts.listByDevice", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_alerts", {
          device_id: 1,
        });

        expect(result.isError).toBeUndefined();
        expect(mockAlertsListByDevice).toHaveBeenCalledWith(1);

        const data = JSON.parse(result.content[0].text);
        expect(data).toHaveLength(1);
      });
    });

    describe("ninjaone_devices_activities", () => {
      it("should list device activities", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_activities", {
          device_id: 1,
        });

        expect(result.isError).toBeUndefined();

        const data = JSON.parse(result.content[0].text);
        expect(data.activities).toHaveLength(1);
      });

      it("should pass activity_type through to the request as type (regression: filter was inert)", async () => {
        await devicesHandler.handleCall("ninjaone_devices_activities", {
          device_id: 1,
          activity_type: "REBOOT",
        });

        expect(mockDevicesGetActivities).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ type: "REBOOT" })
        );
      });
    });

    describe("ninjaone_devices_inventory", () => {
      it.each([
        "disks",
        "processors",
        "volumes",
        "software",
        "os-patches",
        "software-patches",
        "os-patch-installs",
        "software-patch-installs",
        "network-interfaces",
        "custom-fields",
        "last-logged-on-user",
        "jobs",
        "windows-services",
        // Two-segment tails: 1.7.0 sent "scripting-options" and got HTTP 404.
        "policy/overrides",
        "scripting/options",
      ])("should fetch the %s sub-resource by kind", async (kind) => {
        const result = await devicesHandler.handleCall("ninjaone_devices_inventory", {
          device_id: 1,
          kind,
        });

        expect(result.isError).toBeUndefined();
        expect(mockDevicesGetInventoryByKind).toHaveBeenCalledWith(1, kind, expect.anything());
      });

      it("every declared kind is offered on the tool schema", () => {
        const tool = devicesHandler.getTools().find((t) => t.name === "ninjaone_devices_inventory");
        const kinds = (tool?.inputSchema as unknown as { properties: { kind: { enum: string[] } } })
          .properties.kind.enum;

        expect(kinds).toContain("scripting/options");
        expect(kinds).toContain("software-patches");
        expect(kinds).not.toContain("scripting-options");
      });

      it("forwards patch filters to the client (regression: filters were inert)", async () => {
        await devicesHandler.handleCall("ninjaone_devices_inventory", {
          device_id: 1,
          kind: "os-patches",
          status: "FAILED",
          severity: "CRITICAL",
        });

        expect(mockDevicesGetInventoryByKind).toHaveBeenCalledWith(
          1,
          "os-patches",
          expect.objectContaining({ status: "FAILED", severity: "CRITICAL" })
        );
      });

      it("should return unshaped raw data", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_inventory", {
          device_id: 1,
          kind: "disks",
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.some).toBe("raw-field");
      });

      it("should return error when device_id or kind is missing", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_inventory", {
          device_id: 1,
        });

        expect(result.isError).toBe(true);
      });
    });

    describe("ninjaone_devices_custom_fields_update", () => {
      it("should update custom fields", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_custom_fields_update", {
          device_id: 1,
          fields: { warrantyExpiry: "2027-01-01" },
        });

        expect(result.isError).toBeUndefined();
        expect(mockDevicesUpdateCustomFields).toHaveBeenCalledWith(1, {
          warrantyExpiry: "2027-01-01",
        });
      });
    });

    describe("ninjaone_devices_script_run", () => {
      it("sends {type: SCRIPT, id} - the 1.7.0 {scriptId} body was rejected with HTTP 400", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_script_run", {
          device_id: 1,
          script_id: 42,
          parameters: "-Verbose",
          run_as: "SYSTEM",
        });

        expect(result.isError).toBeUndefined();
        expect(mockDevicesRunScript).toHaveBeenCalledWith(1, {
          type: "SCRIPT",
          id: 42,
          uid: undefined,
          parameters: "-Verbose",
          runAs: "SYSTEM",
        });
      });

      it("runs a built-in action by uid, inferring type from the argument given", async () => {
        await devicesHandler.handleCall("ninjaone_devices_script_run", {
          device_id: 1,
          action_uid: "5b7e-uuid",
        });

        expect(mockDevicesRunScript).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ type: "ACTION", uid: "5b7e-uuid", id: undefined })
        );
      });

      it("rejects a SCRIPT run with no script_id instead of calling the API", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_script_run", {
          device_id: 1,
          type: "SCRIPT",
        });

        expect(result.isError).toBe(true);
        expect(mockDevicesRunScript).not.toHaveBeenCalled();
      });
    });

    describe("ninjaone_devices_patch_run", () => {
      it.each([
        ["os", "scan"],
        ["os", "apply"],
        ["software", "scan"],
        ["software", "apply"],
      ])("triggers a %s patch %s", async (patch_type, action) => {
        const result = await devicesHandler.handleCall("ninjaone_devices_patch_run", {
          device_id: 1,
          patch_type,
          action,
        });

        expect(result.isError).toBeUndefined();
        expect(mockDevicesRunPatchAction).toHaveBeenCalledWith(1, patch_type, action);
      });

      it("rejects a call missing patch_type", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_patch_run", {
          device_id: 1,
          action: "scan",
        });

        expect(result.isError).toBe(true);
      });
    });

    describe("ninjaone_devices_service_control", () => {
      it("sends the control verb for the named service", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_service_control", {
          device_id: 1,
          service_id: "Spooler",
          action: "RESTART",
        });

        expect(result.isError).toBeUndefined();
        expect(mockDevicesControlService).toHaveBeenCalledWith(1, "Spooler", "RESTART");
      });
    });

    describe("ninjaone_devices_search", () => {
      it("searches by free text with a default limit", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_search", {
          query: "LAPTOP-42",
        });

        expect(result.isError).toBeUndefined();
        expect(mockDevicesSearch).toHaveBeenCalledWith("LAPTOP-42", 25);
      });

      it("rejects an empty query", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_search", {});

        expect(result.isError).toBe(true);
        expect(mockDevicesSearch).not.toHaveBeenCalled();
      });
    });

    describe("ninjaone_devices_maintenance", () => {
      it("schedules the window with PUT and defaults to suppressing ALERTS", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_maintenance", {
          device_id: 1,
          action: "start",
          end: 1900000000,
        });

        expect(result.isError).toBeUndefined();
        expect(mockDevicesScheduleMaintenance).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ end: 1900000000, disabledFeatures: ["ALERTS"] })
        );
        expect(mockDevicesCancelMaintenance).not.toHaveBeenCalled();
      });

      it("rejects action=start with no end instead of sending a window the API refuses", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_maintenance", {
          device_id: 1,
          action: "start",
        });

        expect(result.isError).toBe(true);
        expect(mockDevicesScheduleMaintenance).not.toHaveBeenCalled();
      });

      it("should call cancelMaintenance (DELETE) for action=cancel", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_maintenance", {
          device_id: 1,
          action: "cancel",
        });

        expect(result.isError).toBeUndefined();
        expect(mockDevicesCancelMaintenance).toHaveBeenCalledWith(1);
        expect(mockDevicesScheduleMaintenance).not.toHaveBeenCalled();
      });
    });

    describe("unknown tool", () => {
      it("should return error for unknown tool", async () => {
        const result = await devicesHandler.handleCall("ninjaone_devices_unknown", {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown device tool");
      });
    });
  });
});
