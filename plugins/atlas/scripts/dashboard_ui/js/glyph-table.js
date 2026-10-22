// Glyph and role tables. Values are \uXXXX escapes copied from plugins/atlas/mod/theme.ts
// (STATE_GLYPH :32, CONTRACT_GLYPH :228, SPIN :142, PHASE_FRAMES :147); the Python contract
// test test_dashboard_glyphs_match_theme_ts fails if they drift.

export const PHASE_GLYPH = {
  research: "\u25CE",
  theory: "\u25C7",
  test: "\u2697",
  validate: "\u2630",
  implement: "\u2692",
  verify: "\u2713",
  done: "\u2691",
  blocked: "\u25A0",
};

export const STATE_GLYPH = {
  spawning: "\u25B8",
  running: "\u25B6",
  idle: "\u25CB",
  input: "\u25C7",
  stuck: "\u25A0",
  parked: "\u00B7",
  finished: "\u25CF",
  failed: "\u25A0",
  dead: "\u00B7",
};

export const SPIN = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];

export const PHASE_FRAMES = {
  research: ["\u25DC", "\u25E0", "\u25DD", "\u25DE", "\u25E1", "\u25DF"],
  theory: ["\u2736", "\u2737", "\u2738", "\u2739", "\u273A", "\u273B"],
  test: ["\u2801", "\u2802", "\u2804", "\u2840", "\u2880", "\u2820"],
  implement: ["\u28FE", "\u28FD", "\u28FB", "\u28BF", "\u287F", "\u28DF"],
  verify: ["\u25D0", "\u25D3", "\u25D1", "\u25D2", "\u25D4", "\u25D5"],
};

export const ROLE_LETTER = {
  lead: "L",
  implementer: "I",
  verifier: "V",
  explorer: "E",
  runner: "R",
  "docs-curator": "D",
  "test-engineer": "T",
};

export function roleLetter(role) {
  if (ROLE_LETTER[role]) return ROLE_LETTER[role];
  return role ? role[0].toUpperCase() : "?";
}

export function spin(frame, phase) {
  const t = PHASE_FRAMES[phase] || SPIN;
  return t[((frame % t.length) + t.length) % t.length];
}
