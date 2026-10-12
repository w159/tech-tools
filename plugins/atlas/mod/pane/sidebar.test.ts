// Sidebar tree tests over a fake element table: the tree is plain data, so presses and
// submits are driven by walking it. Covers route glyphs, empty phases, handlers, widths.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import type { LiveSnapshot } from '../orchestra-types';
import { textWidth } from '../theme';
import { sidebarTree, type GateGroup, type SidebarHandlers, type SidebarModel } from './sidebar';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;

const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
const textOf = (n: Node): string =>
  n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join('');
const button = (root: Node, key: string): Node => {
  const b = all(root).find((n) => n.kind === 'Button' && n.props.key === key);
  if (!b) throw new Error(`no button ${key}`);
  return b;
};

const calls: string[] = [];
const on: SidebarHandlers = {
  selectRecipient: (n) => calls.push(`select:${n}`),
  toggle: (k) => calls.push(`toggle:${k}`),
  draftChange: (t) => calls.push(`draft:${t}`),
  send: (t) => calls.push(`send:${t}`),
  copy: (t) => calls.push(`copy:${t}`),
  focus: (k) => calls.push(`focus:${k}`),
  expand: (k) => calls.push(`expand:${k}`),
};

const gates: GateGroup[] = [
  { id: 'completion', title: 'Completion gate', lines: [{ id: 'verify', label: 'verification coverage', ok: false, detail: 'no verified finding', fix: 'run the hooks suite' }] },
  { id: 'header', title: 'Header', lines: [{ id: 'hdr', label: 'header matched', ok: true }], error: 'findings.json unreadable' },
];

function model(over: Partial<SidebarModel> = {}, snap: LiveSnapshot = busySnap()): SidebarModel {
  return { snapshot: { ...snap, phase: 'implement', now: NOW }, gates, ui: { recipient: null, expanded: null, draft: '' }, columns: 60, rows: 40, ...over };
}

