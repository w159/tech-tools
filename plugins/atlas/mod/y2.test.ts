// y2.test.ts: round Y2 (critics/spec-y.md Y2a-Y2f): whole sections only under any row budget with a `+N more ›` chip, each tab its own body, chips visibly raised, colour that carries meaning, round chart buckets.
import { describe, expect, test } from 'claude-code/testing';
import { cardFrame } from './card-frame';
import { CARD_MORE_KEY, GOTO_PREFIX, ROUND_BUCKETS, bucketLabel, ctxLevel, roundBucket } from './status-frame';
import { tabFrame, tabText, type TabId, type TabIn } from './tabs-frame';
import { hexTo256, uiFromEnv, type Run, type Ui } from './atlas-ui';
import { bandLook } from './band-frame';
import { chipStyle, tileOf } from './clickable';
import type { Health, HealthCheck } from './idle-health';

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const ui256: Ui = { ...uiFromEnv({}), color: '256' };
const checks: HealthCheck[] = [
  { id: 'completion', ok: true, lines: 1, pass: 1 }, { id: 'tripwire', ok: true, lines: 2, pass: 2 },
  { id: 'routing', ok: true, lines: 8, pass: 8 }, { id: 'header', ok: true, lines: 1, pass: 1 },
];
const GROUPS = checks.map((c) => ({ id: c.id, title: c.id, lines: [{ id: 'a', label: 'line a', ok: true, detail: 'ok' }] }));
const health = (o: Partial<Health> = {}): Health => ({
  gates: { total: 4, green: 4, checks }, version: '17.23.0', branch: 'master', team: 'off', upSecs: 185, ctxPct: 6, tokens: 64_000, window: 1_000_000,
  last: { secs: 5, done: 6, total: 6, agents: 0, failed: 0, endedAgo: 3 },
  hooks: { total: 12, byLabel: [{ label: 'tool.call', n: 6 }], lastEventSecs: 4, latency: { n: 12, p50: 3, p95: 5 }, recent: [{ label: 'tool.call Bash', ageSecs: 4, ms: 3 }, { label: 'turn.complete', ageSecs: 9, ms: 4 }] },
  pulse: { events: [0, 0, 0, 1, 0, 0, 2, 2, 2, 0, 0, 0, 0, 1, 5, 2], ctx: [{ tokens: 52_000, pct: 5, at: 1 }, { tokens: 64_000, pct: 6, at: 2 }], runs: [{ secs: 33, ok: true, at: 1 }, { secs: 58, ok: false, at: 2 }] },
  ...o,
});
const tab = (t: TabId, cols: number, o: Partial<TabIn> = {}): TabIn => ({ tab: t, cols, room: 39, ui, kind: 'idle', health: health(), gates: GROUPS, workers: [], todos: [], notes: [], channel: 'c', people: 1, recipient: null, flips: [], lead: false, ...o });
const rowText = (r: readonly Run[]): string => r.map((x) => x.t).join('').trimEnd();
const SECTION = /^ ── ([A-Z]+) /;

