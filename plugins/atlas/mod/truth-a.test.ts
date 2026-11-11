// Critique 8, slice A: the header contract has one evaluation (core row and gates tab), and BLOCKED follows the Stop verdict only.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { panelWorld } from '../contracts/panel-world';
import type { Ui } from './atlas-ui';
import { coreModel } from './data/core';
import { gateTally, withHeaderTally } from './data/runstate';
import { panelText } from './panel-layout';
import type { PanelModel } from './panel-layout';
import type { GateGroup } from './pane/sidebar-types';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const headerPass = { id: 'header', title: 'Header contract', lines: [{ id: 'header-matched', label: 'Last reply header matched', ok: true, detail: 'declared phase: research' }] } as GateGroup;
const core = (ok: number, total: number) => coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok, total }, openGates: 0 });
const text = (tab: PanelModel['tab'], over: Partial<PanelModel>): string[] => panelText(panelWorld(tab, 120, ui, { rows: 40, ...over }));

describe('A3: header n of m and the Header contract row are one evaluation', () => {
  test('the last reply matched but 6 of 8 replies did: the gate is not passing', () => {
    const groups = withHeaderTally([headerPass], { ok: 6, total: 8 });
    expect(groups[0]!.lines).toEqual([{ id: 'header-matched', label: 'Replies with header matched', ok: false, detail: '6 of 8' }]);
    const t = gateTally(groups as never);
    expect(t.failing).toEqual(['header']);
  });
  test('every reply matched: the gate passes and says n of n', () => {
    const groups = withHeaderTally([headerPass], { ok: 8, total: 8 });
    expect(groups[0]!.lines[0]).toMatchObject({ ok: true, detail: '8 of 8' });
  });
  test('no replies counted yet: the gate keeps its own line', () => {
    expect(withHeaderTally([headerPass], { ok: 0, total: 0 })[0]).toBe(headerPass);
    expect(withHeaderTally([headerPass], undefined)[0]).toBe(headerPass);
    expect(withHeaderTally([], { ok: 1, total: 2 })).toEqual([]);
  });
  test('the gates tab reads the core tally: core amber 6 of 8 never sits beside a passing Header contract', () => {
    const rows = text('gates', { gates: [headerPass] as never, core: core(6, 8) }).join('\n');
    expect(rows).toMatch(/■ Header contract +failing/);
    expect(rows).not.toContain('Last reply header matched');
    expect(rows).toContain('0 of 1 green');
    const all = text('gates', { gates: [headerPass] as never, core: core(8, 8) }).join('\n');
    expect(all).not.toMatch(/Header contract +failing/);
    expect(all).toContain('Header contract');
  });
});
