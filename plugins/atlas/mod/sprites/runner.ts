// Sprite set for the Atlas runner persona: orange, sneakers + speed lines.
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
  h: '#e8894a', // orange helmet (runner persona colour)
  p: '#e8894a', // sneakers + speed lines (orange)
  r: '#f2b077', // rim light
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
..p.ssssssss.p..
.p..ssssssss..p.
....ss..ss......
....ss..ss......
....pp..pp......
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
  // bounce on toes, speed lines drift
  idle: [
    ed(P_IDLE, {}),
    ed(P_IDLE, { 11: '....ss..ss......', 12: '....pp..pp......', 13: '....pp..pp......', 14: '................' }),
  ],
  // sprint: leaning, double speed lines + dust puffs
  working: [
    ed(P_IDLE, { 9: 'wp.ssssssss.p...', 10: '.p.wssssssssp...', 13: '...pp...pp......' }),
    ed(P_IDLE, { 9: '...p.sssssss..pw', 10: '..pwssssssss.p..', 13: '.....pp...pp....' }),
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
    ed(P_IDLE, { 2: '...hhhhhhhhhh.v.', 4: '...hvwvvvvwvh...', 9: '..p.ssssssss.ws.' }),
    ed(P_IDLE, { 2: '.v.hhhhhhhh.....', 4: '...hvwvvvvwvh...', 9: '..p.ssssssss.ws.' }),
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
.ssssss.
p.s..s.p
.p....p.
.pp.pp..
........
........
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
    ed(F_IDLE, { 7: '.s....s.', 8: 'p......p', 9: '.pp..pp.' }),
  ],
  working: [
    ed(F_IDLE, { 7: 'p.s..s.p', 8: 'pw....wp', 9: 'pp....pp' }),
    ed(F_IDLE, { 7: '.ps..sp.', 8: '.p....p.', 9: '.pp..pp.' }),
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

const runner: SpriteSet = { persona: 'runner', palette, portrait, field, mini };
export default runner;
