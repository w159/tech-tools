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

test("F5: console and channel lenses become routes; colony is an Agents alias, not a page", () => {
  expect(LENS_ROUTES.colony).toBeUndefined();
  expect(LENS_ROUTES.console).toBe("terminal");
  expect(LENS_ROUTES.channel).toBe("channels");
});

test("terminal keeps its id but shows as Terminal", () => {
  expect(MOBILE_TABS.find((t) => t[0] === "terminal")[1]).toBe("Terminal");
  expect(normalizeNav(["herdr"])[0]).toBe("terminal");
});

test("normalizeNav maps each legacy id to its canonical page and ignores non-array input", () => {
  for (const [old, page] of [["herd", "terminal"], ["work", "agents"], ["irc", "channels"], ["console", "terminal"], ["herdr", "terminal"]]) {
    expect(normalizeNav([old])[0]).toBe(page);
  }
  for (const bad of ["settings", { 0: "settings" }, null, 5]) expect(normalizeNav(bad)).toEqual(DEFAULT_NAV);
  expect(normalizeNav([])).toEqual(DEFAULT_NAV);
});

test("normalizeNav keeps the saved order, dedupes aliases onto one entry and appends the rest in default order", () => {
  expect(normalizeNav(["settings", "work", "agents", "herd", "console"])).toEqual(["settings", "agents", "terminal", "overview", "activity", "health", "colony", "channels", "improve", "projects"]);
  const out = normalizeNav(["projects", "overview"]);
  expect(out.slice(0, 2)).toEqual(["projects", "overview"]);
  expect(out.slice(2)).toEqual(DEFAULT_NAV.filter((p) => p !== "projects" && p !== "overview"));
});

test("lens items sharing a page keep their listed order however many there are", () => {
  const lenses = [{ page: "agents", lens: "a" }, { page: "agents", lens: "b" }, { page: "agents", lens: "c" }, { page: "agents", lens: "d" }, { page: "colony" }];
  const out = orderGroups([{ id: "g", items: lenses }], ["colony", "agents"]);
  expect(out[0].items.map((i) => i.lens || i.page)).toEqual(["colony", "a", "b", "c", "d"]);
  const plain = orderGroups([{ id: "g", items: lenses }], DEFAULT_NAV);
  expect(plain[0].items.map((i) => i.lens || i.page)).toEqual(["a", "b", "c", "d", "colony"]);
});

test("groups whose best page ties keep their listed order, and extra group fields survive", () => {
  const groups = [
    { id: "first", note: "keep", items: [{ page: "agents", lens: "x" }] },
    { id: "second", items: [{ page: "agents", lens: "y" }] },
    { id: "third", items: [{ page: "agents", lens: "z" }] },
    { id: "head", items: [{ page: "overview" }] },
  ];
  const out = orderGroups(groups, DEFAULT_NAV);
  expect(out.map((g) => g.id)).toEqual(["head", "first", "second", "third"]);
  expect(out[1].note).toBe("keep");
  expect(groups.map((g) => g.id)).toEqual(["first", "second", "third", "head"]);
});

test("a group is ranked by its best page, not its first listed item", () => {
  const groups = [
    { id: "late", items: [{ page: "settings" }, { page: "projects" }] },
    { id: "mid", items: [{ page: "agents" }] },
  ];
  const out = orderGroups(groups, ["projects", "agents"]);
  expect(out.map((g) => g.id)).toEqual(["late", "mid"]);
  expect(out[0].items.map((i) => i.page)).toEqual(["projects", "settings"]);
});

test("bootHash only seeds an empty hash", async () => {
  const { bootHash } = await import("./nav-order.js");
  expect(bootHash("")).toBe("#/overview");
  expect(bootHash(undefined)).toBe("#/overview");
  expect(bootHash("#/terminal")).toBeNull();
  expect(bootHash("#/overview?x=1")).toBeNull();
});

test("mobile tabs list every nav page exactly once, each with a label", () => {
  expect([...MOBILE_TABS.map((t) => t[0])].sort()).toEqual([...DEFAULT_NAV].sort());
  expect(MOBILE_TABS.every((t) => t.length === 2 && t[1].length > 0)).toBe(true);
});
