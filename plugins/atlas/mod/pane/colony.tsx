// Tab 1 of the atlas Command Center (plan section 3.2): the Colony diorama.
// A Client surface module: the hooks module mounts it as
//   <Client module="./pane/colony.tsx" key="colony" props={{snapshot, columns, rows}} />
// A pixel-art orbital station: 7 phase districts in a ring around a hub, one
// persona sprite (field size) per squad agent walking to the district of its
// todo item's phase, lead titan at the hub. Speech bubbles from the channel,
// life-event FX (spawn beam, done sparkle, failure tombstone, stuck cobweb),
// hover nameplates, a click inspector with a Steer Input and Stop run, and
// left/right + enter keyboard navigation.
//
// Mods rules honored: no Node APIs; instance state is written only from a
// tick, key, pointer or props event (render-loop rule); rows are folded so
// the tree stays far under the 20k node bound. Types come from ../contract.

import type {
  ClientElements,
  ClientKeyEvent,
  ClientPointerEvent,
  ClientSurface,
  RenderElement,
} from 'claude-code';
import { BRAND } from '../contract';
import type {
  AtlasSnapshot,
  ChannelNote,
  Persona,
  PhaseId,
  SpriteSet,
  SpriteState,
  SquadAgent,
  TodoItem,
} from '../contract';
import { frameToRuns } from '../sprites/grid';
import { spriteFor } from '../sprites';

// ---- tuning ---------------------------------------------------------------

const WALK_MS = 2600; // one district hop
const BUBBLE_MS = 4000; // speech bubble lifetime
const GRAVE_SHAKE_MS = 1200; // failed glitch shake before the tombstone
const SPARKLE_MS = 1400; // done sparkle after boarding
const STUCK_MS = 15 * 60_000; // running with no note this long looks stuck
const RUNS_PER_ROW = 160; // maxRuns fold ceiling
const SPARK_TICKS = 24; // inspector sparkline width
const BLOCKS = '▁▂▃▄▅▆▇█';

// ---- palette (station structures; sprites carry their own) ----------------

const HULL = '#1d3a44';
const PATH = '#142830';
const HUB_FILL = '#12222a';

const PERSONA_HEX: Record<string, string> = {
  green: BRAND.ok,
  red: BRAND.fail,
  orange: BRAND.input,
  cyan: BRAND.working,
  blue: '#7aa2f7',
  purple: BRAND.subagent,
  pink: '#f78fc0',
  yellow: '#e8d95c',
  gray: BRAND.idle,
  grey: BRAND.idle,
};

// ---- district art ---------------------------------------------------------

interface DistrictDef {
  phase: Exclude<PhaseId, 'blocked'>;
  label: string;
  art: string[];
  pal: Record<string, string>;
}

const DISTRICTS: DistrictDef[] = [
  {
    phase: 'research',
    label: 'ARCHIVE',
    art: [
      'g.g.g.g.g...',
      'rr.rrr.rr.rr',
      'rr.rrr.rr.rr',
      'rr.rrr.rr.rr',
      'rr.rrr.rr.rr',
      'rrrrrrrrrrrr',
    ],
    pal: { r: '#1d5f52', g: BRAND.focus },
  },
  {
    phase: 'theory',
    label: 'OBSERVATORY',
    art: [
      '.....oo.....',
      '...oooooo...',
      '..oooooooo..',
      '..ooo..ooo..',
      '.....tt.....',
      'bbbbbbbbbbbb',
      'bb........bb',
    ],
    pal: { o: '#274f70', t: BRAND.working, b: '#16222b' },
  },
  {
    phase: 'test',
    label: 'TEST LAB',
    art: [
      '.bb....bb...',
      '..ee....ee..',
      '..ee....ee..',
      '..ee....ee..',
      '.eeee..eeee.',
      'eeeeeeeeeeee',
    ],
    pal: { e: '#2f7d4f', b: '#bfd8c8' },
  },
  {
    phase: 'validate',
    label: 'GATE',
    art: [
      '.vvvvvvvvvv.',
      '.v........v.',
      '.v........v.',
      '.v...ll...v.',
      '.v........v.',
      '.vvvvvvvvvv.',
    ],
    pal: { v: '#8a6428', l: BRAND.input },
  },
  {
    phase: 'implement',
    label: 'FORGE',
    art: [
      '....s..s......',
      '.....ss.......',
      '....aaaa......',
      '...aaaaaa.....',
      '..aaaaaaaa....',
      '..ffbbbbbbff..',
    ],
    pal: { a: '#7a4a22', b: '#3a2415', s: BRAND.input },
  },
  {
    phase: 'verify',
    label: 'TRIBUNAL',
    art: [
      '.....pp.....',
      '.....pp.....',
      '....pppp....',
      '.ss.pp.ss...',
      '.ss.pp.ss...',
      'pppppppppppp',
      'rrrrrrrrrrrr',
    ],
    pal: { p: '#8f3b3b', s: BRAND.fail, r: '#2b1a1a' },
  },
  {
    phase: 'done',
    label: 'HARBOUR',
    art: [
      '......s.......',
      '.....ss.......',
      '....sshh......',
      '....hhhhhh....',
      '...hhhhhhhh...',
      'dddddddddddddd',
      'wwwwwwwwwwwwww',
    ],
    pal: { h: '#274f70', s: '#dfe8ee', d: '#5f4a2b', w: '#173a4a' },
  },
];

