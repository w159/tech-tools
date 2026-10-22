import { test, expect } from "bun:test";
import { wsLabel } from "./fleet.js";

test("F1: workspace label falls back to id basename, then Unassigned", () => {
  expect(wsLabel({ id: "w1", label: "Alpha" })).toBe("Alpha");
  expect(wsLabel({ id: "/a/b/proj", label: null })).toBe("proj");
  expect(wsLabel({ id: "ws-9", label: "  " })).toBe("ws-9");
  expect(wsLabel({ id: null, label: null })).toBe("Unassigned");
});
