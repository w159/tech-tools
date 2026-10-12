// Tab 1 of the atlas Command Center: the Command Center text view.
// A Client surface module: the hooks module mounts it as
//   <Client module="./pane/colony.tsx" key="colony" props={{snapshot, columns, rows}} />
// Plain-text rows only (user verdict: no pixel/half-block art here): one row
// per building (district label + open/done counts) and one row per squad
// member (name + state + tokens + task), an inspector card with a Steer Input
// and Stop run, and left/right + enter keyboard navigation.
//
// Mods rules honored: no Node APIs; instance state is written only from a
// key or props event (render-loop rule). Types come from ../contract.

import type {
  ClientElements,
  ClientKeyEvent,
  ClientSurface,
  RenderElement,
} from 'claude-code';
import { BRAND } from '../contract';
import type {
  AtlasSnapshot,
  Persona,
  PhaseId,
  SquadAgent,
  TodoItem,
} from '../contract';
import { phaseColor } from '../theme';

// ---- district table (one text row per building) ---------------------------

const DISTRICTS: Array<{ phase: Exclude<PhaseId, 'blocked'>; label: string }> = [
  { phase: 'research', label: 'ARCHIVE' },
  { phase: 'theory', label: 'OBSERVATORY' },
  { phase: 'test', label: 'TEST LAB' },
  { phase: 'validate', label: 'GATE' },
  { phase: 'implement', label: 'FORGE' },
  { phase: 'verify', label: 'TRIBUNAL' },
  { phase: 'done', label: 'HARBOUR' },
];

const DISTRICT_W = 12; // label column width

// ---- small helpers --------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
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
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

