import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { body, installDom, restoreDom } from "./operate-dom-stub.js";
installDom();
const work = (await import("./pages/work.js")).default;
restoreDom();

const BOARD = { phases: [{ name: "Backlog", items: [{ id: "t1", content: "Ship the thing", status: "open" }] }], counts: {} };
const EMPTY = { phases: [], counts: {} };
const ctxWith = (get) => ({ project: "/p", params: {}, api: { hasToken: true, mode: "sse", get, post: async () => ({}) } });
const mount = async (ctx) => {
  body.replaceChildren();
  const data = await work.load(ctx);
  const node = work.render(ctx, data);
  body.appendChild(node);
  return node;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => body.textContent;

describe("work board", () => {
beforeEach(installDom);
afterEach(restoreDom);

test("first load failure renders an error state with Retry instead of throwing", async () => {
  await mount(ctxWith(async () => { throw Object.assign(new Error("daemon down"), { error: "daemon down" }); }));
  expect(text()).toContain("daemon down");
  expect(body.querySelectorAll("button").map((b) => b.textContent).join(" ")).toMatch(/retry/i);
  work.destroy();
});

test("an empty board shows the empty state with a first-task form", async () => {
  await mount(ctxWith(async () => EMPTY));
  expect(text()).toContain("No tasks yet");
  expect(body.querySelector("form")).not.toBeNull();
  work.destroy();
});

test("a failed refresh keeps the last good rows and shows a stale banner with the last good time; recovery clears it", async () => {
  let fail = false;
  const ctx = ctxWith(async () => { if (fail) throw new Error("offline"); return BOARD; });
  await mount(ctx);
  expect(text()).toContain("Ship the thing");
  fail = true;
  work.onEvent("todos", ctx);
  await sleep(900);
  expect(text()).toContain("Ship the thing");
  expect(text()).toContain("Could not refresh the board. Showing the last good state from ");
  fail = false;
  work.onEvent("todos", ctx);
  await sleep(900);
  expect(text()).not.toContain("Could not refresh the board");
  work.destroy();
});
});
