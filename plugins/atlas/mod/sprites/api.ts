// Half-block sprite library: persona x mood x frame x size -> rows of styled runs.
// Personas with hand-drawn pixel art (art.ts, via paintArt) render from it; others fall back to
// procedural palette.ts specs on a 14x14 grid; both fold into half-block cells.
// Output glyphs are only space, U+2580, U+2584 and U+2588 (always one cell wide).
import { ALIASES, CREATURES, PROP_LEGEND, PROPS } from './palette';
import { ART } from './art';
import type { Creature } from './palette';
import { rangeWidth, type Span } from '../theme';

import type { Mood } from '../orchestra-types';
export type Run = { text: string; fg?: string; bg?: string; bold?: boolean };
export type SpriteSize = 's' | 'm' | 'l';

export const MOODS: Mood[] = ['idle', 'working', 'thinking', 'blocked', 'done', 'failed', 'celebrate'];
export const PERSONA_KEYS: string[] = Object.keys(CREATURES);

const PX: Record<SpriteSize, number> = { s: 3, m: 12, l: 16 };
const FRAMES: Record<Mood, number> = { idle: 4, working: 4, thinking: 3, blocked: 2, done: 2, failed: 2, celebrate: 4 };

export const spriteWidth = (size: SpriteSize): number => PX[size];
export const frameCount = (mood: Mood): number => FRAMES[mood];

function resolveKey(persona: string): string {
  const k = persona.toLowerCase().replace(/^atlas:/, '').trim();
  return k.startsWith('armada') ? 'armada' : (ALIASES[k] ?? k);
}

function resolve(persona: string): Creature {
  return CREATURES[resolveKey(persona)] ?? (CREATURES.unknown as Creature);
}

export function personaStyle(persona: string): { color: string; accent: string; species: string; catchphrase: string } {
  const c = resolve(persona);
  return { color: c.color, accent: c.accent, species: c.species, catchphrase: c.catchphrase };
}

function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number): number => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const m = (i: number): string => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, '0');
  return `#${m(0)}${m(1)}${m(2)}`;
}

/** Fade a colour towards gray when the creature has failed. */
const grayed = (failed: boolean, col: string, t: number): string => (failed ? mix(col, GRAY, t) : col);

const EYE = '#14161c';
const GOLD = '#ffd84a';
const RED = '#ff5a52';
const GRAY = '#7a7f8a';
const CONFETTI = ['#ffd84a', '#f472b6', '#56d4dd', '#52c872', '#ff7570'];
const CONF_POS: [number, number][][] = [
  [[1, 2], [12, 1], [0, 8], [13, 7], [6, 0]],
  [[2, 0], [13, 3], [1, 6], [12, 9], [8, 1]],
  [[0, 3], [11, 0], [2, 9], [13, 5], [5, 1]],
  [[1, 1], [12, 4], [0, 6], [13, 10], [9, 0]],
];

type Cell = string | undefined;
type Put = (x: number, y: number, col: string) => void;
/** A filled rectangle (x0, y0, x1, y1 inclusive) in a colour key of the painter palette, or a raw hex. */
type Op = readonly [number, number, number, number, string];
type Pal = Record<string, string>;

const p = (x: number, y: number, k: string): Op => [x, y, x, y, k];
const r = (x0: number, y0: number, x1: number, y1: number, k: string): Op => [x0, y0, x1, y1, k];

