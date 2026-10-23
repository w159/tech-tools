import { describe, it, expect, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { annotate } from "../annotate-tool.js";
import { DOMAINS, getNavigationTools } from "../domains/navigation.js";
import { getDomainHandler } from "../domains/index.js";

async function allTools(): Promise<Tool[]> {
  const out: Tool[] = [...getNavigationTools()];
  for (const d of DOMAINS) out.push(...(await getDomainHandler(d)).getTools());
  return out;
}

const bare = (name: string, extra: Partial<Tool> = {}): Tool => ({
  name,
  description: "x",
  inputSchema: { type: "object" as const, properties: {} },
  ...extra,
});

describe("sonicwall tool annotations", () => {
  it("every registered tool declares readOnlyHint explicitly", async () => {
    const tools = await allTools();
    expect(tools.length).toBeGreaterThan(10);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).not.toBeUndefined();
    }
  });

  it("descriptions marked DESTRUCTIVE: or VISIBLE-TO-OTHERS: are never read-only", async () => {
    for (const t of await allTools()) {
      if (/^(DESTRUCTIVE|VISIBLE-TO-OTHERS):/.test(t.description ?? "")) {
        expect(t.annotations?.readOnlyHint, t.name).toBe(false);
        expect(t.annotations?.destructiveHint, t.name).toBe(true);
      }
    }
  });

  it("tools that write appliance state are marked destructive and non-idempotent", async () => {
    const byName = new Map((await allTools()).map((t) => [t.name, t]));
    const mutating = [
      "sonicwall_config_commit",
      "sonicwall_config_discard",
      "sonicwall_config_mode",
      "sonicwall_non_config_mode",
      "sonicwall_logout",
      "sonicwall_request",
      "sonicwall_objects_create",
      "sonicwall_objects_update",
      "sonicwall_objects_delete",
      "sonicwall_policies_create",
      "sonicwall_policies_update",
      "sonicwall_policies_delete",
    ];
    for (const name of mutating) {
      const t = byName.get(name);
      expect(t, `${name} is registered`).toBeDefined();
      expect(t!.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      });
    }
  });

  it("read tools are read-only and non-destructive", async () => {
    const byName = new Map((await allTools()).map((t) => [t.name, t]));
    for (const name of [
      "sonicwall_version",
      "sonicwall_status",
      "sonicwall_navigate",
      "sonicwall_config_pending",
      "sonicwall_objects_list",
      "sonicwall_objects_get",
    ]) {
      expect(byName.get(name)?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }
  });

  it("sonicwall_config_commit warns that it is visible to others", async () => {
    const t = (await getDomainHandler("config"))
      .getTools()
      .find((x) => x.name === "sonicwall_config_commit");
    expect(t?.description).toMatch(/^DESTRUCTIVE: VISIBLE-TO-OTHERS:/);
  });
});

describe("annotate()", () => {
  it("fails closed (mutating) for a tool with no declared effect class, and logs to stderr", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const [t] = annotate([bare("sonicwall_mystery")], "Sonicwall");
    expect(t.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("sonicwall_mystery"),
    );
  });

  it("adds a friendly title without changing the declared hints", () => {
    const [t] = annotate(
      [
        bare("sonicwall_config_pending", {
          annotations: { readOnlyHint: true },
        }),
      ],
      "Sonicwall",
    );
    expect(t.annotations?.title).toBe("Sonicwall: config pending");
    expect(t.annotations?.readOnlyHint).toBe(true);
  });
});
