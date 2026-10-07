// Status vocabulary and the hex glyph (MASTER 3, 5.2, 9.1). No dependencies beyond dom.js so every module can use it.

import { s, normStatus } from "./dom.js";

// Geometry of the brand mark: pointy-top hexagon, viewBox 0 0 24 28.
export const HEX_PATH = "M12 1L22.5 7V21L12 27L1.5 21V7Z";

// tone = which --st-* token paints it; shape = inner glyph. One row per user-visible state.
export const STATUS = {
  input: { word: "Needs input", tone: "input", inner: "M12 8v8M12 19.4h.01" },
  fail: { word: "Failed", tone: "fail", inner: "M8.6 10.6l6.8 6.8M15.4 10.6l-6.8 6.8" },
  working: { word: "Working", tone: "working", inner: "" },
  idle: { word: "Ready", tone: "idle", inner: "" },
  done: { word: "Done", tone: "ok", inner: "M8 14.5l3 3 5-6" },
  unknown: { word: "Not measured", tone: "idle", inner: "M10.2 11a1.9 1.9 0 1 1 2.9 1.6c-.7.4-1.1.9-1.1 1.6M12 18.6h.01" },
  ok: { word: "Healthy", tone: "ok", inner: "M8 14.5l3 3 5-6" },
  warn: { word: "Warning", tone: "input", triangle: true },
  info: { word: "Info", tone: "sub", inner: "M12 12.5v4M12 9h.01" },
};

// Raw status strings (herd, todo, health, irc, legacy pages) -> state id above.
const TO_STATE = {
  input: "input", needs_input: "input", blocked: "input",
  fail: "fail", failed: "fail",
  working: "working", running: "working", in_progress: "working",
  idle: "idle", open: "idle", exited: "idle", stopped: "idle",
  done: "done",
  unknown: "unknown",
  ok: "ok",
  warn: "warn", partial: "warn",
  info: "info",
};
// Words that differ from the state's own word where the source vocabulary has its own (todo "Open", process "Exited").
const WORD_FOR_RAW = { open: "Open", exited: "Exited", stopped: "Stopped", partial: "Partial" };

export function describeStatus(status) {
  const raw = normStatus(status);
  const state = TO_STATE[raw] || "unknown";
  const row = STATUS[state];
  return { state, tone: row.tone, word: WORD_FOR_RAW[raw] || row.word, raw };
}

const SIZES = { mini: [12, 14], strip: [22, 25], cell: [56, 64] };

// HexGlyph(status, { size: "mini" | "strip" | "cell" | [w, h], label }) -> <svg class="hex">.
// Color, fill and motion are CSS (css/fleet.css) keyed on data-state; the glyph shape is part of the markup.
export function HexGlyph(status, opts) {
  const o = opts || {};
  const d = describeStatus(status);
  const size = o.size || "mini";
  const [w, hh] = Array.isArray(size) ? size : SIZES[size] || SIZES.mini;
  const row = STATUS[d.state];
  const svg = s("svg", {
    class: "hex",
    viewBox: "0 0 24 28",
    width: w,
    height: hh,
    "data-state": d.state,
    "data-tone": d.tone,
    "data-size": Array.isArray(size) ? "custom" : size,
    focusable: "false",
    ...(o.label ? { role: "img", "aria-label": o.label } : { "aria-hidden": "true" }),
  });
  if (row.triangle) {
    svg.appendChild(s("path", { class: "hex-fill", d: "M12 3L23 24H1Z" }));
    svg.appendChild(s("path", { class: "hex-line", d: "M12 3L23 24H1Z" }));
    svg.appendChild(s("path", { class: "hex-mark", d: "M12 10.5v6M12 20h.01" }));
    return svg;
  }
  svg.appendChild(s("path", { class: "hex-fill", d: HEX_PATH }));
  svg.appendChild(s("path", { class: "hex-line", d: HEX_PATH }));
  if (row.inner) svg.appendChild(s("path", { class: "hex-mark", d: row.inner }));
  return svg;
}
