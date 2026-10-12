// Characterization: deriveOrchestration + reducers serialize identically across complexity refactors.
// Regenerate the fixture only on an intended behavior change (see orchestration.golden-cases.ts).
import { describe, expect, test } from 'claude-code/testing';
import { serializeGolden } from './orchestration.golden-cases';
import { GOLDEN } from './orchestration.golden-fixture';

describe('orchestration golden', () => {
  test('serialized output matches the fixture', () => {
    expect(serializeGolden()).toBe(GOLDEN);
  });
});