// ---- procedural painter tables: coordinates on the 14x14 grid, y offsets applied at draw time ----
const EARS: Partial<Record<Creature['ears'], Op[]>> = {
  round: [p(3, 2, 'base'), p(10, 2, 'base')],
  cat: [r(3, 1, 3, 2, 'base'), p(4, 2, 'base'), r(10, 1, 10, 2, 'base'), p(9, 2, 'base'), p(3, 2, 'acc'), p(10, 2, 'acc')],
  bunny: [r(4, 0, 4, 2, 'base'), r(9, 0, 9, 2, 'base'), p(4, 1, 'acc'), p(9, 1, 'acc')],
  horn: [r(3, 1, 3, 2, 'acc'), r(10, 1, 10, 2, 'acc')],
  ant: [p(5, 2, 'acc'), p(4, 1, 'acc'), p(3, 0, 'acc'), p(8, 2, 'acc'), p(9, 1, 'acc'), p(10, 0, 'acc')],
  fin: [r(2, 3, 2, 4, 'acc'), r(11, 3, 11, 4, 'acc'), p(1, 4, 'acc'), p(12, 4, 'acc')],
};
const HATS: Partial<Record<Creature['hat'], Op[]>> = {
  crown: [r(4, 1, 9, 2, 'gold'), p(4, 0, 'gold'), p(6, 0, 'gold'), p(7, 0, 'gold'), p(9, 0, 'gold'), p(6, 2, 'acc'), p(7, 2, 'acc')],
  hardhat: [r(3, 2, 10, 2, 'gold'), r(4, 1, 9, 1, 'gold')],
  cap: [r(4, 2, 9, 2, 'acc'), p(10, 2, 'acc'), p(11, 3, 'acc')],
  visor: [r(3, 3, 10, 3, 'acc')],
  beret: [r(3, 1, 8, 2, 'acc'), p(6, 0, 'acc')],
};
const FEET_STAND: Op[] = [r(4, 12, 5, 13, 'dark'), r(8, 12, 9, 13, 'dark')];
const FEET_RUN: Op[][] = [[r(3, 12, 4, 13, 'dark'), r(9, 13, 10, 13, 'dark')], [r(4, 13, 5, 13, 'dark'), r(8, 12, 9, 13, 'dark')]];
const TORSO_SHELL: Op[] = [r(3, 9, 10, 12, 'dark'), r(6, 10, 7, 12, 'light')];
const TORSO_PLAIN: Op[] = [r(4, 9, 9, 12, 'base'), r(6, 10, 7, 12, 'light')];
const SHOULDERS: Op[] = [p(3, 9, 'base'), p(10, 9, 'base')];
const ARMS_DOWN: Op[] = [...SHOULDERS, p(3, 10, 'base'), p(10, 10, 'base')];
const ARMS: Record<Mood, Op[]> = {
  idle: ARMS_DOWN,
  working: ARMS_DOWN,
  thinking: [...ARMS_DOWN, p(10, 8, 'base')],
  blocked: [...ARMS_DOWN, r(4, 10, 9, 10, 'dark')],
  done: ARMS_DOWN,
  failed: ARMS_DOWN,
  celebrate: [...SHOULDERS, r(2, 7, 2, 8, 'base'), r(11, 7, 11, 8, 'base')],
};
const HEAD: Op[] = [r(3, 3, 10, 8, 'base')];
const HEAD_WIDE: Op[] = [r(2, 4, 11, 8, 'base')];
const HEAD_LIGHT: Op[] = [r(5, 7, 8, 8, 'light')];
const MOUTH_HAPPY: Op[] = [p(5, 7, 'dark'), p(6, 8, 'dark'), p(7, 8, 'dark'), p(8, 7, 'dark')];
const MOUTH: Partial<Record<Mood, Op[]>> = {
  done: MOUTH_HAPPY,
  celebrate: MOUTH_HAPPY,
  failed: [p(5, 8, 'dark'), p(6, 7, 'dark'), p(7, 7, 'dark'), p(8, 8, 'dark')],
  blocked: [p(6, 7, 'dark'), p(7, 7, 'dark')],
  thinking: [p(7, 7, 'dark')],
};
// Per-frame vertical bob of the head and jump of the whole body.
const BOB: Partial<Record<Mood, number[]>> = { idle: [0, 1, 1, 0], working: [0, 0, 1, 0], failed: [1, 1] };
const JUMP: Partial<Record<Mood, number[]>> = { celebrate: [0, -1, -1, 0] };
const PROP_DY: Partial<Record<Mood, number[]>> = { failed: [3, 3], celebrate: [-2, -1, -2, -1] };
// Per-frame eye shift [dx, dy] for the plain (non-happy, non-failed) eyes.
const EYE_SHIFT: Partial<Record<Mood, [number, number][]>> = {
  working: [[1, 0], [1, 0], [1, 1], [1, 0]],
  thinking: [[0, -1], [1, -1], [0, -1]],
};
const EYE_PAIRS = [4, 7];
const BROW: Op[] = [r(4, 4, 5, 4, 'red'), r(8, 4, 9, 4, 'red')];
const WORK_SPARK: [number, number][] = [[13, 4], [12, 3], [13, 2], [12, 4]];
const THINK_DOTS: [number, number][] = [[10, 2], [11, 1], [12, 0]];

