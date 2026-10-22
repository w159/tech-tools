import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { body, buttonsOf, installDom, restoreDom } from "./operate-dom-stub.js";

const read = (rel) => Bun.file(new URL(rel, import.meta.url)).text();
installDom();
const agents = (await import("./pages/agents.js")).default;
const { lensOf } = await import("./pages/agents.js");
const { mountRoster } = await import("./pages/colony.js");
const { colonyHref, terminalHref } = await import("./fleet.js");
restoreDom();

const MEMBERS = { project: "/p", channel: null, members: [
  { name: "lead", kind: "lead", state: "running", steerable: true },
  { name: "impl-1", kind: "worker", state: "running", steerable: true },
  { name: "impl-2", kind: "worker", state: "idle", steerable: true, paused: true },
] };
const mkCtx = (params = {}, mode = "sse") => {
  const gets = [];
  return { gets, project: "/p", params, navigate() {}, openAgent() {}, api: { mode, hasToken: true, post: async () => ({}), get: async (p) => { gets.push(p); return p === "colony" ? MEMBERS : { channels: [] }; } } };
};
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("agents page", () => {
beforeEach(installDom);
afterEach(restoreDom);

test("legacy routes alias into the Agents page", async () => {
  const app = await read("./app.js");
  const aliases = app.match(/const ALIASES = \{([^}]*)\}/)[1];
  expect(aliases).toContain('colony: "agents?lens=roster"');
  expect(aliases).toContain('board: "agents?lens=board"');
  expect(aliases).toContain('supervise: "agents?lens=supervise"');
  expect(app).not.toMatch(/const ids = \[[^\]]*"colony"/); // no separate colony page module
});

test("Agents has exactly Roster, Supervise and Board lenses; old ids resolve; channel falls to roster", async () => {
  expect(lensOf("roster")).toBe("roster");
  expect(lensOf("supervise")).toBe("supervise");
  expect(lensOf("board")).toBe("board");
  expect(lensOf("supervision")).toBe("supervise");
  expect(lensOf("fleet")).toBe("roster");
  expect(lensOf("channel")).toBe("roster");
  expect(lensOf(undefined)).toBe("roster");
  const src = await read("./pages/agents.js");
  expect(src).not.toContain("mountChannelLens");
  expect(src).not.toContain("is-chan");
});

test("roster lens shows Send, Kill, Pause/Resume and Cancel on workers, none on the lead except Send", async () => {
  body.replaceChildren();
  const host = document.createElement("div");
  body.appendChild(host);
  const roster = mountRoster(mkCtx(), host);
  await tick();
  const rows = host.querySelectorAll("li.colony-row");
  expect(rows.length).toBe(3);
  const lead = buttonsOf(rows[0]);
  const w1 = buttonsOf(rows[1]);
  const w2 = buttonsOf(rows[2]);
  expect(lead).not.toContain("Kill");
  expect(lead).not.toContain("Pause");
  expect(w1).toEqual(expect.arrayContaining(["Kill", "Pause", "Cancel", "Send"]));
  expect(w2).toContain("Resume");
  expect(w2).not.toContain("Pause");
  roster.destroy();
});

test("refresh is event driven: a herd event refetches the roster, no timers are installed", async () => {
  const src = await read("./pages/colony.js");
  expect(src).not.toMatch(/setInterval|POLL_MS/);
  body.replaceChildren();
  const ctx = mkCtx({ lens: "roster" });
  await agents.load(ctx);
  body.appendChild(agents.render(ctx));
  await tick();
  const before = ctx.gets.filter((p) => p === "colony").length;
  agents.onEvent("herd", ctx, {});
  await tick();
  expect(ctx.gets.filter((p) => p === "colony").length).toBe(before + 1);
  agents.onEvent("todos", ctx, {}); // not a roster event
  await tick();
  expect(ctx.gets.filter((p) => p === "colony").length).toBe(before + 1);
  agents.destroy();
});

test("in poll mode the stream tick is the fallback that refreshes the roster", async () => {
  body.replaceChildren();
  const ctx = mkCtx({ lens: "roster" }, "poll");
  await agents.load(ctx);
  body.appendChild(agents.render(ctx));
  await tick();
  const before = ctx.gets.filter((p) => p === "colony").length;
  agents.onEvent("tick", ctx, {});
  await tick();
  expect(ctx.gets.filter((p) => p === "colony").length).toBe(before + 1);
  ctx.api.mode = "sse";
  agents.onEvent("tick", ctx, {});
  await tick();
  expect(ctx.gets.filter((p) => p === "colony").length).toBe(before + 1);
  agents.destroy();
});

test("one send path: fleet drawer no longer posts irc or herd prompt; Stop is not a pane close", async () => {
  const fleet = await read("./fleet.js");
  const page = await read("./pages/agents.js");
  expect(fleet).not.toMatch(/api\.post\("irc"/);
  expect(fleet).not.toContain("/prompt");
  expect(fleet).toContain("sendToSeat");
  expect(page).not.toContain("herd/panes");
  expect(page).toContain("killSeat");
});

test("fleet drawer deep links: Open in Colony selects the seat on the roster lens, Open terminal goes to terminal?seat=", () => {
  expect(colonyHref({ name: "impl-1", key: "k" })).toBe("#/agents?lens=roster&seat=impl-1");
  expect(terminalHref({ name: "impl-1", key: "k" })).toBe("#/terminal?seat=impl-1");
});

test("the selected seat is highlighted on the roster", async () => {
  body.replaceChildren();
  const host = document.createElement("div");
  body.appendChild(host);
  const roster = mountRoster(mkCtx({ seat: "impl-2" }), host);
  await tick();
  const rows = host.querySelectorAll("li.colony-row");
  expect(rows.map((r) => r.getAttribute("data-selected"))).toEqual([null, null, "true"]);
  roster.destroy();
});
});
