// The core view (g): four section heads, the REFUTED verdict row, a press toggles it, the expanded row shows its evidence.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { coreFixture, coreMatrix } from '../../contracts/core-fixture';
import { coreModel, type CoreModel } from '../data/core';
import { busySnap } from '../live_fixture';
import { TONE_HEX as T } from '../mission-layout';
import { textWidth } from '../theme';
import { coreRows } from './sidebar-core';
import type { SidebarHandlers, SidebarModel } from './sidebar-types';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];

const pressed: string[] = [];
const on = { toggle: (k: string) => pressed.push(k), copy() {} } as unknown as SidebarHandlers;
const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 0 });
const model = (expanded: string | null = null, withCore = true): SidebarModel => ({
  snapshot: busySnap({ phase: 'implement' }), gates: [], core: withCore ? core : null,
  ui: { recipient: null, expanded, draft: '', view: 'gates' }, columns: 80, rows: 40,
});
const rows = (m: SidebarModel, inner = 70): Node[] => coreRows(els, m, on, inner) as unknown as Node[];

describe('core view', () => {
  test('all four section heads, dim lowercase labels', () => {
    const out = rows(model()).map(textOf).join('\n');
    for (const h of ['contract  ', 'verdicts  ', 'offload  ', 'route  ']) expect(out).toContain(h);
    expect(out).not.toMatch(/CONTRACT|VERDICTS|OFFLOAD|ROUTE/);
  });
  test('the rejected verdict row reads refuted, the verified one verified', () => {
    const out = rows(model()).map(textOf);
    expect(out.find((r) => r.includes('mean-iterable'))).toContain('refuted');
    expect(out.find((r) => r.includes('mean-fix'))).toContain('verified');
  });
  test('pressing a verdict row toggles its key; expanded it shows the evidence', () => {
    const button = rows(model()).find((r) => r.kind === 'Button' && textOf(r).includes('mean-iterable'))!;
    button.props.onPress();
    expect(pressed).toEqual(['core:v:mean-iterable']);
    const open = rows(model('core:v:mean-iterable')).map(textOf).join('\n');
    expect(open).toContain('evidence:');
    expect(open).toContain('TypeError: object of type');
    expect(rows(model()).map(textOf).join('\n')).not.toContain('evidence:');
  });
  test('every row fits the inner width', () => {
    for (const inner of [40, 56, 70]) for (const r of rows(model('core:v:mean-iterable'), inner)) expect(textWidth(textOf(r))).toBeLessThanOrEqual(inner);
  });
  test('without core data the view says so', () => {
    expect(rows(model(null, false)).map(textOf).join('\n')).toContain('no verdicts, workers or gates yet');
    expect(all(rows(model(null, false))[0]!).length).toBeGreaterThan(0);
  });
});

// ---- hand-built model: exact rows, limits and flags (mutation-driven) ----
const empty = (): CoreModel => ({
  contract: { header: { ok: 0, total: 0 }, evidence: { ok: 0, total: 0 }, verifiedDone: { ok: 0, total: 0 }, openGates: 0 },
  verdicts: [], claims: [],
  ledger: { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 },
  offload: { workers: [], kept: 0, returned: 0, ratio: null },
  routes: [],
});
const withCore = (c: CoreModel, inner = 100, expanded: string | null = null): Node[] =>
  coreRows(els, { ...model(expanded), core: c }, on, inner) as unknown as Node[];
const keyed = (rs: Node[], key: string): Node => rs.find((r) => r.props.key === key)!;
const verdict = (id: string, status: 'verified' | 'rejected' | 'needs-evidence', over: Record<string, unknown> = {}) =>
  ({ id, status, title: `title of ${id}`, by: 'atlas:verifier', at: 1, evidence: 'ran it', ...over });
const claim = (owner: string, over: Record<string, unknown> = {}) => ({ owner, role: 'implementer', status: 'DONE', at: 5, matched: null, ...over });