function fmtK(n: number): string {
  return n < 1000 ? `${Math.round(n)}` : `${(n / 1000).toFixed(1)}k`;
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ---- people ----------------------------------------------------------------

const LEAD_PERSONA: Persona = { name: 'lead', model: 'opus', effort: 'high', color: 'teal', description: 'main thread' };

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

function personaOf(snapshot: AtlasSnapshot, persona: string): Persona | undefined {
  return persona === 'lead' ? LEAD_PERSONA : snapshot.personas.find((p) => p.name === persona);
}

function personaHex(snapshot: AtlasSnapshot, persona: string): string {
  const color = personaOf(snapshot, persona)?.color;
  return (color ? PERSONA_HEX[color] : undefined) ?? (persona === 'lead' ? BRAND.accent : BRAND.subagent);
}

function todoOf(snapshot: AtlasSnapshot, a: SquadAgent): TodoItem | undefined {
  return a.item ? snapshot.todos.find((t) => t.id === a.item) : undefined;
}

/** district phase the agent is standing in for */
function phaseOf(a: SquadAgent, snapshot: AtlasSnapshot): PhaseId {
  if (a.state === 'finished') return 'done';
  return todoOf(snapshot, a)?.phase ?? snapshot.phase ?? 'research';
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

// ---- instance state -------------------------------------------------------

export type ColonyProps = {
  snapshot: AtlasSnapshot;
  columns: number;
  rows: number;
};

interface ColonyState {
  p: ColonyProps;
  cursor: number; // keyboard cursor over the squad, -1 = none
  selected: string | null; // inspector-open agent
}

function adoptState(prev: ColonyState | undefined, p: ColonyProps): ColonyState {
  if (prev === undefined) return { p, cursor: -1, selected: null };
  if (p === prev.p) return prev;
  const squad = p.snapshot.squad;
  return {
    p,
    cursor: squad.length === 0 ? -1 : clamp(prev.cursor, -1, squad.length - 1),
    selected: prev.selected && squad.some((x) => x.name === prev.selected) ? prev.selected : null,
  };
}

// ---- cards ----------------------------------------------------------------

/** nameplate rows: persona, model·effort, task, last-note age */
function plateRows(els: ClientElements, snapshot: AtlasSnapshot, a: SquadAgent, now: number): RenderElement[] {
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
  ];
}

/** inspector card for the selected agent (absolute over the rows) */
function inspectorCard(els: ClientElements, st: ColonyState, snapshot: AtlasSnapshot, a: SquadAgent, surface: ClientSurfaceRef, now: number, cols: number): RenderElement {
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
  const plate = plateRows(els, snapshot, a, now);
  return Box({
    position: 'absolute',
    top: 1,
    left: Math.max(1, cols - width - 1),
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
      Text({
        children: `tok ${a.tokens === undefined ? '--' : fmtK(a.tokens)}`,
        color: BRAND.dim,
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

function drawColony(st: ColonyState, els: ClientElements, now: number): RenderElement {
  const { snapshot, columns } = st.p;
  const cols = Math.max(20, columns || 88);

  const header = els.Box({
    flexDirection: 'row',
    children: [
      els.Text({ children: `⬢ ${snapshot.contract.phases.find((ph) => ph.id === snapshot.phase)?.glyph ?? ''} ${snapshot.phase}`, color: BRAND.accent, bold: true }),
      els.Text({ children: ` ${snapshot.counts.done}/${snapshot.counts.total}`, color: BRAND.text }),
      els.Text({ children: ' · colony', color: BRAND.dim }),
    ],
  });

  // one text row per building: label + open/done counts
  const districtRows = DISTRICTS.map((d) => {
    const inPhase = snapshot.todos.filter((t) => t.phase === d.phase && !t.archived);
    const open = inPhase.filter((t) => t.status !== 'completed').length;
    const done = inPhase.filter((t) => t.status === 'completed').length;
    const current = snapshot.phase === d.phase;
    return els.Box({
      key: `colony-bld:${d.phase}`,
      flexDirection: 'row',
      children: [
        els.Text({ children: current ? '» ' : '  ', color: BRAND.accent, bold: current }),
        els.Text({
          children: d.label.padEnd(DISTRICT_W),
          color: current ? BRAND.accent : BRAND.dim,
          bold: current,
        }),
        els.Text({ children: `${open} open · ${done} done`, color: current ? BRAND.text : BRAND.dim, dimColor: !current }),
      ],
    });
  });

  // one text row per squad member: name, state, tokens, task
  const agentRows = snapshot.squad.map((a, i) => {
    const cursorRow = st.cursor === i;
    const mark = cursorRow ? '> ' : '  ';
    const task = oneLine(a.task ?? '(no item)', Math.max(8, cols - 32));
    return els.Box({
      key: `colony-agent:${a.name}`,
      flexDirection: 'row',
      children: [
        els.Text({ children: mark, color: cursorRow ? BRAND.accent : BRAND.dim, bold: cursorRow }),
        els.Text({ children: oneLine(a.name, 16).padEnd(16), color: personaHex(snapshot, a.persona), bold: true }),
        els.Text({ children: a.state.padEnd(9), color: stateHex(a.state) }),
        els.Text({ children: `${a.tokens === undefined ? '--' : fmtK(a.tokens)} tok`.padEnd(10), color: BRAND.dim, dimColor: !cursorRow }),
        els.Text({ children: task, color: BRAND.text, wrap: 'truncate-end' }),
      ],
    });
  });

  const selected = st.selected ? snapshot.squad.find((x) => x.name === st.selected) : undefined;
  const inspector =
    selected !== undefined
      ? inspectorCard(els, st, snapshot, selected, surfaceRefOf(st), now, cols)
      : null;

  const body = els.Box({
    position: 'relative',
    flexDirection: 'column',
    overflow: 'hidden',
    children: [...districtRows, ...agentRows, ...(inspector ? [inspector] : [])],
  });

  const footer = els.Text({
    children: `${snapshot.squad.length} agents · ${fmtK(snapshot.tokens)} tok · ←/→ agent, enter inspect`,
    color: BRAND.dim,
  });

  return els.Box({ flexDirection: 'column', children: [header, body, footer] });
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
  const st = adoptState(prev, p);
  if (prev === undefined) {
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
