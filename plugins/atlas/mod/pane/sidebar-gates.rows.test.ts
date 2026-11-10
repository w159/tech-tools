// gateRows contract: group summary rows, expansion, per-line press behaviour, detail/fix notes and id scrubbing.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap } from '../live_fixture';
import { TONE_HEX as T } from '../mission-layout';
import { textWidth } from '../theme';
import { gateRows } from './sidebar-gates';
import type { GateGroup as RealGroup, SidebarHandlers, SidebarModel } from './sidebar-types';

/** Group ids are a closed union in production; the row builder treats them as opaque keys, so tests use any string. */
type GateGroup = Omit<RealGroup, 'id'> & { id: string };

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));

const calls: string[] = [];
const on = { toggle: (k: string) => calls.push(`toggle:${k}`), copy: (t: string) => calls.push(`copy:${t}`) } as unknown as SidebarHandlers;
const rows = (gates: GateGroup[], expanded: string | null = null, inner = 100): Node[] =>
  gateRows(els, { snapshot: busySnap(), gates: gates as RealGroup[], ui: { recipient: null, expanded, draft: '', view: 'gates' }, columns: inner + 1, rows: 40 } as SidebarModel, on, inner) as unknown as Node[];

const mixed: GateGroup = { id: 'completion', title: 'Completion gate', lines: [
  { id: 'a', label: 'docs ok', ok: true, detail: 'docs present' },
  { id: 'b', label: 'verifier verdict', ok: false, detail: 'no verified finding', fix: 'dispatch atlas:verifier' },
  { id: 'c', label: 'changelog', ok: false },
] };

describe('group summary row', () => {
  test('open group: ✗ and "N failing" in the bad tone, title plain, first failing line fix as muted tail', () => {
    const [row] = rows([mixed]);
    expect(row!.kind).toBe('Button');
    expect(row!.props).toMatchObject({ key: 'group:completion', plain: true });
    expect(textOf(row!)).toBe('✗ Completion gate  2 failing  dispatch atlas:verifier');
    const parts = kids(row!);
    expect(parts[0]!.props).toMatchObject({ children: '✗ ', color: T.bad });
    expect(parts[2]!.props).toMatchObject({ children: '  2 failing', color: T.bad });
    expect(parts[1]!.props).toMatchObject({ children: 'Completion gate', color: T.text });
    expect(parts[3]!.props).toMatchObject({ children: '  dispatch atlas:verifier', color: T.muted });
  });

  test('tail falls back to the first failing label when it has no fix, and skips earlier ok lines', () => {
    const g: GateGroup = { id: 'g', title: 'g', lines: [{ id: 'x', label: 'fine', ok: true, detail: 'D' }, { id: 'y', label: 'broken thing', ok: false }] };
    expect(textOf(rows([g])[0]!)).toBe('✗ g  1 failing  broken thing');
  });

  test('clean group: ✓ in the ok tone, "passing", first line detail as the tail', () => {
    const g: GateGroup = { id: 'h', title: 'header', lines: [{ id: 'x', label: 'L', ok: true, detail: 'matches ^# atlas:' }, { id: 'y', label: 'M', ok: true, detail: 'other' }] };
    const row = rows([g])[0]!;
    expect(textOf(row)).toBe('✓ header  passing  matches ^# atlas:');
    expect(kids(row)[0]!.props).toMatchObject({ children: '✓ ', color: T.ok });
    expect(kids(row)[2]!.props).toMatchObject({ children: '  passing', color: T.ok });
  });

  test('a clean group without detail or lines has no tail', () => {
    expect(textOf(rows([{ id: 'e', title: 'empty', lines: [] }])[0]!)).toBe('✓ empty  passing');
    expect(textOf(rows([{ id: 'e', title: 'nodetail', lines: [{ id: 'x', label: 'L', ok: true }] }])[0]!)).toBe('✓ nodetail  passing');
  });

  test('an unavailable source counts as one open gate and says so, whitespace collapsed', () => {
    const g: GateGroup = { id: 'u', title: 'src', lines: [], error: 'boom\n  could not   read' };
    const row = rows([g])[0]!;
    expect(textOf(row)).toBe('✗ src  1 failing  unavailable: boom could not read');
    const withLines: GateGroup = { id: 'u', title: 'src', error: 'bad', lines: [{ id: 'x', label: 'L', ok: false, fix: 'F' }] };
    expect(textOf(rows([withLines])[0]!)).toBe('✗ src  2 failing  unavailable: bad');
  });

  test('raw 17-hex agent ids are scrubbed to 6 chars in titles, tails and errors', () => {
    const id = 'a529730494759bac3';
    const g: GateGroup = { id: 's', title: `agent ${id}`, lines: [{ id: 'x', label: `waiting on ${id}`, ok: false }] };
    expect(textOf(rows([g])[0]!)).toBe('✗ agent a52973  1 failing  waiting on a52973');
    const e: GateGroup = { id: 's', title: 't', lines: [], error: `died ${id}` };
    expect(textOf(rows([e])[0]!)).toBe('✗ t  1 failing  unavailable: died a52973');
  });

  test('pressing a group row toggles its group key', () => {
    calls.length = 0;
    rows([mixed])[0]!.props.onPress();
    expect(calls).toEqual(['toggle:group:completion']);
  });

  test('the row is cut to the inner width', () => {
    const long: GateGroup = { id: 'l', title: 'T', lines: [{ id: 'x', label: 'y'.repeat(200), ok: false }] };
    expect(textWidth(textOf(rows([long], null, 30)[0]!))).toBeLessThanOrEqual(30);
  });
});