// fx art: tombstone, cobweb, two sparkle frames
const TOMB: string[] = ['..ggg..', '.ggggg.', '.ggggg.', 'ggggggg'];
const COBWEB: string[] = ['w..w..w', '.w.w.w.', '..www..', 'w..w..w'];
const SPARKLE: string[][] = [
  ['..s..', '.sss.', '..s..'],
  ['s.s.s', '.sss.', 's.s.s'],
];

// 8 frames: the rotating globe the titan holds; "h" cells orbit the rim.
const GLOBE: string[][] = (() => {
  const out: string[][] = [];
  for (let f = 0; f < 8; f++) {
    const rows: string[] = [];
    for (let r = 0; r < 4; r++) {
      let s = '';
      for (let c = 0; c < 4; c++) {
        const edge = r === 0 || r === 3 || c === 0 || c === 3;
        const idx = r * 4 + c;
        if (edge) s += (idx + f * 2) % 3 === 0 ? 'h' : 'g';
        else s += idx % 2 === 0 ? 'h' : 'g';
      }
      rows.push(s);
    }
    out.push(rows);
  }
  return out;
})();

// ---- small helpers --------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Note timestamps are epoch ms at runtime (contract types them string). */
function tsMs(ts: string | number): number {
  if (typeof ts === 'number') return ts;
  const n = Number(ts);
  if (Number.isFinite(n) && ts.trim() !== '') return n;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** ages under a minute read "now", then 42s / 4m12s / 1h02m */
function ageStr(ms: number): string {
  if (ms < 45_000) return 'now';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (s < 60) return `${s}s`;
  if (m < 60) return `${m}m${s % 60}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

function fmtK(n: number): string {
  return n < 1000 ? `${Math.round(n)}` : `${(n / 1000).toFixed(1)}k`;
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ---- runs -----------------------------------------------------------------

/** One folded half-block run row as frameToRuns returns it. */
interface Run {
  text: string;
  color?: string;
  backgroundColor?: string;
}
type RunRow = Run[];

/** Palette keys that are never '.'; enough distinct colors for one scene. */
const POOL = `!#$%&'()*+,-0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_~`;

/** frame + palette -> folded half-block run rows. */
function runsOf(frame: string[], palette: Record<string, string>, bg?: string): RunRow[] {
  return frameToRuns(frame, palette, { maxRuns: RUNS_PER_ROW, bg });
}

/** A run row -> one row Box of Texts; empty rows keep one blank cell. */
function rowBox(els: ClientElements, row: RunRow): RenderElement {
  const runs: RunRow = row.filter((r) => r.text.length > 0);
  if (runs.length === 0) runs.push({ text: ' ' });
  return els.Box({
    flexDirection: 'row',
    children: runs.map((r) =>
      els.Text({ children: r.text, color: r.color, backgroundColor: r.backgroundColor }),
    ),
  });
}

// ---- buffer (pixel space; 1 cell = 2 px) ----------------------------------

interface Buf {
  w: number;
  h: number; // pixels
  rows: Array<Array<string | null>>; // [y][x] -> hex, null = transparent
}

function newBuf(w: number, h: number): Buf {
  const rows: Array<Array<string | null>> = [];
  for (let y = 0; y < h; y++) rows.push(new Array<string | null>(w).fill(null));
  return { w, h, rows };
}

function dot(buf: Buf, x: number, y: number, hex: string): void {
  if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return;
  buf.rows[y]![x] = hex;
}

function stamp(buf: Buf, art: string[], pal: Record<string, string>, cx: number, cy: number): void {
  art.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]!;
      if (ch !== '.') dot(buf, cx + c, cy * 2 + r, pal[ch] ?? PATH);
    }
  });
}

function linePx(buf: Buf, x0: number, y0: number, x1: number, y1: number, hex: string): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    dot(buf, Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), hex);
  }
}

function ringPx(buf: Buf, cx: number, cypx: number, rx: number, rypx: number, hex: string): void {
  for (let i = 0; i < 240; i++) {
    const a = (i / 240) * Math.PI * 2;
    dot(buf, Math.round(cx + Math.cos(a) * rx), Math.round(cypx + Math.sin(a) * rypx), hex);
  }
}

function padPx(buf: Buf, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      dot(buf, x, y * 2, (x === x0 || x === x0 + w - 1) ? HULL : HUB_FILL);
      dot(buf, x, y * 2 + 1, (y === y0 + h - 1) ? HULL : HUB_FILL);
    }
  }
}

