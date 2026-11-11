// Mutation-kill tests for mission-layout.ts (seed 1105 survivors): each standard form is the one that fits (its gauge and noun flags),
// the rich band's idle and blocked words are bold, and the idle board slot gets exactly the rows the head, core and footer leave.
//
// Equivalent (seed 1105, third pass), not tested: spread `-` -> `+` (mission-layout.ts:101). `spread` is a module-private function with no caller:
// `grep -rn "spread(" plugins/atlas/mod plugins/atlas/omp` finds only its definition (mission-layout.ts:100), and it is not exported or passed
// as a value, so no input reaches it. (Dead code; deleting it is a behaviour-neutral cleanup outside this tests-only pass.)
import { describe, expect, test } from 'claude-code/testing';
import { worldModel } from '../contracts/band-world';
import type { Ui } from './atlas-ui';
import { bandLines, isMessageKind, missionLines, runsText, type MissionModel } from './mission-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const band = (m: MissionModel): string => runsText(bandLines(m)[0]!.runs).trimEnd();

describe('standardForms: the wide forms, by the column that selects it', () => {
  // widest first: the gauge forms from 120 (noun+ctx gauge, noun, ...), then the figure forms from 100 (3-gap, then 2-gap); a form is used only where the wider ones do not fit
  test('with a context figure: figures from 100 (2-gap, then 3-gap), gauges from 120 (2-gap, then the full form)', () => {
    const at = (cols: number) => band(worldModel(cols, ui, { maxRows: 1 }));
    expect(at(101)).toBe('◖ ◆ ATLAS ◗  research  todo 3 of 7 ▲ 1 blocked  ctx 62%  agents ◐ 1 running  ■ 1 failed  ◇ 1 queued');
    expect(at(108)).toBe('◖ ◆ ATLAS ◗  research   todo 3 of 7 ▲ 1 blocked   ctx 62%   agents ◐ 1 running   ■ 1 failed   ◇ 1 queued');
    expect(at(119)).toBe(at(108));
    expect(at(120)).toBe('◖ ◆ ATLAS ◗  research  todo ███▍░░░░ 3 of 7 ▲ 1 blocked  ctx 62%  agents ◐ 1 running  ■ 1 failed  ◇ 1 queued');
    expect(at(124)).toBe('◖ ◆ ATLAS ◗  research   todo ████▎░░░░░ 3 of 7 ▲ 1 blocked   ctx █████░░░ 62%   agents ◐ 1 running   ■ 1 failed   ◇ 1 queued');
  });
  test('critique 9: no gauge track below 120 columns, the same facts as figures', () => {
    for (const cols of [100, 110, 119]) expect(band(worldModel(cols, ui, { maxRows: 1 }))).not.toMatch(/[░█▌▏▎▍▋▊▉]/);
  });
  test('without a context figure: the 3-gap figure form from 100, the gauge form from 120', () => {
    const at = (cols: number) => band(worldModel(cols, ui, { maxRows: 1, ctx: undefined }));
    expect(at(100)).toBe('◖ ◆ ATLAS ◗  research   todo 3 of 7 ▲ 1 blocked   agents ◐ 1 running   ■ 1 failed   ◇ 1 queued');
    expect(at(119)).toBe(at(100));
    expect(at(120)).toBe('◖ ◆ ATLAS ◗  research   todo ████▎░░░░░ 3 of 7 ▲ 1 blocked   agents ◐ 1 running   ■ 1 failed   ◇ 1 queued');
  });
});

describe('richBand: the idle and blocked words are bold', () => {
  const rich = (over: Partial<MissionModel>): MissionModel => worldModel(160, ui, { maxRows: 3, rich: true, workers: [], ...over });
  test('idle', () => {
    const word = bandLines(rich({}))[0]!.runs.find((x) => x.t === 'idle');
    expect(word?.bold).toBe(true);
  });
  test('blocked by a refused Stop', () => {
    const word = bandLines(rich({ checks: [{ id: 'routing', ok: false }], stopGates: ['routing'] }))[0]!.runs.find((x) => x.t === ' blocked:');
    expect(word?.bold).toBe(true);
  });
});

describe('isMessageKind', () => {
  test('presence and merge events are not messages; a stated or missing kind is', () => {
    for (const k of ['join', 'leave', 'exit', 'merge']) expect(isMessageKind(k)).toBe(false);
    for (const k of ['say', 'dispatch', 'report', 'anything']) expect(isMessageKind(k)).toBe(true);
    expect(isMessageKind(undefined)).toBe(true);
    expect(isMessageKind('')).toBe(true);
  });
});

describe('bandLines: the model carries its own look, and the rich band needs three rows', () => {
  test('a model ui wins over the environment', () => {
    const ascii: Ui = { theme: 'latte', ascii: true, color: 'truecolor' };
    const plain = band(worldModel(160, ascii, { maxRows: 1 }));
    expect(plain).not.toContain('◆');
    expect(plain).toContain('ATLAS');
    expect(band(worldModel(160, ui, { maxRows: 1 }))).toContain('◆');
  });
  test('rich at 3 rows draws the three rich rows, at 2 the one standard row', () => {
    expect(bandLines(worldModel(160, ui, { maxRows: 3, rich: true }))).toHaveLength(3);
    expect(bandLines(worldModel(160, ui, { maxRows: 2, rich: true }))).toHaveLength(1);
  });
});

describe('idleLines: the board slot takes what the head, the core row and the footer leave', () => {
  const core = [{ t: 'contract  3 of 4', tone: 'text' as const }];
  const idle = (maxRows: number): MissionModel => worldModel(120, ui, { workers: [], maxRows, core, boardRows: 40, checks: [{ id: 'routing', ok: true }] });
  test('one head row, one core row, one footer row: the slot is maxRows - 3, and the whole stack is maxRows', () => {
    for (const maxRows of [6, 9, 12]) {
      const lines = missionLines(idle(maxRows));
      expect(lines.find((l) => l.board !== undefined)?.board).toBe(maxRows - 3);
      expect(lines.reduce((n, l) => n + (l.board ?? 1), 0)).toBe(maxRows);
    }
  });
});
