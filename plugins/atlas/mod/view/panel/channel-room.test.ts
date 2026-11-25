// The channel as an AI-agent chat room: a colour per speaker, HH:MM:SS on every message, the user's bubbles on the right, `alpha -> beta` for agent notes, the compose field last.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../../../contracts/panel-world';
import { uiFromEnv } from '../../design/atlas-ui';
import { chatRows } from './channel-chat';
import { lineText, type PanelNote } from './panel-layout';
import { rowWidth } from './panel-shared';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const notes: PanelNote[] = [
  { at: '10:00:01', ms: 1000, from: 'alpha', to: 'beta', text: 'ready for the schema review whenever you are' },
  { at: '10:00:09', ms: 9000, from: 'beta', to: 'alpha', text: 'looking now' },
  { at: '10:00:20', ms: 20000, from: 'human', to: 'all', text: 'please ship the panel today' },
  { at: '10:00:31', ms: 31000, from: 'gamma', text: 'tests green' },
];
const rowsAt = (cols: number, room = 40, over: Partial<Parameters<typeof panelWorld>[3]> = {}) => chatRows(panelWorld('channel', cols, ui, { rows: room + 4, notes, ...over }), room);
const fgOf = (cols: number, name: string): string | undefined =>
  rowsAt(cols).flatMap((l) => l.runs).find((x) => x.t === name && x.bold)?.fg;

describe('channel chat room', () => {
  test('each agent speaks in its own colour', () => {
    const fgs = ['alpha', 'beta', 'gamma'].map((n) => fgOf(56, n));
    expect(fgs.every(Boolean)).toBe(true);
    expect(new Set(fgs).size).toBe(3);
  });
  test('every message header carries HH:MM:SS', () => {
    const text = rowsAt(56).map(lineText).join('\n');
    for (const t of ['10:00:01', '10:00:09', '10:00:20', '10:00:31']) expect(text).toContain(t);
  });
  test('agent-to-agent notes show the recipient', () => {
    const text = rowsAt(56).map(lineText);
    expect(text.some((t) => t.includes('alpha -> beta'))).toBe(true);
    expect(text.some((t) => t.includes('beta -> alpha'))).toBe(true);
  });
  test('the user message is right-aligned, agents are left-aligned', () => {
    const rows = rowsAt(56).map(lineText);
    const mine = rows.find((t) => t.includes('please ship'))!;
    const theirs = rows.find((t) => t.includes('looking now'))!;
    expect(mine.length - mine.trimStart().length).toBeGreaterThan(theirs.length - theirs.trimStart().length + 10);
  });
  test('the message body wraps under the speaker, indented', () => {
    const rows = rowsAt(38).map(lineText);
    const i = rows.findIndex((t) => t.includes('alpha -> beta'));
    expect(rows[i + 1]!.startsWith('   ')).toBe(true);
    expect(rows[i + 2]!.startsWith('   ')).toBe(true);
  });
  test('the compose input is the last row', () => {
    const last = rowsAt(56).at(-1)!;
    expect(last.press?.kind).toBe('compose');
  });
  for (const cols of [38, 56, 80]) {
    test(`no row is wider than ${cols} cells`, () => {
      for (const l of rowsAt(cols)) expect(rowWidth(l.runs)).toBeLessThanOrEqual(cols);
    });
  }
  test('a small room cuts the log from the top and keeps the newest message', () => {
    const rows = rowsAt(56, 14);
    const text = rows.map(lineText).join('\n');
    expect(rows.length).toBeLessThanOrEqual(14);
    expect(text).toContain('tests green');
    expect(text).not.toContain('ready for the schema review');
    expect(text).toContain('earlier');
  });
});
