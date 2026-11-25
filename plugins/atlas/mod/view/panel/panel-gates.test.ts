// Design rev 5, slice C2: the gates tab is grouped by check. Every group row is a bold title with its count (`8 pass · 0 deny`, right aligned on one column, warn only while the group fails);
// the group's checks sit indented under the title, their mark under the title's first letter, never in the title's mark column.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../../../contracts/panel-world';
import { cells, uiFromEnv } from '../../design/atlas-ui';
import { bodyLines, lineText, type PanelGate, type PanelModel } from './panel-layout';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
// fix1728: a completion line is pending until a Stop refuses. The refused Stop (a record, never a gate row) keeps this group a real failure, so the count column and its tone are tested on one.
const STOP = { id: 'stop-verdict', label: 'Last Stop blocked', ok: true, detail: 'verification coverage' };
const gates: PanelGate[] = [
  { id: 'completion', title: 'Completion gate', lines: [{ id: 'verify', label: 'verification coverage', ok: false, fix: 'run the suite' }, { id: 'docs', label: 'docs updated', ok: true }, { id: 'ev', label: 'evidence recorded', ok: true }, STOP] },
  { id: 'dispatch', title: 'Dispatch tripwire', lines: [{ id: 'name', label: 'named dispatch', ok: true }, { id: 'scope', label: 'scope declared', ok: true }] },
  { id: 'header', title: 'Header contract', lines: [{ id: 'header-matched', label: 'header matched', ok: true, detail: '8 of 8' }] },
];
const body = (cols: number, over: Partial<PanelModel> = {}) => bodyLines(panelWorld('gates', cols, ui, { rows: 40, gates, ...over }));

describe('C2: gates grouped by check', () => {
  for (const cols of [38, 49, 80]) {
  }
});
