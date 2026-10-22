import test from "node:test";
import assert from "node:assert/strict";
import { filterCommands, defaultCommands, openPalette } from "./palette.js";

const noop = () => {};
const cmds = () => defaultCommands({ navigate: noop, steerLead: noop, holdSelected: noop, toggleTheme: noop });

test("defaultCommands has the nine labels", () => {
  assert.deepEqual(cmds().map((c) => c.label), [
    "Go to Run", "Go to Agents", "Go to Board", "Go to Channels", "Go to Health", "Go to Settings",
    "Steer lead", "Hold selected seat", "Toggle theme",
  ]);
});

test("filterCommands is case-insensitive substring, Agents first for 'go to a'", () => {
  assert.equal(filterCommands(cmds(), "GO TO A")[0].label, "Go to Agents");
});

test("empty query returns all", () => {
  assert.equal(filterCommands(cmds(), "").length, 9);
});

test("route commands call navigate with the route id", () => {
  let got;
  const c = defaultCommands({ navigate: (r) => (got = r), steerLead: noop, holdSelected: noop, toggleTheme: noop });
  c[1].run();
  assert.equal(got, "agents");
});

test("openPalette throws a clear error without a root", () => {
  assert.throws(() => openPalette(cmds(), { root: null }), /root/);
});
