// Dollars only for a worker billed per token: a plan login (init apiKeySource "none") still writes a
// total_cost_usd estimate in its result event, which is not a charge.
import { describe, expect, test } from 'bun:test';
import { coreModel, type CoreInput } from './core';

const emptyIn = (over: Partial<CoreInput> = {}): CoreInput =>
  ({ findings: '', teams: [], matrix: '', logs: {}, reports: [], todos: [], header: { ok: 0, total: 0 }, openGates: 0, ...over });
const init = (src?: string): string =>
  JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', ...(src === undefined ? {} : { apiKeySource: src }) });
const body = (cost: number): string =>
  [
    JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } } }),
    JSON.stringify({ type: 'result', total_cost_usd: cost, modelUsage: { 'claude-sonnet-5-5': { costUSD: cost } } }),
  ].join('\n');
const workers = (logs: Record<string, string>) =>
  Object.fromEntries(coreModel(emptyIn({ logs })).offload.workers.map((w) => [w.name, w]));

describe('offload dollars follow billing', () => {
  test('plan init: no dollars, tokens kept', () => {
    const w = workers({ 'w-1': `${init('none')}\n${body(0.4567896)}` })['w-1']!;
    expect([w.costUsd, w.billing, w.peak, w.finished]).toEqual([null, 'plan', 1010, true]);
  });
  test('api init keeps the dollars', () => {
    const w = workers({ 'w-1': `${init('ANTHROPIC_API_KEY')}\n${body(0.25)}` })['w-1']!;
    expect([w.costUsd, w.billing]).toEqual([0.25, 'api']);
  });
  test('no init event, or no apiKeySource: no dollars', () => {
    const ws = workers({ 'w-1': body(0.3), 'w-2': `${init()}\n${body(0.3)}`, 'w-3': `${init('')}\n${body(0.3)}` });
    for (const n of ['w-1', 'w-2', 'w-3']) expect([ws[n]!.costUsd, ws[n]!.billing]).toEqual([null, 'plan']);
  });
  test('mixed run: only the billed worker carries dollars', () => {
    const ws = workers({ 'w-1': `${init('ANTHROPIC_API_KEY')}\n${body(0.25)}`, 'w-2': `${init('none')}\n${body(0.9)}` });
    expect([ws['w-1']!.costUsd, ws['w-2']!.costUsd]).toEqual([0.25, null]);
  });
});
