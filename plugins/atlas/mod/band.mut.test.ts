// Mutation-kill tests for band.tsx (seed 1105 survivors): the key row only where a line carries keys AND handlers exist,
// and the default row budget of bandSpareRows.
//
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
});