const at = (table: Partial<Record<Mood, number[]>>, mood: Mood, fr: number): number => table[mood]?.[fr] ?? 0;

const xEyes = (): Op[] => EYE_PAIRS.flatMap((ox) => [p(ox, 4, 'red'), p(ox + 2, 4, 'red'), p(ox + 1, 5, 'red'), p(ox, 6, 'red'), p(ox + 2, 6, 'red')]);
const happyEyes = (): Op[] => EYE_PAIRS.flatMap((ox) => [p(ox, 5, 'eye'), p(ox + 1, 4, 'eye'), p(ox + 2, 5, 'eye')]);
const eyeShift = (mood: Mood, fr: number): [number, number] => EYE_SHIFT[mood]?.[fr] ?? [0, 0];
const eyeKey = (mood: Mood, fr: number): string => (mood === 'idle' && fr === 3 ? 'dark' : 'eye'); // idle blink
const browOps = (mood: Mood): Op[] => (mood === 'blocked' ? BROW : []);
function plainEyes(mood: Mood, fr: number): Op[] {
  const [ex, ey] = eyeShift(mood, fr);
  const k = eyeKey(mood, fr);
  return [p(5 + ex, 5 + ey, k), p(8 + ex, 5 + ey, k), ...browOps(mood)];
}
const EYES: Partial<Record<Mood, (mood: Mood, fr: number) => Op[]>> = { failed: xEyes, done: happyEyes, celebrate: happyEyes };
const eyeOps = (mood: Mood, fr: number): Op[] => (EYES[mood] ?? plainEyes)(mood, fr);

// Effects sit outside the jump: drawn with no body offset.
const runnerDust = (fr: number): Op[] => {
  const y = 7 + (fr % 2) * 2;
  return [fr % 2 ? r(0, 9, 2, 9, 'white') : r(0, 11, 1, 11, 'white'), r(0, y, 0, y, 'white')];
};
const sparkle = (fr: number): Op[] => {
  const [x, y] = WORK_SPARK[fr] ?? [13, 4];
  return [p(x, y, 'gold')];
};
const EFFECTS: Partial<Record<Mood, (fr: number, running: boolean) => Op[]>> = {
  working: (fr, running) => (running ? runnerDust(fr) : sparkle(fr)),
  thinking: (fr) => THINK_DOTS.slice(0, fr + 1).map(([x, y]) => p(x, y, 'white')),
  blocked: (fr) => { const k = fr === 0 ? 'red' : 'gold'; return [r(12, 0, 12, 2, k), p(12, 4, k)]; },
  done: (fr) => [p(11, 2, 'green'), p(12, 3, 'green'), p(13, 2, 'green'), p(13, 1, 'green'), ...(fr === 1 ? [p(10, 0, 'gold')] : [])],
  failed: (fr) => [p(11, 2 + fr, 'ice'), p(11, 3 + fr, 'ice'), p(1, 1 + fr, 'gray'), p(2, 0, 'gray')],
  celebrate: (fr) => (CONF_POS[fr] ?? []).map(([x, y], i) => p(x, y, CONFETTI[(i + fr) % CONFETTI.length] as string)),
};

// ---- canvas: a pixel grid sampled from the 14x14 design grid ----
const inBounds = (v: number): boolean => v >= 0 && v <= 13;

/** First and last grid cell covered by design pixel v at scale sx. */
function cellSpan(v: number, sx: number): [number, number] {
  const lo = Math.floor(v * sx);
  return [lo, Math.max(lo, Math.floor((v + 1) * sx) - 1)];
}

