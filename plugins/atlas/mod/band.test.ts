// Mission Control band: filled truecolor panel, width tiers, row budget, idle state, chips, sparkline.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree, planRows, shortTool } from './band';
import { callBuckets, liveWorkers } from './data/live';
import { pushCall } from './data/orchestration';
import { busySnap, NOW } from './live_fixture';
import { MOCHA, textWidth } from './theme';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const cells = (row: Node): Node[] => row.props.children as Node[];
const text = (row: Node): string => cells(row).map((t) => t.props.children).join('');
const gate = { id: 'completion' as const, title: 'Gates', lines: [{ ok: false, label: 'x' }] } as any;

/** Panel -> its row Boxes and their text. */
const panel = (columns: number, over: Record<string, unknown> = {}) => {
  const snapshot = (over.snapshot as ReturnType<typeof busySnap>) ?? busySnap();
  const live = (over.live as any) ?? liveWorkers(snapshot, NOW);
  const node = bandTree(els, { snapshot, live, gates: [], columns, tick: 3, maxRows: 12, costUsd: 0.41, ...over } as any) as unknown as Node;
  const rowNodes = node.props.children as Node[];
  const rows = rowNodes.map(text);
  return { node, rowNodes, rows, all: rows.join('\n') };
};
const idleSnap = () => busySnap({ squad: [], activity: {}, comms: [] });
const laneOf = (rowNodes: Node[], name: string): Node => rowNodes.find((r) => text(r).includes(name))!;

const boardTodos = [
  { id: 'a', content: 'map the auth flow', status: 'completed', owner: 'explorer-1', evidence: '1. rg auth -> 3 hits' },
  { id: 'b', content: 'edit auth middleware', status: 'in_progress', owner: 'impl-auth' },
  { id: 'c', content: 'add ttl config', status: 'pending' },
];

describe('band board panel', () => {
  test('collapsed bar sits under the rail and costs one row', () => {
    const base = panel(160).rows;
    const { rows } = panel(160, { snapshot: busySnap({ todos: boardTodos as any }) });
    expect(rows).toHaveLength(base.length + 1);
    expect(rows[2]).toContain('1/3');
    expect(rows[2]).toContain('impl-auth: edit auth middleware');
  });
  test('expanded lists every item', () => {
    const { rows } = panel(160, { snapshot: busySnap({ todos: boardTodos as any }), todoExpanded: true, maxRows: 14 });
    expect(rows.slice(2, 5).map((r) => r.trim().slice(0, 1))).toEqual(['✔', expect.any(String), '○']);
  });
});

