import { test, expect } from "bun:test";
import { normalizeNav, orderGroups, DEFAULT_NAV } from "./nav-order.js";

const G = [
  { id: "observe", items: [{ page: "overview" }, { page: "activity" }, { page: "health" }] },
  { id: "operate", items: [{ page: "agents", lens: "fleet" }, { page: "agents", lens: "board" }, { page: "colony" }] },
  { id: "improve", items: [{ page: "improve" }] },
  { id: "configure", items: [{ page: "projects" }, { page: "settings" }] },
];
const shape = (gs) => gs.map((g) => g.id + ":" + g.items.map((i) => i.lens || i.page).join(","));

test("normalizeNav maps aliases, drops unknown, dedupes, appends missing", () => {
  expect(normalizeNav(undefined)).toEqual(DEFAULT_NAV);
  expect(normalizeNav(["work", "irc", "bogus", "settings", "agents"]).slice(0, 2)).toEqual(["agents", "settings"]);
  expect(normalizeNav(["console", "overview"]).slice(0, 2)).toEqual(["colony", "overview"]);
  expect(normalizeNav(["herdr", "colony"]).filter((i) => i === "colony").length).toBe(1);
  expect(normalizeNav(["x"]).length).toBe(DEFAULT_NAV.length);
});

test("default order keeps the fixed rail", () => {
  expect(shape(orderGroups(G, DEFAULT_NAV))).toEqual(shape(G));
});

test("projects first moves configure group up and reorders within it", () => {
  const out = orderGroups(G, ["projects", "settings", "overview"]);
  expect(out[0].id).toBe("configure");
  expect(shape(out)[1]).toBe("observe:overview,activity,health");
});

test("settings above projects; colony above agents lenses; lenses stay together", () => {
  const out = shape(orderGroups(G, ["colony", "settings", "projects"]));
  expect(out[0]).toBe("operate:colony,fleet,board");
  expect(out.find((s) => s.startsWith("configure"))).toBe("configure:settings,projects");
});
