import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultCommands } from "./palette.js";

test("defaultCommands wiring: nine commands, every run is callable and reaches its handler", () => {
  const seen = [];
  const cmds = defaultCommands({
    navigate: (r) => seen.push(`nav:${r}`),
    steerLead: () => seen.push("steer"),
    holdSelected: () => seen.push("hold"),
    toggleTheme: () => seen.push("theme"),
  });
  assert.equal(cmds.length, 9);
  for (const c of cmds) assert.equal(typeof c.run, "function", c.id);
  cmds.forEach((c) => c.run());
  assert.equal(seen.length, 9);
  assert.ok(seen.includes("nav:health") && seen.includes("steer") && seen.includes("hold") && seen.includes("theme"));
});

test("app.js binds slash to the palette and shortcuts.js no longer claims it", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /bindKeys\(\{ "\/": /);
  const sc = readFileSync(new URL("./shortcuts.js", import.meta.url), "utf8");
  assert.ok(!sc.includes('ev.key === "/"'));
});
