// Current, structured state: the HUD channel line is built from who/to/kind (never message text); the todo cache keys on
// mtime AND size; a change to a gate file reaches the gates on the next poll; spinner frames come from the shared clock.
import { describe, expect, test } from 'claude-code/testing';
import type { Ui } from './atlas-ui';
import { spinFrameOf, spinnerGlyph } from './atlas-ui';
import { missionLines, runsText, type MissionModel, type MissionWorker } from './mission-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const model = (over: Partial<MissionModel> = {}): MissionModel => ({
  cols: 120, maxRows: 12, tick: 0, project: 'p', phases: ['plan', 'build'], phase: 'build', done: 1, total: 3, workers: [], checks: null, ui, ...over,
});
const rows = (m: MissionModel): string[] => missionLines(m).map((l) => runsText(l.runs));

describe('step 1: the channel line is structured, never message text', () => {
  const body = '1. Read /mnt/attach/project-files/atlas-ui-redesign/round2/alpha.py and report';
  test('a report reads `gamma-explorer to lead   reported`, the lead id collapsed, no body', () => {
    const line = rows(model({ workers: [{ name: 'a', state: 'running', secs: 1 }], note: { from: 'gamma-explorer', to: 'lead-a3a3ab', text: body, kind: 'report', at: '10:02' } })).find((x) => x.includes(' to '))!;
    expect(line).toMatch(/^ gamma-explorer to lead {3}reported +10:02 $/);
    expect(line).not.toContain('/mnt');
    expect(line).not.toContain('1. Read');
  });
  test('dispatch and unknown kinds read as words of our own', () => {
    const at = (kind?: string) => rows(model({ workers: [{ name: 'a', state: 'running', secs: 1 }], note: { from: 'lead-a3a3ab', to: 'alpha-explorer', text: body, kind } })).find((x) => x.includes(' to '))!;
    expect(at('dispatch')).toContain('lead to alpha-explorer   dispatched work');
    expect(at(undefined)).toContain('sent a message');
  });
});

describe('step 5: spinner frames come from the shared clock and the worker name', () => {
  test('a running mark at `now` is the spinFrameOf(now, name) glyph, not the local tick', () => {
    const now = 1_910_000_000_000;
    const w = (name: string): MissionWorker => ({ name, state: 'running', secs: 1 });
    const mark = (name: string) => rows(model({ tick: 0, now, workers: [w(name)] })).find((x) => x.includes(name))!.trim()[0];
    for (const name of ['alpha-explorer', 'beta-explorer', 'gamma-explorer']) expect(mark(name)).toBe(spinnerGlyph(spinFrameOf(now, name), false));
    const glyphs = new Set(['alpha-explorer', 'beta-explorer', 'gamma-explorer', 'delta', 'epsilon'].map(mark));
    expect(glyphs.size).toBeGreaterThan(1); // two agents are not in lockstep
  });
});
