// State 40: the TODO summary row, the lead item, the SUBAGENTS table while agents run, its LAST text and TIME clock (critique 39).
import { describe, expect, test } from 'claude-code/testing';
import { runsString, type Run, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { hudLines, type HudAgent, type HudInput } from './hud';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const NOW = 5_000_000;
const text = (rows: readonly (readonly Run[])[]): string[] => rows.map((r) => runsString([...r]).trimEnd());
const item = (i: number, status: string, content: string, owner?: string, extra: Record<string, unknown> = {}): TodoItem => ({ id: `t${i}`, content, status, ...(owner ? { owner } : {}), ...extra }) as unknown as TodoItem;
const agent = (name: string, state: string, ui_: string, extra: Partial<HudAgent> = {}): HudAgent => ({ name, role: 'explorer', state, ui: ui_ as never, model: 'haiku', since: NOW - 20_000, ...extra }) as HudAgent;
const view = (cols: number, maxRows: number, extra: Record<string, unknown> = {}) => ({ cols, maxRows, ui, now: NOW, ...extra });

describe('1. the summary row counts every hidden state apart', () => {
  // stoprun-110-1/f0074: T2 was closed by the lead over a failed worker; the title reads `4/5 · ■1` and the hidden rows were `● 3 done`.
  const todos = [item(1, 'completed', 'T1 read alpha.py', 'alpha-explorer'), item(2, 'completed', 'T2 read ghost.py', 'ghost-explorer'), item(3, 'completed', 'T3 read beta.py', 'beta-explorer'), item(4, 'completed', 'T4 combine the reports'), item(5, 'pending', 'T5 write the summary')];
  const agents = [agent('alpha-explorer', 'done', 'done'), agent('ghost-explorer', 'failed', 'failed'), agent('beta-explorer', 'done', 'done')];
  const input: HudInput = { todos, agents };
  for (const cols of [93, 56]) {
    test(`${cols} cells: a failed item is never folded into the done count; failed rows hide after the done and queued ones`, () => {
      const rows = text(hudLines(input, view(cols, 9, { merge: false })));
      const summary = rows.find((r) => /^ {2}\S \d+ (?:more )?(?:done|failed|queued)/.test(r))!;
      expect(summary, rows.join('\n')).toBeDefined();
      expect(summary).toMatch(/● \d+ done/);
      const shown = rows.filter((r) => /^[▸ ] [◐◓◑◒◇●■▲◉] T\d/.test(r));
      const counted = [...summary.matchAll(/(\d+) (?:more )?(?:queued|running|done|failed)/g)].reduce((n, m) => n + Number(m[1]), 0);
      expect(shown.length + counted, rows.join('\n')).toBe(5);
      expect(rows.find((r) => /▸ TODO/.test(r))).toMatch(/3\/5 · ■1/);
      const failedDrawn = shown.some((r) => /^[▸ ] ■ T2/.test(r));
      expect(failedDrawn || /■ 1 failed/.test(summary), rows.join('\n')).toBe(true); // the failed row is drawn, or counted as failed: never as done
      if (/◇ \d+ queued/.test(summary)) expect(failedDrawn, rows.join('\n')).toBe(true); // queued rows go before a failed one is hidden
    });
  }
  test('with the failed row hidden the summary reads `● 3 done  ■ 1 failed  ◇ 1 queued`, each glyph in its own colour', () => {
    const lines = hudLines(input, view(93, 8, { merge: false }));
    const row = lines.find((r) => /^ {2}\S \d+ (?:done|failed|queued)/.test(runsString([...r])))!;
    expect(row, text(lines).join('\n')).toBeDefined();
    const glyphs = row.filter((x) => ['●', '■', '◇'].includes(x.t));
    expect(glyphs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(glyphs.map((x) => x.tone)).size).toBe(glyphs.length);
    expect(runsString([...row]).trim()).toBe('● 3 done  ■ 1 failed  ◇ 1 queued');
    const words = row.filter((x) => /failed/.test(x.t));
    for (const w of words) expect(w.tone).toBe('bad');
  });
});
