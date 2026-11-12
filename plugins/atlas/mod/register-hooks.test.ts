// The live host refuses a plugin that registers one event twice without a matcher ("on(\"prompt.submit\") is registered twice without a
// matcher") and drops the WHOLE mod: no band, no HUD, no cards, no chip (wave 15 build baf27d46). The fake `on` here refuses the same way.
import { describe, expect, test } from 'claude-code/testing';
import type { On } from 'claude-code';
import { register } from './register';

describe('register: one unmatched hook per event, as the live host requires', () => {
  test('no event is registered twice without a matcher', async () => {
    const seen = new Map<string, number>();
    const on = ((event: string, hookOrMatcher: unknown, maybeHook?: unknown) => {
      if (maybeHook === undefined && typeof hookOrMatcher === 'function') {
        if (seen.has(event)) throw new Error(`on("${event}") is registered twice without a matcher`);
        seen.set(event, 1);
      }
      return { catch() {} };
    }) as unknown as On;
    await register(on, {});
    expect(seen.has('prompt.submit')).toBe(true);
  });
});
