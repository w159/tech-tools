import test from "node:test";
import assert from "node:assert/strict";
import {
  channelRows,
  pickChannel,
  recipientOptions,
  isAgentAuthor,
  kindPill,
  routeText,
  mergeMessages,
  sameFeed,
} from "./channels-model.js";

const chans = [
  { name: "a", last_activity: 100, members: [{ name: "x" }] },
  { name: "b", last_activity: 300, members: [], current: false },
  {
    name: "c",
    last_activity: 200,
    members: [{ name: "y" }, { name: "z" }],
    current: true,
  },
];

test("channelRows sorts newest first and counts members", () => {
  const rows = channelRows(chans);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["b", "c", "a"],
  );
  assert.equal(rows[1].memberCount, 2);
  assert.equal(rows[0].lastActivityMs, 300000);
});

test("pickChannel prefers the hash, then the current lead channel, then the newest", () => {
  assert.equal(pickChannel(chans, "a"), "a");
  assert.equal(pickChannel(chans, "missing"), "c");
  assert.equal(
    pickChannel(
      chans.map((c) => ({ ...c, current: false })),
      "",
    ),
    "b",
  );
  assert.equal(pickChannel([], ""), "");
});

test("recipientOptions starts with everyone", () => {
  assert.deepEqual(
    recipientOptions(chans[2]).map((o) => o.value),
    ["all", "y", "z"],
  );
  assert.deepEqual(
    recipientOptions(null).map((o) => o.value),
    ["all"],
  );
});

test("author, pill and route wording", () => {
  assert.equal(isAgentAuthor("you"), false);
  assert.equal(isAgentAuthor("implementer-shell"), true);
  assert.equal(kindPill("exit"), "exit");
  assert.equal(kindPill("note"), "");
  assert.equal(routeText({ from: "you", to: "all" }), "you -> everyone");
  assert.equal(routeText({ from: "a", to: "b" }), "a -> b");
});

test("mergeMessages dedupes by id and keeps time order", () => {
  const out = mergeMessages(
    [{ id: "1", ts: "2026-01-01T00:00:02Z" }],
    [
      { id: "0", ts: "2026-01-01T00:00:01Z" },
      { id: "1", ts: "2026-01-01T00:00:02Z" },
    ],
  );
  assert.deepEqual(
    out.map((m) => m.id),
    ["0", "1"],
  );
  assert.equal(sameFeed(out, out), true);
  assert.equal(sameFeed(out, out.slice(1)), false);
});