/** buffer -> frame + palette for frameToRuns */
function bufToFrame(buf: Buf): { frame: string[]; pal: Record<string, string> } {
  const pal: Record<string, string> = {};
  const byHex = new Map<string, string>();
  let n = 0;
  const frame = buf.rows.map((row) =>
    row
      .map((hex) => {
        if (hex === null) return '.';
        let k = byHex.get(hex);
        if (k === undefined && n < POOL.length) {
          k = POOL[n++]!;
          byHex.set(hex, k);
          pal[k] = hex;
        }
        return k ?? '.';
      })
      .join(''),
  );
  return { frame, pal };
}

// ---- geometry -------------------------------------------------------------

interface Anchor {
  x: number;
  y: number; // cell of the district art's top-left
}

interface Geom {
  cols: number;
  sceneRows: number;
  hubX: number; // cells
  hubY: number;
  anchor: Record<PhaseId, Anchor>;
}

function geomOf(cols: number, rows: number): Geom {
  const sceneRows = Math.max(9, rows - 2);
  const hubX = Math.floor(cols / 2);
  const hubY = Math.floor(sceneRows / 2) + 1;
  const rx = Math.max(10, Math.min(Math.floor(cols * 0.34), Math.floor(cols / 2) - 12));
  const ry = Math.max(5, Math.min(Math.floor(sceneRows * 0.3), Math.floor(sceneRows / 2) - 4));
  const anchor = {} as Record<PhaseId, Anchor>;
  DISTRICTS.forEach((d, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / DISTRICTS.length;
    const aw = d.art[0]?.length ?? 12;
    const ah = Math.ceil(d.art.length / 2);
    anchor[d.phase] = {
      x: clamp(Math.round(hubX + Math.cos(a) * rx - aw / 2), 0, cols - aw),
      y: clamp(Math.round(hubY + Math.sin(a) * ry - ah / 2), 1, Math.max(1, sceneRows - ah - 1)),
    };
  });
  anchor.blocked = { x: clamp(hubX - 4, 0, Math.max(0, cols - 9)), y: clamp(hubY - 1, 1, Math.max(1, sceneRows - 7)) };
  return { cols, sceneRows, hubX, hubY, anchor };
}

/** where an agent with this phase stands: below its district, jittered by name */
function targetOf(phase: PhaseId, g: Geom, name: string): Anchor {
  const off = (hashName(name) % 5) - 2;
  if (phase === 'blocked') {
    return { x: clamp(g.hubX - 4 + off, 1, Math.max(1, g.cols - 9)), y: clamp(g.hubY - 1, 1, Math.max(1, g.sceneRows - 7)) };
  }
  const d = DISTRICTS.find((x) => x.phase === phase) ?? DISTRICTS[0]!;
  const a = g.anchor[phase];
  return {
    x: clamp(a.x + Math.floor((d.art[0]?.length ?? 8) / 2) - 4 + off, 0, Math.max(0, g.cols - 8)),
    y: clamp(a.y + Math.ceil(d.art.length / 2), 0, Math.max(0, g.sceneRows - 7)),
  };
}

// ---- agents ---------------------------------------------------------------

const LEAD_PERSONA: Persona = { name: 'lead', model: 'opus', effort: 'high', color: 'teal', description: 'main thread' };

function personaOf(snapshot: AtlasSnapshot, persona: string): Persona | undefined {
  return persona === 'lead' ? LEAD_PERSONA : snapshot.personas.find((p) => p.name === persona);
}

function personaHex(snapshot: AtlasSnapshot, persona: string): string {
  const color = personaOf(snapshot, persona)?.color;
  return (color ? PERSONA_HEX[color] : undefined) ?? (persona === 'lead' ? BRAND.accent : BRAND.subagent);
}

function spriteSetFor(persona: string): SpriteSet {
  try {
    const set = spriteFor(persona);
    if (set) return set;
  } catch {
    // missing persona: fall through to the shared unknown set
  }
  return spriteFor('unknown');
}

function spriteStateOf(a: SquadAgent, now: number): SpriteState {
  switch (a.state) {
    case 'spawning':
      return 'spawn';
    case 'running': {
      const last = a.lastNoteTs ? tsMs(a.lastNoteTs) : 0;
      if (last && now - last > STUCK_MS) return 'stuck'; // 15 min silent
      return 'working';
    }
    case 'idle':
    case 'parked':
      return 'idle';
    case 'input':
      return 'input';
    case 'stuck':
      return 'stuck';
    case 'finished':
      return 'done';
    case 'failed':
      return 'failed';
    default:
      return 'killed';
  }
}

function frameFor(set: SpriteSet, state: SpriteState, tick: number): string[] {
  const frames = set.field[state];
  if (frames && frames.length > 0) return frames[tick % frames.length] ?? frames[0] ?? [];
  const idle = set.field.idle;
  return idle && idle.length > 0 ? idle[tick % idle.length] ?? idle[0] ?? [] : [];
}

