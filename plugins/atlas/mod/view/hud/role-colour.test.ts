// Every delegated worker shows its name in its role's colour (agents/<role>.md `color:`), whether it runs in-process or as a tmux
// team or crew worker. The table lives inline in theme.ts (the host loader refuses .md imports from mod modules), so this test is
// what keeps it in step with the agent files.
import { describe, expect, test } from 'claude-code/testing';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginRoot } from '../../fixtures/source-tree';
import { parseFrontmatter, personaColor, PERSONA_COLORS } from '../../data/personas';
import { agentRows, agentTable, type AgentRow, type SurfaceOpts } from './hud-surface';
import { ROLE_COLOUR, roleOf } from '../../design/theme';
import { ROLE_HEX, roleHex } from '../../design/atlas-ui';
import type { Run } from '../../design/atlas-ui';
import { agentModel } from './hud';

const AGENTS = join(pluginRoot(), 'agents');
const agentFiles = readdirSync(AGENTS).filter((f) => f.endsWith('.md'));

describe('role colour table mirrors agents/*.md', () => {
  test('every role is in the table with its frontmatter colour', () => {
    expect(agentFiles.length).toBeGreaterThan(0);
    for (const f of agentFiles) {
      const fm = parseFrontmatter(readFileSync(join(AGENTS, f), 'utf8'));
      expect(fm.name).toBeTruthy();
      expect([fm.name, ROLE_COLOUR[fm.name!]]).toEqual([fm.name, fm.color]);
    }
    expect(Object.keys(ROLE_COLOUR).length).toBe(agentFiles.length);
  });
  test('every colour has a hex for both colour depths', () => {
    for (const colour of Object.values(ROLE_COLOUR)) {
      expect(ROLE_HEX[colour]?.truecolor).toMatch(/^#[0-9a-f]{6}$/);
      expect(ROLE_HEX[colour]?.x256).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  test('personaColor reads the same table (test-engineer included)', () => {
    expect(personaColor('test-engineer')).toBe(PERSONA_COLORS.cyan!);
    expect(personaColor('atlas:implementer')).toBe(PERSONA_COLORS.green!);
  });
});

describe('roleOf', () => {
  test('persona first, then the name prefix, else crew', () => {
    expect(roleOf('implementer', 'notes')).toBe('implementer');
    expect(roleOf('atlas:verifier', 'x')).toBe('verifier');
    expect(roleOf('unknown', 'implementer-be')).toBe('implementer');
    expect(roleOf(undefined, 'explorer-9a55')).toBe('explorer');
    expect(roleOf(undefined, 'docs-curator-2')).toBe('docs-curator');
    expect(roleOf('unknown', 'notes')).toBe('crew');
    expect(roleHex('crew', 'truecolor')).toBeUndefined();
  });
});

const row = (name: string, persona?: string): AgentRow => ({ name, state: 'done', model: '-', tasks: [], tool: '', ctx: null, focus: false, ...(persona ? { persona } : {}) });
const opts = (color: 'truecolor' | '256' | 'none'): SurfaceOpts => ({ cols: 120, ui: { theme: 'mocha', ascii: false, color } });
const nameRun = (runs: readonly Run[], name: string): Run => runs.find((r) => r.t.trimStart().startsWith(name))!;
const text = (runs: readonly Run[]): string => runs.map((r) => r.t).join('');

describe('SUBAGENTS rows in role colour', () => {
  // A tmux worker carries persona 'unknown' (data/crew.ts, data/mux.ts): its role comes from its name; an in-process one names its persona.
  // The redesigned grid has a ROLE column: the role word wears the role's colour, the name stays plain.
  const rows = [row('implementer-be', 'unknown'), row('w1', 'implementer'), row('explorer-9a55'), row('notes', 'unknown')];
  const roleRun = (out: readonly (readonly Run[])[], name: string, role: string): Run => out.find((r) => text(r).includes(name))!.find((x) => x.t.trim() === role)!;
  for (const color of ['truecolor', '256'] as const) {
    test(`table, ${color}: the ROLE cell takes its role's colour; same role same colour, different roles differ`, () => {
      const out = agentTable({ todos: [], agents: rows }, opts(color))!;
      const tmux = roleRun(out, 'implementer-be', 'implementer');
      const inproc = roleRun(out, 'w1', 'implementer');
      const expl = roleRun(out, 'explorer-9a55', 'explorer');
      const crew = roleRun(out, 'notes', 'crew');
      expect(tmux.fg).toBe(roleHex('implementer', color)!);
      expect(inproc.fg).toBe(tmux.fg!);
      expect(expl.fg).toBe(roleHex('explorer', color)!);
      expect(expl.fg).not.toBe(tmux.fg!);
      expect(crew.fg).toBeUndefined(); // a free-named crew worker keeps the neutral colour
      expect(nameRun(out.find((r) => text(r).includes('implementer-be'))!, 'implementer-be').fg).toBeUndefined(); // the name itself stays plain
    });
    test(`box rows, ${color}: same role same colour`, () => {
      const out = agentRows(rows, opts(color), {} as never);
      const fg = (n: string, role: string): string | undefined => roleRun(out, n, role).fg;
      expect(fg('implementer-be', 'implementer')).toBe(roleHex('implementer', color)!);
      expect(fg('w1', 'implementer')).toBe(fg('implementer-be', 'implementer')!);
      expect(fg('explorer-9a55', 'explorer')).not.toBe(fg('w1', 'implementer')!);
    });
  }
  test('the role word is its own cell on every row, whether or not the name carries it', () => {
    const all = agentTable({ todos: [], agents: rows }, opts('truecolor'))!.map(text).join('\n');
    expect(all).toMatch(/w1\s+implementer/);
    expect(all).toMatch(/notes\s+crew/);
    expect(all).toMatch(/implementer-be\s+implementer/);
    expect(all).toMatch(/explorer-9a55\s+explorer/);
  });
  test('a worker with role implementer named impl-hud takes the implementer colour', () => {
    const [r] = agentModel([{ name: 'impl-hud', role: 'implementer', state: 'running' } as never], []);
    expect(r!.persona).toBe('implementer');
    expect(roleRun(agentTable({ todos: [], agents: [r!] }, opts('truecolor'))!, 'impl-hud', 'implementer').fg).toBe(roleHex('implementer', 'truecolor')!);
  });
  test('NO_COLOR: the text is whole and uncoloured', () => {
    const out = agentTable({ todos: [], agents: rows }, opts('none'))!;
    const all = out.map(text).join('\n');
    for (const s of ['implementer-be', 'w1', 'explorer-9a55', 'notes']) expect(all).toContain(s);
    for (const r of out.flat()) if (/w1|implementer|explorer|notes/.test(r.t)) expect(r.fg).toBeUndefined();
  });
});
