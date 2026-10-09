import { describe, expect, it } from "bun:test";

import { rollupStatus, statusEdgeRead } from "./status.ts";

describe("rollupStatus", () => {
  it("rolls a workspace's panes up as herdr does: blocked, then working, then done, then ready", () => {
    expect(rollupStatus(["idle", "blocked", "working"])).toBe("blocked");
    expect(rollupStatus(["done", "working"])).toBe("working");
    expect(rollupStatus(["idle", "done"])).toBe("done");
    expect(rollupStatus(["idle", undefined])).toBe("idle");
  });

  it("is unknown only when no pane says more", () => {
    expect(rollupStatus([undefined, "unknown", "something-new"])).toBe("unknown");
    expect(rollupStatus([])).toBe("unknown");
  });
});

describe("statusEdgeRead", () => {
  it("reads at once when a turn starts or ends", () => {
    expect(statusEdgeRead("working", "done")).toBe(true);
    expect(statusEdgeRead("working", "idle")).toBe(true);
    expect(statusEdgeRead("working", "blocked")).toBe(true);
    expect(statusEdgeRead("idle", "working")).toBe(true);
    expect(statusEdgeRead("done", "working")).toBe(true);
    expect(statusEdgeRead(undefined, "working")).toBe(true);
  });

  it("leaves an unchanged status and changes that neither start nor end a turn to the poll", () => {
    expect(statusEdgeRead("working", "working")).toBe(false);
    expect(statusEdgeRead("idle", "idle")).toBe(false);
    expect(statusEdgeRead("idle", "done")).toBe(false);
    expect(statusEdgeRead("blocked", "idle")).toBe(false);
    expect(statusEdgeRead(undefined, undefined)).toBe(false);
  });
});