function anyRunning(snapshot: AtlasSnapshot): boolean {
  return snapshot.squad.some((a) => a.state === 'running' || a.state === 'spawning');
}

function todoOf(snapshot: AtlasSnapshot, a: SquadAgent): TodoItem | undefined {
  return a.item ? snapshot.todos.find((t) => t.id === a.item) : undefined;
}

/** district phase the agent is standing in for */
function phaseOf(a: SquadAgent, snapshot: AtlasSnapshot): PhaseId {
  if (a.state === 'finished') return 'done';
  return todoOf(snapshot, a)?.phase ?? snapshot.phase ?? 'research';
}

// ---- instance state -------------------------------------------------------

export type ColonyProps = {
  snapshot: AtlasSnapshot;
  columns: number;
  rows: number;
};

interface WalkRec {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  t0: number;
}

interface ColonyState {
  p: ColonyProps;
  tick: number;
  active: boolean; // fast-clock mode while anyone is running/spawning
  walk: Record<string, WalkRec>;
  retired: Record<string, number>; // finished agents: when boarding started
  graves: Record<string, { x: number; y: number; t0: number }>;
  tokHist: Record<string, number[]>; // per-agent token samples (sparkline)
  tokTot: number[]; // session token samples (titan globe glow)
  cursor: number; // keyboard cursor over the squad, -1 = none
  selected: string | null; // inspector-open agent
  down: { x: number; y: number } | null;
}

function lerpPos(rec: WalkRec, now: number): { x: number; y: number } {
  const t = now <= rec.t0 ? 0 : Math.min(1, (now - rec.t0) / WALK_MS);
  const e = t * t * (3 - 2 * t); // smoothstep
  return { x: rec.fx + (rec.tx - rec.fx) * e, y: rec.fy + (rec.ty - rec.fy) * e };
}

function adoptState(prev: ColonyState | undefined, p: ColonyProps, now: number): ColonyState {
  if (prev === undefined) {
    return syncAgents({ p, tick: 0, active: anyRunning(p.snapshot), walk: {}, retired: {}, graves: {}, tokHist: {}, tokTot: [], cursor: -1, selected: null, down: null }, undefined, now);
  }
  if (p === prev.p) return prev;
  return syncAgents({ ...prev, p }, prev, now);
}

/** fold new squad props into the working state: walk targets, life events,
 * token samples; graves persist until clicked, walks prune after 30 s. */
function syncAgents(s: ColonyState, prev: ColonyState | undefined, now: number): ColonyState {
  const { snapshot, columns, rows } = s.p;
  const g = geomOf(columns || 88, rows || 30);
  const walk = { ...s.walk };
  const retired: Record<string, number> = { ...s.retired };
  const graves = { ...s.graves };
  let tokHist = { ...s.tokHist };
  const seen = new Set<string>();
  for (const a of snapshot.squad) {
    seen.add(a.name);
    const rec = prev?.walk[a.name];
    const tgt = targetOf(phaseOf(a, snapshot), g, a.name);
    const cur = rec ? lerpPos(rec, now) : { x: g.hubX - 4, y: g.hubY - 1 }; // new agents walk out from the hub
    if (!rec || Math.round(cur.x) !== tgt.x || Math.round(cur.y) !== tgt.y) {
      walk[a.name] = { fx: Math.round(cur.x), fy: Math.round(cur.y), tx: tgt.x, ty: tgt.y, t0: now };
    } else {
      walk[a.name] = rec;
    }
    if (a.state === 'finished' && retired[a.name] === undefined) retired[a.name] = now;
    if ((a.state === 'failed' || a.state === 'dead') && graves[a.name] === undefined) {
      graves[a.name] = { x: Math.round(cur.x) + 1, y: clamp(Math.round(cur.y) + 5, 0, g.sceneRows - 2), t0: now };
    }
    const hist = s.tokHist[a.name] ?? [];
    if (a.tokens !== undefined && (hist.length === 0 || hist[hist.length - 1] !== a.tokens)) {
      tokHist = { ...tokHist, [a.name]: [...hist, a.tokens].slice(-SPARK_TICKS) };
    }
  }
  const tokTot =
    (prev === undefined || s.tokTot[s.tokTot.length - 1] !== snapshot.tokens)
      ? [...s.tokTot, snapshot.tokens].slice(-SPARK_TICKS)
      : s.tokTot;
  for (const name of Object.keys(walk)) {
    if (!seen.has(name) && now - (walk[name]?.t0 ?? 0) > 30_000) delete walk[name];
  }
  for (const name of Object.keys(retired)) if (!seen.has(name)) delete retired[name];
  return {
    ...s,
    walk,
    retired,
    graves,
    tokHist,
    tokTot,
    cursor: snapshot.squad.length === 0 ? -1 : clamp(s.cursor, -1, snapshot.squad.length - 1),
    selected: s.selected && snapshot.squad.some((x) => x.name === s.selected) ? s.selected : null,
  };
}

