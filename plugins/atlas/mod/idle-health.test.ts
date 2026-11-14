// Idle health (wave 42): with no run yet the band, the HUD and the side panel show a small live health summary instead of empty placeholders
// (`todo -`, `no agents`, `no tasks yet`, `no agents yet`), and a clickable `▸ health` control expands it.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree, type BandHandlers, type BandModel } from './band';
import { liveWorkers } from './data/live';
import { busySnap, NOW } from './live_fixture';
import { uiFromEnv } from './atlas-ui';
import { healthCardRows, todoRows, agentRows } from './hud-surface';
import { bodyLines, lineText, type PanelModel } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { textWidth } from './theme';
import { composeSlot } from './slot';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
const textOf = (n: Node): string => (n.kind === 'Text' || typeof n.props.children === 'string' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const buttons = (n: Node): Node[] => all(n).filter((x) => x.kind === 'Button');

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const calls: string[] = [];
const handlers: BandHandlers = { openView: (v) => calls.push(`open:${v}`), toggleTodos: () => calls.push('board'), toggleHealth: () => calls.push('health') };
const green = (id: 'completion' | 'tripwire' | 'routing' | 'header') => ({ id, title: id, lines: [{ id, label: id, ok: true }] }) as any;
const GATES = [green('completion'), green('tripwire'), green('routing'), green('header')];
const HEALTH = { upSecs: 724, version: '17.21.1', branch: 'main', tokens: 42_000, open: false };
const idleSnap = (over: Record<string, unknown> = {}) => busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 18, ...over } as never);
const model = (columns: number, over: Partial<BandModel> = {}): BandModel => ({ snapshot: idleSnap(), live: [], gates: GATES, columns, tick: 0, maxRows: 12, ui, health: HEALTH, ...over });
const firstRow = (b: BandModel, on: BandHandlers | null = handlers): string => textOf(kids(bandTree(els, b, on ?? undefined) as unknown as Node)[0]!);

describe('idle band shows live health', () => {
  for (const cols of [150, 110]) {
    test(`at ${cols}: idle, gates, ctx and the health button replace \`todo -\` and \`no agents\``, () => {
      const row = firstRow(model(cols));
      expect(row).toContain('◖ ◆ ATLAS ◗ ○ idle');
      expect(row).toContain('● gates 4/4');
      expect(row).toContain('ctx 18%');
      expect(row).toContain('▸ health');
      expect(row).not.toContain('todo -');
      expect(row).not.toContain('no agents');
      expect(textWidth(row)).toBeLessThanOrEqual(cols);
    });
  }
  test('at 150 the tokens, the uptime and the version-free summary all show', () => {
    const row = firstRow(model(150));
    expect(row).toContain('ctx 18% · 42k tok');
    expect(row).toContain('up 12:04');
  });
  test('a failed gate reads ■ and the count', () => {
    const bad = [...GATES.slice(0, 3), { id: 'header', title: 'header', lines: [{ id: 'header', label: 'header', ok: false }] }] as any;
    expect(firstRow(model(150, { gates: bad }))).toContain('■ gates 3/4');
  });
  test('an unknown context is omitted, never made up', () => {
    const row = firstRow(model(150, { snapshot: idleSnap({ contextPct: 0 }), health: { ...HEALTH, tokens: null } }));
    expect(row).not.toContain('ctx');
    expect(row).not.toContain('tok');
    expect(row).toContain('up 12:04');
  });
  test('a run that ended this session adds `last run`', () => {
    const row = firstRow(model(150, { ranSecs: 134, restSecs: 40 }));
    expect(row).toContain('last run 2:14');
  });
  test('the uptime ticks', () => {
    expect(firstRow(model(150, { health: { ...HEALTH, upSecs: 725 } }))).toContain('up 12:05');
  });
});

