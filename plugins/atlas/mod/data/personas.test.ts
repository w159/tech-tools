// Tests for the persona data module. Run with `claude plugin test plugins/atlas`.
// The implementer fixture is the real frontmatter head of plugins/atlas/agents/implementer.md.
import { describe, expect, test } from 'claude-code/testing';
import type { FsLike } from '../contract';
import {
  loadContract,
  loadPersonas,
  parseFrontmatter,
  PERSONA_COLORS,
  personaColor,
  ROUTING_MATRIX,
  stableHue,
} from './personas';

const IMPLEMENTER_MD = `---
name: implementer
description: "Focused implementer that makes ONE bounded, well-specified change as a minimal diff, checks docs, then runs the project's gate (lint/typecheck/test/build) and reports the result with evidence. Never expands scope. Use when a single, clearly specified code change is ready to be made and verified."
model: sonnet
effort: low
color: green
disallowedTools: [Agent, Task, TaskCreate, TaskGet, TaskList, TaskUpdate, NotebookEdit]
---

# atlas:implementer

Body after the closing fence is ignored.
`;

const ROOT = '/plugins/atlas';

function memFs(files: Record<string, string>): FsLike {
  return {
    async read(path) {
      return files[path];
    },
    async stat(path) {
      return files[path] === undefined ? undefined : { size: files[path].length, mtimeMs: 0 };
    },
    async exists(path) {
      return files[path] !== undefined;
    },
    async list(path) {
      const prefix = `${path}/`;
      return Object.keys(files)
        .filter((p) => p.startsWith(prefix))
        .map((p) => p.slice(prefix.length));
    },
  };
}

describe('parseFrontmatter', () => {
  test('parses the real agents/implementer.md head', () => {
    const fm = parseFrontmatter(IMPLEMENTER_MD);
    expect(fm.name).toBe('implementer');
    expect(fm.model).toBe('sonnet');
    expect(fm.effort).toBe('low');
    expect(fm.color).toBe('green');
    expect(fm.description).toContain('ONE bounded, well-specified change');
  });

  test('keeps colons inside values and stops at the closing fence', () => {
    const fm = parseFrontmatter(IMPLEMENTER_MD);
    expect(fm.description).toContain('gate (lint/typecheck/test/build)');
    expect(fm.disallowedTools).toBe('[Agent, Task, TaskCreate, TaskGet, TaskList, TaskUpdate, NotebookEdit]');
    expect(fm['# atlas']).toBeUndefined(); // body never parsed
  });

  test('returns empty for files without a frontmatter fence', () => {
    expect(parseFrontmatter('no fence here\n')).toEqual({});
  });

  test('strips quoted values and handles CRLF', () => {
    const fm = parseFrontmatter('---\r\nname: explorer\r\ndescription: "a: b"\r\n---\r\nbody');
    expect(fm.name).toBe('explorer');
    expect(fm.description).toBe('a: b');
  });
});

describe('loadPersonas', () => {
  test('reads agents/*.md via FsLike, skips non-md, defaults missing fields', async () => {
    const fs = memFs({
      [`${ROOT}/agents/implementer.md`]: IMPLEMENTER_MD,
      [`${ROOT}/agents/bare.md`]: '---\nname: bare\n---\nbody',
      [`${ROOT}/agents/notes.txt`]: 'not a persona',
    });
    const personas = await loadPersonas(fs, ROOT);
    expect(personas.map((p) => p.name)).toEqual(['bare', 'implementer']);
    const impl = personas.find((p) => p.name === 'implementer')!;
    expect(impl.model).toBe('sonnet');
    expect(impl.color).toBe('green');
    const bare = personas.find((p) => p.name === 'bare')!;
    expect(bare.model).toBe('inherit');
    expect(bare.effort).toBe('low');
    expect(bare.color).toBe('unknown');
    expect(bare.description).toBe('');
  });
});

describe('loadContract', () => {
  test('maps the operating contract fields', async () => {
    const fs = memFs({
      [`${ROOT}/contracts/operating-contract.json`]: JSON.stringify({
        phases: [
          { id: 'research', glyph: '🔍' },
          { id: 'implement', glyph: '🔧' },
        ],
        todoPhases: ['research', 'implement'],
        headerFirstLinePattern: '^ATLAS \\| \\S+ (research|implement) \\| \\S',
        itemPhasePrefix: '[<phase>] ',
      }),
    });
    const contract = await loadContract(fs, ROOT);
    expect(contract.todoPhases).toEqual(['research', 'implement']);
    expect(contract.phases[0]).toEqual({ id: 'research', glyph: '🔍' });
    expect(contract.headerFirstLinePattern).toContain('^ATLAS');
    expect(contract.itemPhasePrefix).toBe('[<phase>] ');
  });

  test('throws a contextual error on malformed JSON', async () => {
    const fs = memFs({ [`${ROOT}/contracts/operating-contract.json`]: '{oops' });
    await expect(loadContract(fs, ROOT)).rejects.toThrow('not valid JSON');
  });
});

describe('personaColor', () => {
  test('maps frontmatter colour names to dashboard-token hexes', () => {
    expect(personaColor('green')).toBe('#52c872');
    expect(personaColor('teal')).toBe('#2fbd9f');
    expect(personaColor('purple')).toBe('#b5a3fa');
    expect(personaColor('red')).toBe('#ff7570');
  });

  test('armada departments wear the subagent token, unknown goes idle', () => {
    expect(personaColor('armada-finance')).toBe('#b5a3fa');
    expect(personaColor('unknown')).toBe('#93a4ac');
    expect(personaColor('no-such-color')).toBe('#93a4ac');
  });

  test('resolves persona names, with or without the atlas: prefix', () => {
    expect(personaColor('implementer')).toBe('#52c872');
    expect(personaColor('atlas:implementer')).toBe('#52c872');
    expect(personaColor('atlas:verifier')).toBe('#ff7570');
    expect(personaColor('ui-runtime-tester')).toBe('#f472b6');
  });
});

describe('PERSONA_COLORS', () => {
  test('every colour used in agents/*.md frontmatter is covered', () => {
    const used = ['green', 'red', 'blue', 'cyan', 'yellow', 'pink', 'purple', 'orange'];
    for (const name of used) expect(PERSONA_COLORS[name]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('ROUTING_MATRIX', () => {
  test('copies the plan section 5 table', () => {
    expect(ROUTING_MATRIX).toHaveLength(14);
    expect(ROUTING_MATRIX.find((r) => r.persona === 'atlas:implementer')).toEqual({
      task: 'One bounded implementation',
      persona: 'atlas:implementer',
      model: 'sonnet',
      effort: 'low',
    });
    expect(ROUTING_MATRIX.find((r) => r.persona === 'atlas:verifier')!.effort).toBe('medium');
    expect(ROUTING_MATRIX.find((r) => r.task === 'Department work')).toEqual({
      task: 'Department work',
      persona: 'armada-<dept>',
      model: 'inherit',
      effort: 'inherit',
    });
  });
});

describe('stableHue', () => {
  test('is deterministic, hex-shaped, and distinct across dispatch names', () => {
    expect(stableHue('impl-auth')).toBe(stableHue('impl-auth'));
    expect(stableHue('impl-auth')).toMatch(/^#[0-9a-f]{6}$/);
    expect(stableHue('impl-auth')).not.toBe(stableHue('verifier-ui'));
  });
});
