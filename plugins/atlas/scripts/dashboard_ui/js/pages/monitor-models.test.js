import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWindow,
  projectParam,
  secondsBetween,
  severityState,
  parseTarget,
} from "./monitor-model.js";
import { waitingAgents } from "../run-data.js";
import { activityToFeed, filterFeed, seatOptions } from "./channels-model.js";
import {
  healthState,
  hasHistory,
  sortSubsystems,
  successLabel,
  remeasurable,
  batchSummary,
  remeasureSentence,
  findingTone,
} from "./health-model.js";
import { splitProjects, hidePatch, pinPatch } from "./settings-model.js";

test("window and project params", () => {
  assert.equal(normalizeWindow("30d"), "30d");
  assert.equal(normalizeWindow("bogus"), "7d");
  assert.equal(projectParam("all"), undefined);
  assert.equal(projectParam("/a/b"), "/a/b");
  assert.equal(
    secondsBetween("2026-01-01T00:00:00Z", "2026-01-01T00:01:05Z"),
    65,
  );
  assert.equal(secondsBetween(null, "x"), null);
  assert.equal(severityState("warn").word, "Warning");
  assert.deepEqual(parseTarget("health#abc"), {
    route: "health",
    focus: "abc",
  });
});

test("overview agent selection", () => {
  const payload = {
    agents: [
      { key: "a", name: "a", state: "working", project: "/p" },
      { key: "b", name: "b", state: "input", project: "/p" },
      { key: "c", name: "c", state: "done", project: "/q" },
    ],
  };
  assert.equal(waitingAgents(payload, "/p").length, 1);
  assert.equal(waitingAgents(payload, "/q").length, 0);
});

test("activity history feed", () => {
  const feed = activityToFeed({
    groups: [
      { items: [{ id: "2", ts: "2026-01-02", agent: "impl-a", title: "ran tests", kind: "run" }] },
      { items: [{ id: "1", ts: "2026-01-01", kind: "dispatch", title: "dispatched" }] },
    ],
  });
  assert.deepEqual(feed.map((m) => m.id), ["1", "2"]);
  assert.equal(feed[0].from, "dispatch");
  assert.deepEqual(filterFeed(feed, { seat: "impl-a" }).map((m) => m.id), ["2"]);
  assert.deepEqual(filterFeed(feed, { q: "DISPATCHED" }).map((m) => m.id), ["1"]);
  assert.deepEqual(seatOptions(feed).map((o) => o.value), ["", "dispatch", "impl-a"]);
});

test("health helpers", () => {
  assert.equal(healthState({ measured: false }).word, "Not measured");
  assert.equal(healthState({ status: "fail", measured: true }).raw, "fail");
  assert.equal(hasHistory({ history: [{ ok: 0, fail: 0 }] }), false);
  assert.equal(hasHistory({ history: [{ ok: 1, fail: 0 }] }), true);
  assert.deepEqual(
    sortSubsystems([
      { id: "a", status: "ok" },
      { id: "b", status: "fail" },
      { id: "c", status: "warn" },
    ]).map((s) => s.id),
    ["b", "c", "a"],
  );
  assert.equal(successLabel("tool_calls_ok"), "Tool calls that ran");
});

test("improve helpers", () => {
  const f = [
    { id: "doctor:1", source: "doctor", status: "open" },
    { id: "doctor:2", source: "doctor", status: "fixed" },
    { id: "ledger:x", source: "ledger", status: "open" },
  ];
  assert.deepEqual(
    remeasurable(f).map((x) => x.id),
    ["doctor:1"],
  );
  assert.equal(
    batchSummary([{ ok: true }, { ok: false }]),
    "1 re-measured, 1 failed",
  );
  assert.match(
    remeasureSentence({ state: { verdict: "not_reproduced" } }),
    /not reproduced/,
  );
  assert.equal(findingTone("fixed"), "ok");
});

test("projects split and prefs patches", () => {
  const ps = [
    { root: "/a", last_active: "2026-01-01" },
    { root: "/b", last_active: "2026-02-01" },
    { root: "/c", last_active: "2026-03-01" },
  ];
  const s = splitProjects(ps, ["/a"], ["/c"]);
  assert.deepEqual(
    s.visible.map((p) => p.root),
    ["/a", "/b"],
  );
  assert.deepEqual(
    s.hidden.map((p) => p.root),
    ["/c"],
  );
  const prefs = { pinned_projects: ["/a"], hidden_projects: [] };
  assert.deepEqual(pinPatch(prefs, "/a").pinned_projects, []);
  const hp = hidePatch(prefs, "/a");
  assert.deepEqual(hp.hidden_projects, ["/a"]);
  assert.deepEqual(hp.pinned_projects, []);
});
