import { describe, expect, test as bareTest } from 'claude-code/testing';
import type { EngineInterface } from 'claude-code';
import { clearLook, lookOf, lookRich, lookUi, readLook } from './look';

const KEYS = ['NO_COLOR', 'ATLAS_ASCII', 'ATLAS_THEME', 'COLORTERM', 'TERM', 'ATLAS_BAND_RICH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'COLORFGBG'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const reset = (): void => {
  clearLook();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
};
// the process environment is shared by every test file: put it back whatever the body does
const test = (name: string, fn: () => void | Promise<void>): void => bareTest(name, async () => { try { await fn(); } finally { reset(); } });
const noEnv = { env: { get: async () => undefined } } as unknown as EngineInterface;

describe('the look before lookOf has run goes through the same single read', () => {
  const cases: Record<string, string>[] = [{}, { NO_COLOR: '1' }, { ATLAS_ASCII: '1' }, { NO_COLOR: '1', ATLAS_ASCII: '1', ATLAS_BAND_RICH: '1' }, { ATLAS_THEME: 'latte', TERM: 'xterm-256color' }];
  for (const c of cases) {
    test(`fallback equals lookOf for ${JSON.stringify(c)}`, async () => {
      for (const k of KEYS) delete process.env[k];
      Object.assign(process.env, c);
      clearLook();
      const before = { ui: lookUi(), rich: lookRich() };
      expect(before).toEqual(readLook(process.env));
      const after = await lookOf(noEnv);
      expect(before.ui).toEqual(after.ui);
      expect(before.rich).toBe(after.rich);
      expect({ ui: lookUi(), rich: lookRich() }).toEqual(before); // and once read, the kept look answers the same
    });
  }
  test('NO_COLOR and ASCII together: the fallback and the read agree on both', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.NO_COLOR = '1';
    process.env.ATLAS_ASCII = '1';
    clearLook();
    expect(lookUi().color).toBe('none');
    expect(lookUi().ascii).toBe(true);
    expect(readLook(process.env).ui).toEqual(lookUi());
  });
});
