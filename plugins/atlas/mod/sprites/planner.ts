// Sprite set for the Atlas planner persona: blue, blueprint scroll.
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
  h: '#5b8def', // blue helmet (planner persona colour)
  p: '#cfe3f0', // blueprint scroll (pale paper)
  r: '#9db9f5', // rim light
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
................
....hhhhhhhh....
...hhhhhhhhhh...
...hvvvvvvvvh...
...hvevvvvevh...
...hhhhhhhhhh...
....ssssssss....
...ssaaaassss...
...ssssssssss...
..pppppppppp....
..pwwppwwppp....
....ss..ss......
....ss..ss......
...kkk..kkk.....
................
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
  // taps chin, scroll held
  idle: [
    ed(P_IDLE, { 4: '...hvevvvvevh.s.' }),
    ed(P_IDLE, { 4: '...hvevvvvevh...', 5: '...hhhhhhhhhh.s.' }),
  ],
  // unrolls the scroll wider
  working: [
    ed(P_IDLE, { 9: '.pppppppppppp...', 10: '.pwwppwwppppp...' }),
    ed(P_IDLE, { 9: '.ppppppppppppp..', 10: '.pwwppwwppwwp...' }),
  ],
  // teleport beam from above
  spawn: [
    ed(P_IDLE, { 0: '......aa........', 1: '......aa........', 2: '......aa........' }),
    ed(P_IDLE, { 0: '.....aawaa......', 1: '.....aawaa......', 2: '.....aawaa......' }),
  ],
  // hand raised, amber !
  input: [
    ed(P_IDLE, { 0: '............i...', 1: '.............i..', 2: '....hhhhhhhh.ss.' }),
    ed(P_IDLE, { 0: '............i...', 2: '....hhhhhhhh.ss.' }),
  ],
  // thumbs up + teal sparkles
  done: [
    ed(P_IDLE, { 2: '...hhhhhhhhhh.v.', 4: '...hvwvvvvwvh...' }),
    ed(P_IDLE, { 2: '.v.hhhhhhhh.....', 4: '...hvwvvvvwvh...' }),
  ],
  // red x eyes + glitching rows
  failed: [
    ed(P_IDLE, { 4: '...hfvvvvvfvh...', 6: '....kssssssk....', 11: '...ss..ss.......' }),
    ed(P_IDLE, { 4: '...hfvvvvvfvh...', 7: '...kkaaaasss....', 12: '.....ss..ss.....' }),
  ],
  // z z, eyes closed
  stuck: [
    ed(P_IDLE, { 0: '..z.............', 2: '...hhhhhhhhhh.z.', 4: '...hvvvvvvvvh...' }),
    ed(P_IDLE, { 0: '.............z..', 1: '....hhhhhhhh....', 4: '...hvvvvvvvvh...' }),
  ],
  killed: [
    P_KILLED_1,
    ed(P_KILLED_1, { 12: '...zz..zz..z....', 13: '...z..zz..zz....' }),
  ],
};

// ---- field (8x12) ----
const F_IDLE = grid(`
..hhhh..
.hvvvvh.
.hveveh.
.hhhhhh.
.ssssss.
.saaaas.
.pppppp.
.pwwppp.
.pppppp.
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
    ed(F_IDLE, { 2: '.hvvvvh.', 4: 's.ssssss' }),
  ],
  working: [
    ed(F_IDLE, { 6: 'ppppppp.', 7: 'pwwppwwp' }),
    ed(F_IDLE, { 6: 'pppppppp', 7: 'pwwppwwp' }),
  ],
  spawn: [
    ed(F_IDLE, { 0: '...aa...', 1: '...aa...', 2: '...aa...' }),
    ed(F_IDLE, { 0: '..aaw...', 1: '..aaw...', 2: '..aaw...' }),
  ],
  input: [
    ed(F_IDLE, { 0: '.....i..', 1: '....hhhi', 2: '.hveveh.' }),
    ed(F_IDLE, { 0: '.....i..', 2: '.hveveh.' }),
  ],
  done: [
    ed(F_IDLE, { 0: '.....v..', 2: '.hvwvwh.' }),
    ed(F_IDLE, { 0: '..v.....', 2: '.hvwvwh.' }),
  ],
  failed: [
    ed(F_IDLE, { 2: '.hfvffh.', 5: '.skaaas.' }),
    ed(F_IDLE, { 2: '.hfvffh.', 5: '.skaaks.' }),
  ],
  stuck: [
    ed(F_IDLE, { 0: '.zhhhh..', 2: '.hvvvvh.' }),
    ed(F_IDLE, { 0: '..hhhhz.', 2: '.hvvvvh.' }),
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
    ed(M_IDLE, { 2: 'sppp' }),
    ed(M_IDLE, { 2: 'sppw' }),
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

const planner: SpriteSet = { persona: 'planner', palette, portrait, field, mini };
export default planner;
