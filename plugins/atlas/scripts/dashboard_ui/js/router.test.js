import test from "node:test";
import assert from "node:assert/strict";
import { acceptRender, parseHash, buildHash, redirectOld, ROUTES } from "./router.js";

test("parses route and query params", () => {
  const r = parseHash("#/agents?agent=wA%3Ap1&project=%2Fa%2Fb");
  assert.equal(r.route, "agents");
  assert.deepEqual(r.params, { agent: "wA:p1", project: "/a/b" });
  assert.equal(r.redirected, false);
});

test("empty and unknown hashes land on overview", () => {
  assert.equal(parseHash("").route, "overview");
  assert.equal(parseHash("#/nope").route, "overview");
  assert.equal(parseHash("#/nope").redirected, true);
});

test("old hashes redirect to the page that owns them", () => {
  for (const [old, now] of [
    ["colony", "agents"],
    ["terminal", "agents"],
    ["herd", "agents"],
    ["work", "board"],
    ["irc", "channels"],
  ]) {
    const r = parseHash(`#/${old}`);
    assert.equal(r.route, now, old);
    assert.equal(r.redirected, true);
  }
  assert.equal(parseHash("#/terminal").params.tab, "terminal");
  assert.equal(redirectOld("#/work?status=open"), "#/board?status=open");
  assert.equal(redirectOld("#/board"), null);
});

test("buildHash drops empty values and round-trips", () => {
  assert.equal(
    buildHash("board", { status: "open", project: "" }),
    "#/board?status=open",
  );
  assert.equal(buildHash("overview"), "#/overview");
  const p = { agent: "a b", tab: "messages" };
  assert.deepEqual(parseHash(buildHash("agents", p)).params, p);
});

test("all nine routes are routable", () => {
  assert.equal(ROUTES.length, 9);
  for (const r of ROUTES) assert.equal(parseHash(`#/${r}`).route, r);
});

test("a stale render is rejected", () => {
  assert.equal(acceptRender("activity", "channels"), false);
  assert.equal(acceptRender("activity", "activity", { isConnected: false }), false);
  assert.equal(acceptRender("activity", "activity", { isConnected: true }), true);
});
