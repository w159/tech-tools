import test from "node:test";
import assert from "node:assert/strict";
import { PHASE_GLYPH, STATE_GLYPH, SPIN, PHASE_FRAMES, roleLetter, spin } from "./glyph-table.js";

test("state input glyph", () => assert.equal(STATE_GLYPH.input, "\u25C7"));
test("phase implement glyph", () => assert.equal(PHASE_GLYPH.implement, "\u2692"));
test("phase validate glyph", () => assert.equal(PHASE_GLYPH.validate, "\u2630"));
test("spin uses the phase table", () => assert.equal(spin(7, "verify"), "\u25D3"));
test("spin wraps the default braille table", () => {
  assert.equal(spin(10), "\u280B");
  assert.equal(SPIN.length, 10);
  assert.equal(PHASE_FRAMES.research.length, 6);
});
test("roleLetter table hit and first-letter fallback", () => {
  assert.equal(roleLetter("docs-curator"), "D");
  assert.equal(roleLetter("zebra"), "Z");
});
test("roleLetter empty is ?", () => assert.equal(roleLetter(""), "?"));
