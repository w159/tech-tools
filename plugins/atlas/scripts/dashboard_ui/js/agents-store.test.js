import { test, expect } from "bun:test";

// agents-store imports api.js, which touches window/location at load; stub the minimum.
globalThis.window = { location: { href: "http://127.0.0.1:7421/", origin: "http://127.0.0.1:7421" }, addEventListener() {} };
globalThis.location = window.location;
globalThis.document = { querySelector: () => null, addEventListener() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {} };
const { joinAgents } = await import("./agents-store.js");

const ROOT = "/p/proj";
const pane = (pane_id, title, cwd) => ({ pane_id, title, cwd, status: "working", state_change_seq: 1, state_changed_at: "2026-10-16T00:00:00Z" });
const item = (content, owner, project, status = "open") => ({ content, owner, project, status });

test("lead pane shows its project's open items; worker pane keeps only its own", () => {
  const todos = { phases: [{ items: [
    item("a", "worker-one", ROOT),
    item("b", "worker-two", ROOT, "in_progress"),
    item("c", "worker-one", ROOT, "done"),
    item("d", "worker-one", "/p/other"),
  ] }] };
  const out = joinAgents({
    herd: { agents: [
      pane("lead", "\u03c0 Update CLAUDE.md with things", ROOT + "/sub"),
      pane("tmp", "tmpj_3_i9xy", ROOT),
      pane("w", "worker-two", ROOT),
      pane("elsewhere", "Do something", "/nowhere"),
    ] },
    todos, projects: { projects: [{ root: ROOT + "/" }, { root: "/p/other" }] }, seen: new Map(), now: Date.now(),
  });
  const by = Object.fromEntries(out.map((r) => [r.key, r.tasks.map((t) => t.content).sort()]));
  expect(by.lead).toEqual(["a", "b"]);
  expect(by.tmp).toEqual(["a", "b"]);
  expect(by.w).toEqual(["b"]);
  expect(by.elsewhere).toEqual([]);
});

test("lead pane with a session id shows only its session's items; no match falls back to the project", () => {
  const todos = { phases: [{ items: [
    { content: "x", project: ROOT, status: "open", session_id: "01a113b4-72fe" },
    { content: "y", project: ROOT, status: "open", channel: "p@main/lead-01a145" },
    { content: "z", project: ROOT, status: "open" },
  ] }] };
  const run = (sid) => joinAgents({
    herd: { agents: [{ ...pane("l", "\u03c0 do things", ROOT), session_id: sid }] },
    todos, projects: { projects: [{ root: ROOT }] }, seen: new Map(), now: Date.now(),
  })[0].tasks.map((t) => t.content).sort();
  expect(run("01a113b4-72fe")).toEqual(["x"]);
  expect(run("01a145aa-0000")).toEqual(["y"]);
  expect(run("ffffffff-0000")).toEqual(["x", "y", "z"]);
  expect(run("")).toEqual(["x", "y", "z"]);
});

test("projectFor resolves with the live /api/projects row shape ({root_path})", () => {
  const todos = { phases: [{ items: [{ content: "x", project: ROOT, status: "open" }] }] };
  const out = joinAgents({
    herd: { agents: [pane("l", "\u03c0 do things", ROOT)] },
    todos, projects: { projects: [{ id: 1, root_path: ROOT, name: "proj" }] }, seen: new Map(), now: Date.now(),
  });
  expect(out[0].tasks.map((t) => t.content)).toEqual(["x"]);
});
