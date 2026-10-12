// Characterization: sprite rows, badges, speech bubbles and code point widths must serialize identically across refactors.
// Regenerate the fixture only on an intended visual change (see sprites.golden-cases.ts).
import { describe, expect, test } from 'claude-code/testing';
import { serializeGolden } from './sprites.golden-cases';
import { GOLDEN } from './sprites.golden-fixture';

describe('sprites golden', () => {
  test('serialized output matches the fixture', () => {
    expect(serializeGolden()).toBe(GOLDEN);
  });
});
