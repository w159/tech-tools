// Test helper: every Atlas surface rendered for a 256-colour terminal, and the xterm indices the terminal would show.
// The Claude Code host downsamples the #rrggbb it is handed with hostTo256, so the colour on screen of an element prop is hostTo256(hex); a direct ANSI
// painter (paintAnsi) writes the index itself. palette.test.ts only reads source literals; this walks what the surfaces really emit (critique 26: 147, 151,
// 210, 251 and a 231 -> 194 -> 151 -> 114 fade reached the terminal although no source file spells them).
import type { ClientElements, RenderElement } from 'claude-code';
import type { SquadAgent, TodoItem } from './contract';
import type { LiveSnapshot } from './orchestra-types';
import { hostTo256, spinClock, withSpinFrame, type Ui } from './atlas-ui';
import { bandTree } from './band';
import { hudAgents, hudRows } from './hud';
import { liveWorkers, queuedMembers } from './data/live';
import { ownTodos } from './data/todos';
import { busySnap, NOW } from './live_fixture';
import { Motion, MOTION_MS } from './motion';
import { sidebarTree, type SidebarHandlers, type SidebarModel } from './pane/sidebar';
import { leadOf, leadRow } from './transcript/leadheader';
import { bubbleTree, notificationTree, workerCard, type CallLike } from './transcript/cards';
import { noteToastRuns, toastRuns } from './panel-layout';
import { paintAnsi } from './atlas-ui';

export const UI256: Ui = { theme: 'mocha', ascii: false, color: '256' };

/** The indices Atlas's palette may put on screen: accent 141, ok 114, warn 179, error 203, neutrals 236 / 240 / 245 / 252, the panel fills 234 / 235, 231 (white, a fade's first step) and 151 (the done fade's held step). */
export const PALETTE_INDICES: ReadonlySet<number> = new Set([141, 114, 179, 203, 236, 237, 240, 245, 252, 234, 235, 231, 151]);

type Node = { kind?: string; type?: string; props?: Record<string, unknown>; children?: unknown };
const mk = (kind: string) => (props: Record<string, unknown>) => ({ kind, props });
export const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
export const on: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} };

const COLOUR_PROPS = ['color', 'backgroundColor', 'bg', 'borderColor', 'fg'] as const;

/** Every xterm index the host would draw for the colours in `tree` (element props, Segment records, Run records) with the first path that carries it. */
export function indicesOf(tree: unknown): Map<number, string> {
  const out = new Map<number, string>();
  const visit = (n: unknown, path: string): void => {
    if (Array.isArray(n)) { n.forEach((c, i) => visit(c, `${path}[${i}]`)); return; }
    if (n === null || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    for (const k of COLOUR_PROPS) {
      const v = o[k];
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) { const i = hostTo256(v.toLowerCase()); if (!out.has(i)) out.set(i, `${path}.${k}=${v}${typeof o.t === 'string' ? ` "${o.t}"` : ''}`); }
    }
    for (const k of ['props', 'children']) if (k in o) visit(o[k], `${path}.${k}`);
    if (!('props' in o) && !('children' in o)) for (const k of Object.keys(o)) if (typeof o[k] === 'object') visit(o[k], `${path}.${k}`);
  };
  visit(tree, '$');
  return out;
}