function fillCells(grid: Cell[][], x0: number, y0: number, x1: number, y1: number, col: string): void {
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) (grid[yy] as Cell[])[xx] = col;
}

function canvas(n: number): { grid: Cell[][]; put: Put } {
  const sx = n / 14;
  const grid: Cell[][] = Array.from({ length: n }, () => new Array<Cell>(n).fill(undefined));
  const put: Put = (x, y, col) => {
    if (!inBounds(x) || !inBounds(y)) return;
    const [x0, x1] = cellSpan(x, sx);
    const [y0, y1] = cellSpan(y, sx);
    fillCells(grid, x0, y0, x1, y1, col);
  };
  return { grid, put };
}

function fillRect(put: Put, x0: number, y0: number, x1: number, y1: number, col: string): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, col);
}

function drawOps(put: Put, pal: Pal, ops: Op[], dy: number): void {
  for (const [x0, y0, x1, y1, k] of ops) fillRect(put, x0, y0 + dy, x1, y1 + dy, pal[k] ?? k);
}

function bodyPalette(c: Creature, mood: Mood): Pal {
  const failed = mood === 'failed';
  const base = grayed(failed, c.color, 0.5);
  return {
    base, acc: grayed(failed, c.accent, 0.5), dark: mix(base, '#000000', 0.38), light: mix(base, '#ffffff', 0.4),
    gold: GOLD, red: RED, eye: EYE, gray: GRAY, white: '#f2f4f8', green: '#52c872', ice: '#9be7ff',
  };
}

const propDy = (mood: Mood, fr: number): number => PROP_DY[mood]?.[fr] ?? 1;

function propOffset(prop: (typeof PROPS)[Creature['prop']], mood: Mood, fr: number): [number, number] {
  if (mood === 'working') return prop.work[fr] ?? [0, 0];
  return [0, propDy(mood, fr)];
}

function drawProp(put: Put, c: Creature, pal: Pal, mood: Mood, fr: number, oy: number): void {
  const prop = PROPS[c.prop];
  const [dx, dy] = propOffset(prop, mood, fr);
  const cells = prop.art.flatMap((row, ry) => [...row].map((ch, rx) => ({ ch, rx, ry }))).filter((cell) => cell.ch !== '.');
  for (const { ch, rx, ry } of cells) {
    const col = ch === 'a' ? pal.acc : PROP_LEGEND[ch];
    if (col) put(11 + dx + rx, 6 + dy + ry + oy, grayed(mood === 'failed', col, 0.4));
  }
}

const feetOps = (running: boolean, fr: number): Op[] => (running ? (FEET_RUN[fr % 2] as Op[]) : FEET_STAND);
const torsoOps = (c: Creature): Op[] => (c.shell ? TORSO_SHELL : TORSO_PLAIN);
const headOps = (c: Creature): Op[] => [...HEAD, ...(c.wide ? HEAD_WIDE : []), ...HEAD_LIGHT];
const faceOps = (mood: Mood, fr: number): Op[] => [...eyeOps(mood, fr), ...(MOUTH[mood] ?? [])];
const effectOps = (mood: Mood, fr: number, running: boolean): Op[] => EFFECTS[mood]?.(fr, running) ?? [];

function paint(c: Creature, mood: Mood, fr: number, size: SpriteSize): Cell[][] {
  const { grid, put } = canvas(PX[size]);
  const pal = bodyPalette(c, mood);
  const running = c.prop === 'stopwatch' && mood === 'working';
  const b = at(BOB, mood, fr);
  const oy = at(JUMP, mood, fr);
  const draw = (ops: Op[], dy: number): void => drawOps(put, pal, ops, dy);
  draw(feetOps(running, fr), oy);
  draw(torsoOps(c), oy);
  draw(ARMS[mood], oy);
  draw(headOps(c), oy + b);
  draw(EARS[c.ears] ?? [], oy + b);
  draw(HATS[c.hat] ?? [], oy + b);
  draw(faceOps(mood, fr), oy + b);
  drawProp(put, c, pal, mood, fr, oy);
  draw(effectOps(mood, fr, running), 0);
  return grid;
}