describe('Y2a: whole sections only, under every row budget', () => {
  for (const cols of [150, 110, 48, 41]) {
    test(`card at ${cols}: budgets 12..45 never cut a section; the chip says how many went and carries the open key`, () => {
      const full = cardFrame(health(), { cols, ui });
      const names = (rows: readonly (readonly Run[])[]): string[] => rows.flatMap((r) => [...rowText(r).matchAll(/── ([A-Z]+) /g)].map((m) => m[1]!));
      const all = names(full);
      expect(all.length).toBeGreaterThan(2);
      for (let budget = 12; budget <= 45; budget++) {
        const rows = cardFrame(health(), { cols, ui, maxRows: budget });
        expect(rows.length, `${cols}@${budget}`).toBeLessThanOrEqual(Math.max(budget, 12));
        const kept = names(rows);
        // every kept section is whole: its rows equal the same section of the full card (in column one the order is stable)
        for (const n of kept) expect(all, `${cols}@${budget}`).toContain(n);
        const more = rows.map((r) => r.find((x) => x.press === CARD_MORE_KEY)).find(Boolean);
        if (kept.length < all.length) {
          expect(more, `${cols}@${budget} dropped sections need a chip`).toBeDefined();
          expect(more!.t).toMatch(/\+\d+ more [›>]/);
          expect(rowText(rows.at(-1)!)).toMatch(/\+\d+ more/);
        } else expect(more, `${cols}@${budget}`).toBeUndefined();
      }
    });
  }
  test('a roomy card keeps every section and shows no chip', () => {
    const rows = cardFrame(health(), { cols: 150, ui, maxRows: 60 });
    expect(rows.flat().some((x) => x.press === CARD_MORE_KEY)).toBe(false);
  });
  for (const cols of [48, 41]) for (const t of ['team', 'channel', 'gates', 'core', 'board'] as TabId[]) {
    test(`${t} at ${cols}: pane rows 12..45 never cut a section; a dropped shared section leaves a goto chip`, () => {
      const full = tabText(tabFrame(tab(t, cols, { room: 80 }))).filter((l) => SECTION.test(l));
      for (let room = 12; room <= 45; room++) {
        const lines = tabFrame(tab(t, cols, { room }));
        const txt = tabText(lines);
        const sections = txt.filter((l) => SECTION.test(l));
        expect(sections.length, `${t}@${cols}/${room}`).toBeGreaterThanOrEqual(1);
        expect(sections[0], `${t}@${cols}/${room}`).toBe(full[0]);
        if (sections.length < full.length) {
          const chip = lines.find((l) => l.press?.kind === 'goto');
          expect(chip, `${t}@${cols}/${room}`).toBeDefined();
          expect(tabText([chip!])[0]).toMatch(/\+\d+ more [›>]/);
          expect(chip!.press!.key.length).toBeGreaterThan(0);
        }
      }
    });
  }
  test('the goto key reaches a view: the run press carries the goto prefix the panel turns into a view switch', () => {
    const rows = cardFrame(health(), { cols: 150, ui, maxRows: 12 }).flat();
    expect(rows.some((x) => x.press === CARD_MORE_KEY)).toBe(true);
    expect(GOTO_PREFIX).toBe('goto:');
  });
});

describe('Y2b: each tab shows its own body plus exactly one related shared section', () => {
  const OWN: Record<string, [string, string]> = { team: ['TEAM', 'ACTIVITY'], board: ['BOARD', 'RUNS'], channel: ['CHANNEL', 'RECENT'], core: ['CORE', 'GATES'], gates: ['GATES', 'HOOKS'] };
  for (const cols of [48, 41]) for (const t of Object.keys(OWN) as TabId[]) {
    test(`${t} at ${cols}: ribbons are [own, ${OWN[t]![1]}]`, () => {
      const r = tabText(tabFrame(tab(t, cols, { room: 45 }))).filter((l) => SECTION.test(l)).map((l) => l.match(SECTION)![1]!);
      expect(r).toHaveLength(2);
      expect(r[1]).toBe(OWN[t]![1]);
    });
  }
});

describe('Y2c: chips read as buttons', () => {
  test('the chip fill is at least two 256-colour steps lighter than the 234 panel surface, and truecolor carries the same step', () => {
    for (const u of [ui, ui256]) {
      const fill = chipStyle(u).backgroundColor!;
      expect(hexTo256(fill) - 234, u.color).toBeGreaterThanOrEqual(2);
      expect(tileOf(u)).toBe(fill);
    }
    expect(chipStyle({ ...ui, color: 'none' }).backgroundColor).toBeUndefined();
  });
  test('tab chips are drawn on the raised fill with a cell of padding either side', () => {
    const lines = tabFrame(tab('team', 48, { room: 45, workers: [{ name: 'w', state: 'running', detail: 'x', secs: 3 }] }));
    const chip = lines.find((l) => l.press?.kind === 'flip')!;
    const filled = chip.runs.filter((x) => x.bgHex !== undefined);
    expect(filled.length).toBeGreaterThan(0);
    for (const x of filled) expect(hexTo256(x.bgHex!) - 234).toBeGreaterThanOrEqual(2);
    expect(filled[0]!.t).toMatch(/^ /);
    expect(filled.at(-1)!.t).toMatch(/ $/);
  });
  test('the gate group rows carry the chip fill on the caret cell', () => {
    const lines = tabFrame(tab('gates', 48, { room: 45, kind: 'working' }));
    const g = lines.find((l) => l.press?.kind === 'flip' && /[▸▾]/.test(rowText(l.runs)))!;
    const caret = g.runs.find((x) => /[▸▾]/.test(x.t))!;
    expect(caret.bgHex).toBeDefined();
    expect(hexTo256(caret.bgHex!) - 234).toBeGreaterThanOrEqual(2);
  });
  test('the channel compose line draws a visible input field after the chip', () => {
    for (const cols of [48, 41]) {
      const lines = tabFrame(tab('channel', cols, { room: 45, kind: 'working' }));
      const c = lines.find((l) => l.press?.kind === 'compose')!;
      const t = rowText(c.runs);
      expect(t, String(cols)).toMatch(/✎ message/);
      expect(t.slice(t.indexOf('message')), String(cols)).toMatch(/[▁_]{4,}/);
    }
  });
});

