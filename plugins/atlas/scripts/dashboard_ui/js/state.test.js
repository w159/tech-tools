import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeState,
  statusOf,
  agentKey,
  mergeAgents,
  countStates,
  createStore,
} from "./state.js";

test("raw states map to the five words plus Unknown", () => {
  const words = Object.fromEntries(
    [
      "working",
      "blocked",
      "input",
      "idle",
      "done",
      "fail",
      "ended",
      "wat",
      undefined,
    ].map((s) => [String(s), statusOf(s).word]),
  );
  assert.deepEqual(words, {
    working: "Working",
    blocked: "Needs input",
    input: "Needs input",
    idle: "Ready",
    done: "Done",
    fail: "Failed",
    ended: "Done",
    wat: "Unknown",
    undefined: "Unknown",
  });
  assert.equal(normalizeState("RUNNING"), "working");
});

test("agentKey prefers pane id, then address, then name", () => {
  assert.equal(
    agentKey({ pane_id: "wA:p1", address: "x@y", name: "n" }),
    "wA:p1",
  );
  assert.equal(agentKey({ address: "x@y", name: "n" }), "x@y");
  assert.equal(agentKey({ name: "n" }), "n");
});

const agents = {
  agents: [
    {
      key: "wA:p1",
      pane_id: "wA:p1",
      name: "lead",
      kind: "claude",
      state: "working",
      project: "/p",
      state_changed_at: "2026-01-01T00:00:00Z",
      tasks: [{ content: "do it" }],
    },
    {
      key: "CCBackend",
      name: "CCBackend",
      kind: "unknown",
      state: "unknown",
      pane_id: null,
    },
  ],
};
const seats = {
  spaces: [
    {
      seats: [
        {
          address: "lead@s",
          name: "lead",
          pane: "wA:p1",
          target: "wA:p1",
          kind: "pane",
          state: "working",
        },
        {
          address: "shell@host",
          name: "shell@host",
          kind: "shell",
          target: null,
          state: "idle",
          cwd: "/home",
        },
        { address: "tui@host", name: "tui@host", kind: "tui", state: "idle" },
        {
          address: "old@s",
          name: "old",
          kind: "pane",
          state: "ended",
          target: null,
        },
      ],
    },
  ],
};

test("mergeAgents dedupes seats already present and adds shells", () => {
  const rows = mergeAgents(agents, seats);
  assert.deepEqual(
    rows.map((r) => r.key),
    ["wA:p1", "CCBackend", "shell@host", "tui@host", "old@s"],
  );
  const lead = rows[0];
  assert.equal(lead.task, "do it");
  assert.equal(lead.word, "Working");
  assert.equal(lead.kind, "claude");
  assert.equal(rows[1].kind, "");
  const shell = rows[2];
  assert.equal(shell.kind, "shell");
  assert.equal(shell.word, "Ready");
  assert.equal(rows[3].kind, "tui");
  assert.equal(rows[4].word, "Done");
});

test("mergeAgents tolerates missing payloads", () => {
  assert.deepEqual(mergeAgents(null, null), []);
  assert.equal(mergeAgents(agents, null).length, 2);
});

test("countStates tallies by state key", () => {
  const c = countStates(mergeAgents(agents, seats));
  assert.equal(c.working, 1);
  assert.equal(c.ready, 2);
  assert.equal(c.done, 1);
  assert.equal(c.unknown, 1);
});

test("store notifies subscribers until unsubscribed", () => {
  const s = createStore(1);
  const seen = [];
  const off = s.subscribe((v) => seen.push(v));
  s.set(2);
  s.update((v) => v + 1);
  off();
  s.set(9);
  assert.deepEqual(seen, [2, 3]);
  assert.equal(s.get(), 9);
});

test("mergeAgents keeps two shell seats with the same name but different addresses", () => {
  const seatsPayload = {
    spaces: [
      {
        seats: [
          { kind: "shell", name: "shell", address: "shell@host", state: "ready" },
          { kind: "shell", name: "shell", address: "shell@proj", project: "/p", state: "ready" },
        ],
      },
    ],
  };
  const rows = mergeAgents({ agents: [] }, seatsPayload);
  assert.deepEqual(rows.map((r) => r.address), ["shell@host", "shell@proj"]);
});
