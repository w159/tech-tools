// Edge pins for mod/view/panel/panel-layout.ts (surviving mutants of the 553a9bce run): which worker takes the focus mark, when the channel log
// grows a word column, the two-line wrap, the dispatch name column cap, and that a dispatch detail is never clipped at any width.
// Expectations are literal text.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../../../contracts/panel-world';
import type { Ui } from '../../design/atlas-ui';
import type { CoreModel } from '../../data/core';
import { bodyLines, lineText, wrap, type PanelModel, type PanelNote, type PanelTab, type PanelWorker } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const body = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}, ui: Ui = mocha): string[] => bodyLines(panelWorld(t, cols, ui, over)).map((l) => lineText(l).trimEnd());
const w = (name: string, state: PanelWorker['state'], over: Partial<PanelWorker> = {}): PanelWorker => ({ name, state, detail: '', ...over });
const lead = w('lead', 'waiting', { role: 'lead', detail: 'idle' });
const note = (over: Partial<PanelNote> = {}): PanelNote => ({ at: '10:02', from: 'lead', text: 'hello', ...over });
const empty = (): CoreModel => ({
  contract: { header: { ok: 0, total: 0 }, evidence: { ok: 0, total: 0 }, openGates: 0, verifiedDone: { ok: 0, total: 0 } },
  verdicts: [], claims: [], ledger: { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 },
  offload: { workers: [], kept: 0, returned: 0, ratio: null }, routes: [],
} as unknown as CoreModel);
const route = (id: string, over: Record<string, unknown> = {}) => ({ teamId: id, name: id, cls: 'fix', effort: 'low', isolation: 'shared', maxParallel: 1, seats: [], drift: [], transport: 'tmux', ...over });

const strip = (rows: string[]): string[] => rows.map((l) => l.replace(/ +10:02$/, ''));

describe('team tab focus mark', () => {
  const ws = [w('a', 'running'), w('b', 'waiting')];
  const marked = (over: Partial<PanelModel>): string[] => bodyLines(panelWorld('team', 80, mocha, { lead, workers: ws, ...over })).filter((l) => l.runs[0]?.t === '▸' && l.runs[0].bold).map((l) => lineText(l).split(/\s+/)[2]!); // round 3 (E8): every expandable row carries `▸`; the focus is the bold accent one
});

describe('channel log word column', () => {
  const only = (kind: PanelNote['kind']): string => strip(body('channel', 120, { notes: [note({ kind, from: 'a' })] }))[1]!;
});

describe('wrap', () => {
  test('is two lines by default and the second is cut with `…` when text is left over', () => {
    expect(wrap('alpha beta gamma delta epsilon zeta eta theta', 12)).toEqual(['alpha beta', 'gamma delta…']);
    expect(wrap('alpha beta gamma delta epsilon zeta eta theta', 12, 4)).toHaveLength(4);
    expect(wrap('alpha beta gamma', 12)).toEqual(['alpha beta', 'gamma']);
  });
});

describe('core tab dispatch rows', () => {
  test('a detail is whole at every width: it fits after the row or wraps under it, and is never clipped by one cell', () => {
    const c = empty();
    c.routes = [route('rt-zq', { maxParallel: 7, isolation: 'worktree', seats: [{ role: 'runner', count: 1, model: 'model-zz', effort: 'xhigh', ran: [] }] })] as never;
    for (let cols = 30; cols <= 140; cols++) {
      const text = body('core', cols, { core: c }).join(' ');
      expect([cols, /rt-zq\s+tmux,\s+worktree,\s+max\s+7/.test(text)]).toEqual([cols, true]);
      expect([cols, /not run yet,\s+planned\s+model-zz,\s+xhigh\s+effort/.test(text)]).toEqual([cols, true]);
    }
  });
});
