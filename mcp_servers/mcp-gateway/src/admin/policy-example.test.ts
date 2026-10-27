import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePolicy } from "../policy.js";
import { catalogConnectorIds } from "./plan.js";

// The shipped example must stay loadable by the gateway against the real catalog.
const examplePath = fileURLToPath(new URL("../../../../plugins/armada/enterprise/templates/policy.example.yaml", import.meta.url));

describe("plugins/armada/enterprise/templates/policy.example.yaml", () => {
  const text = readFileSync(examplePath, "utf8");

  it("loads with parsePolicy against catalog/catalog.json", () => {
    const policy = parsePolicy(text, catalogConnectorIds());
    expect(policy.subjects.length).toBeGreaterThan(0);
    expect(policy.grants.length).toBeGreaterThan(0);
  });

  it("rejects the same file with a connector that is not in the catalog", () => {
    expect(() => parsePolicy(text.replace("connectwise", "nosuchvendor"), catalogConnectorIds())).toThrow();
  });
});
