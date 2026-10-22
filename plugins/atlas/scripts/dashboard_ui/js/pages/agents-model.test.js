import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterRows,
  groupByProject,
  chipCounts,
  terminalPlan,
  promptState,
  channelsFor,
  messagesFor,
  todosFor,
  inProject,
  NAME_PATTERN,
  isRecentParticipant,
  splitRecent,
} from "./agents-model.js";

const row = (o) => ({
  key: "k",
  name: "k",
  state: "ready",
  word: "Ready",
  source: "agent",
  project: null,
  cwd: "",
  task: "",
  kind: "",
  ...o,
});

test("filterRows combines state chip and search text", () => {
  const rows = [
    row({ name: "alpha-one", state: "working" }),
    row({ name: "beta-two", state: "ready", task: "fix login" }),
  ];
  assert.equal(filterRows(rows, { state: "working" }).length, 1);
  assert.equal(filterRows(rows, { q: "LOGIN" })[0].name, "beta-two");
  assert.equal(filterRows(rows, { q: "zzz" }).length, 0);
});

test("groupByProject orders by label and puts no-project last", () => {
  const g = groupByProject([
    row({ name: "a" }),
    row({ name: "b", project: "/x/zeta" }),
    row({ name: "c", project: "/x/alpha" }),
  ]);
  assert.deepEqual(
    g.map((x) => x.label),
    ["alpha", "zeta", "No project"],
  );
});

test("chipCounts counts per state", () => {
  const c = chipCounts([
    row({ state: "input" }),
    row({ state: "input" }),
    row({}),
  ]);
  assert.equal(c.all, 3);
  assert.equal(c.input, 2);
  assert.equal(c.ready, 1);
});

test("terminalPlan: shell seat, tui seat, tmux pane, herdr pane falls back to peek", () => {
  assert.deepEqual(
    terminalPlan(row({ source: "seat", seatKind: "shell", cwd: "/home/u" }))
      .ticket,
    { kind: "shell", cwd: "/home/u" },
  );
  assert.equal(
    terminalPlan(row({ source: "seat", seatKind: "tui" })).ticket.kind,
    "tui",
  );
  assert.equal(
    terminalPlan(
      row({ source: "seat", seatKind: "pane", target: "atlas-x:lead" }),
    ).ticket.target,
    "atlas-x:lead",
  );
  const herdr = terminalPlan(row({ key: "wA:p1", target: "wA:p1" }));
  assert.equal(herdr.mode, "peek");
  assert.equal(herdr.id, "wA:p1");
});

test("promptState explains why a prompt is disabled", () => {
  assert.equal(promptState(row({ pane_id: "wA:p1", key: "wA:p1" })).ok, true);
  const busy = promptState(
    row({ pane_id: "wA:p1", key: "wA:p1", state: "working", word: "Working" }),
  );
  assert.equal(busy.ok, false);
  assert.match(busy.reason, /working/);
  assert.equal(promptState(row({ source: "seat" })).ok, false);
});

test("channelsFor and messagesFor match the agent by name", () => {
  const me = row({ name: "worker-a" });
  const channels = [
    { name: "c1", lead: "boss", members: [{ name: "worker-a" }] },
    { name: "c2", lead: "boss", members: [{ name: "other" }] },
  ];
  assert.deepEqual(
    channelsFor(channels, me).map((c) => c.name),
    ["c1"],
  );
  const msgs = messagesFor(
    [
      {
        channel: "c1",
        messages: [
          { id: 2, ts: "2026-01-02", from: "you", to: "worker-a", body: "hi" },
          { id: 1, ts: "2026-01-01", from: "worker-a", to: "all", body: "yo" },
          { id: 3, ts: "2026-01-03", from: "x", to: "y", body: "no" },
        ],
      },
    ],
    me,
  );
  assert.deepEqual(
    msgs.map((m) => m.id),
    [1, 2],
  );
});

test("todosFor matches owner, claimed_by and launch target", () => {
  const state = {
    phases: [
      {
        name: "p",
        items: [
          { id: "1", owner: "worker-a" },
          { id: "2", launch: { target: "wA:p1" } },
          { id: "3", owner: "z" },
        ],
      },
    ],
  };
  const ids = todosFor(state, row({ name: "worker-a", pane_id: "wA:p1" })).map(
    (t) => t.id,
  );
  assert.deepEqual(ids, ["1", "2"]);
});

test("inProject matches the root and children", () => {
  assert.equal(inProject(row({ cwd: "/a/b/c" }), "/a/b"), true);
  assert.equal(inProject(row({ cwd: "/a/bc" }), "/a/b"), false);
  assert.equal(inProject(row({}), "all"), true);
});

test("NAME_PATTERN requires a hyphenated lowercase name", () => {
  assert.ok(NAME_PATTERN.test("fix-login"));
  assert.ok(!NAME_PATTERN.test("fix"));
  assert.ok(!NAME_PATTERN.test("Fix-login"));
});

test("splitRecent isolates exited channel participants with no pane or project", () => {
  const gone = row({ key: "g", name: "g", state: "unknown" });
  const live = row({ key: "a", name: "a", pane_id: "p1" });
  const unknownInProject = row({ key: "u", state: "unknown", project: "/x" });
  assert.equal(isRecentParticipant(gone), true);
  assert.equal(isRecentParticipant(unknownInProject), false);
  const { live: l, recent } = splitRecent([gone, live, unknownInProject]);
  assert.deepEqual(recent.map((r) => r.key), ["g"]);
  assert.equal(l.length, 2);
});
