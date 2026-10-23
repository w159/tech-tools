import { describe, it, expect, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { annotate } from "../annotate-tool.js";
import { DOMAINS, getNavigationTools } from "../domains/navigation.js";
import { getDomainHandler } from "../domains/index.js";

async function domainTools(): Promise<Tool[]> {
  const out: Tool[] = [];
  for (const d of DOMAINS) out.push(...(await getDomainHandler(d)).getTools());
  return out;
}

const bare = (
  name: string,
  description = "x",
  extra: Partial<Tool> = {},
): Tool => ({
  name,
  description,
  inputSchema: { type: "object" as const, properties: {} },
  ...extra,
});

describe("paylocity tool annotations (after annotate())", () => {
  it("the connector is a read-only surface: every tool is annotated read-only and non-destructive", async () => {
    const tools = annotate(
      [...getNavigationTools(), ...(await domainTools())],
      "Paylocity",
    );
    expect(tools.length).toBeGreaterThan(12);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.annotations?.destructiveHint, t.name).toBe(false);
    }
  });

  it("no tool name or description claims to write", async () => {
    for (const t of await domainTools()) {
      expect(t.name, t.name).toMatch(/_(list|get|summary)$/);
      expect(t.description ?? "", t.name).not.toMatch(
        /^(DESTRUCTIVE|VISIBLE-TO-OTHERS):/,
      );
    }
  });

  it("every tool name is paylocity_-prefixed and unique", async () => {
    const names = [...getNavigationTools(), ...(await domainTools())].map(
      (t) => t.name,
    );
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n.startsWith("paylocity_")).toBe(true);
  });
});

describe("annotate() classification", () => {
  it("a DESTRUCTIVE: description marker wins even for a read-looking name", () => {
    const [t] = annotate(
      [bare("paylocity_employees_list", "DESTRUCTIVE: deletes everyone.")],
      "Paylocity",
    );
    expect(t.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it("overrides a hand-written readOnlyHint:true that contradicts the marker", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const [t] = annotate(
      [
        bare(
          "paylocity_employees_get",
          "VISIBLE-TO-OTHERS: notifies the employee.",
          { annotations: { readOnlyHint: true } },
        ),
      ],
      "Paylocity",
    );
    expect(t.annotations?.readOnlyHint).toBe(false);
    err.mockRestore();
  });

  it("fails closed (mutating) for an unrecognised name and logs to stderr", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const [t] = annotate([bare("paylocity_frobnicate")], "Paylocity");
    expect(t.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("paylocity_frobnicate"),
    );
    err.mockRestore();
  });

  it("classifies write verbs as mutating and adds a friendly title", () => {
    const [upd, crt] = annotate(
      [bare("paylocity_employee_update"), bare("paylocity_employee_create")],
      "Paylocity",
    );
    expect(upd.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(crt.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(upd.annotations?.title).toBe("Paylocity: employee update");
  });
});
