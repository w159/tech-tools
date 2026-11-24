// The one-row bar always ends in its pane controls: `open` while the pane is closed;
// the tab chips and `close` while it is open. Pressing a chip calls the handler the host wires to $.ui.open / $.ui.close.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree, BAND_BUTTONS, type BandHandlers } from './band';
import { busySnap } from '../../live_fixture';
import { liveWorkers } from '../../data/live';
import type { Ui } from '../../design/atlas-ui';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };

const idle = busySnap({ squad: [], phase: 'research', counts: { done: 0, total: 0, byPhase: {} } });
const working = busySnap();
const STATES = [['idle', idle], ['working', working]] as const;

function draw(snapshot: typeof idle, columns: number, handlers: Partial<BandHandlers>, maxRows = 1) {
  const calls: string[] = [];
  const on: BandHandlers = { openView: (v) => calls.push(`open:${v}`), toggleTodos: () => calls.push('board'), closePane: () => calls.push('close'), ...handlers };
  const tree = bandTree(els, { snapshot, live: liveWorkers(snapshot, snapshot.now), gates: [], columns, tick: 0, maxRows, ui } as never, on) as unknown as Node;
  const keys = all(tree).filter((n) => n.kind === 'Button').map((n) => String(n.props.key));
  const rows = kids(tree).map((r) => textOf(r));
  return { tree, calls, keys, rows, button: (key: string) => all(tree).find((n) => n.kind === 'Button' && n.props.key === key)! };
}

describe('the one-row band controls', () => {
  for (const [name, snap] of STATES) for (const columns of [60, 80, 120, 200]) {
    test(`${name} at ${columns} columns, pane closed: an \`open\` chip and no close chip; one row; pressing open asks the pane open on the first tab`, () => {
      const d = draw(snap, columns, { paneOpen: false });
      expect(d.keys).toContain('band:open');
      expect(d.keys).not.toContain('band:close');
      expect(d.rows).toHaveLength(1);
      expect(d.rows[0]).toContain(' open ');
      d.button('band:open').props.onPress();
      expect(d.calls).toEqual([`open:${BAND_BUTTONS[0]!.id}`]);
    });

    test(`${name} at ${columns} columns, pane open: a \`close\` chip${columns >= 80 ? ' and the tab chips' : ''}; pressing close closes the pane`, () => {
      const d = draw(snap, columns, { paneOpen: true });
      expect(d.keys).toContain('band:close');
      expect(d.keys).not.toContain('band:open');
      for (const b of BAND_BUTTONS) expect(d.keys.includes(`band:${b.id}`)).toBe(columns >= 80);
      expect(d.rows).toHaveLength(1);
      d.button('band:close').props.onPress();
      expect(d.calls).toEqual(['close']);
    });
  }

  test('the left runs are fitted first: the controls survive a narrow bar and the row never exceeds the column width', () => {
    for (const columns of [60, 80, 100, 120]) {
      const d = draw(working, columns, { paneOpen: true });
      expect([...d.rows[0]!].length).toBeLessThanOrEqual(columns);
      expect(d.keys).toContain('band:close');
    }
  });

  test('a taller band keeps the controls on its first row; the footer key row is not drawn twice (no tab chips on the first row)', () => {
    const d = draw(idle, 120, { paneOpen: false }, 12);
    expect(d.keys).toContain('band:open');
    expect(d.keys.filter((k) => k === 'band:open')).toHaveLength(1);
  });
});
