// Band worker rows (critique 18 Band #3, critique 19 Band 1-3). Shapes come from live frames of the 232567af capture runs:
//   live-150-232567af-1 f0068 (band 93 cells beside the docked pane, 3 explorers running, band slot of 2 rows: ribbon + 1)
//   live-110-232567af-1 f0065 (band 61 cells beside the pane, same three explorers)
//   stoprun-150-232567af-1 f0093 (band count glyph ◒ against the HUD row ◐)
//   stoprun-110-232567af-2 f0101 (blocked band at 61 cells: the todo figure and the failed count dropped)
// The scorer (round2/tools/live_capture.py, parse_frame rev 4, line 659) reads a band worker row as
// `^\s*([◐◓◑◒◐◓◑◒◐◓◇■▲◉●])\s+(\S+)\s+([a-z][a-z-]*)\s{2,}\S` on the lines under the band ribbon, state from the glyph.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { SPIN_FRAMES, leadSpinnerGlyph, spinClock, spinFrameOf, type Ui } from './atlas-ui';
import { textWidth as textWidthOf } from './theme';
import { bandTree } from './band';
import { runsText, missionLines, type MissionModel } from './mission-layout';
import { liveWorkers, type LiveWorker } from './data/live';
import { busySnap, NOW } from './live_fixture';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const text = (row: Node): string => (row.props.children as Node[]).map((t) => t.props.children).join('');
const UI: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const SCORER_ROW = /^\s*([◐◓◑◒◐◓◑◒◐◓◇■▲◉●])\s+(\S+)\s+([a-z][a-z-]*)\s{2,}\S/; // live_capture.py:659
const SPIN = '◐◓◑◒';

const explorer = (name: string, over: Partial<LiveWorker> = {}): LiveWorker => ({
  name, role: 'explorer', state: 'working', tool: 'Read', lastTool: null, since: NOW - 12_000, startedAt: NOW - 12_000, target: `${name.split('-')[0]}.py`, lastLine: '', calls: [], scope: null, ...over,
});
const THREE = ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].map((n) => explorer(n));
const bare = (over: Record<string, unknown> = {}) => busySnap({ squad: [], activity: {}, comms: [], ...over });

const rowsOf = (columns: number, maxRows: number, live: LiveWorker[], over: Record<string, unknown> = {}): string[] => {
  const snapshot = (over.snapshot as ReturnType<typeof busySnap>) ?? bare();
  const node = bandTree(els, { snapshot, live, gates: [], columns, tick: 0, maxRows, workersInHud: true, ui: UI, ...over } as never) as unknown as Node;
  return (node.props.children as Node[]).map(text);
};
const parsed = (rows: string[]) => rows.slice(1).map((r) => SCORER_ROW.exec(r)).filter((m): m is RegExpExecArray => m !== null);

describe('band worker rows beside the Subagents block (live frame shape: band slot of 2 rows)', () => {
  for (const [label, columns] of [['150 (band 93)', 93], ['110 (band 61)', 61]] as const) {
    test(`${label}: the one spare row names a running worker in the scorer's form`, () => {
      const rows = rowsOf(columns, 2, THREE);
      expect(rows).toHaveLength(2);
      const got = parsed(rows);
      expect(got).toHaveLength(1);
      expect(SPIN).toContain(got[0]![1]!); // the glyph carries the state: a spinner is running
      expect(THREE.map((w) => w.name)).toContain(got[0]![2]!);
      expect(got[0]![3]).toBe('running');
      expect(textWidthOf(rows[1]!)).toBe(columns);
    });
  }

  test('every running worker gets its turn on the one row: the row follows snapshot.now, never the wall clock', () => {
    const seen = new Set<string>();
    for (let k = 0; k < 8; k++) {
      const snapshot = bare({ now: NOW + k * 1000 });
      const got = parsed(rowsOf(93, 2, THREE, { snapshot }));
      expect(got).toHaveLength(1);
      seen.add(got[0]![2]!);
    }
    expect([...seen].sort()).toEqual(THREE.map((w) => w.name).sort());
    // same snapshot, same row
    expect(rowsOf(93, 2, THREE)).toEqual(rowsOf(93, 2, THREE));
  });

  test('with more rows every running worker has its own row', () => {
    for (const columns of [93, 61]) {
      const got = parsed(rowsOf(columns, 4, THREE));
      expect(got.map((m) => m[2]).sort()).toEqual(THREE.map((w) => w.name).sort());
      expect(got.every((m) => m[3] === 'running')).toBe(true);
    }
  });

  test('a finished or killed worker reads its true state in words, and a waiting worker says waiting', () => {
    const live = [
      explorer('alpha-explorer'),
      explorer('beta-explorer', { state: 'done', tool: null, lastTool: 'Read', since: NOW - 2_000 }),
      explorer('ghost-explorer', { state: 'failed', tool: null, lastTool: 'Read', since: NOW - 3_000 }),
      explorer('gamma-explorer', { state: 'blocked', tool: null }),
    ];
    const rows = rowsOf(93, 6, live);
    const byName = Object.fromEntries(parsed(rows).map((m) => [m[2], m]));
    expect(byName['beta-explorer']![1]).toBe('●');
    expect(byName['beta-explorer']![3]).toBe('done');
    expect(byName['ghost-explorer']![1]).toBe('■');
    expect(byName['ghost-explorer']![3]).toBe('failed');
    expect(rows.find((r) => r.includes('ghost-explorer'))).toContain('failed');
    expect(byName['gamma-explorer']![1]).toBe('◉');
    expect(byName['gamma-explorer']![3]).toBe('waiting');
    expect(SPIN).toContain(byName['alpha-explorer']![1]!);
  });

  test('a worker finished just now shows its done row ahead of the running ones, then gives the row back', () => {
    const live = [explorer('alpha-explorer'), explorer('beta-explorer', { state: 'done', tool: null, lastTool: 'Read', since: NOW - 1_000 })];
    expect(parsed(rowsOf(93, 2, live))[0]![2]).toBe('beta-explorer');
    const later = bare({ now: NOW + 60_000 });
    const got = parsed(rowsOf(93, 2, live, { snapshot: later }));
    expect(got[0]![2]).toBe('alpha-explorer');
  });

  test('the clock column counts from snapshot.now', () => {
    const rows = rowsOf(93, 2, [explorer('alpha-explorer', { startedAt: NOW - 12_000 })]);
    expect(rows[1]).toContain('0:12');
  });

  test('a long name is clipped in cells, the row stays exactly as wide as the band', () => {
    const long = 'implementer-auth-middleware-refactor';
    const rows = rowsOf(61, 2, [explorer(long)]);
    const got = parsed(rows);
    expect(got).toHaveLength(1);
    expect(got[0]![2]!.endsWith(String.fromCharCode(0x2026))).toBe(true); // critic fix 4: the band cuts with the HUD's one-cell ellipsis (the SUBAGENTS rows already cut names with U+2026), never three dots
    expect(textWidthOf(rows[1]!)).toBe(61);
  });

  test('the ribbon, the todo and the counts stay: a worker row never replaces them', () => {
    const rows = rowsOf(93, 2, THREE);
    expect(rows[0]).toContain('3 running');
  });

  test('narrower than 40 cells the band is the single row', () => {
    expect(rowsOf(36, 2, THREE)).toHaveLength(1);
  });

  test('Claude Code and omp share the layout: the same model prints the same rows', () => {
    const m = { cols: 93, maxRows: 4, tick: 0, now: NOW, project: 'p', phases: ['research'], phase: 'research', done: 0, total: 5, workers: THREE.map((w) => ({ name: w.name, role: w.role, state: 'running', tool: 'Read', target: 'x.py', secs: 12 })), checks: null, workersInHud: true, ui: UI } as unknown as MissionModel;
    const rows = missionLines(m).map((l) => runsText(l.runs));
    expect(parsed(rows).map((x) => x[2])).toEqual(THREE.map((w) => w.name));
  });
});