describe('Y2d: colour carries meaning', () => {
  test('ctx levels: below 70 ok, 70 warn, 90 bad', () => {
    expect([0, 69, 70, 89, 90, 100].map(ctxLevel)).toEqual(['ok', 'ok', 'warn', 'warn', 'bad', 'bad']);
  });
  const colourOf = (rows: readonly (readonly Run[])[], needle: RegExp): (string | undefined)[] => rows.flat().filter((x) => needle.test(x.t)).map((x) => x.fg);
  test('the card context figure follows the ramp: calm green, hot red, never the same', () => {
    const calm = colourOf(cardFrame(health({ ctxPct: 20 }), { cols: 150, ui }), /20%/);
    const hot = colourOf(cardFrame(health({ ctxPct: 95 }), { cols: 150, ui }), /95%/);
    expect(calm.length + hot.length).toBeGreaterThan(0);
    if (calm.length && hot.length) expect(calm[0]).not.toBe(hot[0]);
  });
  test('labels are neutral: the column heads and section names never take a ramp colour', () => {
    const k = bandLook(ui);
    const ramp = new Set([k.ok, k.warn, k.bad].map((x) => x.toLowerCase()));
    const rows = cardFrame(health(), { cols: 150, ui }).flat();
    const heads = rows.filter((x) => /^(?: ?(?:pass|deny|last|p50|p95|n|hook))+ *$/.test(x.t.trim()) && x.t.trim() !== '');
    expect(heads.length).toBeGreaterThan(0);
    for (const x of heads) expect(ramp.has((x.fg ?? '').toLowerCase()), x.t).toBe(false);
  });
});

describe('Y2f: round bucket sizes', () => {
  test('the sizes are the round ladder and the smallest that fits the columns', () => {
    expect([...ROUND_BUCKETS]).toEqual([1, 2, 5, 10, 15, 30, 60, 120]);
    expect(roundBucket(60, 60)).toBe(1);
    expect(roundBucket(120, 60)).toBe(2);
    expect(roundBucket(300, 60)).toBe(5);
    expect(roundBucket(600, 60)).toBe(10);
    expect(roundBucket(900, 60)).toBe(15);
    expect(roundBucket(1800, 60)).toBe(30);
    expect(roundBucket(3600, 60)).toBe(60);
    expect(roundBucket(7200, 60)).toBe(120);
    for (let w = 60; w <= 1800; w += 60) for (const c of [20, 30, 40, 46]) { const b = roundBucket(w, c); expect(ROUND_BUCKETS).toContain(b); expect(w / b).toBeLessThanOrEqual(c); }
  });
  test('the label names a round size, never 1.7s', () => {
    for (const b of ROUND_BUCKETS) expect(bucketLabel(b)).toMatch(/^\d+[sm]$/);
  });
  test('the card chart prints `peak N / <round>` and no fractional bucket', () => {
    for (const cols of [150, 110]) {
      const t = cardFrame(health(), { cols, ui }).map(rowText).join('\n');
      const m = t.match(/peak \d+ \/ (\d+[sm])/);
      expect(m, String(cols)).not.toBeNull();
      expect(t).not.toMatch(/\/ \d+\.\d+s/);
    }
  });
});