/** The indices a painted ANSI string writes. */
export function sgrIndices(ansi: string): Set<number> {
  const out = new Set<number>();
  for (const m of ansi.matchAll(/\x1b\[([0-9;]*)m/g)) {
    const p = m[1]!.split(';');
    for (let i = 0; i + 2 < p.length; i++) if ((p[i] === '38' || p[i] === '48') && p[i + 1] === '5') out.add(Number(p[i + 2]));
  }
  return out;
}
export { paintAnsi };

// ---- the scenario: alpha, beta and gamma explorers on a five row plan (live-150-a5fa582a-1) ---------------------------------------------------

const sq = (name: string, state: SquadAgent['state'], item?: string): SquadAgent => ({ name, persona: 'explorer', state, source: 'task', ...(item ? { item } : {}) });
const act = (over: Record<string, unknown> = {}) => ({ tool: 'Read', target: 'alpha.py', since: NOW - 1000, startedAt: NOW - 14_000, toolCount: 1, tokens: null, mood: 'working', lastLine: '', ...over });
const row = (id: string, content: string, status: string, extra: Partial<TodoItem> = {}): TodoItem => ({ id, content, status, session_id: 's1', origin: 'session', ...extra });
const dispatch = (n: string, status = 'in_progress'): TodoItem => row(`d-${n}`, `dispatch ${n}`, status, { origin: 'dispatch', owner: n });
export const plan = (status = 'pending', dispatchStatus = 'in_progress'): TodoItem[] => [
  row('1', 'T1 read alpha.py (alpha-explorer)', status), row('2', 'T2 read beta.py (beta-explorer)', status), row('3', 'T3 read gamma.py (gamma-explorer)', status),
  row('4', 'T4 combine the three reports', 'pending'), row('5', 'T5 write the final summary', 'pending'),
  dispatch('alpha-explorer', dispatchStatus), dispatch('beta-explorer', dispatchStatus), dispatch('gamma-explorer', dispatchStatus),
];
export type Scene = 'running' | 'done' | 'killed';
export function scene(kind: Scene, over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  const state: SquadAgent['state'] = kind === 'running' ? 'running' : 'finished';
  const squad = [sq('alpha-explorer', state, 'T1'), sq('beta-explorer', state, 'T2'), sq('gamma-explorer', kind === 'killed' ? 'failed' : state, 'T3')];
  const todos = kind === 'running' ? plan() : plan('completed', 'completed');
  const mood = (a: SquadAgent): string => (kind === 'running' ? 'working' : a.state === 'failed' ? 'failed' : 'done');
  return {
    ...busySnap(), sessionId: 's1', squad, activity: Object.fromEntries(squad.map((a) => [a.name, act({ mood: mood(a), ...(kind === 'running' ? {} : { since: NOW - 500 }) })])),
    comms: [], members: [], todos, now: NOW, phase: kind === 'running' ? 'research' : 'done', ...over,
  } as LiveSnapshot;
}

export const VIEWS = ['route', 'team', 'channel', 'gates', 'core', 'board'] as const;
export const sidebarModel = (s: LiveSnapshot, view: SidebarModel['ui']['view'], columns: number, ui: Ui = UI256, motion?: SidebarModel['motion']): SidebarModel =>
  ({ snapshot: s, look: ui, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns, rows: 40, tick: 0, ...(motion ? { motion } : {}) }) as SidebarModel;

/** Plain text of an element tree, one line per row: what a terminal shows. */
export function textOf(tree: unknown): string[] {
  const flat = (n: unknown): string => {
    if (Array.isArray(n)) return n.map(flat).join('');
    if (n === null || typeof n !== 'object') return n === undefined || n === null ? '' : String(n);
    const o = n as Node;
    const p = o.props ?? {};
    if (o.kind === 'Text' || o.type === 'Text') return String(p.children ?? '') + (Array.isArray(o.children) ? flat(o.children) : '');
    if (p.width === 0) return '';
    const kids = o.kind ? p.children : o.children;
    const row = (p.flexDirection === 'row') || (o.kind === 'Button');
    const parts = (Array.isArray(kids) ? kids : kids == null ? [] : [kids]).map(flat);
    return row ? parts.join('') : parts.join('\n');
  };
  return flat(tree).split('\n');
}

export type Surface = { name: string; tree: unknown };

/** Every surface the person sees, rendered for `ui` at the pane `cols` (the host's columns less the border) and, for the transcript, `rail` columns. */
export function surfaces(ui: Ui = UI256, cols = 59): Surface[] {
  const out: Surface[] = [];
  const push = (name: string, tree: unknown): void => { out.push({ name, tree }); };
  const draw = <T,>(f: () => T): T => withSpinFrame(Math.floor(NOW / 100), f);
  for (const kind of ['running', 'done', 'killed'] as const) {
    const s = scene(kind);
    for (const v of VIEWS) push(`panel ${v} ${kind} ${cols}`, draw(() => sidebarTree(els, sidebarModel(s, v, cols + 1, ui), on)));
    const live = liveWorkers(s, s.now);
    const hudIn = { todos: ownTodos(s.todos, s.sessionId), agents: hudAgents(live, s.squad, queuedMembers(s)), root: s.root };
    push(`hud ${kind} ${cols}`, draw(() => hudRows(hudIn, { cols: cols + 60, tick: 0, ui, now: s.now, maxRows: 40 })));
    push(`band ${kind}`, draw(() => bandTree(els, { snapshot: s, live, gates: [], columns: cols + 60, tick: 0, maxRows: 12, ui } as never)));
  }
  // transcript: a start card, a finish card, a killed card, the lead's header chips and a toast
  const call = (over: Partial<CallLike> = {}): CallLike => ({ tool: 'Agent', input: { subagent_type: 'atlas:explorer', name: 'alpha-explorer', description: 'read alpha.py' }, isRunning: false, isErrored: false, isInterrupted: false, ...over });
  push('card start', workerCard(call({ isRunning: true }), 'running', 100, 'alpha-explorer', 'running', { ui, now: 'Read alpha.py · 0:03 · 1 tool' }, ui));
  push('card finish', notificationTree('alpha-explorer', 'explorer', 'finished · STATUS: DONE · 0:14', false, ui));
  push('card finish aged', notificationTree('alpha-explorer', 'explorer', 'finished · 0:14', false, ui, true));
  push('card killed', notificationTree('ghost-explorer', 'explorer', 'killed · 0:05', true, ui));
  push('card bubble', bubbleTree('hello', 'alpha-explorer', 'lead', 0, ui));
  for (const phase of ['research', 'implement', 'verify', 'done', 'blocked'] as const)
    for (const quiet of [false, true]) push(`lead ${phase}${quiet ? ' quiet' : ''}`, leadRow(leadOf(`▌ ${phase} 1/3 · working on it`, '')!, { ui, columns: 100, quiet }) as RenderElement);
  push('toast', { runs: toastRuns('done', 'alpha-explorer', 'explorer finished · 0:14', ui) });
  push('toast note', { runs: noteToastRuns('alpha-explorer', 'found 3 call sites', ui) });
  return out;
}

/** The fade of rows that changed state: HUD and panel frames at every beat of the motion window, for a run that finished and for one that lost a worker. */
export function fadeSurfaces(ui: Ui = UI256, cols = 59): Surface[] {
  const out: Surface[] = [];
  const t0 = NOW;
  const items = (s: LiveSnapshot) => s.squad.flatMap((a) => { const st = a.state === 'finished' ? 'done' : a.state === 'failed' ? 'failed' : 'running'; return [{ key: `worker:${a.name}`, state: st }, { key: `agent:${a.name}`, state: st }]; });
  for (const kind of ['done', 'killed'] as const) {
    const before = scene('running');
    const after = scene(kind);
    const mo = new Motion(true);
    mo.observe('x', items(before), t0 - 5000);
    mo.observe('x', items(after), t0);
    for (const dt of [0, 200, 400, 600, 800]) {
      const ctx = mo.ctx(t0 + dt);
      const live = liveWorkers(after, after.now);
      const hudIn = { todos: ownTodos(after.todos, after.sessionId), agents: hudAgents(live, after.squad, queuedMembers(after)), root: after.root };
      for (const v of ['team', 'route', 'board'] as const) out.push({ name: `fade ${kind} panel ${v} +${dt}`, tree: withSpinFrame(Math.floor(NOW / 100), () => sidebarTree(els, sidebarModel(after, v, cols + 1, ui, ctx), on)) });
      out.push({ name: `fade ${kind} hud +${dt}`, tree: withSpinFrame(Math.floor(NOW / 100), () => hudRows(hudIn, { cols: cols + 60, tick: 0, ui, now: after.now, maxRows: 40, motion: ctx })) });
    }
  }
  void MOTION_MS;
  void spinClock;
  return out;
}
