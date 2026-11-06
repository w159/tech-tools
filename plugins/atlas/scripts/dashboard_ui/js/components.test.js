import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom } from "./rich-dom.js";

let C, core, overlays, data, fleet;
beforeEach(async () => {
  installRichDom();
  [C, core, overlays, data, fleet] = await Promise.all([import("./components.js"), import("./ui-core.js"), import("./ui-overlays.js"), import("./ui-data.js"), import("./fleet.js")]);
});
afterEach(restoreRichDom);

describe("components.js barrel", () => {
  test("re-exports every ui-core, ui-overlays and ui-data export as the same binding", () => {
    for (const [name, mod] of [["core", core], ["overlays", overlays], ["data", data]]) {
      const names = Object.keys(mod);
      expect(names.length).toBeGreaterThan(5);
      for (const k of names) expect([name, k, C[k]]).toEqual([name, k, mod[k]]);
    }
  });
  test("the documented component families are all reachable from the one import", () => {
    const families = ["HexGlyph", "StatusDot", "Badge", "describeStatus", "Kpi", "Sparkline", "Table", "Tabs", "tabPanelProps", "Modal", "openModal", "closeModal", "confirm", "openPopover", "openMenu", "openPalette", "State", "EmptyState", "DegradedState", "toast", "toastError", "Button", "IconButton", "Chip", "Keycap", "Input", "Select", "Card", "CommandBlock", "LineChart", "BarChart", "StateBar", "Terminal", "LogView", "FilterBar", "stripAnsi", "fuzzy", "FeedItem", "DayHeader", "Timeline", "ChannelMessage", "ChannelList", "Composer", "PaneTile", "openDrawer", "closeDrawer", "Drawer"];
    for (const k of families) expect(typeof C[k]).toBe("function");
  });
  test("the fleet components come from fleet.js", () => {
    for (const k of ["AgentRow", "AgentCard", "Inspector"]) expect(C[k]).toBe(fleet[k]);
  });
  test("nothing else leaks: the barrel exports exactly the union of its sources plus the three fleet components", () => {
    const expected = new Set([...Object.keys(core), ...Object.keys(overlays), ...Object.keys(data), "AgentRow", "AgentCard", "Inspector"]);
    expect(new Set(Object.keys(C))).toEqual(expected);
  });
});
