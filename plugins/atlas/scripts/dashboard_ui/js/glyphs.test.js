import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installDom, restoreDom } from "./operate-dom-stub.js";

installDom();
const { describeStatus, HexGlyph } = await import("./glyphs.js");
restoreDom();
beforeEach(installDom);
afterEach(restoreDom);

const walk = (n, out = []) => { out.push(n); (n.children || []).forEach((c) => walk(c, out)); return out; };
const paths = (svg) => walk(svg).filter((n) => n.tag === "path");

describe("describeStatus", () => {
  const cases = [
    ["input", "input", "input", "Needs input"], ["needs_input", "input", "input", "Needs input"], ["blocked", "input", "input", "Needs input"],
    ["fail", "fail", "fail", "Failed"], ["failed", "fail", "fail", "Failed"], ["error", "fail", "fail", "Failed"],
    ["working", "working", "working", "Working"], ["running", "working", "working", "Working"], ["in_progress", "working", "working", "Working"],
    ["idle", "idle", "idle", "Ready"], ["done", "done", "ok", "Done"], ["ok", "ok", "ok", "Healthy"],
    ["warn", "warn", "input", "Warning"], ["info", "info", "sub", "Info"], ["unknown", "unknown", "idle", "Not measured"],
  ];
  for (const [raw, state, tone, word] of cases) {
    test(`${raw} -> ${state}/${tone}/${word}`, () => {
      const d = describeStatus(raw);
      expect(d.state).toBe(state);
      expect(d.tone).toBe(tone);
      expect(d.word).toBe(word);
    });
  }
  test("source vocabularies keep their own word but map to the shared state", () => {
    expect(describeStatus("open")).toMatchObject({ state: "idle", word: "Open", raw: "open" });
    expect(describeStatus("exited")).toMatchObject({ state: "idle", word: "Exited" });
    expect(describeStatus("stopped")).toMatchObject({ state: "idle", word: "Stopped" });
    // "partial" is aliased to warn by normStatus before the word lookup, so it reads "Warning"
    expect(describeStatus("partial")).toMatchObject({ state: "warn", word: "Warning", raw: "warn" });
  });
  test("aliases are normalised before lookup", () => {
    expect(describeStatus("Healthy")).toMatchObject({ state: "ok", raw: "ok" });
    expect(describeStatus("In Progress").state).toBe("working");
  });
  test("nothing or an unrecognised word reads as Not measured", () => {
    expect(describeStatus(undefined)).toMatchObject({ state: "unknown", word: "Not measured" });
    expect(describeStatus("banana")).toMatchObject({ state: "unknown", word: "Not measured", raw: "banana" });
  });
});

describe("HexGlyph", () => {
  test("defaults to the mini size, hidden from assistive tech", () => {
    const g = HexGlyph("ok");
    expect(g.attrs).toMatchObject({ class: "hex", viewBox: "0 0 24 28", width: "12", height: "14", "data-state": "ok", "data-tone": "ok", "data-size": "mini", focusable: "false", "aria-hidden": "true" });
    expect(g.attrs.role).toBeUndefined();
  });
  test("named sizes and custom [w,h]", () => {
    expect(HexGlyph("ok", { size: "strip" }).attrs).toMatchObject({ width: "22", height: "25", "data-size": "strip" });
    expect(HexGlyph("ok", { size: "cell" }).attrs).toMatchObject({ width: "56", height: "64", "data-size": "cell" });
    expect(HexGlyph("ok", { size: [30, 40] }).attrs).toMatchObject({ width: "30", height: "40", "data-size": "custom" });
  });
  test("an unknown size name falls back to mini dimensions", () => {
    expect(HexGlyph("ok", { size: "huge" }).attrs).toMatchObject({ width: "12", height: "14" });
  });
  test("a label makes it an accessible image", () => {
    const g = HexGlyph("fail", { label: "Failed agent" });
    expect(g.attrs).toMatchObject({ role: "img", "aria-label": "Failed agent" });
    expect(g.attrs["aria-hidden"]).toBeUndefined();
  });
  test("hexagon outline with a status mark: fill, line, mark", () => {
    const p = paths(HexGlyph("done"));
    expect(p.map((x) => x.attrs.class)).toEqual(["hex-fill", "hex-line", "hex-mark"]);
    expect(p[0].attrs.d).toBe("M12 1L22.5 7V21L12 27L1.5 21V7Z");
    expect(p[1].attrs.d).toBe(p[0].attrs.d);
    expect(p[2].attrs.d).toBe("M8 14.5l3 3 5-6");
  });
  test("states without an inner shape draw no mark", () => {
    for (const st of ["working", "idle"]) expect(paths(HexGlyph(st)).map((x) => x.attrs.class)).toEqual(["hex-fill", "hex-line"]);
  });
  test("warn draws the triangle instead of the hexagon", () => {
    const p = paths(HexGlyph("warn"));
    expect(p.map((x) => [x.attrs.class, x.attrs.d])).toEqual([["hex-fill", "M12 3L23 24H1Z"], ["hex-line", "M12 3L23 24H1Z"], ["hex-mark", "M12 10.5v6M12 20h.01"]]);
  });
  test("data-state follows the normalised status", () => {
    expect(HexGlyph("blocked").attrs["data-state"]).toBe("input");
  });
});
