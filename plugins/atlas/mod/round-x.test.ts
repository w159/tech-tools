// round-x.test.ts: round X (critics/spec-x.md X1-X7): every Atlas view draws the status tab's widget set, no view invents data, idle is never empty, the pill breathes visibly in 256 colours and a chevron lives only in a chip.
import { describe, expect, test } from 'claude-code/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as statusFrame from './status-frame';
import { statusFrame as buildStatus } from './status-frame';
import { cardFrame } from './card-frame';
import { tabFrame, tabText, type TabIn, type TabId } from './tabs-frame';
import { uiFromEnv, type Run, type Ui } from './atlas-ui';
import type { Health, HealthCheck } from './idle-health';
import { IDLE_RAMP_256 } from './band-motion';
import { textWidth } from './theme';
import { gateValue } from './tabs-frame';
import { ribbonRow, type PanelModel } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { NOW } from './live_fixture';

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const checks: HealthCheck[] = [
  { id: 'completion', ok: true, lines: 1, pass: 1 }, { id: 'tripwire', ok: true, lines: 2, pass: 2 },
  { id: 'routing', ok: true, lines: 8, pass: 8 }, { id: 'header', ok: true, lines: 1, pass: 1 },
];
const NOTE = 'as of the last ingest (Stop, SubagentStop, PreCompact)';
const GROUPS = [
  { id: 'completion', title: 'Completion', lines: [{ id: 'm', label: 'Not an orchestrating session', ok: true, detail: 'Not an orchestrating session: only this condition applies' }] },
  { id: 'tripwire', title: 'Tripwire', lines: [{ id: 'a', label: 'Team mode', ok: true, detail: 'off' }, { id: 'b', label: 'Lead hands work to subagents', ok: true, detail: '0 direct calls since the last dispatch, limit 4' }] },
  { id: 'routing', title: 'Routing', lines: ['lean-ctx calls', 'context-mode calls', 'claude-mem calls', 'Native Read calls', 'Native Grep calls', 'Native Glob calls', 'Native Bash calls', 'Policy denies'].map((label, i) => ({ id: `r${i}`, label, ok: true, detail: `${i} ${NOTE}` })) },
  { id: 'header', title: 'Header', lines: [{ id: 'h', label: 'Last reply header matched', ok: true, detail: 'declared phase: research' }] },
];
const health = (o: Partial<Health> = {}): Health => ({
  gates: { total: 4, green: 4, checks }, version: '17.23.0', branch: 'master', team: 'off', upSecs: 185, ctxPct: 6, tokens: 64_000, window: 1_000_000,
  last: { secs: 5, done: 6, total: 6, agents: 0, failed: 0, endedAgo: 3 },
  hooks: { total: 12, byLabel: [{ label: 'tool.call', n: 6 }], lastEventSecs: 4, latency: { n: 12, p50: 3, p95: 5 }, recent: [{ label: 'tool.call Bash', ageSecs: 4, ms: 3 }, { label: 'turn.complete', ageSecs: 9, ms: 4 }, { label: 'session.measure', ageSecs: 10, ms: 1 }] },
  pulse: { events: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 2, 2, 0, 0, 0, 0, 1, 5, 2], ctx: [{ tokens: 52_000, pct: 5, at: 1 }, { tokens: 64_000, pct: 6, at: 2 }], runs: [{ secs: 33, ok: true, at: 1 }, { secs: 58, ok: false, at: 2 }] },
  ...o,
});
const tab = (t: TabId, cols: number, o: Partial<TabIn> = {}): TabIn => ({ tab: t, cols, room: 39, ui, kind: 'idle', health: health(), gates: GROUPS, workers: [], todos: [], notes: [], channel: 'c', people: 1, recipient: null, flips: [], lead: false, ...o });
const WIDTHS = [48, 41]; // the pane at 150 and at 110 columns
const text = (a: TabIn): string[] => tabText(tabFrame(a));