// ---- half-block folding ----
const lowerOnly = (u: Cell): Run => (u ? { text: '▄', fg: u } : { text: ' ' });
const bothHalves = (t: string, u: string): Run => (t === u ? { text: '█', fg: t } : { text: '▀', fg: t, bg: u });

/** One cell from its top and bottom pixel. */
function cellOf(t: Cell, u: Cell): Run {
  if (!t) return lowerOnly(u);
  return u ? bothHalves(t, u) : { text: '▀', fg: t };
}

const canMerge = (last: Run | undefined, cell: Run): boolean => !!last && last.fg === cell.fg && last.bg === cell.bg && last.text[0] === cell.text;

function pushCell(runs: Run[], cell: Run): void {
  const last = runs[runs.length - 1];
  if (last && canMerge(last, cell)) last.text += cell.text;
  else runs.push(cell);
}

function foldRow(top: Cell[], bot: Cell[]): Run[] {
  const runs: Run[] = [];
  for (let x = 0; x < top.length; x++) pushCell(runs, cellOf(top[x], bot[x]));
  return runs;
}

function fold(grid: Cell[][]): Run[][] {
  const rows: Run[][] = [];
  for (let row = 0; row < grid.length; row += 2) rows.push(foldRow(grid[row] as Cell[], (grid[row + 1] ?? []) as Cell[]));
  return rows;
}

// ---- hand-drawn art ----
const MOOD_COLOR: Record<Mood, string> = { idle: '#7d8590', working: '#ffd84a', thinking: '#9be7ff', blocked: '#ff5a52', done: '#52c872', failed: '#a0646a', celebrate: '#f472b6' };

type ArtGeom = { w: number; rows: number; n: number };
type Mark = [number, number, string];
const markCells = (ys: number[], g: ArtGeom, col: string): Mark[] => ys.flatMap((y) => Array.from({ length: g.w }, (_, x): Mark => [x, y, col]));
const mirrorX = (x: number, g: ArtGeom): number => (x < 7 ? x % g.w : g.n - 1 - (x % g.w));
const confetti = (fr: number, g: ArtGeom): Mark[] =>
  (CONF_POS[fr] ?? []).flatMap(([x, y], i): Mark[] => (y < g.rows ? [[mirrorX(x, g), y % g.rows, CONFETTI[(i + fr) % CONFETTI.length] as string]] : []));

// Mood marker painted in the left padding columns of the art.
const MARKS: Partial<Record<Mood, (fr: number, g: ArtGeom) => Mark[]>> = {
  working: (fr, g) => markCells([fr % 2 ? 1 : 2], g, MOOD_COLOR.working),
  thinking: (fr, g) => markCells(Array.from({ length: fr + 1 }, (_, i) => g.rows - 1 - i), g, MOOD_COLOR.thinking),
  blocked: (fr, g) => markCells([0, 1, 2, 4].slice(0, g.rows - 1), g, fr ? GOLD : RED),
  done: (fr, g) => markCells(fr ? [0, 1, 2, 3] : [1, 2, 3], g, MOOD_COLOR.done),
  failed: (fr, g) => markCells([1 + fr, 2 + fr], g, '#9be7ff'),
  celebrate: confetti,
};

const RED_EYE_MOODS: Mood[] = ['failed', 'blocked'];
// Eyes close on these frames.
const SQUINT: Partial<Record<Mood, (fr: number) => boolean>> = { idle: (fr) => fr === 3, working: (fr) => fr % 2 === 1 };

function artEye(mood: Mood, fr: number, base: string): string {
  if (RED_EYE_MOODS.includes(mood)) return RED;
  return SQUINT[mood]?.(fr) ? mix(base, '#000000', 0.62) : EYE;
}

