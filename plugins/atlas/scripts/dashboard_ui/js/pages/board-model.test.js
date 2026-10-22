import { test } from "node:test";
import assert from "node:assert/strict";
import { columnsOf, menuFor, opBody } from "./board-model.js";

const state = {
  phases: [
    {
      name: "build",
      items: [
        { id: "1", status: "open" },
        { id: "2", status: "done" },
      ],
    },
    { name: "ship", items: [{ id: "3", status: "blocked" }] },
  ],
};

test("columnsOf buckets items by status across phases", () => {
  const c = columnsOf(state);
  assert.deepEqual(
    c.open.map((i) => i.id),
    ["1"],
  );
  assert.deepEqual(
    c.done.map((i) => i.id),
    ["2"],
  );
  assert.deepEqual(
    c.blocked.map((i) => i.id),
    ["3"],
  );
  assert.equal(c.in_progress.length, 0);
});

test("menuFor offers Start on open, Reopen on done", () => {
  assert.ok(menuFor({ status: "open" }).some((m) => m.id === "start"));
  assert.ok(!menuFor({ status: "done" }).some((m) => m.id === "done"));
  assert.ok(menuFor({ status: "done" }).some((m) => m.id === "reopen"));
  assert.equal(menuFor({ status: "open" }).at(-1).id, "remove");
});

test("opBody uses server op names and the item's own project", () => {
  const item = { id: "7", project: "/p/own" };
  const start = opBody("start", item, "/p/side");
  assert.equal(start.project, "/p/own");
  assert.equal(start.op, "status");
  assert.equal(start.status, "in_progress");
  assert.equal(opBody("restore", item, "x").op, "restore");
  assert.equal(opBody("done", { id: "7" }, "/p/side").project, "/p/side");
  assert.equal(opBody("done", item, "x").status, "done");
  assert.equal(opBody("reopen", item, "x").status, "open");
  assert.equal(opBody("assign", item, "x", { owner: "w-a" }).owner, "w-a");
  assert.throws(() => opBody("nope", item, "x"));
});