describe('X1: one widget set', () => {
  test('the old builders are gone: status-frame exports only the status tab\'s own sections', () => {
    for (const old of ['activityRows', 'contextRows', 'runsRows', 'gatesRows', 'hooksRows']) expect(Object.keys(statusFrame)).not.toContain(old);
    for (const f of ['statusActivityRows', 'statusContextRows', 'statusRunsRows', 'statusGatesRows', 'statusHooksRows', 'statusRecentRows']) expect(Object.keys(statusFrame)).toContain(f);
  });
  test('no source file keeps the old widgets\' texts (`0└5m`, `checks   ok fail`, `seen ·`)', () => {
    for (const f of ['status-frame.ts', 'tabs-frame.ts', 'card-frame.ts']) {
      const src = readFileSync(join(import.meta.dir, f), 'utf8');
      expect(src, f).not.toMatch(/0\$\{g\('└'|checks {3}ok fail|activityRows\(|contextRows\(|[^s]gatesRows\(|[^s]hooksRows\(/);
    }
  });
  // Y2b: a tab shows its own body and exactly ONE related shared section (the status tab's own builder): board RUNS, team ACTIVITY, channel RECENT, core GATES, gates HOOKS
  // AA7: tabs do not repeat each other: RECENT only on status and channel, core is routing data only (its ROUTING section needs routes), gates owns GATES and HOOKS
  const SHARED: Record<string, [string, RegExp] | null> = {
    team: ['ACTIVITY', /-\d+m +-[\d.]+m +now/], channel: ['RECENT', /\d+s · /], gates: ['HOOKS', /hook(?: · last 64 calls)? +n +p50(?: +p95)? +last|hooks wired/], core: null, board: ['RUNS', /\d:\d\d (ok|failed)/],
  };
  for (const cols of WIDTHS) for (const t of ['team', 'channel', 'gates', 'core', 'board'] as TabId[]) {
    test(`${t} at ${cols}: its own body plus ${SHARED[t] ? `the shared section ${SHARED[t]![0]}` : 'no shared section (AA7)'}, drawn by the status tab's builder`, () => {
      const rows = text(tab(t, cols, { workers: t === 'team' ? [{ name: 'w', state: 'running', detail: 'x', secs: 3 }] : [] }));
      const all = rows.join('\n');
      const ribbons = rows.filter((l) => /^ ── [A-Z]+ /.test(l)).map((l) => l.match(/^ ── ([A-Z]+) /)![1]!);
      if (!SHARED[t]) { expect(ribbons, `${t}@${cols}`).toEqual(['CORE']); return; }
      expect(ribbons.length, `${t}@${cols}`).toBeGreaterThanOrEqual(2); // the tab's own ribbon, then the shared section
      expect(ribbons[1]).toBe(SHARED[t]![0]);
      expect(ribbons.slice(2).every((x) => x === 'RECENT'), `${t}@${cols}`).toBe(t === 'channel' || ribbons.length === 2); // AA7: RECENT only on status and channel
      expect(all).toMatch(SHARED[t]![1]);
      expect(all).not.toMatch(/── CONTEXT |0└5m|checks +ok fail|\d+ seen · \d+ms|no calls/);
    });
  }
  test('the status tab, a tab and the card draw the same ACTIVITY chart for one width (one implementation)', () => {
    const h = health();
    const u = 46;
    const status = buildStatus({ cols: u + 2, room: 39, ui, kind: 'idle', phases: ['research', 'theory'], phase: 'research', spin: '◐', todos: { done: 0, total: 0 }, gates: GROUPS, health: h, lead: false });
    const chartRows = (rows: string[]): string[] => { const i = rows.findIndex((l) => l.includes('── ACTIVITY')); return rows.slice(i + 1, i + 5).map((l) => l.replace(/ +$/, '')); };
    const st = status.map((r) => r.map((x) => x.t).join('').trimEnd());
    const tb = text(tab('team', u + 2));
    const a = chartRows(st).slice(0, 3), b = chartRows(tb).slice(0, 3);
    expect(b[0]).toBe(a[0]); // the y gutter and the first chart row at the same width
    expect(st.join('\n')).toMatch(/── HOOKS /);
  });
  test('the card holds the same sections by the same names', () => {
    const t = cardFrame(health(), { cols: 150, ui }).map((r) => r.map((x) => x.t).join('')).join('\n');
    for (const s of ['ACTIVITY', 'CONTEXT', 'RUNS', 'GATES', 'HOOKS']) expect(t).toContain(`── ${s} `);
    expect(t).toMatch(/○ 4 gates armed · 0 checks yet|pass deny last/); // AA4: idle summarises
    expect(t).toMatch(/hooks wired|hook(?: · last 64 calls)? +n +p50(?: +p95)? +last/);
    expect(t).not.toMatch(/checks +ok fail|0└5m/);
  });
});

describe('X2: no invented rows; an empty tab is never a void', () => {
  const EMPTY = /○ T\d|○ w\d|·{3,}|--:--|worker +state|item +owner|time +from|check +figure|queued|last run/;
  // Y2b: an empty tab is its ribbon and ONE honest line (what appears, what triggers it); the shared section follows, never a filler line of figures
  for (const cols of WIDTHS) for (const [t, fact] of [['team', /no workers/], ['channel', /no notes/], ['core', /no verdicts/], ['board', /no items/]] as const) {
    test(`${t} at ${cols}: ribbon, one honest line \`${fact.source}\` that says what appears and when, no placeholder`, () => {
      const rows = text(tab(t, cols));
      const all = rows.join('\n');
      expect(all).toMatch(fact);
      expect(all).toMatch(/(?:appear|adds?)/);
      expect(rows.filter((l) => !/0┤/.test(l)).join('\n')).not.toMatch(EMPTY); // the chart baseline's `·` lead is not a placeholder
      expect(rows.at(-1)).toMatch(/^ +atlas /);
    });
  }
  test('no word is cut: the board line shortens before it is cut', () => {
    for (const cols of [48, 41, 38]) { const t = text(tab('board', cols)); expect(t.slice(0, 3).join('\n'), String(cols)).not.toMatch(/…/); expect(t.slice(1, 3).join(' ')).toMatch(/no items(?: yet)? · (?:items )?(?:appear|a plan adds)/); }
  });
});

describe('X3: gates tab rows', () => {
  const rows = (cols: number, extra: Partial<TabIn> = {}): string[] => text(tab('gates', cols, { kind: 'working', room: 60, ...extra }));
  test('a group row carries the status table\'s columns (pass deny last) under one rule', () => {
    const t = rows(48);
    expect(t.find((l) => l.includes('── GATES'))).toMatch(/pass deny last$/);
    expect(t.find((l) => /completion/.test(l))).toMatch(/[▸▾] +[●○] completion +\d +\d +(—|\d+[smh])$/);
  });
  test('a child row is `├ ● label` and a short value at the right: a figure, off, ok or the dash; never a sentence', () => {
    for (const cols of WIDTHS) {
      const t = rows(cols);
      const children = t.filter((l) => /^\s+[├└] [●○■] /.test(l));
      expect(children.length).toBeGreaterThanOrEqual(10);
      for (const l of children) {
        const value = l.trimEnd().split(' ').at(-1)!;
        expect(textWidth(value), l).toBeLessThanOrEqual(8);
        expect(value, l).toMatch(/^(\d+(\/\d+| open)?|on|off|ok|deny|—|[a-z]{1,8})$/);
      }
    }
  });
  test('text shared by every row appears once, as a dim note under the group', () => {
    for (const cols of WIDTHS) {
      const t = rows(cols);
      expect(t.filter((l) => l.includes('as of the last ingest')), String(cols)).toHaveLength(1);
      expect(t.join('\n')).not.toMatch(/Not an orchestrat…|0 direct calls si…|as of the last…/);
    }
  });
  test('labels keep at least 22 cells before any cut, and a cut is at the end with `…`', () => {
    for (const cols of WIDTHS) {
      const t = rows(cols);
      const lead = t.find((l) => l.includes('Lead hands work to subag'))!;
      expect(lead.match(/Lead hands work to subag\S*/)![0].length).toBeGreaterThanOrEqual(22);
      for (const l of t.filter((x) => x.includes('…'))) expect(l).toMatch(/…\s+\S+$/);
    }
  });
  test('a failing line shows `deny`, its sentence under it, then the fix', () => {
    const bad = GROUPS.map((g) => (g.id === 'routing' ? { ...g, lines: [...g.lines.slice(0, 4), { id: 'x', label: 'Native Grep calls', ok: false, detail: '2 calls denied', fix: 'use ctx_search' }] } : g));
    const t = rows(48, { gates: bad, health: health({ gates: { total: 4, green: 3, checks: checks.map((c) => (c.id === 'routing' ? { ...c, ok: false, pass: 7 } : c)), denied: 2 } }) });
    const i = t.findIndex((l) => /■ Native Grep calls +deny$/.test(l));
    expect(i).toBeGreaterThan(0);
    expect(t[i + 1]).toMatch(/2 calls denied$/);
    expect(t[i + 2]).toMatch(/fix: use ctx_search$/);
  });
  test('gateValue: figures with their unit, never a sentence', () => {
    expect(gateValue({ label: 'Team mode', ok: true, detail: 'off' })).toBe('off');
    expect(gateValue({ label: 'x', ok: true, detail: '3 as of the last ingest (Stop)' })).toBe('3');
    expect(gateValue({ label: 'x', ok: true, detail: '0 direct calls since the last dispatch, limit 4' })).toBe('0/4');
    expect(gateValue({ label: 'x', ok: true, detail: '2 of 5 done with evidence' })).toBe('2/5');
    expect(gateValue({ label: 'x', ok: true, detail: '3 open' })).toBe('3 open');
    expect(gateValue({ label: 'x', ok: true })).toBe('ok');
    expect(gateValue({ label: 'x', ok: false, detail: 'whatever sentence' })).toBe('deny');
  });
  test('group rows are chips with `▸`/`▾`; leaf rows carry no chevron', () => {
    const f = tabFrame(tab('gates', 48, { kind: 'working', room: 60 }));
    for (const l of f) {
      const t = l.runs.map((x) => x.t).join('');
      if (/^\s+[├└│]/.test(t)) expect(t).not.toMatch(/[▸▾]/);
      if (/[▸▾] [●○■] \w+/.test(t)) expect(l.runs.some((x) => x.bgHex !== undefined && x.hover === true)).toBe(true);
    }
  });
});

describe('X4: the card grid', () => {
  const rowsOf = (cols: number, h = health()): string[] => cardFrame(h, { cols, ui }).map((r) => r.map((x) => x.t).join(''));
  test('150: two equal columns, a 3-cell gutter, ACTIVITY and GATES on one row, CONTEXT and HOOKS on one row', () => {
    const t = rowsOf(150);
    const u = Math.floor((150 - 4) / 2) - 1;
    const a = t.find((l) => l.includes('── ACTIVITY'))!;
    expect(a.indexOf('── GATES') - a.indexOf('── ACTIVITY')).toBe(u + 1 + 3);
    const c = t.find((l) => l.includes('── CONTEXT'))!;
    expect(c).toContain('── HOOKS');
    expect(c.indexOf('── HOOKS')).toBe(a.indexOf('── GATES'));
  });
  test('padding: a short first section pushes the next one down in every column', () => {
    const few = health({ gates: { total: 1, green: 1, checks: [{ id: 'completion', ok: true, lines: 1, pass: 1 }] } });
    const t = rowsOf(150, few);
    expect(t.findIndex((l) => l.includes('── CONTEXT'))).toBe(t.findIndex((l) => l.includes('── HOOKS')));
  });
  test('110: one column; no row is cut mid-word at 150 or 110', () => {
    const t = rowsOf(110);
    expect(t.find((l) => l.includes('── ACTIVITY'))).not.toContain('── GATES');
    for (const cols of [150, 110, 120]) {
      const all = rowsOf(cols).join('\n');
      expect(all, String(cols)).not.toContain('…');
      for (const word of ['completion', 'tripwire', 'routing', 'header', 'session.start', 'prompt.submit', 'tool.call', 'classic.Stop', 'session.measure', 'turn.complete']) expect(all, `${cols} ${word}`).toContain(word);
      for (const l of rowsOf(cols)) expect(textWidth(l)).toBeLessThanOrEqual(cols);
    }
  });
  test('the title is one `▾ HEALTH` chip and a rule, with no pill', () => {
    const r = cardFrame(health(), { cols: 150, ui })[0]!;
    expect(r.map((x) => x.t).join('').trim()).toMatch(/^▾ HEALTH +─+$/);
    expect(r.find((x) => x.t.includes('HEALTH'))).toMatchObject({ press: 'band:health', hover: true });
    expect(r.map((x) => x.t).join('')).not.toContain('ATLAS');
  });
});

describe('X6: the 256-colour breath', () => {
  test('eight distinct xterm violets from dark to light', () => {
    expect(IDLE_RAMP_256).toEqual([54, 55, 91, 97, 135, 141, 177, 183]);
    expect(new Set(IDLE_RAMP_256).size).toBeGreaterThanOrEqual(6);
  });
  test('FRAME_MS stays at or under 100', () => {
    const src = readFileSync(join(import.meta.dir, 'band-motion.ts'), 'utf8');
    expect(Number(src.match(/FRAME_MS\s*=\s*(\d+)/)?.[1] ?? 100)).toBeLessThanOrEqual(100);
  });
});

describe('X7: a chevron only inside a chip', () => {
  const chevrons = (rows: readonly (readonly Run[])[]): Run[] => rows.flat().filter((x) => /[▸▾]/.test(x.t));
  test('tabs: every `▸`/`▾` run is a chip fill', () => {
    for (const cols of WIDTHS) for (const t of ['team', 'channel', 'gates', 'core', 'board'] as TabId[]) {
      const f = tabFrame(tab(t, cols, { kind: 'working', room: 60, workers: t === 'team' ? [{ name: 'w', state: 'running', detail: 'x', secs: 3 }] : [], todos: t === 'board' ? [{ id: 'a', label: 'do it', state: 'running' }] : [] }));
      for (const x of chevrons(f.map((l) => l.runs))) expect(x.bgHex, `${t} ${cols} ${x.t}`).toBeDefined();
    }
  });
  test('card: the only chevron is the title chip', () => {
    const c = chevrons(cardFrame(health(), { cols: 150, ui }));
    expect(c).toHaveLength(1);
    expect(c[0]!.bgHex).toBeDefined();
  });
  test('the pane header keeps `▸ SIDEPANEL` as a dim breadcrumb (not a chip); the strip overflow is `more ›`', () => {
    const m = panelWorld('gates', 48, ui, { rows: 39, run: { kind: 'idle', secs: 0, startMs: NOW, frame: 0 } } as never) as PanelModel;
    const r = ribbonRow(m).runs;
    const crumb = r.find((x) => x.t === ' ▸ ')!;
    expect(crumb).toMatchObject({ tone: 'dim' });
    expect(crumb.bgHex).toBeUndefined();
    expect(r.map((x) => x.t).join('')).toContain('◖ ◆ ATLAS ◗ ▸ SIDEPANEL');
  });
});

describe('X5: the band at the pane-open width keeps state, gates chip and the spark with its unit', async () => {
  const { bandTree } = await import('./band');
  const { busySnap } = await import('./live_fixture');
  type N = { kind: string; props: Record<string, any> };
  const mk = (kind: string) => (props: Record<string, any>): N => ({ kind, props });
  const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as never;
  const kids = (n: N): N[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is N => typeof x === 'object' && x !== null); };
  const textOf = (n: N): string => (n.kind === 'Text' || typeof n.props.children === 'string' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
  const g = (id: string) => ({ id, title: id, lines: [{ id, label: id, ok: true }] }) as never;
  const bandRow = (columns: number): string => {
    const snapshot = busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 6 } as never);
    const hs = { upSecs: 13, version: '17.24.0', branch: 'master', tokens: 64_000, window: 1_000_000, panel: true, open: false, hooks: { total: 3, byLabel: [{ label: 'tool.call', n: 3 }], recent: [], lastEventSecs: 2, runTools: 3 }, pulse: { events: [0, 0, 0, 0, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 5, 1], ctx: [], runs: [] } };
    const tree = bandTree(els, { snapshot, live: [], gates: ['a', 'b', 'c', 'd'].map(g), columns, tick: 0, maxRows: 12, ui, health: hs } as never, { openView() {}, toggleTodos() {}, toggleHealth() {} }) as unknown as N;
    return textOf(kids(tree)[0]!);
  };
  for (const cols of [57, 58, 60]) test(`idle at ${cols} cells with the pane open`, () => {
    const row = bandRow(cols);
    expect(textWidth(row)).toBeLessThanOrEqual(cols);
    expect(row).toContain('◌ idle');
    expect(row).toContain('gates');
    expect(row).toMatch(/[▁-█]{8}/); // AA2: the 8-cell spark fits from 53 cells
  });
});
