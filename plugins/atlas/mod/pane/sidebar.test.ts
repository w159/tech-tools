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
};

const gates: GateGroup[] = [
  { id: 'completion', title: 'Completion', lines: [{ id: 'verify', label: 'verification coverage', ok: false, detail: 'no verified finding', fix: 'run the hooks suite' }] },
  { id: 'header', title: 'Header', lines: [{ id: 'hdr', label: 'header matched', ok: true }], error: 'findings.json unreadable' },
];

function model(over: Partial<SidebarModel> = {}, snap: LiveSnapshot = busySnap()): SidebarModel {
  return { snapshot: { ...snap, phase: 'implement', now: NOW }, gates, ui: { recipient: null, expanded: null, draft: '' }, columns: 60, rows: 40, ...over };
}

describe('sidebar tree', () => {
  test('route shows done, current and pending waypoints', () => {
    const line = textOf(sidebarTree(els, model(), on) as unknown as Node);
    for (const ph of busySnap().contract.phases.filter((x) => busySnap().contract.todoPhases.includes(x.id))) expect(line).toContain(ph.glyph);
    expect(line).toContain('━');
    expect(line).toContain('─');
    expect(line).toMatch(/[▰▱]/);
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

  test('gate with a fix expands on first press and copies on the second', () => {
    const first = sidebarTree(els, model({ ui: { recipient: null, expanded: 'group:completion', draft: '' } }), on) as unknown as Node;
    button(first, 'gate:verify').props.onPress();
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

  test('phase names sit under their waypoints, or only the current one when cramped', () => {
    const wide = sidebarTree(els, model({ columns: 120 }), on) as unknown as Node;
    const rowsOf = (r: Node) => all(r).filter((n) => n.kind === 'Box' && n.props.flexDirection === 'row').map(textOf);
    const [route, names] = rowsOf(wide).slice(1, 3) as [string, string];
    for (const ph of busySnap().contract.todoPhases) expect(names.indexOf(String(ph))).toBeGreaterThanOrEqual(0);
    const first = names.indexOf(String(busySnap().contract.todoPhases[0]));
    expect(route[first + Math.floor(String(busySnap().contract.todoPhases[0]).length / 2)]).toBeDefined();
    const narrow = rowsOf(sidebarTree(els, model({ columns: 20 }), on) as unknown as Node)[2]!.trim();
    expect(narrow).toBe('implement');
  });

  test('team shows one lead row, no other-session leads, caps with +N more', () => {
    const snap = busySnap();
    const members = ['lead-01a118', 'lead-d304aa', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'].map((name) => ({ name }));
    const t = textOf(sidebarTree(els, model({ rows: 40 }, { ...snap, squad: [], members }), on) as unknown as Node);
    expect(t).not.toContain('lead-01a118');
    expect(t.match(/ lead /g)?.length ?? 0).toBeLessThanOrEqual(2);
    expect(t).toContain('+2 more');
  });

  test('gates: header shows open count, groups collapse to one line, armed info is not a failure', () => {
    const g: GateGroup[] = [{ id: 'tripwire', title: 'Tripwire', lines: [{ id: 'armed', label: 'Orchestration armed', ok: true, detail: 'not armed' }, { id: 'inline', label: 'Inline ops', ok: false }] }];
    const t = textOf(sidebarTree(els, model({ gates: g }), on) as unknown as Node);
    expect(t).toContain('Gates  1 open');
    expect(t).toContain('Tripwire  1 open');
    expect(t).not.toContain('Inline ops');
    expect(textOf(sidebarTree(els, model({ gates: [] }), on) as unknown as Node)).toContain('Gates  all clear');
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

  const root60 = () => sidebarTree(els, model({ columns: 60 }), on) as unknown as Node;
  const HEX = /^#[0-9a-f]{6}$/i;

  const isBgOk = (bg: unknown) => bg === undefined || HEX.test(String(bg));
  const expectThemeColours = (t: Node) => {
    if (HEX.test(t.props.color ?? '')) expect(t.props.backgroundColor).toMatch(HEX);
    expect(isBgOk(t.props.backgroundColor)).toBe(true);
    expect(t.props.dimColor).toBeUndefined();
  };

  test('colours are theme keys: hex only on sprite runs with fg and bg, never dim on colour', () => {
    for (const columns of [30, 60]) {
      const root = sidebarTree(els, model({ columns, ui: { recipient: null, expanded: 'group:completion', draft: '' } }), on) as unknown as Node;
      all(root).filter((n) => n.kind === 'Text').forEach(expectThemeColours);
    }
  });

  test('sections are round-bordered in a theme key at 60 columns, borderless at 30', () => {
    const boxes = all(root60()).filter((n) => n.kind === 'Box' && n.props.borderStyle);
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    for (const b of boxes) { expect(b.props.borderStyle).toBe('round'); expect(b.props.borderColor).toBe('promptBorder'); }
    expect(all(sidebarTree(els, model({ columns: 30 }), on) as unknown as Node).some((n) => n.props.borderStyle)).toBe(false);
  });

  test('every member row starts with a badge chip (persona colour fg+bg)', () => {
    const rows = all(root60()).filter((n) => n.kind === 'Button' && String(n.props.key).startsWith('member:'));
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      const chip = kids(r).find((t) => HEX.test(t.props.backgroundColor ?? '') && HEX.test(t.props.color ?? ''));
      expect(chip).toBeDefined();
    }
  });

  const hasArt = (r: Node) => all(r).some((n) => n.kind === 'Text' && /[▀▄█]/.test(String(n.props.children)));
  const ui = (recipient: string | null) => ({ recipient, expanded: null, draft: '' });
  const quiet = (): LiveSnapshot => ({ ...busySnap(), squad: [], members: [], activity: {}, comms: [] });

  test('selected member shows a portrait at 40+ columns, none at 30', () => {
    const name = busySnap().squad[0]!.name;
    const portrait = (columns: number) => hasArt(sidebarTree(els, model({ columns, ui: ui(name) }), on) as unknown as Node);
    expect(portrait(40)).toBe(true);
    expect(portrait(60)).toBe(true);
    expect(portrait(30)).toBe(false);
  });

  test('idle default lead shows no portrait; an explicit pick of an idle lead does', () => {
    expect(hasArt(sidebarTree(els, model({}, quiet()), on) as unknown as Node)).toBe(false);
    expect(hasArt(sidebarTree(els, model({ ui: ui('lead') }, quiet()), on) as unknown as Node)).toBe(true);
  });

  test('team title is plain "Team N members" with no badge chip and counts rows excluding the lead', () => {
    const root = sidebarTree(els, model(), on) as unknown as Node;
    const rows = all(root).filter((n) => n.kind === 'Button' && String(n.props.key).startsWith('member:')).length;
    const m = textOf(root).match(/Team  (\d+) members?/);
    expect(m).not.toBeNull();
    expect(textOf(root)).not.toMatch(/LE.?Team/);
    expect(Number(m![1])).toBe(rows - 1);
  });

  test('bubble is <= 36 columns and carries the selected member\'s own line, never another member\'s', () => {
    const snap = busySnap();
    const [a, b] = [snap.squad[0]!.name, snap.squad[1]!.name];
    const long = 'x'.repeat(200);
    const withText = { ...snap, activity: { ...snap.activity, [a]: { ...snap.activity[a], lastLine: 'MY OWN LINE' } }, comms: [{ from: b, to: 'lead', text: 'OTHER HANDOFF', ts: 1 }, { from: 'lead', to: 'all', text: long, ts: 2 }] } as any;
    const t = textOf(sidebarTree(els, model({ columns: 120, ui: ui(a) }, withText), on) as unknown as Node);
    expect(t).toContain('MY OWN LINE');
    expect(t).not.toContain('OTHER HANDOFF');
    const lead = sidebarTree(els, model({ columns: 120, ui: ui('lead') }, withText), on) as unknown as Node;
    expect(textOf(lead)).not.toContain('xxxx');
    for (const r of all(lead).filter((n) => n.kind === 'Box' && n.props.flexDirection === 'row')) {
      const bubble = textOf(r).replace(/^[^\u2570-\u2571\u256d-\u2570│╭╰]*/, '');
      if (/[╭╰│]/.test(textOf(r))) expect(textWidth(bubble)).toBeLessThanOrEqual(37);
    }
  });

  test('working badges animate with the tick', () => {
    const chips = (tick: number) => JSON.stringify(all(sidebarTree(els, model({ tick }), on) as unknown as Node).filter((n) => n.kind === 'Text').map((n) => n.props.color));
    expect(chips(0)).not.toBe(chips(1));
  });

  test('gates show a status strip with one mark per group', () => {
    const t = textOf(sidebarTree(els, model(), on) as unknown as Node);
    expect(t).toMatch(/✗ Completion +✗ Header|✗ Completion +✓ Header/);
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