function artPalette(c: Creature, mood: Mood, fr: number): Pal {
  const failed = mood === 'failed';
  const base = grayed(failed, c.color, 0.5);
  const tone = (col: string): string => grayed(failed, col, 0.4);
  return {
    k: mix(base, '#000000', 0.62), f: base, m: mix(base, '#000000', 0.28), h: mix(base, '#ffffff', 0.4), a: grayed(failed, c.accent, 0.5),
    g: tone('#f2b705'), y: tone('#fff3a0'), w: tone('#f2f4f8'), b: tone('#a9743f'), s: tone('#9aa4b2'), d: tone('#4a5060'),
    c: tone('#9be7ff'), t: tone('#4a63b5'), r: tone('#ff5a52'), o: tone('#f2994a'), e: artEye(mood, fr, base), n: EYE,
  };
}

const artGeom = (n: number): ArtGeom => ({ w: n === 16 ? 2 : 1, rows: n === 16 ? 4 : 5, n });
const artMarks = (mood: Mood, fr: number, g: ArtGeom): Mark[] => MARKS[mood]?.(fr, g) ?? [];

/** Paint only onto transparent art cells so the mood marker never covers the sprite. */
function setIfEmpty(grid: Cell[][], [x, y, col]: Mark): void {
  const row = grid[y];
  if (row && row[x] === undefined) row[x] = col;
}

function paintArt(art: string[], c: Creature, mood: Mood, fr: number, n: number): Cell[][] {
  const pal = artPalette(c, mood, fr);
  const grid: Cell[][] = art.map((row) => [...row].map((ch) => (ch === '.' ? undefined : pal[ch])));
  for (const mark of artMarks(mood, fr, artGeom(n))) setIfEmpty(grid, mark);
  return grid;
}

// ---- badge ----
// Mood dot colour on odd frames (a pulse); other moods keep the steady colour.
const DOT_PULSE: Partial<Record<Mood, string>> = { blocked: GOLD, working: mix(MOOD_COLOR.working, '#000000', 0.5) };

const lum = (h: string): number => (parseInt(h.slice(1, 3), 16) * 299 + parseInt(h.slice(3, 5), 16) * 587 + parseInt(h.slice(5, 7), 16) * 114) / 1000;

const DISPLAY_NAMES: Record<string, string> = {
  lead: 'Lead agent', explorer: 'Explorer', implementer: 'Implementer', verifier: 'Verifier', planner: 'Planner',
  runner: 'Runner', 'docs-curator': 'Docs curator', 'docs-auditor': 'Docs auditor', 'completeness-critic': 'Critic',
  'db-prober': 'DB prober', 'ui-runtime-tester': 'UI tester',
};

