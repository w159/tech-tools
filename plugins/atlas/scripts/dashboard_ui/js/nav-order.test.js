import { test, expect } from "bun:test";
import { normalizeNav, orderGroups, DEFAULT_NAV, LENS_ROUTES, MOBILE_TABS } from "./nav-order.js";

const G = [
  { id: "observe", items: [{ page: "overview" }, { page: "activity" }, { page: "health" }] },
  { id: "operate", items: [{ page: "agents", lens: "fleet" }, { page: "agents", lens: "board" }, { page: "colony" }] },
  { id: "improve", items: [{ page: "improve" }] },
  { id: "configure", items: [{ page: "projects" }, { page: "settings" }] },
];
const shape = (gs) => gs.map((g) => g.id + ":" + g.items.map((i) => i.lens || i.page).join(","));

test("normalizeNav maps aliases, drops unknown, dedupes, appends missing", () => {
  expect(normalizeNav(undefined)).toEqual(DEFAULT_NAV);
  expect(normalizeNav(["work", "irc", "bogus", "settings", "agents"]).slice(0, 3)).toEqual(["agents", "channels", "settings"]);
  expect(normalizeNav(["console", "overview"]).slice(0, 2)).toEqual(["terminal", "overview"]); // F4: console aliases to the Terminal nav entry
  expect(normalizeNav(["colony", "colony"]).filter((i) => i === "colony").length).toBe(1);
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

test("F4: terminal is in the nav and saved herd/console/herdr entries survive", () => {
  expect(DEFAULT_NAV).toContain("terminal");
  expect(MOBILE_TABS.map((t) => t[0])).toContain("terminal");
  for (const alias of ["herd", "console", "herdr"]) expect(normalizeNav([alias])[0]).toBe("terminal");
});

test("F5: agents?lens=colony routes to the Colony page, console to terminal", () => {
  expect(LENS_ROUTES.colony).toBe("colony");
  expect(LENS_ROUTES.console).toBe("terminal");
  expect(LENS_ROUTES.channel).toBe("channels");
});
