import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const css = (f) => readFileSync(new URL(`../css/${f}`, import.meta.url), "utf8");
const src = readFileSync(new URL("./pages/terminal.js", import.meta.url), "utf8");

test("no stylesheet pins a px height or max-height on the xterm element", () => {
  for (const f of ["components.css", "terminal.css", "fleet.css"]) {
    for (const [, sel, body] of css(f).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      // xterm adds class "terminal" to its root, so a bare `.terminal` rule would also hit it.
      const hitsXterm = /\.xterm\b/.test(sel.replace(/:not\([^)]*\)/g, "")) || /\.terminal(?![\w-])(?!:not\(\.xterm\))/.test(sel);
      if (!hitsXterm) continue;
      expect(`${sel.trim()} ${body}`).not.toMatch(/(^|[\s;])(max-)?height:\s*\d+px/);
    }
  }
});

test("fit runs from the ResizeObserver", () => {
  expect(src).toMatch(/new ResizeObserver\(doFit\)/);
  expect(src).toMatch(/ro\.observe\(el\)/);
});