describe('the health button', () => {
  const btn = (b: BandModel): Node => {
    const x = buttons(bandTree(els, b, handlers) as unknown as Node).find((n) => n.props.key === 'band:health');
    if (!x) throw new Error('no health button');
    return x;
  };
  test('closed it reads ▸ health, open ▾ health: the toggle flips the chevron', () => {
    expect(textOf(btn(model(150)))).toBe('▸ health');
    expect(textOf(btn(model(150, { health: { ...HEALTH, open: true } })))).toBe('▾ health');
  });
  test('it is distinguishable: accent text, a chevron, a hover style', () => {
    const b = btn(model(150));
    const text = all(b).find((n) => n.kind === 'Text')!;
    expect(text.props.color).toBeTruthy();
    expect(text.props.bold).toBe(true);
    expect(text.props.hover?.backgroundColor).toBeTruthy();
    expect(text.props.hover?.scope).toBeTruthy();
  });
  test('pressing it calls toggleHealth', () => {
    calls.length = 0;
    btn(model(150)).props.onPress();
    expect(calls).toEqual(['health']);
  });
  test('with no handlers wired (omp, fixtures) no button is drawn', () => {
    expect(firstRow(model(150), null)).not.toContain('health');
  });
});

describe('the working band is unchanged', () => {
  const working = (columns: number, health: boolean): string => {
    const snapshot = busySnap();
    return firstRow({ snapshot, live: liveWorkers(snapshot, NOW), gates: GATES, columns, tick: 0, maxRows: 12, ui, ...(health ? { health: HEALTH } : {}) });
  };
  for (const cols of [150, 110]) {
    test(`at ${cols} a running band reads the same with or without health input`, () => {
      expect(working(cols, true)).toBe(working(cols, false));
      expect(working(cols, true)).not.toContain('health');
    });
  }
  test('golden: the 150 working band row', () => {
    expect(working(150, true).trimEnd()).toBe(WORKING_150);
  });
});
const WORKING_150 = '◖ ◆ ATLAS ◗ ◐ working 0:42 ▌ todo ▰▰▰▱▱▱▱▱▱▱ 1/4 ■1 ▌ ◐ 1 running · ■1';

describe('the expanded health card (HUD)', () => {
  const h = { gates: { total: 4, green: 4, checks: ['completion', 'tripwire', 'routing', 'header'].map((id) => ({ id, ok: true })) }, ctxPct: 18, tokens: 42_000, upSecs: 724, branch: 'main', version: '17.21.1', open: true };
  const text = (over: Record<string, unknown> = {}): string[] => healthCardRows({ ...h, ...over } as never, { cols: 110, ui }).map((r) => r.map((x) => x.t).join(''));
  test('ribbon, rows and closing rule', () => {
    const t = text();
    expect(t[0]).toContain('◖ ◆ ATLAS ◗ ▸ HEALTH');
    expect(t.some((l) => /hooks\s+● loaded · atlas 17\.21\.1/.test(l))).toBe(true);
    expect(t.some((l) => /gates\s+● completion ● tripwire ● routing ● header\s+4\/4/.test(l))).toBe(true);
    expect(t.some((l) => /session\s+up 12:04 · ctx 18% · 42k tokens · branch main/.test(l))).toBe(true);
    expect(t.some((l) => /last run\s+none this session/.test(l))).toBe(true);
    expect(t[t.length - 1]).toMatch(/^╰─+╯$/);
  });
  test('a finished run fills the last-run row', () => {
    const t = text({ last: { secs: 134, done: 5, total: 5, agents: 3, failed: 0, endedAt: '9:27 PM' } });
    expect(t.some((l) => /last run\s+2:14 · 5\/5 todos · 3 agents · 0 failed · ended 9:27 PM/.test(l))).toBe(true);
  });
  test('only values the mod has: no ctx, no tokens, no branch', () => {
    const t = text({ ctxPct: undefined, tokens: undefined, branch: undefined }).join('\n');
    expect(t).not.toContain('ctx');
    expect(t).not.toContain('tokens');
    expect(t).not.toContain('branch');
  });
});

