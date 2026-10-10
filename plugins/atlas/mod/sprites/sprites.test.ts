// Sprite module tests: every SPRITES entry passes validateSpriteSet ([] =
// clean), and every plugins/atlas/agents/*.md persona name has a SPRITES key.
// Runs with the /tmp/cc_testing_preload.ts shim, which maps 'claude-code/testing'
// to bun:test. node:fs here is test-only by design.
import { describe, expect, test } from 'claude-code/testing';
import { readdirSync } from 'node:fs';
import { SPRITES } from './index';
import { validateSpriteSet } from './grid';

describe('sprites', () => {
  describe('structural validity', () => {
    for (const [name, set] of Object.entries(SPRITES)) {
      test(`${name} set is valid`, () => {
        expect(validateSpriteSet(set)).toEqual([]);
      });
    }
  });

  describe('persona coverage', () => {
    const personas = readdirSync(`${import.meta.dir}/../../agents`)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -3));

    for (const persona of personas) {
      test(`${persona} has a SPRITES key`, () => {
        expect(SPRITES[persona]).toBeDefined();
      });
    }
  });
});