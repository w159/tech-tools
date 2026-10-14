// roles.ts: one tiny three-cell character per worker role, animated by worker state. Eyes carry the role, the
// mouth carries the state, so a lane reads `◔_◔` (explorer, tool in flight) or `•‿•` (implementer, done) in the
// 3 cells the spinner used to take. Pure: band.tsx and omp/mission-panel.ts pick a frame from the spinner tick.
// Every glyph is one cell wide. atlas_panefeed.py keeps the same table for the tmux pane header (ROLE_EYES,
// MOUTHS); roles.test.ts checks the two stay equal.

export type CharState = 'running' | 'thinking' | 'done' | 'failed' | 'blocked';

/** Left and right eye per role key. */
export const ROLE_EYES: Record<string, readonly [string, string]> = {
  explorer: ['◔', '◔'],
  implementer: ['•', '•'],
  verifier: ['◉', '◉'],
  runner: ['▸', '◂'],
  planner: ['◐', '◑'],
  critic: ['ò', 'ó'],
  docs: ['°', '°'],
  'ui-tester': ['◈', '◈'],
  db: ['⊙', '⊙'],
  generic: ['·', '·'],
};

/** Mouth frames per state: running cycles with the tick; the rest hold one or two poses. */
export const MOUTHS: Record<CharState, readonly string[]> = {
  running: ['_', 'o', 'O', '^', 'u'], // odd lengths: an even tick step (the 2 s samples of register-sidebar.test) still moves
  thinking: ['~', '-', '='],
  done: ['‿'],
  failed: ['n'],
  blocked: ['.'],
};

// Persona names (frontmatter `name`, with or without `atlas:`) folded onto the character keys.
const ALIAS: Record<string, string> = {
  'completeness-critic': 'critic',
  'docs-auditor': 'docs',
  'docs-curator': 'docs',
  'ui-runtime-tester': 'ui-tester',
  'db-prober': 'db',
  'rls-privilege-audit': 'db',
  'schema-inventory': 'db',
  'naming-glossary-audit': 'db',
};

/** The character key for a persona or role token; anything unknown (armada squads included) is `generic`. */
export function roleKey(role: string | undefined): string {
  const k = (role ?? '').toLowerCase().replace(/^atlas:/, '').trim();
  const key = ALIAS[k] ?? k;
  return key in ROLE_EYES ? key : 'generic';
}

/** The three-cell character for `role` in `state` at spinner `tick`. */
export function charFrame(role: string | undefined, state: CharState, tick: number): string {
  const [l, r] = ROLE_EYES[roleKey(role)] as readonly [string, string];
  const mouths = MOUTHS[state];
  return `${l}${mouths[Math.abs(tick) % mouths.length]}${r}`;
}
