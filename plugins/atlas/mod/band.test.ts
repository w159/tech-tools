// Tests for band.tsx buildConveyor usage honesty (unknown vs measured zero):
// null figures render `ctx --` / `-- tok` / `$--`; a measured 0 still renders
// 0; an absent usage prop falls back to the snapshot numbers (old behavior).
import { describe, expect, test } from 'claude-code/testing';
import { buildConveyor, type BandProps } from './band';
import type { AtlasSnapshot } from './contract';

function snap(over: Partial<AtlasSnapshot> = {}): AtlasSnapshot {
  return {
    root: '/r',
    sessionId: 's',
    channel: null,
    contract: { phases: [], headerFirstLinePattern: '', itemPhasePrefix: '', todoPhases: [] },
    personas: [],
    todos: [],
    counts: { done: 0, total: 0, byPhase: {} },
    phase: 'research',
    phaseSource: 'default',
    notes: [],
    members: [],
    squad: [{ name: 'aa-1', persona: 'unknown', state: 'running', source: 'task' }],
    unread: 0,
    tokens: 0,
    costUsd: 0,
    contextPct: 0,
    headerMisses: 0,
    now: 0,
    ...over,
  };
}

const textOf = (w: number, s: AtlasSnapshot, usage?: BandProps['usage']) =>
  buildConveyor(s, w, usage).segs.map((seg) => seg.text).join('');

describe('conveyor usage honesty', () => {
  test('unmeasured figures render as dashes, never as zeros', () => {
    const text = textOf(200, snap(), { tokens: null, costUsd: null, contextPct: null });
    expect(text).toContain('ctx --');
    expect(text).toContain('-- tok');
    expect(text).toContain('$--');
    expect(text).not.toContain('0%');
    expect(text).not.toContain('0 tok');
    expect(text).not.toContain('$0.00');
  });

  test('a measured zero still renders as zero', () => {
    const text = textOf(200, snap(), { tokens: 0, costUsd: 0, contextPct: 0 });
    expect(text).toContain('0%');
    expect(text).toContain('0 tok');
    expect(text).toContain('$0.00');
  });

  test('measured nonzero figures render their values', () => {
    const text = textOf(200, snap(), { tokens: 15000, costUsd: 0.05, contextPct: 12 });
    expect(text).toContain('12%');
    expect(text).toContain('15k tok');
    expect(text).toContain('$0.05');
  });

  test('absent usage prop falls back to the snapshot numbers', () => {
    const text = textOf(200, snap({ tokens: 3000, costUsd: 0.02, contextPct: 5 }));
    expect(text).toContain('5%');
    expect(text).toContain('3k tok');
    expect(text).toContain('$0.02');
  });

  test('a squad with a live agent is drawn instead of the empty text', () => {
    const text = textOf(200, snap());
    expect(text).not.toContain('no live agents');
    expect(text).toContain('aa-1');
  });

  test('an all-idle squad keeps the empty-state text', () => {
    const text = textOf(
      200,
      snap({ squad: [{ name: 'aa-1', persona: 'unknown', state: 'finished', source: 'task' }] }),
    );
    expect(text).toContain('no live agents');
  });
});