describe('core view: contract row', () => {
  const contract = (c: CoreModel) => keyed(withCore(c), 'core:h:contract');
  const withVerdict = (): CoreModel => ({ ...empty(), verdicts: [verdict('v1', 'verified')] as any });
  test('one line of plain figures: `contract  header 3/4 · evidence 2/2 · verified none`', () => {
    const c = withVerdict();
    c.contract = { header: { ok: 3, total: 4 }, evidence: { ok: 2, total: 2 }, verifiedDone: { ok: 0, total: 0 }, openGates: 0 };
    expect(textOf(contract(c))).toBe('contract  header 3/4 · evidence 2/2 · verified none');
  });
  test('only a partial tally takes colour (amber); complete stays plain text, empty is muted', () => {
    const c = withVerdict();
    c.contract = { header: { ok: 3, total: 4 }, evidence: { ok: 2, total: 2 }, verifiedDone: { ok: 0, total: 0 }, openGates: 0 };
    const parts = kids(contract(c));
    expect(parts[0]!.props).toMatchObject({ children: 'contract  ', color: T.dim, bold: true });
    expect(parts[1]!.props).toMatchObject({ children: 'header 3/4', color: T.warn });
    expect(parts[3]!.props).toMatchObject({ children: 'evidence 2/2', color: T.text });
    expect(parts[5]!.props).toMatchObject({ children: 'verified none', color: T.muted });
  });
  test('a partial verified tally is amber, a complete one plain', () => {
    const c = withVerdict();
    c.contract.verifiedDone = { ok: 2, total: 2 };
    c.contract.evidence = { ok: 1, total: 3 };
    expect(textOf(contract(c))).toBe('contract  header none · evidence 1/3 · verified 2/2');
    const parts = kids(contract(c));
    expect(parts[3]!.props.color).toBe(T.warn);
    expect(parts[5]!.props.color).toBe(T.text);
  });
  test('open gates are not repeated here: the gate groups below carry them', () => {
    const c = withVerdict();
    c.contract.openGates = 1;
    expect(textOf(contract(c))).not.toContain('gate');
    expect(withCore(c).map((r) => r.props.key)).not.toContain('core:c:gates');
  });
  test('section heads are bold and every row Box holds its size', () => {
    const rs = withCore(withVerdict());
    expect(kids(keyed(rs, 'core:h:contract'))[0]!.props.bold).toBe(true);
    for (const r of rs.filter((x) => x.kind === 'Box')) expect(r.props.flexShrink).toBe(0);
  });
  test('blank spacers are one-space rows between the four sections', () => {
    const rs = withCore(withVerdict());
    for (const k of ['core:b1', 'core:b2', 'core:b3']) expect(textOf(keyed(rs, k))).toBe(' ');
    expect(rs.map((r) => r.props.key).filter((k) => /^core:b/.test(k))).toEqual(['core:b1', 'core:b2', 'core:b3']);
  });
});