describe('empty HUD boxes say what will appear, with the live summary', () => {
  const o = { cols: 110, ui, reserve: true, healthLine: '● gates 4/4 · ctx 18%' };
  test('TODO and SUBAGENTS', () => {
    const todo = todoRows([], o as never, { spacers: false, extras: false }).map((r) => r.map((x) => x.t).join('')).join('\n');
    const subs = agentRows([], o as never, { spacers: false, extras: false }).map((r) => r.map((x) => x.t).join('')).join('\n');
    for (const s of [todo, subs]) {
      expect(s).not.toMatch(/no tasks yet|none running yet/);
      expect(s).toContain('● gates 4/4 · ctx 18%');
    }
    expect(todo).toContain('plan rows appear here');
    expect(subs).toContain('agents appear here');
  });
});

describe('the side panel status view, idle', () => {
  const health = { gates: { total: 4, green: 4, checks: ['completion', 'tripwire', 'routing', 'header'].map((id) => ({ id, ok: true })) }, ctxPct: 18, tokens: 42_000, upSecs: 724, branch: 'main', version: '17.21.1' };
  const world = (over: Partial<PanelModel> = {}): PanelModel => panelWorld('route', 57, ui, { rows: 40, todos: [], workers: [], gates: [], notes: [], run: { kind: 'idle', secs: 0, startMs: NOW }, health, ...over } as never);
  const rows = (m: PanelModel) => bodyLines(m);
  test('health rows replace the bare placeholders', () => {
    const t = rows(world()).map(lineText).join('\n');
    expect(t).not.toMatch(/no agents yet|no events yet/);
    for (const label of ['hooks', 'gates', 'session', 'last run']) expect(t).toContain(label);
    expect(t).toContain('up 12:04');
  });
  test('each row is pressable and shows the closed chevron', () => {
    const ls = rows(world()).filter((l) => l.press?.key.startsWith('health:'));
    expect(ls.map((l) => l.press!.key)).toEqual(['health:hooks', 'health:gates', 'health:session', 'health:last']);
    for (const l of ls) expect(lineText(l)).toContain('▸');
    expect(rows(world()).map(lineText).join('\n')).not.toContain('completion green'); // closed: no detail lines
  });
  test('an open row shows ▾ and 1-3 detail lines', () => {
    const t = rows(world({ expanded: 'health:gates' })).map(lineText);
    const i = t.findIndex((l) => l.includes('▾') && l.includes('gates'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(t.slice(i + 1, i + 5).join('\n')).toMatch(/completion\s+green/);
    const s = rows(world({ expanded: 'health:session' })).map(lineText).join('\n');
    expect(s).toContain('42,000 tokens');
    expect(s).toContain('18% of context');
  });
  test('with a worker listed the status view is unchanged (no health rows)', () => {
    const t = rows(world({ workers: panelWorld('route', 57, ui).workers })).map(lineText).join('\n');
    expect(t).not.toContain('health:');
    expect(t).not.toMatch(/hooks\s+●/);
  });
});

describe('the slot draws the open card while idle', () => {
  const hudIn = { todos: [], agents: [], root: '/tmp/proj', phases: { ids: ['plan'], active: 0 } };
  const bandIn = (rows: unknown[], maxRows: number | undefined): BandModel => model(110, { maxRows: maxRows ?? 12 });
  const input = (card?: never[][]) => ({ budget: 14, hasSlot: true, hudOn: true, runOn: false, columns: 110, hudIn, hudView: { cols: 110, tick: 0, ui }, running: false, agentsListed: false, orchestrated: false, now: NOW, bandIn, held: 0, ...(card ? { healthCard: card } : {}) }) as never;
  test('closed: no HUD rows; open: the card rows stand in the HUD', () => {
    expect(composeSlot(input()).hud).toHaveLength(0);
    const card = [[{ t: '◖ ◆ ATLAS ◗ ▸ HEALTH' }], [{ t: 'hooks' }]] as never[][];
    expect(composeSlot(input(card)).hud).toHaveLength(2);
  });
});