describe('expansion', () => {
  test('collapsed: one row per group', () => {
    expect(rows([mixed, { ...mixed, id: 'two' }])).toHaveLength(2);
  });

  test('expanding the group key shows every line as a plain Button, after its summary', () => {
    const r = rows([mixed], 'group:completion');
    expect(r).toHaveLength(4);
    expect(r.slice(1).map((n) => [n.kind, n.props.key, n.props.plain])).toEqual([['Button', 'gate:a', true], ['Button', 'gate:b', true], ['Button', 'gate:c', true]]);
    expect(r.slice(1).map(textOf)).toEqual(['  ✓ docs ok', '  ✗ verifier verdict', '  ✗ changelog']);
  });

  test('line marks use the ok / bad tones and labels stay plain text', () => {
    const r = rows([mixed], 'group:completion');
    expect(kids(r[1]!)[0]!.props).toMatchObject({ children: '  ✓ ', color: T.ok });
    expect(kids(r[2]!)[0]!.props).toMatchObject({ children: '  ✗ ', color: T.bad });
    expect(kids(r[2]!)[1]!.props).toMatchObject({ children: 'verifier verdict', color: T.text });
  });

  test('expanding a line key keeps its group open and only that group', () => {
    const other: GateGroup = { id: 'o', title: 'other', lines: [{ id: 'z', label: 'zz', ok: true }] };
    const r = rows([mixed, other], 'gate:b');
    // the two undefined keys are the detail and fix note rows under the expanded line
    expect(r.map((n) => n.props.key)).toEqual(['group:completion', 'gate:a', 'gate:b', undefined, undefined, 'gate:c', 'group:o']);
  });

  test('an unrelated expanded key opens nothing', () => {
    expect(rows([mixed], 'group:nope')).toHaveLength(1);
    expect(rows([mixed], null)).toHaveLength(1);
  });

  test('the expanded line shows detail then the fix hint as dim, non-shrinking note rows', () => {
    const r = rows([mixed], 'gate:b');
    expect(r.map(textOf)).toEqual([
      '✗ Completion gate  2 failing  dispatch atlas:verifier',
      '  ✓ docs ok', '  ✗ verifier verdict',
      '     no verified finding', '     fix: dispatch atlas:verifier (press to copy)',
      '  ✗ changelog',
    ]);
    const note = r[3]!;
    expect(note.kind).toBe('Box');
    expect(note.props.flexShrink).toBe(0);
    expect(kids(note)[0]!.props.color).toBe(T.muted);
  });

  test('only the detail when there is no fix, only the fix when there is no detail, nothing for a bare line', () => {
    const g: GateGroup = { id: 'g', title: 'g', lines: [
      { id: 'd', label: 'D', ok: true, detail: 'just detail' },
      { id: 'f', label: 'F', ok: false, fix: 'just fix' },
      { id: 'n', label: 'N', ok: false },
    ] };
    expect(rows([g], 'gate:d').map(textOf).slice(1)).toEqual(['  ✓ D', '     just detail', '  ✗ F', '  ✗ N']);
    expect(rows([g], 'gate:f').map(textOf).slice(1)).toEqual(['  ✓ D', '  ✗ F', '     fix: just fix (press to copy)', '  ✗ N']);
    expect(rows([g], 'gate:n').map(textOf).slice(1)).toEqual(['  ✓ D', '  ✗ F', '  ✗ N']);
  });

  test('note rows are scrubbed and cut to the width', () => {
    const id = 'a529730494759bac3';
    const g: GateGroup = { id: 'g', title: 'g', lines: [{ id: 'd', label: `L ${id}`, ok: false, detail: `saw ${id}` }] };
    const r = rows([g], 'gate:d');
    expect(textOf(r[1]!)).toBe('  ✗ L a52973');
    expect(textOf(r[2]!)).toBe('     saw a52973');
    expect(textWidth(textOf(rows([{ ...g, lines: [{ id: 'd', label: 'x', ok: false, detail: 'w'.repeat(100) }] }], 'gate:d', 20)[2]!))).toBe(20);
  });
});

describe('line press', () => {
  test('collapsed line: toggles its key', () => {
    calls.length = 0;
    rows([mixed], 'group:completion')[2]!.props.onPress();
    expect(calls).toEqual(['toggle:gate:b']);
  });

  test('expanded line with a fix: copies the fix', () => {
    calls.length = 0;
    rows([mixed], 'gate:b')[2]!.props.onPress();
    expect(calls).toEqual(['copy:dispatch atlas:verifier']);
  });

  test('expanded line without a fix: still toggles (collapses)', () => {
    calls.length = 0;
    rows([mixed], 'gate:c')[3]!.props.onPress();
    expect(calls).toEqual(['toggle:gate:c']);
  });

  test('a line with a fix that is not expanded toggles instead of copying', () => {
    calls.length = 0;
    rows([mixed], 'gate:a')[3]!.props.onPress(); // line b (row 2 is a's detail note), while a is the expanded key
    expect(calls).toEqual(['toggle:gate:b']);
  });
});
