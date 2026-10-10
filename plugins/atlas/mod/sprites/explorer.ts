// Sprite set for the Atlas explorer persona: cyan, lantern + map.
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
  h: '#4fc3e8', // cyan helmet (explorer persona colour)
  p: '#f2aa40', // lantern glow (amber)
  r: '#9fe3f5', // rim light
  a: '#b5a3fa', // accent stripe (per-agent hue placeholder)
  w: '#e6edf0', // white highlights / map paper / eyes
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
...ssssssss.pp..
.ww.ssssss.pp...
.ww.ssssss.pp...
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
  // lantern sways, map held steady
  idle: [
    ed(P_IDLE, {}),
    ed(P_IDLE, { 8: '...sssssssspp...', 9: '.ww.ssssss.pp...', 10: '.ww.ssssss.pp...' }),
  ],
  // sweeps the lantern, beam arc wide
  working: [
    ed(P_IDLE, { 8: '...sssssss.p.i..', 9: '.ww.ssssssppi...', 10: '.ww.ssssss.pp...' }),
    ed(P_IDLE, { 8: '..i.psssssss....', 9: '...ippssssss.ww.', 10: '...pp.ssssss.ww.' }),
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
.ssssss.
.pp.s...
.pp..ww.
.s...ww.
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
    ed(F_IDLE, { 7: '.pp.s...', 8: '..pp.ww.', 9: '.s...ww.' }),
  ],
  working: [
    ed(F_IDLE, { 7: 'i.pps...', 8: '.pp..ww.', 9: '.s...ww.' }),
    ed(F_IDLE, { 7: '...spp..', 8: '.ww..pp.', 9: '.ww..s..' }),
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
    ed(F_IDLE, { 2: '.hfvffh.', 4: '.skaaas.' }),
    ed(F_IDLE, { 2: '.hfvffh.', 4: '.skaaks.' }),
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
    ed(M_IDLE, { 0: 'ihh.' }),
    ed(M_IDLE, { 0: '.hhi' }),
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

const explorer: SpriteSet = { persona: 'explorer', palette, portrait, field, mini };
export default explorer;
