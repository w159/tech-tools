// Mission Control panel: framed multi-row band, width tiers, row budget, idle state.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree, planRows, shortTool } from './band';
import { liveWorkers } from './data/live';
import { busySnap, NOW } from './live_fixture';
import { textWidth } from './theme';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const text = (n: Node): string => (n.props.children as Node[]).map((t) => t.props.children).join('');
const gate = { id: 'completion' as const, title: 'Gates', lines: [{ ok: false, label: 'x' }] } as any;

/** Panel -> rows of text (a bare row Box -> one line). */
const panel = (columns: number, over: Record<string, unknown> = {}) => {
  const snapshot = (over.snapshot as ReturnType<typeof busySnap>) ?? busySnap();
  const live = (over.live as any) ?? liveWorkers(snapshot, NOW);
  const node = bandTree(els, { snapshot, live, gates: [], columns, tick: 3, maxRows: 12, ...over } as any) as unknown as Node;
  const rows = node.props.borderStyle ? (node.props.children as Node[]).map(text) : [text(node)];
  return { node, rows, all: rows.join('\n') };
};
const idleSnap = () => busySnap({ squad: [], activity: {}, comms: [] });

describe('Mission Control panel', () => {
  test('full tier is a rounded frame with header, lanes, ticker and footer', () => {
    const { node, rows, all } = panel(160, { gates: [gate] });
    expect(node.props.borderStyle).toBe('round');
    expect(rows[0]).toContain(' ATLAS ');
    expect(rows[0]).toContain('implement');
    expect(rows[0]).toContain('tasks');
    expect(rows[0]).toContain('gates ✗1');
    expect(all).toContain('explorer-1');
    expect(all).toContain('explorer'); // role column
    expect(all).toContain('Grep');
    expect(all).toContain('▕');
    expect(all).toContain('#lead-1');
    expect(all).toContain('need a decision on the token ttl');
    expect(all).toContain('todos');
    expect(all).toContain('r t c g tabs');
    expect(rows).toHaveLength(6); // header + blocked, failed, working lanes + ticker + footer
  });
  test('border colour tracks state: blocked or open gates warn, working live, idle muted', () => {
    expect(panel(160).node.props.borderColor).toBe('warning'); // busySnap has a blocked worker
    const working = busySnap();
    working.squad = working.squad.filter((a) => a.name === 'explorer-1');
    expect(panel(160, { snapshot: working, live: liveWorkers(working, NOW) }).node.props.borderColor).toBe('suggestion');
    expect(panel(160, { snapshot: idleSnap(), live: [] }).node.props.borderColor).toBe('subtle');
  });
  test('phase rail marks past, current and future phases', () => {
    const head = panel(160).rows[0]!;
    expect(head).toMatch(/✓ research/);
    expect(head).toMatch(/[⣾⣽⣻⢿⡿⣟] implement/);
    expect(head).toMatch(/○ verify/);
  });
  test('mid tier drops role and target, keeps lanes', () => {
    const snapshot = busySnap();
    snapshot.activity['explorer-1'] = { ...snapshot.activity['explorer-1']!, tool: 'Edit', target: 'band.tsx' } as never;
    const { all } = panel(100, { snapshot, live: liveWorkers(snapshot, NOW) });
    expect(all).toContain('Edit');
    expect(all).not.toContain('band.tsx');
    expect(all).not.toMatch(/ explorer {4}/);
  });
  test('narrow tier is one bordered header row', () => {
    const { node, rows } = panel(70, { gates: [gate] });
    expect(node.props.borderStyle).toBe('round');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('2 working');
    expect(rows[0]).toContain('✗1');
  });
  test('never wider than columns inside the frame at any width', () => {
    for (const columns of [160, 120, 100, 80, 79, 60, 40, 20]) {
      for (const row of panel(columns, { gates: [gate] }).rows) expect(textWidth(row)).toBeLessThanOrEqual(Math.max(1, columns - 2));
    }
  });
  test('maxRows collapses lanes first, then ticker, then footer; total never exceeds maxRows', () => {
    for (const maxRows of [3, 4, 5, 6, 7, 8, 12]) {
      expect(panel(160, { maxRows }).rows.length + 2).toBeLessThanOrEqual(Math.max(maxRows, 3));
    }
    expect(planRows(4, 3, true)).toMatchObject({ lanes: 1, ticker: false, footer: false });
    expect(planRows(5, 3, true)).toMatchObject({ ticker: false, footer: true });
    expect(planRows(7, 5, true)).toMatchObject({ lanes: 1, ticker: true, footer: true, more: true });
    expect(panel(160, { maxRows: 6 }).all).toMatch(/\+\d+ more/);
  });
  test('maxRows under 3 falls back to one borderless row', () => {
    const { node } = panel(160, { maxRows: 2 });
    expect(node.props.borderStyle).toBeUndefined();
  });
  test('idle: a 3-row framed panel with brand, rail and last run', () => {
    const snapshot = busySnap({ comms: [] });
    snapshot.squad = snapshot.squad.map((a) => ({ ...a, state: 'finished' as const }));
    snapshot.activity = {};
    const { node, rows, all } = panel(160, { snapshot, live: liveWorkers(snapshot, NOW).map((w) => ({ ...w, state: 'done' as const })) });
    expect(node.props.borderStyle).toBe('round');
    expect(rows).toHaveLength(1);
    expect(all).toContain(' ATLAS ');
    expect(all).toContain('idle');
    expect(all).toContain('last run: 3 workers');
    expect(all).not.toMatch(/[⣾⣽⣻⢿⡿⣟] /);
  });
  test('idle with open gates reads blocked', () => {
    expect(panel(160, { snapshot: idleSnap(), live: [], gates: [gate] }).all).toContain('blocked');
  });
  test('shortTool strips mcp server prefixes', () => {
    expect(shortTool('mcp__lean-ctx__ctx_shell')).toBe('ctx_shell');
    expect(shortTool('mcp__plugin_context-mode_context-mode__ctx_execute')).toBe('ctx_execute');
    expect(shortTool('Edit')).toBe('Edit');
  });
  test('lane shows the short MCP tool name', () => {
    const snapshot = busySnap();
    snapshot.activity['explorer-1'] = { ...snapshot.activity['explorer-1']!, tool: 'mcp__lean-ctx__ctx_shell', target: 'sleep 5' } as never;
    expect(panel(160, { snapshot, live: liveWorkers(snapshot, NOW) }).all).toMatch(/ctx_shell\s+sleep 5/);
  });
});