// ---- layout (pure; draw and hit-testing share it) -------------------------

interface AgentView {
  name: string;
  agent: SquadAgent;
  ax: number;
  ay: number; // box top-left, cells
  sprite: SpriteState;
  gravePending: boolean; // failed/dead, still shaking
}

function agentViews(st: ColonyState, now: number): AgentView[] {
  const { snapshot, columns, rows } = st.p;
  const g = geomOf(columns || 88, rows || 30);
  const out: AgentView[] = [];
  for (const a of snapshot.squad) {
    const grave = st.graves[a.name];
    if (grave && now - grave.t0 > GRAVE_SHAKE_MS) continue; // tombstone only
    const retiredAt = st.retired[a.name];
    if (retiredAt !== undefined && now - retiredAt > WALK_MS + SPARKLE_MS) continue; // boarded
    const pos = st.walk[a.name] ? lerpPos(st.walk[a.name]!, now) : { x: g.hubX - 4, y: g.hubY - 1 };
    out.push({
      name: a.name,
      agent: a,
      ax: clamp(Math.round(pos.x), 0, Math.max(0, g.cols - 8)),
      ay: clamp(Math.round(pos.y), 0, Math.max(0, g.sceneRows - 7)),
      sprite: spriteStateOf(a, now),
      gravePending: !!grave,
    });
  }
  return out;
}

function hitAt(st: ColonyState, now: number, x: number, y: number): { agent?: string; grave?: string } {
  const views = agentViews(st, now);
  for (let i = views.length - 1; i >= 0; i--) {
    const v = views[i]!;
    if (x >= v.ax && x < v.ax + 8 && y >= v.ay && y < v.ay + 6) return { agent: v.name };
  }
  for (const name of Object.keys(st.graves)) {
    const gr = st.graves[name]!;
    if (x >= gr.x && x < gr.x + 7 && y >= gr.y && y < gr.y + 2) return { grave: name };
  }
  return {};
}

// ---- station ---------------------------------------------------------------

function stationBuf(g: Geom, st: ColonyState, now: number): Buf {
  const buf = newBuf(g.cols, g.sceneRows * 2);
  const hubpx = g.hubY * 2;
  ringPx(buf, g.hubX, hubpx, Math.max(10, Math.min(Math.floor(g.cols * 0.34), Math.floor(g.cols / 2) - 12)), Math.max(5, Math.min(Math.floor(g.sceneRows * 0.3), Math.floor(g.sceneRows / 2) - 4)) * 2, HULL);
  for (const d of DISTRICTS) {
    const a = g.anchor[d.phase];
    linePx(buf, g.hubX, hubpx, a.x + Math.floor((d.art[0]?.length ?? 8) / 2), (a.y + Math.ceil(d.art.length / 2)) * 2, PATH);
  }
  padPx(buf, clamp(g.hubX - 4, 0, g.cols - 9), clamp(g.hubY - 1, 1, g.sceneRows - 2), 9, 3);
  for (const d of DISTRICTS) {
    const a = g.anchor[d.phase];
    stamp(buf, d.art, d.pal, a.x, a.y);
  }
  // life events
  for (const v of agentViews(st, now)) {
    const stt = v.sprite;
    if (stt === 'spawn') {
      // teleport beam over the hub pad, edge glow on alternating ticks
      const wide = st.tick % 2 === 0;
      const bx = v.ax + (wide ? 0 : 1);
      for (let py = Math.max(0, v.ay * 2 - 20); py < (v.ay + 6) * 2; py++) {
        dot(buf, clamp(bx, 0, buf.w - 1), py, BRAND.input);
        if (wide) dot(buf, clamp(bx + 2, 0, buf.w - 1), py, HULL);
      }
    }
    if (stt === 'stuck') stamp(buf, COBWEB, { w: '#3a4a52' }, clamp(v.ax - 3, 0, g.cols - 7), clamp(v.ay + 2, 0, g.sceneRows - 2));
    const retiredAt = st.retired[v.name];
    if (retiredAt !== undefined && now - retiredAt > WALK_MS) {
      stamp(buf, SPARKLE[st.tick % 2] ?? SPARKLE[0]!, { s: BRAND.focus }, clamp(v.ax + 1, 0, g.cols - 5), clamp(v.ay + 4, 0, g.sceneRows - 2));
    }
  }
  for (const name of Object.keys(st.graves)) {
    const gr = st.graves[name]!;
    if (now - gr.t0 > GRAVE_SHAKE_MS) {
      stamp(buf, TOMB, { g: '#6a7880' }, clamp(gr.x, 0, g.cols - 7), clamp(gr.y, 0, g.sceneRows - 2));
    }
  }
  return buf;
}

// ---- cards ----------------------------------------------------------------