/** Readable name for a persona; unknown personas fall back to the member name, title-cased. */
export function displayName(persona: string, memberName?: string): string {
  const known = DISPLAY_NAMES[resolveKey(persona)];
  if (known) return known;
  const words = (memberName ?? '').replace(/^atlas:/, '').replace(/[-_]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Agent';
}

/** Display width of a badge chip: label plus one space of padding each side. */
export const badgeWidth = (label: string): number => [...label].length + 2;

/** One chip for nick lists: the readable name on the persona colour + a mood dot. */
export function badge(persona: string, mood: Mood, frame: number, label?: string): Run[] {
  const c = resolve(persona);
  const bg = grayed(mood === 'failed', c.color, 0.5);
  const fg = lum(bg) > 140 ? '#14161c' : '#ffffff';
  return [{ text: ` ${label ?? displayName(persona)} `, fg, bg, bold: true }, { text: '●', fg: moodDot(mood, frame) }];
}

function moodDot(mood: Mood, frame: number): string {
  const odd = Math.abs(Math.trunc(frame)) % 2;
  return (odd ? DOT_PULSE[mood] : undefined) ?? MOOD_COLOR[mood];
}

/** Rows of runs for a persona sprite; every row has display width spriteWidth(size). Size 's' is the 1-row badge. */
export function spriteRows(persona: string, mood: Mood, frame: number, size: 's' | 'm' | 'l'): Run[][] {
  if (size === 's') return [badge(persona, mood, frame)];
  const n = FRAMES[mood] ?? 1;
  const f = ((Math.trunc(frame) % n) + n) % n;
  const art = ART[resolveKey(persona)];
  const c = resolve(persona);
  return fold(art ? paintArt(art[size], c, mood, f, PX[size]) : paint(c, mood, f, size));
}

// ---- speech bubble ----
// Display width tables for bubble text: zero-width cells become spaces, wide cells become '?'.
const BUBBLE_ZERO: readonly Span[] = [[0, 0x1f], [0x7f, 0x9f], [0x300, 0x36f], [0x200d, 0x200d], [0xfe00, 0xfe0f]];
const BUBBLE_WIDE: readonly Span[] = [
  [0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f000, 0x1faff], [0x2600, 0x27bf], [0x20000, 0x3fffd],
];

const BUBBLE_BORDER = '#7d8590';
const BUBBLE_MAX_LINES = 4;

/** Keep single-cell characters; zero-width ones become a space, wide ones '?'. */
const bubbleChar = (ch: string): string => [' ', ch, '?'][rangeWidth(ch.codePointAt(0) ?? 0, BUBBLE_ZERO, BUBBLE_WIDE)] as string;

/** Split a word into inner-wide chunks; the last chunk is the remainder (at most inner wide). */
function chunkWord(word: string, inner: number): string[] {
  const chars = [...word];
  const chunks: string[] = [];
  let at0 = 0;
  for (; chars.length - at0 > inner; at0 += inner) chunks.push(chars.slice(at0, at0 + inner).join(''));
  chunks.push(chars.slice(at0).join(''));
  return chunks;
}

/** Append word to the current line, or start a new one (pushing the finished line). Returns the new current line. */
function place(lines: string[], cur: string, word: string, inner: number): string {
  if (!cur) return word;
  if ([...cur].length + 1 + [...word].length <= inner) return `${cur} ${word}`;
  lines.push(cur);
  return word;
}

function absorbWord(lines: string[], cur: string, word: string, inner: number): string {
  const chunks = chunkWord(word, inner);
  let line = cur;
  if (chunks.length > 1) {
    if (line) lines.push(line);
    lines.push(...chunks.slice(0, -1));
    line = '';
  }
  return place(lines, line, chunks[chunks.length - 1] as string, inner);
}

function wrapWords(words: string[], inner: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of words) cur = absorbWord(lines, cur, word, inner);
  if (cur || lines.length === 0) lines.push(cur);
  return lines;
}

/** At most BUBBLE_MAX_LINES lines; the last kept line ends in an ellipsis when text was dropped. */
function clampLines(lines: string[], inner: number): string[] {
  if (lines.length <= BUBBLE_MAX_LINES) return lines;
  const last = `${[...(lines[BUBBLE_MAX_LINES - 1] as string)].slice(0, inner - 1).join('')}…`;
  return [...lines.slice(0, BUBBLE_MAX_LINES - 1), last];
}

function bubbleRows(lines: string[], tailSide: 'l' | 'r'): Run[][] {
  const textW = Math.max(...lines.map((l) => [...l].length));
  const w = textW + 4;
  const edge = (l: string, rt: string): Run[] => [{ text: `${l}${'─'.repeat(w - 2)}${rt}`, fg: BUBBLE_BORDER }];
  const rows: Run[][] = [edge('╭', '╮')];
  for (const l of lines) {
    rows.push([{ text: '│ ', fg: BUBBLE_BORDER }, { text: l.padEnd(textW) }, { text: ' │', fg: BUBBLE_BORDER }]);
  }
  rows.push(edge('╰', '╯'));
  const tail = tailSide === 'l' ? ` ╱${' '.repeat(w - 2)}` : `${' '.repeat(w - 2)}╲ `;
  rows.push([{ text: tail, fg: BUBBLE_BORDER }]);
  return rows;
}

/** Rounded speech bubble with word wrap (max 4 lines) and a one-row tail. All rows share one width <= maxCols. */
export function speechBubble(text: string, maxCols: number, tailSide: 'l' | 'r'): Run[][] {
  if (maxCols < 6) return [];
  const inner = maxCols - 4;
  const words = [...text].map(bubbleChar).join('').split(/\s+/).filter(Boolean);
  return bubbleRows(clampLines(wrapWords(words, inner), inner), tailSide);
}