describe('sidebar tree', () => {
  test('route is the compact waypoint line with one plain label row', () => {
    const root = sidebarTree(els, model(), on) as unknown as Node;
    const rows = all(root).filter((n) => n.kind === 'Box' && n.props.flexDirection === 'row').map(textOf);
    const phases = busySnap().contract.todoPhases.map(String);
    const cur = phases.indexOf('implement');
    const way = '━━━━'.length;
    const markAt = (i: number) => (i === cur ? '◉' : i < cur ? '◆' : '○');
    const railAt = (i: number) => (i === phases.length - 1 ? '' : (i < cur ? '━' : '─').repeat(way));
    const expected = phases.map((_, i) => markAt(i) + railAt(i)).join('');
    expect(rows[1]).toBe(expected);
    expect(rows[2]).toBe(phases.join(' '));
    expect(textOf(root)).toContain(`Atlas  implement, `);
  });

  test('each phase has a mini-bar header; tasks are one row each with their own status glyph', () => {
    const snap = busySnap();
    const it = (id: string, status: string) => ({ id, content: `task ${id}`, status, owner: id === 'a' ? 'bob' : null, evidence: null, live: true });
    const todoGroups = [{ phase: 'implement', dept: '', glyph: '', done: 1, total: 3, items: [it('a', 'in_progress'), it('b', 'pending'), it('c', 'completed')] }] as any;
    const root = sidebarTree(els, model({}, { ...snap, todoGroups }), on) as unknown as Node;
    expect(textOf(root)).toMatch(/implement .* 1\/3/);
    expect(textOf(button(root, 'task:a'))).toMatch(/^ {2}◉ task a +bob$/);
    expect(textOf(button(root, 'task:b'))).toMatch(/^ {2}○ task b$/);
    expect(textOf(button(root, 'task:c'))).toMatch(/^ {2}✓ task c$/);
    expect(textOf(root)).not.toContain('research  ');
  });

  test('sections are bordered from 40 columns up and plain below', () => {
    const borders = (columns: number) =>
      all(sidebarTree(els, model({ columns }), on) as unknown as Node).filter((n) => n.props.borderStyle === 'round' && n.props.borderColor === 'promptBorder').length;
    expect(borders(60)).toBeGreaterThanOrEqual(3);
    expect(borders(40)).toBeGreaterThanOrEqual(3);
    expect(borders(38)).toBe(0);
  });

  test('a phase with no tasks says nothing planned', () => {
    const snap = busySnap();
    const t = textOf(sidebarTree(els, model({}, { ...snap, todoGroups: [] }), on) as unknown as Node);
    expect(t).toContain('nothing planned');
  });

  test('member press selects the recipient and the label follows it', () => {
    const snap = busySnap();
    const name = snap.squad[0]!.name;
    const root = sidebarTree(els, model(), on) as unknown as Node;
    button(root, `member:${name}`).props.onPress();
    expect(calls).toContain(`select:${name}`);
    const after = sidebarTree(els, model({ ui: { recipient: name, expanded: null, draft: '' } }), on) as unknown as Node;
    expect(all(after).find((n) => n.kind === 'Input')!.props.label).toBe(`To ${name}`);
    expect(textOf(after)).toContain('▸');
  });

  test('input defaults to lead; submit sends, typing updates the draft', () => {
    const root = sidebarTree(els, model({ ui: { recipient: null, expanded: null, draft: 'hi' } }), on) as unknown as Node;
    const input = all(root).find((n) => n.kind === 'Input')!;
    expect(input.props.label).toBe('To lead');
    expect(input.props.value).toBe('hi');
    input.props.onSubmit('hello');
    input.props.onInput('he');
    expect(calls).toContain('send:hello');
    expect(calls).toContain('draft:he');
  });

  test('gate group opens into line Buttons; a fix line expands, then copies', () => {
    const closed = sidebarTree(els, model(), on) as unknown as Node;
    expect(all(closed).some((n) => n.kind === 'Button' && n.props.key === 'gate:verify')).toBe(false);
    expect(textOf(button(closed, 'group:completion'))).toBe('▸ Completion gate  1 open');
    button(closed, 'group:completion').props.onPress();
    expect(calls).toContain('toggle:group:completion');
    const grp = sidebarTree(els, model({ ui: { recipient: null, expanded: 'group:completion', draft: '' } }), on) as unknown as Node;
    button(grp, 'gate:verify').props.onPress();
    expect(calls).toContain('toggle:gate:verify');
    const open = sidebarTree(els, model({ ui: { recipient: null, expanded: 'gate:verify', draft: '' } }), on) as unknown as Node;
    expect(textOf(open)).toContain('no verified finding');
    button(open, 'gate:verify').props.onPress();
    expect(calls).toContain('copy:run the hooks suite');
  });

  test('failed gate source draws one dimmed line', () => {
    expect(textOf(sidebarTree(els, model(), on) as unknown as Node)).toContain('Header unavailable: findings.json unreadable');
  });

  test('header and band count the route tasks, advisor notes excluded', () => {
    const snap = busySnap();
    const it = (id: string, status: string) => ({ id, content: id, status, owner: null, evidence: null, live: true });
    const todoGroups = [
      { phase: 'research', dept: '', glyph: '', done: 1, total: 2, items: [it('a', 'completed'), it('b', 'pending')] },
      { phase: 'advisor', dept: '', glyph: '', done: 0, total: 3, items: [it('n1', 'pending'), it('n2', 'pending'), it('n3', 'pending')] },
    ] as any;
    const t = textOf(sidebarTree(els, model({}, { ...snap, counts: { done: 0, total: 35, byPhase: {} }, todoGroups }), on) as unknown as Node);
    expect(t).toContain('1 of 2 done');
    expect(t).not.toContain('of 35');
  });

  test('team shows one lead row, no other-session leads, caps with +N more', () => {
    const snap = busySnap();
    const members = ['lead-01a118', 'lead-d304aa', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'].map((name) => ({ name }));
    const t = textOf(sidebarTree(els, model({ rows: 40 }, { ...snap, squad: [], members }), on) as unknown as Node);
    expect(t).not.toContain('lead-01a118');
    expect(t.match(/ lead /g)?.length ?? 0).toBeLessThanOrEqual(2);
    expect(t).toContain('+2 more');
  });

  test('gates: collapsed groups with counts, a status strip, armed info is not a failure', () => {
    const g: GateGroup[] = [{ id: 'tripwire', title: 'Dispatch tripwire', lines: [{ id: 'armed', label: 'Orchestration armed', ok: true, detail: 'not armed' }, { id: 'inline', label: 'Inline ops', ok: false }] }];
    const t = textOf(sidebarTree(els, model({ gates: g }), on) as unknown as Node);
    expect(t).toMatch(/Gates +1 open/);
    expect(t).toContain('✗ Dispatch tripwire');
    expect(t).toContain('▸ Dispatch tripwire  1 open');
    expect(t).not.toContain('Inline ops');
    expect(textOf(sidebarTree(els, model({ gates: [] }), on) as unknown as Node)).toMatch(/Gates +all clear/);
    const clear: GateGroup[] = [{ id: 'routing', title: 'Tool routing', lines: [{ id: 'r', label: 'r', ok: true }] }];
    expect(textOf(sidebarTree(els, model({ gates: clear }), on) as unknown as Node)).toContain('▸ Tool routing  clear');
  });

  test('hotkeys: m focuses the message field, g expands the first group with open items', () => {
    const root = sidebarTree(els, model(), on) as unknown as Node;
    expect(button(root, 'hotkey:m').props.hotkey).toBe('m');
    expect(button(root, 'hotkey:g').props.hotkey).toBe('g');
    button(root, 'hotkey:m').props.onPress();
    button(root, 'hotkey:g').props.onPress();
    expect(calls).toContain('focus:msg');
    expect(calls).toContain('expand:group:completion');
  });

  test('advisor notes are their own section: first 2, +N more, press expands', () => {
    const snap = busySnap();
    const it = (id: string) => ({ id, content: `note ${id} full text`, status: 'pending', owner: null, evidence: null, live: true });
    const todoGroups = [{ phase: 'advisor', dept: '', glyph: '', done: 0, total: 3, items: [it('1'), it('2'), it('3')] }] as any;
    const root = sidebarTree(els, model({}, { ...snap, todoGroups }), on) as unknown as Node;
    const t = textOf(root);
    expect(t).toContain('Advisor notes');
    expect(t).toContain('note 2 full text');
    expect(t).not.toContain('note 3 full text');
    expect(t).toContain('+1 more');
    button(root, 'advisor:more').props.onPress();
    expect(calls).toContain('toggle:advisor:more');
  });

  const HEX = /^#[0-9a-f]{6}$/i;

  const usesHexOrBg = (t: Node) => HEX.test(t.props.color ?? '') || t.props.backgroundColor !== undefined;

  const expectThemeColours = (t: Node) => {
    // Hex only on sprite and chip runs, which always set their own background too.
    if (usesHexOrBg(t)) expect(HEX.test(t.props.backgroundColor ?? '')).toBe(true);
    expect(t.props.dimColor).toBeUndefined();
  };

  test('colours are theme keys; hex appears only with its own background; never dim on colour', () => {
    for (const columns of [30, 60]) {
      const root = sidebarTree(els, model({ columns, ui: { recipient: null, expanded: 'gate:verify', draft: '' } }), on) as unknown as Node;
      all(root).filter((n) => n.kind === 'Text').forEach(expectThemeColours);
    }
  });

  test('team rows carry a readable-name chip, never a two-letter code', () => {
    const root = sidebarTree(els, model(), on) as unknown as Node;
    expect(textOf(root)).toMatch(/Team +lead is (conducting \d+|idle)/);
    const rows = all(root).filter((n) => n.kind === 'Button' && String(n.props.key).startsWith('member:'));
    expect(rows.length).toBeGreaterThan(1);
    expect(textOf(rows[0]!)).toMatch(/^▸ +Lead agent/);
    for (const r of rows) {
      expect(textOf(r)).not.toMatch(/\b[A-Z]{2}\b/);
      expect(kids(r).some((t) => HEX.test(t.props.backgroundColor ?? ''))).toBe(true);
    }
  });

  test('a custom member name reads on the chip', () => {
    const snap = busySnap();
    const t = textOf(sidebarTree(els, model({}, { ...snap, squad: [{ ...snap.squad[0]!, name: 'selffix-worker', persona: 'unknown' }], members: [], activity: {} }), on) as unknown as Node);
    expect(t).toContain('Selffix worker');
  });

  test('a roster lead with an ordinary name is not listed as a teammate', () => {
    const snap = busySnap();
    const t = textOf(sidebarTree(els, model({}, { ...snap, squad: [], members: [{ name: 'selffix', role: 'lead' }], activity: {}, comms: [] }), on) as unknown as Node);
    expect(t).not.toContain('selffix');
    expect(t).toContain('nobody dispatched yet');
  });

  test('portrait with a speech bubble shows for the selected member only in a tall bordered pane', () => {
    const name = busySnap().squad[0]!.name;
    const ui = { recipient: name, expanded: null, draft: '' };
    const rowsOf = (m: SidebarModel) => all(sidebarTree(els, m, on) as unknown as Node).filter((n) => n.kind === 'Box' && n.props.flexDirection === 'row').length;
    expect(rowsOf(model({ ui, rows: 40 }))).toBeGreaterThan(rowsOf(model({ ui, rows: 20 })));
    expect(rowsOf(model({ ui, rows: 40 }))).toBeGreaterThan(rowsOf(model({ ui, rows: 40, columns: 38 })));
  });

  test('empty team says how to dispatch', () => {
    const quiet: LiveSnapshot = { ...busySnap(), squad: [], members: [], activity: {}, comms: [] };
    const t = textOf(sidebarTree(els, model({}, quiet), on) as unknown as Node);
    expect(t).toContain('nobody dispatched yet');
    expect(t).toMatch(/lead is idle/);
  });

  for (const columns of [30, 40, 60, 120]) {
    test(`every text line fits ${columns} columns`, () => {
      const root = sidebarTree(els, model({ columns, ui: { recipient: null, expanded: 'gate:verify', draft: '' } }), on) as unknown as Node;
      const rows = all(root).filter((n) => (n.kind === 'Box' && n.props.flexDirection === 'row') || n.kind === 'Button');
      expect(rows.length).toBeGreaterThan(5);
      for (const r of rows) expect(textWidth(textOf(r))).toBeLessThanOrEqual(columns);
    });
  }
});