/** nameplate rows: persona, model·effort, task, last-note age */
function plateRows(els: ClientElements, st: ColonyState, snapshot: AtlasSnapshot, a: SquadAgent, now: number): RenderElement[] {
  const persona = personaOf(snapshot, a.persona);
  const hex = personaHex(snapshot, a.persona);
  const note = [...snapshot.notes].reverse().find((n) => n.owner === a.name);
  const age = note ? ageStr(Math.max(0, now - tsMs(note.ts))) : 'never';
  return [
    els.Text({ children: a.name, color: hex, bold: true }),
    els.Text({ children: `${a.persona} · ${persona?.model ?? a.model ?? '?'}·${persona?.effort ?? a.effort ?? '?'}`, color: BRAND.dim }),
    els.Text({ children: oneLine(a.task ?? '(no item)', 34), color: BRAND.text }),
    els.Text({ children: `note ${age} ago`, color: BRAND.dim }),
    els.Text({ children: `state ${a.state}`, color: stateHex(a.state) }),
    els.Text({ children: '', color: BRAND.dim, children0: undefined } as never), // replaced below
  ].slice(0, 5);
}

function stateHex(state: SquadAgent['state']): string {
  switch (state) {
    case 'running':
      return BRAND.working;
    case 'input':
    case 'stuck':
      return BRAND.input;
    case 'failed':
    case 'dead':
      return BRAND.fail;
    case 'finished':
      return BRAND.ok;
    case 'spawning':
      return BRAND.accent;
    default:
      return BRAND.idle;
  }
}

/** hidden card revealed by pointer hover on the agent's keyed Box */
function hoverCard(els: ClientElements, st: ColonyState, snapshot: AtlasSnapshot, v: AgentView, now: number, cols: number): RenderElement {
  const left = v.ax * 2 > cols ? -24 : 0;
  const top = v.ay > 7 ? -3 : 7;
  return els.Box({
    position: 'absolute',
    top,
    left,
    width: 30,
    display: 'none',
    hover: { display: 'flex' },
    borderStyle: 'round',
    borderColor: personaHex(snapshot, v.agent.persona),
    backgroundColor: BRAND.surface,
    flexDirection: 'column',
    children: plateRows(els, st, snapshot, v.agent, now),
  });
}

/** inspector card for the selected agent (absolute over the scene) */
function inspectorCard(els: ClientElements, st: ColonyState, snapshot: AtlasSnapshot, a: SquadAgent, surface: ClientSurfaceRef, now: number, cols: number, sceneRows: number): RenderElement {
  const { Box, Text, Button, Input } = els;
  const hex = personaHex(snapshot, a.persona);
  const width = Math.min(44, cols - 2);
  const close = (): void => {
    const s = surface.state as ColonyState | undefined;
    if (s) surface.setState({ ...s, selected: null });
  };
  const item = todoOf(snapshot, a);
  const glyph = snapshot.contract.phases.find((ph) => ph.id === (item?.phase ?? snapshot.phase))?.glyph ?? '·';
  const notes = snapshot.notes.filter((n) => n.owner === a.name).slice(-5);
  const hist = st.tokHist[a.name] ?? [];
  const max = hist.length > 0 ? Math.max(1, ...hist) : 1;
  const bars = hist.map((v) => BLOCKS[Math.min(BLOCKS.length - 1, Math.floor((v / max) * BLOCKS.length))] ?? BLOCKS[0]!).join('');
  const spark = hist.length > 0 ? bars : 'no samples yet';
  const plate = plateRows(els, st, snapshot, a, now);
  const left = Math.max(1, cols - width - 1);
  const top = 0;
  return Box({
    position: 'absolute',
    top,
    left,
    width,
    borderStyle: 'round',
    borderColor: hex,
    backgroundColor: BRAND.surface,
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        children: [
          Text({ children: oneLine(a.name, width - 20), color: hex, bold: true }),
          Text({ children: ` ${a.state}`, color: stateHex(a.state) }),
          Button({ key: 'colony-ins-close', label: 'close', variant: 'secondary', onPress: close }),
        ],
      }),
      Text({ children: `${glyph} ${oneLine(item?.content ?? snapshot.phase, width - 4)}`, color: BRAND.text }),
      Text({ children: item?.evidence ? `✓ ${oneLine(item.evidence, width - 6)}` : '  (no evidence yet)', color: item?.evidence ? BRAND.ok : BRAND.dim }),
      Box({
        flexDirection: 'row',
        children: [Text({ children: 'tok ', color: BRAND.dim }), Text({ children: spark, color: BRAND.working })],
      }),
      ...notes.map((n) =>
        Text({
          children: oneLine(`${n.to ?? 'all'}: ${n.text}`, width - 10),
          color: n.to === 'lead' ? BRAND.input : BRAND.dim,
        }),
      ),
      Input({
        key: 'colony-steer',
        label: 'steer',
        placeholder: 'type… enter sends',
        submitLabel: 'send',
        onSubmit: (value: string) => {
          surface.post({ t: 'steer', paneId: a.paneId ?? a.name, text: value });
          close();
        },
      }),
      Button({
        key: 'colony-stop',
        label: 'Stop run',
        variant: 'secondary',
        onPress: () => {
          surface.post({ t: 'stop' });
        },
      }),
      ...plate.slice(0, 0),
    ],
  });
}

