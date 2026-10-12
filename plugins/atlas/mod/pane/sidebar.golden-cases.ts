// Representative sidebar models, serialized for the golden characterization test.
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import type { LiveSnapshot } from '../orchestra-types';
import { sidebarTree, type GateGroup, type SidebarHandlers, type SidebarModel } from './sidebar';

const mk = (kind: string) => (props: Record<string, unknown>) => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const on: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {} };

const gates: GateGroup[] = [
  { id: 'completion', title: 'Completion', lines: [{ id: 'verify', label: 'verification coverage', ok: false, detail: 'no verified finding', fix: 'run the hooks suite' }, { id: 'docs', label: 'docs updated', ok: true }] },
  { id: 'header', title: 'Header', lines: [{ id: 'hdr', label: 'header matched', ok: true }], error: 'findings.json unreadable' },
  { id: 'routing', title: 'Routing', lines: [] },
];
const it = (id: string, status: string, owner: string | null = null) => ({ id, content: `task ${id} with some longer content to fit`, status, owner, evidence: status === 'completed' ? 'ev ' + id : null, live: true });
const model = (over: Partial<SidebarModel>, snap: LiveSnapshot = busySnap()): SidebarModel => ({
  snapshot: { ...snap, phase: 'implement', now: NOW }, gates, ui: { recipient: null, expanded: null, draft: '' }, columns: 60, rows: 40, ...over,
});
const busy = busySnap();
const todoGroups = [
  { phase: 'research', dept: '', glyph: '', done: 1, total: 2, items: [it('a', 'completed', 'bob'), it('b', 'pending')] },
  { phase: 'implement', dept: '', glyph: '', done: 0, total: 2, items: [it('c', 'in_progress', 'alice-long-owner-name'), it('d', 'pending')] },
  { phase: 'advisor', dept: '', glyph: '', done: 0, total: 3, items: [it('n1', 'pending'), it('n2', 'pending'), it('n3', 'pending')] },
] as any;
const name = busy.squad[0]!.name;

const cases: Record<string, SidebarModel> = {
  empty: model({}, { ...busy, squad: [], members: [], activity: {}, comms: [], todoGroups: [] }),
  midrun: model({ tick: 3 }, { ...busy, todoGroups }),
  gatesExpanded: model({ ui: { recipient: null, expanded: 'gate:verify', draft: '' } }),
  taskExpandedMore: model({ ui: { recipient: null, expanded: 'task:c', draft: 'draft' } }, { ...busy, todoGroups }),
  advisorAll: model({ ui: { recipient: null, expanded: 'advisor:more', draft: '' } }, { ...busy, todoGroups }),
  portrait: model({ ui: { recipient: name, expanded: null, draft: '' }, tick: 2 }),
  cols30: model({ columns: 30 }, { ...busy, todoGroups }),
  cols60: model({ columns: 60, rows: 20 }, { ...busy, todoGroups }),
  cols120: model({ columns: 120, rows: 24 }),
};

export const serializeGolden = (): string =>
  JSON.stringify(Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, sidebarTree(els, v, on)])), null, 1);
