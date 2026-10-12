// Characterization: sidebarTree over representative models serializes identically across refactors.
// Regenerate the fixture only on an intended visual change (see sidebar.golden-cases.ts).
import { describe, expect, test } from 'claude-code/testing';
import { serializeGolden } from './sidebar.golden-cases';
import { GOLDEN } from './sidebar.golden-fixture';

describe('sidebar golden', () => {
  test('serialized trees match the fixture', () => {
    expect(serializeGolden()).toBe(GOLDEN);
  });
});