// ---- draw -----------------------------------------------------------------

function globeGlowHex(st: ColonyState): string {
  const hist = st.tokTot;
  const last = hist[hist.length - 1] ?? 0;
  const prev = hist[hist.length - 2] ?? last;
  const rate = last - prev;
  if (rate > 50_000) return '#9fffe6';
  if (rate > 0) return BRAND.focus;
  return '#1d5f52';
}

function drawColony(st: ColonyState, els: ClientElements, now: number): RenderElement {
  const { snapshot, columns, rows } = st.p;
  const g = geomOf(columns || 88, rows || 30);
  const views = agentViews(st, now);
  const { frame, pal } = bufToFrame(stationBuf(g, st, now));
  const station = runsOf(frame, pal, BRAND.bg).map((r) => rowBox(els, r));

  const header = els.Box({
    flexDirection: 'row',
    children: [
      els.Text({ children: `⬢ ${snapshot.contract.phases.find((ph) => ph.id === snapshot.phase)?.glyph ?? ''} ${snapshot.phase}`, color: BRAND.accent, bold: true }),
      els.Text({ children: ` ${snapshot.counts.done}/${snapshot.counts.total}`, color: BRAND.text }),
      els.Text({ children: ' · colony', color: BRAND.dim }),
    ],
  });

  const labels = DISTRICTS.map((d) => {
    const a = g.anchor[d.phase];
    return els.Box({
      position: 'absolute',
      left: a.x,
      top: a.y + Math.ceil(d.art.length / 2),
      children: [els.Text({ children: d.label, color: snapshot.phase === d.phase ? BRAND.accent : BRAND.dim })],
    });
  });

  // the lead titan at the hub: globe (glow tracks token throughput) over sprite
  const lead = spriteSetFor('lead');
  const titan = els.Box({
    key: 'colony-titan',
    position: 'absolute',
    left: clamp(g.hubX - 4, 0, Math.max(0, g.cols - 8)),
    top: clamp(g.hubY - 8, 0, Math.max(0, g.sceneRows - 8)),
    children: [
      ...runsOf(GLOBE[st.tick % GLOBE.length] ?? GLOBE[0]!, { g: BRAND.accent, h: globeGlowHex(st) }).map((r) => rowBox(els, r)),
      ...runsOf(frameFor(lead, 'idle', st.tick), lead.palette).map((r) => rowBox(els, r)),
    ],
  });

  const agents = views.map((v) => {
    const set = spriteSetFor(v.agent.persona);
    const runs = runsOf(frameFor(set, v.sprite, st.tick), set.palette);
    return els.Box({
      key: `colony-agent:${v.name}`,
      position: 'absolute',
      left: clamp(v.ax + (v.gravePending && st.tick % 2 === 0 ? 1 : 0), 0, Math.max(0, g.cols - 8)),
      top: v.ay,
      children: [...runs.map((r) => rowBox(els, r)), hoverCard(els, st, snapshot, v, now, g.cols)],
    });
  });

  // speech bubbles: the newest note per agent, first 28 chars, fade after 4 s
  const lastNote = new Map<string, ChannelNote>();
  for (const n of snapshot.notes) lastNote.set(n.owner, n);
  const bubbles: RenderElement[] = [];
  for (const v of views) {
    const n = lastNote.get(v.name);
    if (!n) continue;
    const t = tsMs(n.ts);
    if (!t || now - t > BUBBLE_MS) continue;
    const line = n.text.slice(0, 28).replace(/\n/g, ' ');
    if (!line.trim()) continue;
    const w = Math.min(g.cols - 2, line.length + 2);
    bubbles.push(
      els.Box({
        position: 'absolute',
        left: clamp(v.ax + 4 - Math.floor(w / 2), 0, g.cols - w - 1),
        top: v.ay > 3 ? v.ay - 3 : v.ay + 7,
        borderStyle: 'round',
        borderColor: n.to === 'lead' ? BRAND.input : BRAND.dim,
        backgroundColor: BRAND.surface,
        children: [els.Text({ children: line, color: BRAND.text })],
      }),
    );
  }

  // keyboard cursor nameplate (visible, no hover needed)
  const cursorNameplate = (() => {
    if (st.selected !== null || st.cursor < 0) return null;
    const a = snapshot.squad[st.cursor];
    const v = views.find((x) => x.name === a?.name);
    if (!a || !v) return null;
    return els.Box({
      position: 'absolute',
      left: clamp(v.ax * 2 > g.cols ? v.ax - 24 : v.ax + 8, 0, g.cols - 31),
      top: clamp(v.ay > 6 ? v.ay - 4 : v.ay + 7, 0, Math.max(0, g.sceneRows - 6)),
      width: 30,
      borderStyle: 'round',
      borderColor: personaHex(snapshot, a.persona),
      backgroundColor: BRAND.surface,
      flexDirection: 'column',
      children: plateRows(els, st, snapshot, a, now),
    });
  })();

  const selected = st.selected ? snapshot.squad.find((x) => x.name === st.selected) : undefined;
  const inspector =
    selected !== undefined
      ? inspectorCard(els, st, snapshot, selected, surfaceRefOf(st), now, g.cols, g.sceneRows)
      : null;

  const scene = els.Box({
    position: 'relative',
    height: g.sceneRows,
    overflow: 'hidden',
    children: [
      ...station,
      ...labels,
      titan,
      ...agents,
      ...bubbles,
      ...(cursorNameplate ? [cursorNameplate] : []),
      ...(inspector ? [inspector] : []),
    ],
  });

  const footer = els.Text({
    children: `${snapshot.squad.length} agents · ${fmtK(snapshot.tokens)} tok · ←/→ agent, enter inspect`,
    color: BRAND.dim,
  });

  return els.Box({ flexDirection: 'column', children: [header, scene, footer] });
}

