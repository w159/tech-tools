// Representative sidebar models, serialized for the golden characterization test.
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import type { LiveSnapshot } from '../orchestra-types';
import { sidebarTree, type GateGroup, type SidebarHandlers, type SidebarModel } from './sidebar';

const mk = (kind: string) => (props: Record<string, unknown>) => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const on: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} };

const gates: GateGroup[] = [
  { id: 'completion', title: 'Completion gate', lines: [{ id: 'verify', label: 'verification coverage', ok: false, detail: 'no verified finding', fix: 'run the hooks suite' }, { id: 'docs', label: 'docs updated', ok: true }] },
  { id: 'header', title: 'Header contract', lines: [{ id: 'hdr', label: 'header matched', ok: true }], error: 'findings.json unreadable' },
  { id: 'routing', title: 'Tool routing', lines: [] },
];
const it = (id: string, status: string, owner: string | null = null) => ({ id, content: `task ${id} with some longer content to fit`, status, owner, evidence: status === 'completed' ? 'ev ' + id : null});
const model = (over: Partial<SidebarModel>, snap: LiveSnapshot = busySnap()): SidebarModel => ({
  snapshot: { ...snap, phase: 'implement', now: NOW }, gates, ui: { recipient: null, expanded: null, draft: '', view: 'team' }, columns: 60, rows: 40, ...over,
});
const busy = busySnap();
const todoGroups = [
  { phase: 'research', dept: '', glyph: '', items: [it('a', 'completed', 'bob'), it('b', 'pending')] },
  { phase: 'implement', dept: '', glyph: '', items: [it('c', 'in_progress', 'alice-long-owner-name'), it('d', 'pending')] },
  { phase: 'advisor', dept: '', glyph: '', items: [it('n1', 'pending'), it('n2', 'pending'), it('n3', 'pending')] },
] as any;
const name = busy.squad[0]!.name;
const note = (i: number) => ({ ts: '2026-01-01T00:00:00.000Z', seq: i, owner: i % 3 === 0 ? 'lead' : name, text: `note ${i}`, channel: 'general' });

const ui = (over: Partial<SidebarModel['ui']> = {}): SidebarModel['ui'] => ({ recipient: null, expanded: null, draft: '', view: 'team', ...over });
const v = (view: SidebarModel['ui']['view'], over: Partial<SidebarModel> = {}, snap: LiveSnapshot = { ...busy, todoGroups }) => model({ ui: ui({ view }), ...over }, snap);

const cases: Record<string, SidebarModel> = {
  empty: model({ ui: ui() }, { ...busy, squad: [], members: [], activity: {}, comms: [], todoGroups: [] }),
  team: v('team', { tick: 3 }),
  teamPortrait: v('team', { ui: ui({ recipient: name }), tick: 2 }),
  teamCustomName: v('team', {}, { ...busy, members: [], squad: [{ ...busy.squad[0]!, name: 'selffix-worker', persona: 'unknown' }] }),
  channel: v('channel'),
  route: v('route'),
  gates: v('gates'),
  gatesExpanded: v('gates', { ui: ui({ view: 'gates', expanded: 'gate:verify' }) }),
  cols38: v('team', { columns: 38 }),
  cols30: v('route', { columns: 30 }),
  cols50: v('channel', { columns: 50, tick: 1 }),
  cols120: v('team', { columns: 120 }),
  // channel log longer than the default rows budget: only the newest rows - 4 notes show
  channelLog: v('channel', {}, { ...busy, todoGroups, notes: Array.from({ length: 40 }, (_, i) => note(i)) }),
  // route view with a task row opened: a pending task with no evidence, and a completed one (shown from DONE_MIN_COLS) with its evidence
  routeOpenPending: v('route', { ui: ui({ view: 'route', expanded: 'task:c' }) }),
  routeOpenDone: v('route', { columns: 100, ui: ui({ view: 'route', expanded: 'task:a' }), snapshot: { ...busy, todoGroups, phase: 'research', now: NOW } }),
};

export const serializeGolden = (): string =>
  JSON.stringify(Object.fromEntries(Object.entries(cases).map(([k, m]) => [k, sidebarTree(els, m, on)])), null, 1);
