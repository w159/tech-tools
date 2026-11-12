// Edge pins for mod/panel-layout.ts (surviving mutants of the 553a9bce run): which worker takes the focus mark, when the channel log
// grows a word column, the two-line wrap, the dispatch name column cap, and that a dispatch detail is never clipped at any width.
// Expectations are literal text.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import type { Ui } from './atlas-ui';
import type { CoreModel } from './data/core';
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
  const marked = (over: Partial<PanelModel>): string[] => body('team', 80, { lead, workers: ws, ...over }).filter((l) => l.startsWith('▸')).map((l) => l.split(/\s+/)[2]!);
  test('without a recipient the first running worker is marked', () => {
    expect(marked({ recipient: undefined })).toEqual(['a']);
  });
  test('a recipient that is not on the roster falls back to the first running worker', () => {
    expect(marked({ recipient: 'ghost' })).toEqual(['a']);
  });
  test('a recipient on the roster takes the mark, and only it', () => {
    expect(marked({ recipient: 'b' })).toEqual(['b']);
  });
  test('with nobody running and no recipient, nobody is marked', () => {
    expect(marked({ workers: [w('b', 'waiting')], recipient: undefined })).toEqual([]);
  });
});

describe('channel log word column', () => {
  const only = (kind: PanelNote['kind']): string => strip(body('channel', 120, { notes: [note({ kind, from: 'a' })] }))[1]!;
  test('a lone blocked, handoff or done note brings the word column; a lone plain note has none', () => {
    expect(only('blocked')).toBe('  ▣ a  blocked hello');
    expect(only('handoff')).toBe('  ● a  handoff hello');
    expect(only('done')).toBe('  ● a  done    hello');
    expect(only(undefined)).toBe('    a hello');
  });
  test('a plain note beside a marked one is padded to the word column', () => {
    expect(strip(body('channel', 120, { notes: [note({ kind: 'done', from: 'a' }), note({ from: 'b' })] })).slice(1)).toEqual(['  ● a  done    hello', '    b          hello']);
  });
});

describe('wrap', () => {
  test('is two lines by default and the second is cut with `…` when text is left over', () => {
    expect(wrap('alpha beta gamma delta epsilon zeta eta theta', 12)).toEqual(['alpha beta', 'gamma delta…']);
    expect(wrap('alpha beta gamma delta epsilon zeta eta theta', 12, 4)).toHaveLength(4);
    expect(wrap('alpha beta gamma', 12)).toEqual(['alpha beta', 'gamma']);
  });
});

describe('core tab dispatch rows', () => {
  test('the name column is capped at 16 cells, cut in the middle', () => {
    const c = empty();
    c.routes = [route('t1', { cls: 'implement', effort: 'medium', seats: [{ role: 'completeness-critic', count: 1, model: 'sonnet', effort: 'low', ran: ['sonnet'] }] })] as never;
    expect(body('core', 120, { core: c }).filter((l) => /implement|critic|complete/.test(l))).toEqual([
      '    implement team (medium effort) t1  tmux, shared, max 1',
      '  ●   1 completenes… as planned ran sonnet, low effort',
    ]);
  });
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
