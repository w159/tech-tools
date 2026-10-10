// Sprite set for the Atlas lead persona: teal + gold, globe held overhead.
import type { Frame, Frames, SpriteSet } from '../contract';

/** Parse a hand-drawn grid: trims lines, drops blanks. '.' is transparent. */
const grid = (s: string): string[] =>
  s.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

/** Apply row edits (index -> replacement row) to a base grid. */
const ed = (base: string[], edits: Record<number, string>): Frame =>
  base.map((r, i) => (edits[i] !== undefined ? edits[i] : r));

// ---- palette (shared key scheme: v visor, s suit, h helmet, p prop, r rim,
// a accent, w white, k dark, e eyes; i amber, f fail-red, z ghost grey) ----
const palette: Record<string, string> = {
  v: '#2fbd9f', // teal visor
  s: '#121a1e', // dark suit
  h: '#e0b34a', // gold helmet (lead persona colour)
  p: '#e0b34a', // globe (gold)
  r: '#7fe0cb', // rim light
  a: '#b5a3fa', // accent stripe (per-agent hue placeholder)
  w: '#e6edf0', // white highlights / eyes
  k: '#0c1215', // dark
  e: '#e6edf0', // eyes
  i: '#f2aa40', // amber (input !)
  f: '#ff7570', // fail red (x eyes / glitch)
  z: '#93a4ac', // ghost grey
};

// ---- portrait (16x16) ----
const P_IDLE = grid(`
....pppppp......
...ppwwpppp.....
....pppppp..s...
....hhhhhhhh....
...hhhhhhhhhh...
...hvvvvvvvvh...
...hvevvvvevh...
...hhhhhhhhhh...
....ssssssss....
...ssaaaassss...
...ssssssssss...
....ssssssss....
....ss..ss......
....ss..ss......
...kkk..kkk.....
................
`);

const P_KILLED_1 = grid(`
................
.....zzzzzz.....
....zzzzzzzz....
...zzzzzzzzzz...
...zzkkzzkkzz...
...zzkkzzkkzz...
...zzzzzzzzzz...
...zzzzzzzzzz...
...zzzzzzzzzz...
...zzzzzzzzzz...
...zzzzzzzzzz...
....zzzzzzzz....
...z..zz..zz....
...zz..zz..z....
................
................
`);

const portrait: Frames = {
  // globe rotates (continents drift), occasional blink
  idle: [
    ed(P_IDLE, {}),
    ed(P_IDLE, { 1: '...ppppwwpp.....', 6: '...hvvvvvvvvh...' }),
  ],
  // globe spins with sparks flying off
  working: [
    ed(P_IDLE, { 1: '...wpwwpppp.....', 2: '....pppppp.ws...' }),
    ed(P_IDLE, { 1: '...ppwwppwp.....', 2: '....pppppp.sw...' }),
  ],
  // teleport beam from above, globe not yet materialised
  spawn: [
    ed(P_IDLE, { 0: '......aa........', 1: '......aa........', 2: '......aa........' }),
    ed(P_IDLE, { 0: '.....aawaa......', 1: '.....aawaa......', 2: '.....aawaa......' }),
  ],
  // hand raised, amber !
  input: [
    ed(P_IDLE, { 0: '....pppppp...i..', 1: '....ppwwpppp.i..', 2: '....pppppp.ss...' }),
    ed(P_IDLE, { 0: '....pppppp......', 1: '....ppwwpppp.i..', 2: '....pppppp.ss...' }),
  ],
  // thumbs up + teal sparkles
  done: [
    ed(P_IDLE, { 2: '....pppppp.ws...', 3: '...hhhhhhhhhh.v.', 6: '...hvwvvvvwvh...' }),
    ed(P_IDLE, { 2: '....pppppp.ws...', 3: '.v.hhhhhhhh.....', 6: '...hvwvvvvwvh...' }),
  ],
  // red x eyes + glitching rows
  failed: [
    ed(P_IDLE, { 6: '...hfvvvvvfvh...', 8: '....kssssssk....', 12: '...ss..ss.......' }),
    ed(P_IDLE, { 6: '...hfvvvvvfvh...', 9: '...kkaaaasss....', 13: '.....ss..ss.....' }),
  ],
  // z z, eyes closed
  stuck: [
    ed(P_IDLE, { 0: '..z.pppppp......', 2: '....pppppp.z....', 6: '...hvvvvvvvvh...' }),
    ed(P_IDLE, { 0: '......pppppp.z..', 1: '...ppwwpppp.....', 6: '...hvvvvvvvvh...' }),
  ],
  killed: [
    P_KILLED_1,
    ed(P_KILLED_1, { 12: '...zz..zz..z....', 13: '...z..zz..zz....' }),
  ],
};

