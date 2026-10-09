import { describe, expect, it } from "bun:test";
import { isChromeFull, parseParentMessage, retireEmbedParam } from "./lib/atlasBridge.ts";

describe("?chrome=full", () => {
  it("drops the rail only inside a frame", () => {
    expect(isChromeFull("?chrome=full&theme=dark", true)).toBe(true);
    expect(isChromeFull("?chrome=full&pane=p1&machine=local", true)).toBe(true);
  });
  it("a top-level visit, another chrome or none keeps the normal UI", () => {
    expect(isChromeFull("?chrome=full", false)).toBe(false);
    expect(isChromeFull("?chrome=pane", true)).toBe(false);
    expect(isChromeFull("", true)).toBe(false);
  });
  it("the retired ?embed=1 without a pane resolves to the rail-less host", () => {
    expect(isChromeFull(retireEmbedParam("?embed=1") ?? "", true)).toBe(true);
  });
});

describe("legacy ?embed=1", () => {
  it("becomes the pane frame with a pane and the full host without one", () => {
    expect(retireEmbedParam("?embed=1&pane=w1:p2&machine=local")).toBe("?pane=w1%3Ap2&machine=local&chrome=pane");
    expect(retireEmbedParam("?embed=1")).toBe("?chrome=full");
    expect(retireEmbedParam("?embed=1&pane=")).toBe("?pane=&chrome=full");
  });
  it("leaves an explicit chrome and other entries alone", () => {
    expect(retireEmbedParam("?embed=1&chrome=full")).toBeNull();
    expect(retireEmbedParam("?chrome=pane&pane=p1")).toBeNull();
    expect(retireEmbedParam("")).toBeNull();
  });
});

describe("parent messages", () => {
  const parent = {};
  const from = (data: unknown, origin = "https://h.test", source: unknown = parent) => parseParentMessage({ origin, source, data } as MessageEvent, "https://h.test", parent);
  it("accepts theme and select-pane from the same-origin parent", () => {
    expect(from({ type: "atlas:theme", theme: "light" })).toEqual({ type: "atlas:theme", theme: "light" });
    expect(from({ type: "atlas:select-pane", pane_id: "p1" })).toEqual({ type: "atlas:select-pane", pane_id: "p1", machine_id: null });
    expect(from({ type: "atlas:select-pane", pane_id: "p1", machine_id: "m" })).toEqual({ type: "atlas:select-pane", pane_id: "p1", machine_id: "m" });
  });
  it("drops another origin, another window and malformed data", () => {
    expect(from({ type: "atlas:theme", theme: "dark" }, "https://evil.test")).toBeNull();
    expect(from({ type: "atlas:theme", theme: "dark" }, "https://h.test", {})).toBeNull();
    expect(from({ type: "atlas:theme", theme: "pink" })).toBeNull();
    expect(from({ type: "atlas:select-pane", pane_id: 3 })).toBeNull();
    expect(from(null)).toBeNull();
  });
});
