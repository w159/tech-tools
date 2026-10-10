// Sprite module tests: every SPRITES entry passes validateSpriteSet ([] =
// clean), and every persona has a SPRITES key. Runs under the plugin test
// host (claude-code/testing): no Node fs — persona files come from a
// memFs fixture, mirroring the agents/*.md set in data/personas.test.ts.
import { describe, expect, test } from 'claude-code/testing';
import { SPRITES } from './index';
import { validateSpriteSet } from './grid';
import { memFs } from '../test_helpers';

// Mirrors plugins/atlas/agents/*.md; update alongside new agent files.
const AGENT_PERSONAS = [
  'armada', 'completeness-critic', 'db-prober', 'docs-auditor', 'docs-curator',
  'explorer', 'implementer', 'naming-glossary-audit', 'planner',
  'rls-privilege-audit', 'runner', 'schema-inventory', 'ui-runtime-tester',
  'verifier',
];

describe('sprites', () => {
  describe('structural validity', () => {
    for (const [name, set] of Object.entries(SPRITES)) {
      test(`${name} set is valid`, () => {
        expect(validateSpriteSet(set)).toEqual([]);
      });
    }
  });

  describe('persona coverage', () => {
    // The host test env has no fs; inject the agent personas through memFs
    // and enumerate them the same way loadPersonas does over FsLike.
    const files = Object.fromEntries(
      AGENT_PERSONAS.map((name) => [`/atlas/agents/${name}.md`, '---\nname: x\n---\n']),
    );
    const fs = memFs(files);

    test('agents fixture lists every persona as a .md file', async () => {
      const personas = (await fs.list('/atlas/agents'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.slice(f.lastIndexOf('/') + 1, -3))
        .sort();
      expect(personas).toEqual([...AGENT_PERSONAS].sort());
    });

    for (const persona of AGENT_PERSONAS) {
      test(`${persona} has a SPRITES key`, () => {
        expect(SPRITES[persona]).toBeDefined();
      });
    }
  });
});