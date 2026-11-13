// Critique 11, slice B: the band states what the live host shows. Shapes come from live-150-5d6a53ef-{1,3} (frames f0025, f0094) and live-110-5d6a53ef-1 (f0072).
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree } from './band';
import { cellsText, coreCells } from './core-row';
import type { Ui } from './atlas-ui';
import { busySnap, NOW } from './live_fixture';
import { gateTally, leadBusy, withCoreTally } from './data/runstate';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') } as unknown as ClientElements;
const text = (row: Node): string => (row.props.children as Node[]).map((t) => t.props.children).join('');
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const SESSION = 'd87fbe79';
const lead = (tool: string | null, mood: string) => ({ lead: { tool, since: NOW, toolCount: 1, tokens: null, mood, lastLine: '' } });
const idle = (over: Record<string, unknown> = {}) => busySnap({ squad: [], comms: [], sessionId: SESSION, activity: lead(null, 'idle'), ...over } as never);
const rows = (snapshot: ReturnType<typeof busySnap>, gates: unknown[], columns = 150, core: unknown = null, maxRows = 12): string[] =>
  ((bandTree(els, { snapshot, live: [], gates, columns, tick: 0, maxRows, ui, core } as never) as unknown as Node).props.children as Node[]).map(text);
const grp = (id: string, ok: boolean) => ({ id, title: id, lines: [{ id: `${id}-l`, label: id, ok }] });
const row = (id: string, status: string, origin: string, session_id: string, owner?: string) => ({ id, content: `${id} ${origin}`, status, origin, session_id, ...(owner ? { owner } : {}) });
const doneStore = (gamma = 'completed') => [
  ...['t1', 't2', 't3', 't4', 't5'].map((id) => row(id, 'completed', 'session', '')),
  row('da', 'completed', 'dispatch', SESSION, 'alpha-explorer'), row('db', 'completed', 'dispatch', SESSION, 'beta-explorer'), row('dg', gamma, 'dispatch', SESSION, 'gamma-explorer'),
];
const core = (open: number) => ({ contract: { header: { ok: 1, total: 1 }, evidence: { ok: 0, total: 5 }, open, openGates: 0, verifiedDone: { ok: 0, total: 5 } }, verdicts: [{ id: 'f1', title: 'alpha read', status: 'verified' }], claims: [], ledger: { verified: 1, refuted: 0, pending: 0, claimed: 0, unchecked: 0 }, offload: { workers: [], kept: 0, returned: 0, ratio: null }, routes: [] });

describe('B1: the band never reads idle while the lead runs its own tool', () => {
  test('f0025: the lead runs a shell command, no plan yet, no worker listed: the band is not idle', () => {
    const snap = idle({ activity: lead('Bash', 'working') });
    expect(leadBusy(snap as never)).toBe(true);
    const out = rows(snap, [])[0]!;
    expect(out).not.toContain('idle');
  });
  test('the lead between tools (thinking) is busy too; a finished or aborted turn is idle', () => {
    expect(leadBusy(idle({ activity: lead(null, 'thinking') }) as never)).toBe(true);
    for (const mood of ['done', 'idle', 'failed']) expect(leadBusy(idle({ activity: lead(null, mood) }) as never)).toBe(false);
    expect(rows(idle({ activity: lead(null, 'done') }), [])[0]).toContain('idle');
  });
  test('f0072: a failing check while the lead runs is not a warning yet: the band names the phase, not `warning`', () => {
    const out = rows(idle({ activity: lead('Bash', 'working') }), [grp('completion', false), grp('tripwire', true)], 110)[0]!;
    expect(out).not.toContain('warning');
    expect(out).not.toContain('idle');
  });
});

describe('B2: `n open` comes from the snapshot the plan count reads, and names what is open', () => {
  test('f0094: every row completed in the snapshot, a stale core still holds 1 open: no `open` on the band', () => {
    const out = rows(idle({ todos: doneStore(), activity: lead(null, 'done') }), [], 150, core(1))[0]!;
    expect(out).toContain('5/5');
    expect(out).not.toContain('open');
  });
  test('the gamma dispatch row is open (session-stamped, Stop counts it): the band says `1 dispatch open`', () => {
    const out = rows(idle({ todos: doneStore('pending') }), [], 150, core(0)).join('\n');
    expect(out).toContain('5/5 · 1 dispatch open');
  });
  test('an open row Stop does not count (another session, archived, manual) is never named', () => {
    const extra = [row('x', 'pending', 'session', 'other'), { ...row('y', 'pending', 'dispatch', SESSION, 'z'), archived: true }, row('m', 'pending', 'manual', SESSION)];
    expect(rows(idle({ todos: [...doneStore(), ...extra] }), [], 150)[0]).not.toContain('open');
  });
});