describe('Mission Control band', () => {
  test('full tier: filled panel with gradient title, rail, lanes, ticker and footer', () => {
    const { node, rows, all } = panel(160, { gates: [gate] });
    expect(node.props.backgroundColor).toBe(MOCHA.panel);
    expect(node.props.borderStyle).toBeUndefined();
    expect(rows[0]).toContain('◆ ATLAS');
    expect(rows[0]).toContain('mission control');
    expect(rows[0]).toMatch(/◷ \d\d:\d\d/);
    expect(rows[0]).toContain('ctx 12%');
    expect(rows[0]).toContain('$0.41');
    for (const s of ['RUN ', 'WAIT', 'FAIL', 'explorer-1', 'Grep', '#lead-1', 'need a decision on the token ttl', 'tasks', '✖ completion']) expect(all).toContain(s);
    expect(rows).toHaveLength(7); // title + rail + blocked, failed, working lanes + ticker + footer
  });
  test('title bar is a truecolor gradient: every cell filled, colours move left to right', () => {
    const title = panel(160).rowNodes[0]!;
    const bgs = cells(title).map((t) => t.props.backgroundColor as string);
    expect(bgs.every((b) => /^#[0-9a-f]{6}$/.test(b))).toBe(true);
    expect(new Set(bgs).size).toBeGreaterThan(10);
    expect(bgs[0]).toBe(MOCHA.violet);
  });
  test('phase rail: past pills checked, current upper-case and bright, future plain', () => {
    const rail = panel(160).rows[1]!;
    expect(rail).toContain(' ✓ research ');
    expect(rail).toContain(' ◆ IMPLEMENT ');
    expect(rail).toContain(' verify ');
    expect(rail).toContain('▶');
  });
  test('the current pill shimmers with the tick', () => {
    const pillBg = (tick: number) => cells(panel(160, { tick }).rowNodes[1]!).find((t) => String(t.props.children).includes('IMPLEMENT'))!.props.backgroundColor;
    expect(pillBg(0)).not.toBe(pillBg(3));
  });
  test('lanes carry a filled state chip, a tool chip and an eighth-block bar', () => {
    const { rowNodes } = panel(160);
    const lane = laneOf(rowNodes, 'explorer-1');
    const chip = cells(lane).find((t) => String(t.props.children).includes('RUN'))!;
    expect(chip.props.backgroundColor).toBe(MOCHA.green);
    expect(cells(lane).some((t) => t.props.backgroundColor === MOCHA.panel2 && String(t.props.children).includes('Grep'))).toBe(true);
    expect(text(lane)).toMatch(/[▏▎▍▌▋▊▉█]/);
  });
  test('sparkline climbs with recent tool calls', () => {
    const snapshot = busySnap();
    snapshot.activity['explorer-1'] = { ...snapshot.activity['explorer-1']!, calls: [NOW - 1500, NOW - 1000, NOW - 500] };
    expect(text(laneOf(panel(160, { snapshot, live: liveWorkers(snapshot, NOW) }).rowNodes, 'explorer-1'))).toContain('▆');
    expect(callBuckets([NOW - 1000, NOW - 2000, NOW - 7000, NOW - 61_000], NOW)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
  });
  test('pushCall keeps one minute of call times, capped', () => {
    expect(pushCall([NOW - 70_000, NOW - 1000], NOW)).toEqual([NOW - 1000, NOW]);
    expect(pushCall(Array.from({ length: 60 }, () => NOW), NOW)).toHaveLength(48);
  });
  test('ticker: channel chip and hashed nick colours, stable per name', () => {
    const ticker = panel(160).rowNodes[5]!;
    const chip = cells(ticker).find((t) => String(t.props.children).includes('#lead-1'))!;
    expect(chip.props.backgroundColor).toBe(MOCHA.violet);
    const nick = (n: string) => cells(ticker).find((t) => t.props.children === n)?.props.color;
    expect(nick('lead')).toBeDefined();
    expect(text(ticker)).toContain(' → ');
  });
  test('mid tier drops role and target, keeps lanes', () => {
    const snapshot = busySnap();
    snapshot.activity['explorer-1'] = { ...snapshot.activity['explorer-1']!, tool: 'Edit', target: 'band.tsx' } as never;
    const { all } = panel(100, { snapshot, live: liveWorkers(snapshot, NOW) });
    expect(all).toContain('Edit');
    expect(all).not.toContain('band.tsx');
    expect(all).not.toContain('mission control');
  });
  test('narrow tier is the title row alone', () => {
    const { rows } = panel(70, { gates: [gate] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('2 working');
    expect(rows[0]).toContain('✖1');
  });
  test('every row fills exactly the columns at 60..200', () => {
    for (const columns of [200, 160, 158, 120, 119, 100, 80, 79, 60]) {
      for (const row of panel(columns, { gates: [gate] }).rows) expect([columns, textWidth(row)]).toEqual([columns, columns]);
    }
  });
  test('maxRows collapses lanes first, then ticker, then footer; total never exceeds maxRows', () => {
    for (const maxRows of [3, 4, 5, 6, 7, 8, 12]) expect(panel(160, { maxRows }).rows.length).toBeLessThanOrEqual(maxRows);
    expect(planRows(3, 3, true)).toMatchObject({ lanes: 1, ticker: false, footer: false });
    expect(planRows(4, 3, true)).toMatchObject({ ticker: false, footer: true });
    expect(planRows(6, 5, true)).toMatchObject({ lanes: 1, ticker: true, footer: true, more: true });
    expect(panel(160, { maxRows: 5 }).all).toMatch(/\+\d+ more/);
  });
  test('maxRows under 3 falls back to the title row', () => {
    expect(panel(160, { maxRows: 2 }).rows).toHaveLength(1);
  });
  test('idle: two rows, dim title with the last wave, settled rail, no spinner', () => {
    const snapshot = busySnap({ comms: [] });
    snapshot.squad = snapshot.squad.map((a) => ({ ...a, state: 'finished' as const }));
    snapshot.activity = {};
    const { rows, all } = panel(160, { snapshot, live: liveWorkers(snapshot, NOW).map((w) => ({ ...w, state: 'done' as const })) });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('◆ ATLAS  ·  idle');
    expect(rows[0]).toContain('last wave: 3 workers');
    expect(rows[1]).toContain('IMPLEMENT');
    expect(all).not.toMatch(/[⣾⣽⣻⢿⡿⣟] /);
  });
  test('idle with open gates stays calm: grey title, one amber gates chip, never "blocked"', () => {
    const { rows, rowNodes } = panel(160, { snapshot: idleSnap(), live: [], gates: [gate] });
    expect(rows[0]).toContain('◆ ATLAS  ·  idle');
    expect(rows[0]).not.toContain('blocked');
    const gatesChip = cells(rowNodes[0]!).find((t) => String(t.props.children).includes('gates ✖1'))!;
    expect(gatesChip.props.backgroundColor).toBe(MOCHA.peach);
    expect(cells(rowNodes[0]!)[0]!.props.backgroundColor).toBe(MOCHA.grey);
    expect(textWidth(rows[0]!)).toBe(160);
  });
  test('last wave counts the most recent spawn burst only, not every worker of the session', () => {
    const snapshot = busySnap({ comms: [] });
    const live = liveWorkers(snapshot, NOW).map((w, i) => ({ ...w, state: 'done' as const, startedAt: i < 2 ? NOW - 300_000 : NOW - 40_000 }));
    const title = panel(160, { snapshot: idleSnap(), live }).rows[0]!;
    expect(title).toContain('last wave: 1 worker ');
    expect(title).toContain('40s');
  });
  test('a blocked or unknown phase keeps the last real phase lit and adds a red BLOCKED chip', () => {
    const snapshot = idleSnap();
    snapshot.phase = 'blocked' as never;
    const { rows, rowNodes } = panel(160, { snapshot, live: [], lastPhase: 'implement' });
    expect(rows[1]).toContain('◆ IMPLEMENT');
    const blocked = cells(rowNodes[0]!).find((t) => String(t.props.children).includes('BLOCKED'))!;
    expect(blocked.props.backgroundColor).toBe(MOCHA.red);
    expect(panel(160, { snapshot, live: [] }).rows[1]).toMatch(/◆ [A-Z]+/); // no memory yet: still one lit pill
  });
  test('shortTool strips mcp server prefixes', () => {
    expect(shortTool('mcp__lean-ctx__ctx_shell')).toBe('ctx_shell');
    expect(shortTool('mcp__plugin_context-mode_context-mode__ctx_execute')).toBe('ctx_execute');
    expect(shortTool('Edit')).toBe('Edit');
  });
  test('lane shows the short MCP tool name and its target', () => {
    const snapshot = busySnap();
    snapshot.activity['explorer-1'] = { ...snapshot.activity['explorer-1']!, tool: 'mcp__lean-ctx__ctx_shell', target: 'sleep 5' } as never;
    expect(panel(160, { snapshot, live: liveWorkers(snapshot, NOW) }).all).toMatch(/ctx_shell\s+sleep 5/);
  });
  test('between calls the lane keeps the last tool and target, dimmed, never "-"', () => {
    const snapshot = busySnap();
    snapshot.activity['explorer-1'] = { ...snapshot.activity['explorer-1']!, tool: null, lastTool: 'mcp__lean-ctx__ctx_shell', target: 'sleep 5', mood: 'thinking' };
    const { rowNodes, all } = panel(160, { snapshot, live: liveWorkers(snapshot, NOW) });
    expect(all).toMatch(/ctx_shell\s+sleep 5/);
    const cell = cells(laneOf(rowNodes, 'explorer-1')).find((t) => String(t.props.children).includes('ctx_shell'))!;
    expect(cell.props.color).toBe(MOCHA.muted);
  });
  test('title shows the dispatch scope and the wave', () => {
    const snapshot = busySnap();
    snapshot.activity['explorer-1'] = { ...snapshot.activity['explorer-1']!, scope: 'audit/medium' };
    const title = panel(160, { snapshot, live: liveWorkers(snapshot, NOW) }).rows[0]!;
    expect(title).toContain('audit/medium');
    expect(title).toMatch(/wave \d/);
  });
});