describe('core view: verdict rows', () => {
  test('look per status, id padded to 16, bold only when refuted', () => {
    const c = empty();
    c.verdicts = [verdict('exactly-16-chars!', 'verified'), verdict('short', 'rejected'), verdict('maybe', 'needs-evidence')] as any;
    const rs = withCore(c);
    expect(textOf(keyed(rs, 'core:v:exactly-16-chars!'))).toBe('  ✓ exactly-16-cha… verified       title of exactly-16-chars!');
    expect(textOf(keyed(rs, 'core:v:short'))).toBe(`  ✗ ${'short'.padEnd(16)}${'refuted'.padEnd(14)} title of short`);
    expect(textOf(keyed(rs, 'core:v:maybe'))).toBe(`  ? ${'maybe'.padEnd(16)}needs evidence title of maybe`);
    const tone = (k: string) => kids(keyed(rs, k)).map((n) => n.props.color);
    expect(tone('core:v:short')).toEqual([T.bad, T.text, T.bad, T.muted]);
    expect(tone('core:v:exactly-16-chars!')).toEqual([T.ok, T.text, T.ok, T.muted]);
    expect(tone('core:v:maybe')).toEqual([T.warn, T.text, T.warn, T.muted]);
    const bold = (k: string) => kids(keyed(rs, k)).map((n) => n.props.bold);
    expect(bold('core:v:short')[2]).toBe(true);
    expect(bold('core:v:exactly-16-chars!')[2]).toBeFalsy();
    expect(bold('core:v:maybe')[2]).toBeFalsy();
  });
  test('only the last 8 verdicts show', () => {
    const c = empty();
    c.verdicts = Array.from({ length: 9 }, (_, i) => verdict(`v${i}`, 'verified')) as any;
    const keys = withCore(c).map((r) => r.props.key);
    expect(keys).not.toContain('core:v:v0');
    expect(keys).toContain('core:v:v1');
    expect(keys).toContain('core:v:v8');
  });
  test('the ledger figures drop zero open and unchecked counts and colour only what is off', () => {
    const c = empty();
    c.verdicts = [verdict('v', 'verified')] as any;
    c.ledger = { claimed: 1, verified: 1, refuted: 0, pending: 0, unchecked: 0 };
    expect(textOf(keyed(withCore(c), 'core:h:verdicts'))).toBe('verdicts  1 verified · 0 refuted');
    const quiet = kids(keyed(withCore(c), 'core:h:verdicts'));
    expect([quiet[1]!.props.color, quiet[3]!.props.color]).toEqual([T.ok, T.muted]);
    c.ledger = { claimed: 2, verified: 1, refuted: 1, pending: 3, unchecked: 4 };
    expect(textOf(keyed(withCore(c), 'core:h:verdicts'))).toBe('verdicts  1 verified · 1 refuted · 3 open · 4 unchecked');
    const off = kids(keyed(withCore(c), 'core:h:verdicts'));
    expect([off[3]!.props.color, off[5]!.props.color, off[7]!.props.color]).toEqual([T.bad, T.warn, T.warn]);
  });
  test('expanded detail names the matched claim owner, the verifier and the evidence', () => {
    const c = empty();
    c.verdicts = [verdict('a', 'verified', { evidence: '' }), verdict('b', 'verified', { by: 'someone' })] as any;
    c.claims = [claim('w1', { matched: 'b' })] as any;
    const a = withCore(c, 100, 'core:v:a').map((r) => r.props.key);
    expect(a).toContain('core:v:a:0');
    const text = (open: string, i: number) => textOf(keyed(withCore(c, 100, open), `${open}:${i}`));
    expect(text('core:v:a', 0)).toBe('      no worker claim before it');
    expect(text('core:v:a', 1)).toBe('      by atlas:verifier');
    expect(text('core:v:a', 2)).toBe('      evidence: none recorded');
    expect(text('core:v:b', 0)).toBe('      checks the done claim of w1');
    expect(text('core:v:b', 1)).toBe('      by someone');
    expect(text('core:v:b', 2)).toBe('      evidence: ran it');
  });
  test('DONE claims with no verdict get a warning row; matched, non-DONE ones do not', () => {
    const c = empty();
    c.verdicts = [verdict('a', 'verified')] as any;
    c.claims = [claim('lonely', { at: 9 }), claim('matched', { matched: 'a', at: 8 }), claim('failed', { status: 'FAILED', at: 7 })] as any;
    const rs = withCore(c);
    const keys = rs.map((r) => r.props.key);
    expect(keys).toContain('core:u:lonely:9');
    expect(keys).not.toContain('core:u:matched:8');
    expect(keys).not.toContain('core:u:failed:7');
    expect(textOf(keyed(rs, 'core:u:lonely:9'))).toBe(`  ⚠ ${'lonely'.padEnd(16)}unchecked: says done, no verdict yet`);
    expect(kids(keyed(rs, 'core:u:lonely:9'))[2]!.props.color).toBe(T.warn);
  });
  test('no verdicts but an unchecked claim shows the claim, not the "none" row', () => {
    const c = empty();
    c.claims = [claim('lonely')] as any;
    const keys = withCore(c).map((r) => r.props.key);
    expect(keys).toContain('core:u:lonely:5');
    expect(keys).not.toContain('core:v:none');
  });
  test('no verdicts and no claims shows the none row', () => {
    const c = empty();
    c.routes = [{ teamId: 't', name: '', cls: 'fix', effort: 'low', isolation: 'shared', maxParallel: 1, seats: [], drift: [] }];
    expect(textOf(keyed(withCore(c), 'core:v:none'))).toBe('  no verdict recorded yet');
  });
});

