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

describe("panos tool annotations", () => {
  it("every registered tool declares readOnlyHint explicitly", async () => {
    const tools = await allTools();
    expect(tools.length).toBeGreaterThan(40);
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

  it("tools that change the appliance are destructive and non-idempotent", async () => {
    const byName = new Map((await allTools()).map((t) => [t.name, t]));
    const mutating = [
      "panos_commit",
      "panos_commit_all",
      "panos_config_set",
      "panos_config_edit",
      "panos_config_delete",
      "panos_op",
      "panos_objects_create",
      "panos_objects_delete",
      "panos_policies_create",
      "panos_policies_delete",
      "panos_system_reboot",
      "panos_software_install",
      "panos_cert_revoke",
    ];
    for (const name of mutating) {
      const t = byName.get(name);
      expect(t, `${name} is registered`).toBeDefined();
      expect(t!.annotations, name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      });
    }
  });

  it("read tools are read-only and non-destructive", async () => {
    const byName = new Map((await allTools()).map((t) => [t.name, t]));
    for (const name of [
      "panos_status",
      "panos_navigate",
      "panos_version",
      "panos_system_info",
      "panos_config_show",
      "panos_objects_list",
      "panos_policies_list",
      "panos_job_status",
    ]) {
      expect(byName.get(name)?.annotations, name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }
  });

  it("panos_keygen is credential-issuing: not read-only, not destructive, idempotent", async () => {
    const t = (await getDomainHandler("operations"))
      .getTools()
      .find((x) => x.name === "panos_keygen");
    expect(t?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
  });
});

describe("annotate()", () => {
  it("fails closed (mutating) for a tool with no declared effect class, and logs to stderr", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const [t] = annotate([bare("panos_mystery")], "Panos");
    expect(t.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("panos_mystery"));
  });

  it("adds a friendly title without changing the declared hints", () => {
    const [t] = annotate(
      [bare("panos_config_show", { annotations: { readOnlyHint: true } })],
      "Panos",
    );
    expect(t.annotations?.title).toBe("Panos: config show");
    expect(t.annotations?.readOnlyHint).toBe(true);
  });
});