describe('B3: the contract cell never contradicts the plan', () => {
  test('0 of 5 done items carry evidence beside todo 5/5: the cell is dropped, the verdicts stay', () => {
    const cells = cellsText(coreCells(core(0) as never, 150, ui, 5));
    expect(cells).not.toContain('contract');
    expect(cells).toContain('verdicts');
  });
  test('some evidence on record: the cell stays and states it over the plan', () => {
    const m = { ...core(0), contract: { ...core(0).contract, evidence: { ok: 3, total: 5 } } };
    expect(cellsText(coreCells(m as never, 150, ui, 5))).toContain('3/5');
  });
});

describe('critique 12 B1/B4: no unexplained zero, one phrase for one open dispatch', () => {
  test('f0063: T1 done in the plan, the core model has no done item yet: no `no done items yet` beside the plan count', () => {
    const empty = { ...core(0), contract: { ...core(0).contract, evidence: { ok: 0, total: 0 }, verifiedDone: { ok: 0, total: 0 } } };
    expect(cellsText(coreCells(empty as never, 150, ui, 5))).not.toContain('no done items yet');
    expect(cellsText(coreCells(empty as never, 150, ui, 5))).not.toContain('contract');
  });
  test('f0061: 1 dispatch open and 1 agent running is one fact: the band says `1 running`, not both', () => {
    const rowsOf = (live: unknown[]) => ((bandTree(els, { snapshot: busySnap({ sessionId: SESSION, todos: doneStore('in_progress').map((t) => (t.status === 'completed' && t.origin === 'session' ? { ...t, status: 'pending' } : t)) } as never), live, gates: [], columns: 150, tick: 0, maxRows: 12, ui, core: null } as never) as unknown as Node).props.children as Node[]).map(text);
    const out = rowsOf([{ name: 'gamma-explorer', role: 'explorer', state: 'working', tool: 'Read', lastTool: null, target: null, lastLine: '', calls: [], startedAt: NOW - 5000, since: NOW - 5000 }]).join('\n');
    expect(out).toContain('running');
    expect(out).not.toContain('dispatch open');
  });
  test('an open dispatch row with no worker running still reads `n dispatch open` (Stop refuses on it)', () => {
    expect(rows(idle({ todos: doneStore('pending') }), [], 150, core(0)).join('\n')).toContain('5/5 · 1 dispatch open');
  });
});

describe('critique 12 B2: the routing verdict has one source', () => {
  const routes = [{ teamId: 'in-process:audit/low', name: 'in-process', cls: 'audit', effort: 'low', isolation: '', maxParallel: 3, transport: 'in-process', drift: ['explorer ran 3, seat plans 1'], seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku'] }] }];
  const driftCore = { ...core(0), routes };
  const gates = [grp('completion', true), grp('routing', true)];
  test('core drift makes the routing check warn on the band, the same group the gates tab shows', () => {
    const done = idle({ todos: doneStore(), activity: lead(null, 'done') });
    expect(rows(done, gates, 150, core(0)).join('\n')).not.toContain('△ routing');
    expect(rows(done, gates, 150, driftCore).join('\n')).toContain('△ routing');
  });
  test('withCoreTally adds the drift line to the routing group only when a route drifted', () => {
    expect(gateTally(withCoreTally(gates as never, core(0) as never) as never).green).toBe(2);
    const t = gateTally(withCoreTally(gates as never, driftCore as never) as never);
    expect([t.green, t.total, t.failing]).toEqual([1, 2, ['routing']]);
  });
});

describe('B4: one warning mark and one layout at every width', () => {
  const gates = [grp('completion', false), grp('tripwire', true), grp('routing', true), grp('header', false)];
  const done = (over: Record<string, unknown> = {}) => idle({ todos: doneStore(), activity: lead(null, 'done'), ...over });
  const glyphsOf = (out: string[], word: string): string => out.filter((l) => l.includes(word)).join('');
  test('the band head and the checks row mark a failing check with the same glyph', () => {
    const out = rows(done(), gates, 150, core(0));
    expect(gateTally(gates as never).green).toBe(2);
    expect(out[0]).toContain('gates '); // wave 32: the band head says `gates n/m` (no △); the checks row keeps its own mark
    const checks = glyphsOf(out, ' checks ');
    expect(checks).toContain('△ completion');
    expect(checks).not.toContain('■');
  });
  test('110 and 150 draw the same rows: head, the core row carrying the last run, checks, keys', () => {
    const shape = (cols: number): number => rows(done(), gates, cols, core(0)).length;
    expect(shape(110)).toBe(shape(150));
    const wide = rows(done({ todos: doneStore() }), gates, 110, { ...core(0), contract: { ...core(0).contract, evidence: { ok: 5, total: 5 } } });
    expect(wide.join('\n')).toContain('last run');
  });
});
