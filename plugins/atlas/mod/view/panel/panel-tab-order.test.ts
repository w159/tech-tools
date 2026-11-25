// The side panel's tab strip: status, health, channel, bored. The gates tab is gone: its denial badge sits on health and its rows sit under the health rows.
import { mock } from 'bun:test';
import { describe, expect, test } from 'claude-code/testing';
import { resolve } from 'node:path';
import { panelWorld } from '../../../contracts/panel-world';
import { uiFromEnv } from '../../design/atlas-ui';
import type { PanelGate, PanelLine } from './panel-shared';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
// Every bored call is recorded: the body for the bored tab must come from boredRows (slice 3 owns the rows).
const calls: { room: number }[] = [];
const boredPath = resolve(import.meta.dir, 'bored-render.ts');
const realBoredRows = (await import('./bored-render')).boredRows; // module mocks outlive their file in one `bun test` run: the mock answers with the sentinel only inside the bored test and delegates to the real rows otherwise
let sentinel = false;
(mock as { module(path: string, factory: () => object): void }).module(boredPath, () => ({
  boredRows: (m: never, room: number): PanelLine[] => { if (!sentinel) return realBoredRows(m, room); calls.push({ room }); return [{ runs: [{ t: ' bored-sentinel', tone: 'text' }] }]; },
}));
const { PANEL_TABS, STRIP_TABS, stripBadges, bodyLines, lineText, panelText } = await import('./panel-layout');
const { gatesRows } = await import('./gates-tab');
const { healthRows } = await import('./health-tab');

const failing: PanelGate[] = [{ id: 'dispatch', title: 'Dispatch tripwire', lines: [{ id: 'verify', label: 'verification coverage', ok: false, fix: 'run the suite' }] }];

describe('panel tab order', () => {
  test('PANEL_TABS is status, health, channel, bored with no gates entry', () => {
    expect(PANEL_TABS.map((t) => `${t.id}/${t.label}`)).toEqual(['route/status', 'core/health', 'channel/channel', 'bored/bored']);
    expect(STRIP_TABS.some((t) => (t.id as string) === 'gates' || t.label === 'gates')).toBe(false);
  });
  test('the denial count badge sits under core, never gates', () => {
    const b = stripBadges({ gates: failing, core: null, unread: 0 });
    expect(b.core).toBe('1');
    expect('gates' in b).toBe(false);
  });
  test('health body is the health rows, then the gates content', () => {
    const m = panelWorld('core', 80, ui, { rows: 60, gates: failing });
    const text = bodyLines(m).map(lineText);
    const hr = healthRows(m, 60).map(lineText);
    const gr = gatesRows(m).map(lineText);
    expect(gr.join('\n')).toContain('verification coverage');
    expect(text.slice(0, hr.length)).toEqual(hr);
    const at = text.findIndex((t) => t.includes('verification coverage'));
    expect(at).toBeGreaterThanOrEqual(hr.length);
    expect(panelText(m).join('\n')).toContain('verification coverage');
  });
  test('the bored body is boredRows', () => {
    const m = panelWorld('bored', 56, ui, { rows: 30 });
    sentinel = true;
    try { expect(bodyLines(m).map(lineText)).toEqual([' bored-sentinel']); } finally { sentinel = false; }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)!.room).toBeGreaterThan(0);
  });
});