describe('core view: offload rows', () => {
  const worker = (name: string, over: Record<string, unknown> = {}) =>
    ({ name, role: 'implementer', model: 'claude-sonnet-5-5', brief: 0, peak: 58_800, kept: 912, returned: 1_200_000, costUsd: 0.159, finished: true, ...over });
  test('exact row: name 18, model 12 without claude-, tokens right-aligned to 6, cost', () => {
    const c = empty();
    c.offload = { workers: [worker('impl-1')] as any, kept: 2000, returned: 500, ratio: 4 };
    const rs = withCore(c);
    expect(textOf(keyed(rs, 'core:o:impl-1'))).toBe(`  ${'impl-1'.padEnd(18)}${'sonnet-5-5'.padEnd(12)}${'58.8k'.padStart(6)} held ${'912'.padStart(6)} kept ${'1.2M'.padStart(6)} back  $0.16`);
    expect(textOf(keyed(rs, 'core:h:offload'))).toBe('offload  2.0k kept in tmux → 500 back (4.0x)');
  });
  test('missing model reads "?", missing cost is blank, ratio of 10+ rounds', () => {
    const c = empty();
    c.offload = { workers: [worker('w', { model: null, costUsd: null })] as any, kept: 1, returned: 1, ratio: 12.6 };
    const rs = withCore(c);
    expect(textOf(keyed(rs, 'core:o:w'))).toBe(`  ${'w'.padEnd(18)}${'?'.padEnd(12)}${'58.8k'.padStart(6)} held ${'912'.padStart(6)} kept ${'1.2M'.padStart(6)} back`);
    expect(textOf(keyed(rs, 'core:h:offload'))).toBe('offload  1 kept in tmux → 1 back (13x)');
  });
  test('ratio exactly 10 rounds, null shows no ratio', () => {
    const c = empty();
    c.offload = { workers: [worker('w')] as any, kept: 1, returned: 1, ratio: 10 };
    expect(textOf(keyed(withCore(c), 'core:h:offload'))).toBe('offload  1 kept in tmux → 1 back (10x)');
    c.offload.ratio = null;
    expect(textOf(keyed(withCore(c), 'core:h:offload'))).toBe('offload  1 kept in tmux → 1 back');
  });
  test('only the last 8 workers show', () => {
    const c = empty();
    c.offload = { workers: Array.from({ length: 9 }, (_, i) => worker(`w${i}`)) as any, kept: 0, returned: 0, ratio: null };
    const keys = withCore(c).map((r) => r.props.key);
    expect(keys).not.toContain('core:o:w0');
    expect(keys).toContain('core:o:w1');
    expect(keys).toContain('core:o:w8');
  });
});

