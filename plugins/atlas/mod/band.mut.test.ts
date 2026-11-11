// Mutation-kill tests for band.tsx (seed 1105 survivors): the key row only where a line carries keys AND handlers exist,
// and the default row budget of bandSpareRows.
//
// Also equivalent (seed 1105, second pass), not tested: band.tsx missionModel elapsedSecs `now - min` -> `now + min` (MissionModel.elapsedSecs is
// declared at mission-layout.ts:60 and read by nothing in mod/ or omp/; omp/mission-panel.test.ts pins that no clock is drawn);
// bandCountItems `?? 12` -> `?? 13` (the count items read only worker states, never maxRows: mission-layout.ts:131-137); and the
// `strike: true` flag in seg (mission-layout emits no struck run, only the board callback does).
// Equivalent mutant, not tested: boardOf `|| 'atlas'` -> `&& 'atlas'` (line 74). It only changes MissionModel.project, which no
// renderer reads (grep `.project` in mod/ and omp/: the field is declared in mission-layout.ts:40 and set in band.tsx:115 only).
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { worldModel } from '../contracts/band-world';
import { bandSpareRows, bandTree, missionTree } from './band';
import { liveWorkers } from './data/live';
import { busySnap, NOW } from './live_fixture';
import type { Ui } from './atlas-ui';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') } as unknown as ClientElements;
const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const buttons = (n: Node): number => (n.kind === 'Button' ? 1 : 0) + (Array.isArray(n.props.children) ? (n.props.children as Node[]).reduce((a, c) => a + buttons(c), 0) : 0);
const handlers = { openView: () => {}, toggleTodos: () => {} };

describe('band mutation kills', () => {
  test('missionTree: handlers alone never turn a line without keys into a key row', () => {
    const m = worldModel(120, mocha, { maxRows: 12 }); // a running world: no key footer line
    expect(buttons(missionTree(els, m, undefined, handlers) as unknown as Node)).toBe(0);
    expect(buttons(missionTree(els, m) as unknown as Node)).toBe(0);
  });
  test('missionTree: a key line draws buttons only when handlers exist', () => {
    const m = worldModel(120, mocha, { workers: [], maxRows: 12, keysWidth: 1 });
    expect(buttons(missionTree(els, m, undefined, handlers) as unknown as Node)).toBeGreaterThan(0);
    expect(buttons(missionTree(els, m) as unknown as Node)).toBe(0);
  });
  test('bandSpareRows: no maxRows means the 12 row budget, which the 13 row budget would out-spare', () => {
    const snapshot = busySnap();
    const base = liveWorkers(snapshot, NOW);
    const live = Array.from({ length: 9 }, (_, i) => ({ ...base[i % base.length]!, name: `w${i}`, state: 'working' as const }));
    const model = (maxRows?: number) => ({ snapshot, live, gates: [], columns: 120, tick: 0, maxRows, ui: mocha });
    expect(bandSpareRows(model(12))).toBe(1);
    expect(bandSpareRows(model(13))).toBe(2);
    expect(bandSpareRows(model())).toBe(bandSpareRows(model(12)));
    // bandTree takes the same default: it never draws more rows than the 12 budget
    expect((bandTree(els, model()) as unknown as Node).props.children.length).toBeLessThanOrEqual(12);
  });
  test('seg: the bold flag of a run reaches the painted Text (the ATLAS capsule is bold)', () => {
    const bold: string[] = [];
    const walk = (n: Node): void => {
      if (n.kind === 'Text' && n.props.bold === true) bold.push(String(n.props.children));
      if (Array.isArray(n.props.children)) for (const c of n.props.children as Node[]) walk(c);
    };
    walk(missionTree(els, worldModel(120, mocha, { maxRows: 12 })) as unknown as Node);
    expect(bold.some((t) => t.includes('ATLAS'))).toBe(true);
  });
  test('boardOf: a snapshot with neither channel nor root still builds (project falls back to atlas)', () => {
    const snapshot = { ...busySnap(), root: undefined, channel: undefined } as never;
    const b = { snapshot, live: [], gates: [], columns: 120, tick: 0, maxRows: 12, ui: mocha };
    expect(() => bandTree(els, b)).not.toThrow();
  });
});