describe('band count glyph (critique 19 Band 3: ◒ in the band against ◐ in the HUD row)', () => {
  test('one running worker: the count and the worker row turn the same frame', () => {
    const one = [explorer('alpha-explorer')];
    for (let tick = 0; tick < 4; tick++) {
      const rows = rowsOf(93, 2, one, { tick });
      const rowGlyph = parsed(rows)[0]![1]!;
      const countGlyph = /(\S) 1 running/.exec(rows[0]!)![1]!;
      const frame = spinFrameOf(spinClock(bare().now, tick), '');
      expect(countGlyph).toBe(leadSpinnerGlyph(frame)); // the count turns the band braille frame; the worker row stays a circle quarter (the scorer parses it by glyph)
      expect(rowGlyph).toBe(SPIN_FRAMES[((frame % 4) + 4) % 4]);
    }
  });
  test('the band turns the HUD frame: spinFrameOf of the spinner clock, ticker included', () => {
    const rows = rowsOf(93, 2, [explorer('alpha-explorer')], { tick: 3 });
    expect(parsed(rows)[0]![1]).toBe(SPIN[spinFrameOf(NOW + 300, 'alpha-explorer') % 4]);
  });
});

describe('blocked band at 61 cells (critique 19 Band 2: todo and failed dropped)', () => {
  const blockedAt = (cols: number): string => {
    const m = {
      cols, maxRows: 2, tick: 0, now: NOW, project: 'p', phases: ['research', 'verify'], phase: 'verify', blocked: false, stopGates: ['1 todo open'],
      done: 5, total: 5, openWork: 1, openDispatch: 1, openDispatchTitle: 'T2 read ghost.py',
      workers: [{ name: 'ghost-explorer', role: 'explorer', state: 'failed', secs: 5 }], checks: null, ui: UI,
    } as unknown as MissionModel;
    return runsText(missionLines(m)[0]!.runs).trimEnd();
  };
  test('the 61-cell band keeps the todo figure and the failed count beside the blocked reason', () => {
    const row = blockedAt(61);
    expect(row).toContain('blocked');
    expect(row).toContain('stop refused'); // state 38: two reasons only
    expect(row).toContain('5/5');
    expect(row).toMatch(/■\s?1/);
  });
  test('wide bands keep the whole reason', () => {
    expect(blockedAt(93)).toContain('blocked · stop refused');
  });
});

describe('an expanded board does not take the spare row (live-150 f0060: ribbon, one blank row, separator, 3 running)', () => {
  test('boardRows wanted but no room for the board slot: the spare row still names a worker', () => {
    const m = { cols: 93, maxRows: 2, tick: 0, now: NOW, project: 'p', phases: ['research'], phase: 'research', done: 0, total: 5, boardRows: 6, workers: THREE.map((w) => ({ name: w.name, role: w.role, state: 'running', tool: 'Read', target: 'x.py', secs: 12 })), checks: null, workersInHud: true, ui: UI } as unknown as MissionModel;
    const rows = missionLines(m).map((l) => runsText(l.runs));
    expect(rows).toHaveLength(2);
    expect(parsed(rows)).toHaveLength(1);
  });
});
