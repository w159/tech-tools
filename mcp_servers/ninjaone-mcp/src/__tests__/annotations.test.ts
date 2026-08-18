import { describe, it, expect } from "vitest";
import { classifyTool } from "../annotate-tool.js";
import { getDomainHandler, getAvailableDomains } from "../domains/index.js";

/**
 * Annotation classification is name-pattern based, which mislabels in both
 * directions. A write labelled read-only is the dangerous one: clients group
 * it under "Read-only tools" and may auto-approve it.
 */
describe("tool annotations", () => {
  it("classifies the write tools as destructive, not read", () => {
    expect(classifyTool("ninjaone_devices_maintenance")).toBe("destructive");
    expect(classifyTool("ninjaone_devices_script_run")).toBe("destructive");
    expect(classifyTool("ninjaone_devices_custom_fields_update")).toBe("destructive");
    expect(classifyTool("ninjaone_devices_reboot")).toBe("destructive");
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
});
