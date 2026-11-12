// Round 5: the selected row of the TODO and SUBAGENTS blocks is a full-width bar (the 236 fill, the name bold, the `▸ ` cursor text kept so the capture scorer still reads
// the row), the fill survives 256-colour mode through the same stable mapping as every other fill, NO_COLOR draws none, and an unselected row never has one.
import { describe, expect, test } from 'claude-code/testing';
import { fillHex, paintAnsi, runsCells, runsString, type Run, type Ui } from './atlas-ui';
import { agentRows, todoRows, type AgentRow, type TodoRow } from './hud-surface';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const BAR = '#303030'; // 236
const full = { spacers: true, extras: false, close: true };
const agent = (over: Partial<AgentRow> = {}): AgentRow => ({ name: 'alpha-explorer', state: 'running', model: 'haiku', tasks: [1], tool: 'read alpha.py', ctx: null, focus: false, ...over });
const todo = (over: Partial<TodoRow> = {}): TodoRow => ({ label: 'T1 read alpha.py', state: 'running', detail: '', focus: false, ...over });
const paint = (r: Run[], u: Ui): string => r.map((x) => paintAnsi(x, u)).join('');
const filled = (r: Run[]): boolean => r.every((x) => x.bgHex === BAR);

describe('the selected row is a bar', () => {
  for (const cols of [150, 110, 80]) {
    test(`SUBAGENTS at ${cols}: the focused row has every run on 236 and fills the row; its neighbours have none`, () => {
      const rows = agentRows([agent({ focus: true }), agent({ name: 'beta-explorer' })], { cols, ui }, full);
      const [sel, other] = [rows[2]!, rows[3]!];
      expect(filled(sel)).toBe(true);
      expect(runsCells(sel)).toBe(cols); // padded to the full width
      expect(runsString(sel)).toMatch(/^▸ [◐◓◑◒] alpha-explorer\s+running/); // the cursor text and the glyph still start the row for the scorer
      expect(sel.find((x) => x.t.includes('alpha-explorer'))?.bold).toBe(true);
      expect(other.some((x) => x.bgHex !== undefined)).toBe(false);
    });
    test(`TODO at ${cols}: the focused open row has the bar, a queued or unfocused row has none`, () => {
      const rows = todoRows([todo({ focus: true }), todo({ label: 'T2 read beta.py' }), todo({ label: 'T3 later', state: 'queued', focus: true })], { cols, ui }, full);
      expect(filled(rows[1]!)).toBe(true);
      expect(runsCells(rows[1]!)).toBe(cols);
      expect(runsString(rows[1]!)).toMatch(/^▸ [◐◓◑◒] T1 /);
      expect(rows[2]!.some((x) => x.bgHex !== undefined)).toBe(false);
      expect(rows[3]!.some((x) => x.bgHex !== undefined)).toBe(false); // a queued row is never the selected one
    });
  }
  test('256 colours map the bar through the same stable table as every fill; NO_COLOR draws no fill at all', () => {
    const ui256: Ui = { theme: 'mocha', ascii: false, color: '256' };
    const bar = agentRows([agent({ focus: true })], { cols: 110, ui: ui256 }, full)[2]!;
    expect(fillHex(bar[0]!, ui256)).toBe(fillHex({ bg: undefined, bgHex: BAR }, ui256));
    expect(paint(bar, ui256)).toContain('48;5;236');
    const none: Ui = { theme: 'mocha', ascii: false, color: 'none' };
    const flat = agentRows([agent({ focus: true })], { cols: 110, ui: none }, full)[2]!;
    expect(flat.some((x) => x.bgHex !== undefined)).toBe(false);
    expect(paint(flat, none)).not.toContain('\x1b[48');
  });
  test('truecolor paints the 236 fill', () => {
    const bar = agentRows([agent({ focus: true })], { cols: 110, ui }, full)[2]!;
    expect(paint(bar, ui)).toContain('48;2;48;48;48');
  });
});
