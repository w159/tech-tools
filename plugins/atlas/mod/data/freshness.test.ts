// Current, structured state: the HUD channel line is built from who/to/kind (never message text); the todo cache keys on
// mtime AND size; a change to a gate file reaches the gates on the next poll; spinner frames come from the shared clock.
import { describe, expect, test } from 'claude-code/testing';
import type { Ui } from '../design/atlas-ui';
import { spinFrameOf, spinnerGlyph } from '../design/atlas-ui';
import { missionLines, runsText, type MissionModel, type MissionWorker } from '../view/band/mission-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const model = (over: Partial<MissionModel> = {}): MissionModel => ({
  cols: 120, maxRows: 12, tick: 0, project: 'p', phases: ['plan', 'build'], phase: 'build', done: 1, total: 3, workers: [], checks: null, ui, ...over,
});
const rows = (m: MissionModel): string[] => missionLines(m).map((l) => runsText(l.runs));

describe('step 1: the channel line is structured, never message text', () => {
  const body = '1. Read /mnt/attach/project-files/atlas-ui-redesign/round2/alpha.py and report';
});

describe('step 5: spinner frames come from the shared clock and the worker name', () => {
});
