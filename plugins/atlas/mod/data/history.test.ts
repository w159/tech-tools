import { beforeEach, expect, test } from 'bun:test';
import type { EngineInterface } from 'claude-code';
import { flushHistory, loadHistory, noteHistoryRun, resetHistory } from './history';

const MIN = 60_000;
let writes = 0;
const $ = { fs: { exists: async () => true, read: async () => JSON.stringify({ v: 1, runs: [], lat: {}, min: [{ m: 0, n: 3 }, { m: 50, n: 2 }], ctx: null, gates: [] }), write: async () => { writes += 1; } } } as unknown as EngineInterface;

beforeEach(async () => {
  writes = 0;
  resetHistory(0);
  await loadHistory($, '/r', 0);
});

test('at rest: 0 history writes over 10 simulated minutes, even while old minutes age out', async () => {
  await flushHistory($, '/r', 55 * MIN, true); // a real change (forced at turn end)
  expect(writes).toBe(1);
  for (let t = 55 * MIN; t <= 65 * MIN; t += 10_000) await flushHistory($, '/r', t);
  expect(writes).toBe(1);
});

test('a real change still writes', async () => {
  await flushHistory($, '/r', 55 * MIN, true);
  noteHistoryRun({ secs: 5, ok: true, tools: 1, at: 56 * MIN });
  await flushHistory($, '/r', 57 * MIN);
  expect(writes).toBe(2);
});