describe('core view: route rows', () => {
  const route = (teamId: string, over: Record<string, unknown> = {}) =>
    ({ teamId, name: 'meanfix', cls: 'fix', effort: 'low', isolation: 'shared', maxParallel: 1, seats: [], drift: [], ...over });
  const seat = (over: Record<string, unknown> = {}) => ({ role: 'implementer', count: 1, model: 'sonnet', effort: 'medium', ran: [], ...over });
  test('route line and its seat lines, name falls back to the team id', () => {
    const c = empty();
    c.routes = [route('t1', { seats: [seat()] }), route('t2', { name: '' })] as any;
    const rs = withCore(c);
    const keys = rs.map((r) => r.props.key);
    expect(keys.indexOf('core:r:t2')).toBeLessThan(keys.indexOf('core:r:t1'));
    expect(textOf(keyed(rs, 'core:r:t1'))).toBe('  fix/low  meanfix  shared, max 1');
    expect(textOf(keyed(rs, 'core:r:t2'))).toBe('  fix/low  t2  shared, max 1');
    expect(textOf(keyed(rs, 'core:r:t1:0'))).toBe('    → 1× implementer sonnet/medium  not run yet');
    expect(kids(keyed(rs, 'core:r:t1'))[1]!.props.bold).toBe(true);
    expect(kids(keyed(rs, 'core:r:t1'))[2]!.props.bold).toBeFalsy();
  });
  test('only the last 6 routes show, newest first', () => {
    const c = empty();
    c.routes = Array.from({ length: 7 }, (_, i) => route(`t${i}`)) as any;
    const keys = withCore(c).map((r) => r.props.key).filter((k) => /^core:r:t\d$/.test(k));
    expect(keys).toEqual(['core:r:t6', 'core:r:t5', 'core:r:t4', 'core:r:t3', 'core:r:t2', 'core:r:t1']);
  });
  test('seats that ran: unique models, tick when they match (or inherit), cross when not, drift flag', () => {
    const c = empty();
    c.routes = [route('t1', { drift: ['x'], seats: [
      seat({ ran: ['claude-sonnet-5-5', 'claude-sonnet-5-5'] }),
      seat({ ran: ['claude-haiku-5-5'] }),
      seat({ model: 'inherit', ran: ['claude-opus-5'] }),
      seat({ model: 'Sonnet', ran: ['claude-sonnet-5-5', 'claude-haiku-5-5'] }),
    ] }), route('t2', { seats: [seat({ ran: ['claude-haiku-5-5'] }), seat({ ran: ['claude-sonnet-5-5'] })] })] as any;
    const rs = withCore(c);
    expect(textOf(keyed(rs, 'core:r:t1'))).toBe('  fix/low  meanfix  shared, max 1  ✗ drift');
    expect(textOf(keyed(rs, 'core:r:t1:0'))).toBe('    → 1× implementer sonnet/medium  ran claude-sonnet-5-5 ✓ as planned');
    expect(textOf(keyed(rs, 'core:r:t1:1'))).toBe('    → 1× implementer sonnet/medium  ran claude-haiku-5-5 ✗ drift');
    expect(textOf(keyed(rs, 'core:r:t1:2'))).toBe('    → 1× implementer inherit/medium  ran claude-opus-5 ✓ as planned');
    expect(textOf(keyed(rs, 'core:r:t1:3'))).toBe('    → 1× implementer Sonnet/medium  ran claude-sonnet-5-5, claude-haiku-5-5 ✗ drift');
    // the mark and its word are green when the seat ran the planned model, red when it did not
    const mark = (k: string) => kids(keyed(rs, k)).at(-1)!.props;
    expect(mark('core:r:t1:0')).toMatchObject({ children: ' ✓ as planned', color: T.ok });
    expect(mark('core:r:t1:1')).toMatchObject({ children: ' ✗ drift', color: T.bad });
    expect(mark('core:r:t1:2')).toMatchObject({ children: ' ✓ as planned', color: T.ok });
    expect(mark('core:r:t2:0')).toMatchObject({ children: ' ✗ drift', color: T.bad });
    expect(mark('core:r:t2:1')).toMatchObject({ children: ' ✓ as planned', color: T.ok });
  });
  test('a route without drift has no drift flag', () => {
    const c = empty();
    c.routes = [route('t1')] as any;
    expect(textOf(keyed(withCore(c), 'core:r:t1'))).not.toContain('drift');
  });
});