// ---- field (8x12) ----
const F_IDLE = grid(`
..pppp..
.pwwppp.
..pppp..
..hhhh..
.hvvvvh.
.hveveh.
.hhhhhh.
.ssssss.
.saaaas.
.ssssss.
..s..s..
.kk.kk..
`);

const F_KILLED_1 = grid(`
........
..zzzz..
.zzzzzz.
.zkzzkz.
.zzzzzz.
.zzzzzz.
..zzzz..
.z.zz.z.
........
........
........
........
`);

const field: Frames = {
  idle: [
    ed(F_IDLE, {}),
    ed(F_IDLE, { 1: '.ppwwpp.', 5: '.hvvvvh.' }),
  ],
  working: [
    ed(F_IDLE, { 1: '.wpwwpp.', 2: '..pppp.w' }),
    ed(F_IDLE, { 1: '.ppwwpw.', 2: '..ppppw.' }),
  ],
  spawn: [
    ed(F_IDLE, { 0: '...aa...', 1: '...aa...', 2: '...aa...' }),
    ed(F_IDLE, { 0: '..aaw...', 1: '..aaw...', 2: '..aaw...' }),
  ],
  input: [
    ed(F_IDLE, { 0: '..pppp.i', 1: '.pwwpp.i', 2: '..pppp.s' }),
    ed(F_IDLE, { 0: '..pppp..', 1: '.pwwpp.i', 2: '..pppp.s' }),
  ],
  done: [
    ed(F_IDLE, { 2: '..pppp.v', 5: '.hvwvwh.' }),
    ed(F_IDLE, { 2: '.vpppp..', 5: '.hvwvwh.' }),
  ],
  failed: [
    ed(F_IDLE, { 5: '.hfvffh.', 8: '.skaaas.' }),
    ed(F_IDLE, { 5: '.hfvffh.', 8: '.skaaks.' }),
  ],
  stuck: [
    ed(F_IDLE, { 0: '.zpppp..', 5: '.hvvvvh.' }),
    ed(F_IDLE, { 0: '..pppp.z', 5: '.hvvvvh.' }),
  ],
  killed: [
    F_KILLED_1,
    ed(F_KILLED_1, { 7: '.zz.zz..' }),
  ],
};

// ---- mini (4x4) ----
const M_IDLE = grid(`
.hh.
hvvh
.ss.
s..s
`);

const mini: Frames = {
  idle: [
    ed(M_IDLE, {}),
    ed(M_IDLE, { 3: '.ss.' }),
  ],
  working: [
    ed(M_IDLE, { 0: 'whh.' }),
    ed(M_IDLE, { 0: '.hhw' }),
  ],
  spawn: [
    ed(M_IDLE, { 0: '..a.', 1: '.ah.', 3: '.s..' }),
    ed(M_IDLE, { 0: '.a..', 1: 'ah..', 3: '..s.' }),
  ],
  input: [
    ed(M_IDLE, { 0: 'ihh.' }),
    ed(M_IDLE, { 0: '.hh.' }),
  ],
  done: [
    ed(M_IDLE, { 0: 'vhh.' }),
    ed(M_IDLE, { 0: '.hhv' }),
  ],
  failed: [
    ed(M_IDLE, { 1: 'fvff' }),
    ed(M_IDLE, { 1: 'fvff', 2: 'kssk' }),
  ],
  stuck: [
    ed(M_IDLE, { 0: 'zhh.' }),
    ed(M_IDLE, { 0: '.hhz' }),
  ],
  killed: [
    ed(M_IDLE, { 0: '.zz.', 1: 'zkkz', 3: 'z..z' }),
    ed(M_IDLE, { 0: '.zz.', 1: 'zkkz', 3: '.zz.' }),
  ],
};

const lead: SpriteSet = { persona: 'lead', palette, portrait, field, mini };
export default lead;
