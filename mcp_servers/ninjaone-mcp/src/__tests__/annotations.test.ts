import { describe, it, expect, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { annotate, classifyTool } from "../annotate-tool.js";
import { getDomainHandler, getAvailableDomains } from "../domains/index.js";

/**
 * Annotation classification is name-pattern based, which mislabels in both
 * directions. A write labelled read-only is the dangerous one: clients group
 * it under "Read-only tools" and may auto-approve it.
 *
 * classifyTool() used to `return "read"` for any name the tables did not
 * match, which is how ninjaone_devices_service_control shipped with
 * readOnlyHint:true while its own description read "DESTRUCTIVE: Start, stop,
 * pause, or restart a Windows service" - "control" appears in no pattern.
 */
const mkTool = (name: string, description: string, annotations?: Tool["annotations"]): Tool => ({
  name,
  description,
  inputSchema: { type: "object" as const, properties: {} },
  ...(annotations ? { annotations } : {}),
});

describe("tool annotations", () => {
  it("classifies the write tools as destructive, not read", () => {
    expect(classifyTool("ninjaone_devices_maintenance")).toBe("destructive");
    expect(classifyTool("ninjaone_devices_script_run")).toBe("destructive");
    expect(classifyTool("ninjaone_devices_custom_fields_update")).toBe("destructive");
    expect(classifyTool("ninjaone_devices_reboot")).toBe("destructive");
    expect(classifyTool("ninjaone_devices_service_control")).toBe("destructive");
  });

  it("does not mark pure reads as writes just because the name contains 'run'", () => {
    expect(classifyTool("ninjaone_queries_run")).toBe("read");
    expect(classifyTool("ninjaone_devices_os_patch_installs")).toBe("read");
    expect(classifyTool("ninjaone_devices_inventory")).toBe("read");
  });

  it("classifies every listed tool without falling back on an unlisted write", async () => {
    // Any new tool whose name implies mutation must be explicitly classified.
    const mutating = /(_update|_create|_delete|_run|_reboot|_maintenance|_reset|_add_)/;
    for (const domain of getAvailableDomains()) {
      const handler = await getDomainHandler(domain);
      for (const tool of handler.getTools()) {
        const cls = classifyTool(tool.name);
        if (mutating.test(tool.name) && cls === "read") {
          // queries_run is the sanctioned exception: it mutates nothing.
          expect(tool.name).toBe("ninjaone_queries_run");
        }
      }
    }
  });

  it("never annotates a DESTRUCTIVE-marked tool read-only, across the whole surface", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const domain of getAvailableDomains()) {
      const handler = await getDomainHandler(domain);
      for (const t of annotate(handler.getTools(), "NinjaOne")) {
        if (/^\s*(?:DESTRUCTIVE|VISIBLE-TO-OTHERS):/.test(t.description ?? "")) {
          expect({ name: t.name, readOnlyHint: t.annotations?.readOnlyHint }).toEqual({
            name: t.name,
            readOnlyHint: false,
          });
        }
      }
    }
    warn.mockRestore();
  });

  it("follows a DESTRUCTIVE: description marker even for a read-looking name", () => {
    // ninjaone_devices_list matches READ_PATTERNS; the marker must still win.
    const [t] = annotate([mkTool("ninjaone_devices_list", "DESTRUCTIVE: wipes the device.")]);
    expect(t.annotations?.readOnlyHint).toBe(false);
    expect(t.annotations?.destructiveHint).toBe(true);
  });

  it("does not annotate an unrecognised tool name read-only", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const [t] = annotate([mkTool("ninjaone_frobnicate_device", "Does something the tables never saw.")]);
    expect(classifyTool("ninjaone_frobnicate_device")).toBeUndefined();
    expect(t.annotations?.readOnlyHint).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ninjaone_frobnicate_device"));
    warn.mockRestore();
  });

  it("overrides a hand-written read-only annotation that contradicts the marker", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const [t] = annotate([
      mkTool("ninjaone_devices_get", "DESTRUCTIVE: reboots the device.", { readOnlyHint: true }),
    ]);
    expect(t.annotations?.readOnlyHint).toBe(false);
    warn.mockRestore();
  });
});