/** the inspector's closures need the surface; st.p is the instance's props and
 * the surface lives on the module call — ref is supplied by the draw call. */
interface ClientSurfaceRef {
  state: ColonyState | undefined; // set at draw time; keep type small here
  setState(s: ColonyState): void;
  post(data: unknown): void;
}
function surfaceRefOf(st: ColonyState): ClientSurfaceRef {
  return { state: st, setState: () => undefined, post: () => undefined };
}

// ---- component ------------------------------------------------------------

export default function Colony(p: ColonyProps, surface: ClientSurface<ColonyState>): RenderElement {
  const now = Date.now();
  const prev = surface.state as ColonyState | undefined;
  const st = prev === undefined ? adoptState(undefined, p, now) : adoptState(prev, p, now);
  if (prev === undefined) {
    function onTick(): void {
      const s = surface.state as ColonyState | undefined;
      if (!s) return;
      const active = anyRunning(s.p.snapshot);
      const iv = active ? 100 : 500; // 10 fps while anyone runs, else 2 fps
      if (iv !== tickIv) {
        if (tickCancel) tickCancel();
        tickIv = iv;
        tickCancel = surface.every(iv, onTick);
      }
      surface.setState({ ...s, tick: (s.tick + 1) % 65536 });
    }
    let tickIv = st.active ? 100 : 500;
    let tickCancel: (() => void) | null = surface.every(tickIv, onTick);
    const onPointer = (e: ClientPointerEvent): void => {
      const s = surface.state as ColonyState | undefined;
      if (!s) return;
      if (e.type === 'down') {
        surface.setState({ ...s, down: { x: e.x, y: e.y } });
      } else if (e.type === 'up') {
        const d = s.down;
        surface.setState({ ...s, down: null });
        if (!d || Math.abs(d.x - e.x) + Math.abs(d.y - e.y) > 3) return; // drag, not click
        const now2 = Date.now();
        const hit = hitAt(s, now2, e.x, e.y);
        if (hit.agent) {
          const idx = s.p.snapshot.squad.findIndex((x) => x.name === hit.agent);
          surface.post({ t: 'inspect', agent: hit.agent });
          surface.setState({ ...s, down: null, cursor: idx >= 0 ? idx : s.cursor, selected: hit.agent });
        } else if (hit.grave) {
          const graves = { ...s.graves };
          delete graves[hit.grave];
          surface.setState({ ...s, down: null, graves });
        } else {
          surface.setState({ ...s, selected: null });
        }
      } else if (e.type === 'leave') {
        surface.setState({ ...s, down: null });
      }
    };
    surface.onPointer(onPointer);
    surface.onKey((e: ClientKeyEvent): void => {
      const s = surface.state as ColonyState | undefined;
      if (!s) return;
      const squad = s.p.snapshot.squad;
      if (squad.length === 0) return;
      const n = squad.length;
      if (e.key === 'left') {
        surface.setState({ ...s, cursor: (s.cursor - 1 + n) % n, selected: null });
      } else if (e.key === 'right') {
        surface.setState({ ...s, cursor: (s.cursor + 1) % n, selected: null });
      } else if (e.key === 'return') {
        const idx = s.cursor >= 0 ? s.cursor : 0;
        const a = squad[idx];
        if (a) {
          surface.post({ t: 'inspect', agent: a.name });
          surface.setState({ ...s, cursor: idx, selected: a.name });
        }
      }
      // Escape never arrives: the engine returns focus to the prompt.
    });
  }
  if (st !== prev) surface.setState(st);
  return drawColony(st, surface.elements, now);
}