// Persona frontmatter parsing + loaders, colour tables and the task-routing matrix.
// Data sources: <pluginRoot>/agents/*.md and <pluginRoot>/contracts/operating-contract.json.
// Loaders are pure over FsLike (see contract.ts) so register.ts can adapt $.fs and the
// test kit can drive them from memory. No Node imports: mod modules run sandboxed.
import type { Contract, FsLike, Persona, PhaseId } from '../contract';
import { BRAND } from '../contract';

/** Frontmatter colour name -> hex, mirroring the dashboard token palette (dashboard_ui/css/tokens.css). */
export const PERSONA_COLORS: Record<string, string> = {
  green: BRAND.ok, // #52c872
  red: BRAND.fail, // #ff7570
  blue: BRAND.working, // #62b8e6
  cyan: '#56d4dd',
  yellow: BRAND.input, // #f2aa40
  pink: '#f472b6',
  purple: BRAND.subagent, // #b5a3fa
  orange: '#f2994a',
  teal: BRAND.accent, // #2fbd9f
};

/**
 * Persona name (or 'atlas:'-prefixed token) -> frontmatter colour name, mirrored
 * from plugins/atlas/agents/*.md so UI panes can colour by name without loading
 * the files. Frontmatter stays the source of truth for model/effort.
 */
const PERSONA_BY_NAME: Record<string, string> = {
  'completeness-critic': 'red',
  'db-prober': 'yellow',
  'docs-auditor': 'orange',
  'docs-curator': 'purple',
  explorer: 'cyan',
  implementer: 'green',
  'naming-glossary-audit': 'orange',
  planner: 'blue',
  'rls-privilege-audit': 'orange',
  runner: 'orange',
  'schema-inventory': 'cyan',
  'ui-runtime-tester': 'pink',
  verifier: 'red',
};

/**
 * Resolve an identity token to a '#rrggbb' hex.
 * Accepts a persona name ('implementer', 'atlas:implementer'), a frontmatter
 * colour name (Persona.color), or a squad token (SquadAgent.persona):
 * 'armada-<dept>' wears the subagent token, anything unrecognised (incl.
 * 'unknown') goes idle.
 */
export function personaColor(persona: string): string {
  if (persona.startsWith('armada-')) return BRAND.subagent;
  const key = persona.toLowerCase().replace(/^atlas:/, '');
  const mapped = PERSONA_BY_NAME[key];
  return PERSONA_COLORS[key] ?? (mapped === undefined ? undefined : PERSONA_COLORS[mapped]) ?? BRAND.idle;
}

/**
 * Parse the simple YAML head of an agent file: `key: value` lines between the
 * opening `---` fence and the closing one. Splits on the first `:` (descriptions
 * contain colons), strips one pair of matching quotes, ignores anything else.
 */
export function parseFrontmatter(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!md.startsWith('---')) return out;
  for (const raw of md.slice(3).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '---') break; // closing fence
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon <= 0) break; // non `key: value` line ends the simple head
    let value = line.slice(colon + 1).trim();
    if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, colon).trim()] = value;
  }
  return out;
}

/** Load every persona from <pluginRoot>/agents/*.md, in stable file order. */
export async function loadPersonas(fs: FsLike, pluginRoot: string): Promise<Persona[]> {
  const dir = `${pluginRoot}/agents`;
  const entries = (await fs.list(dir)).filter((n) => n.endsWith('.md')).sort();
  const personas: Persona[] = [];
  for (const entry of entries) {
    const path = entry.includes('/') ? entry : `${dir}/${entry}`;
    const md = await fs.read(path);
    if (md === undefined) continue;
    const fm = parseFrontmatter(md);
    if (!fm.name) continue;
    personas.push({
      name: fm.name,
      model: fm.model || 'inherit',
      effort: fm.effort || 'low',
      color: fm.color || 'unknown',
      description: fm.description || '',
    });
  }
  return personas;
}

/** Load the operating contract from <pluginRoot>/contracts/operating-contract.json. */
export async function loadContract(fs: FsLike, pluginRoot: string): Promise<Contract> {
  const path = `${pluginRoot}/contracts/operating-contract.json`;
  const raw = await fs.read(path);
  if (raw === undefined) throw new Error(`operating contract not found: ${path}`);
  let json: {
    phases?: { id?: string; glyph?: string }[];
    todoPhases?: string[];
    headerFirstLinePattern?: string;
    itemPhasePrefix?: string;
  };
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`operating contract is not valid JSON: ${path} (${err instanceof Error ? err.message : String(err)})`);
  }
  return {
    phases: (json.phases ?? []).map((p) => ({ id: (p.id ?? 'research') as PhaseId, glyph: p.glyph ?? '' })),
    todoPhases: (json.todoPhases ?? []) as PhaseId[],
    headerFirstLinePattern: json.headerFirstLinePattern ?? '',
    itemPhasePrefix: json.itemPhasePrefix ?? '[<phase>] ',
  };
}

export interface RoutingRow {
  task: string;
  persona: string; // single persona token; the display row 'DB catalog dump; naming audit' combines two with '; '
  model: string;
  effort: string;
}

/** Task-type routing, copied verbatim from the plan (docs/plans/2026-10-09-atlas-mod.md section 5). Claude-side values. */
export const ROUTING_MATRIX: RoutingRow[] = [
  { task: 'Mechanical edit, exact <=7 STEPS on <=5 files', persona: 'atlas:runner', model: 'haiku', effort: 'low' },
  { task: 'One bounded implementation', persona: 'atlas:implementer', model: 'sonnet', effort: 'low' },
  { task: 'Explore / map code', persona: 'atlas:explorer', model: 'sonnet', effort: 'low' },
  { task: 'Stage plan', persona: 'atlas:planner', model: 'sonnet', effort: 'low' },
  { task: 'Adversarial verify', persona: 'atlas:verifier', model: 'sonnet', effort: 'medium' },
  { task: 'Pre-done completeness audit', persona: 'atlas:completeness-critic', model: 'sonnet', effort: 'medium' },
  { task: 'DB RLS / grants audit', persona: 'atlas:rls-privilege-audit', model: 'sonnet', effort: 'medium' },
  { task: 'DB probe', persona: 'atlas:db-prober', model: 'sonnet', effort: 'low' },
  { task: 'DB catalog dump; naming audit', persona: 'atlas:schema-inventory; atlas:naming-glossary-audit', model: 'haiku', effort: 'low' },
  { task: 'UI runtime test', persona: 'atlas:ui-runtime-tester', model: 'sonnet', effort: 'low' },
  { task: 'Post-ship docs', persona: 'atlas:docs-curator', model: 'sonnet', effort: 'low' },
  { task: 'Docs drift audit', persona: 'atlas:docs-auditor', model: 'haiku', effort: 'low' },
  { task: 'Department work', persona: 'armada-<dept>', model: 'inherit', effort: 'inherit' },
  { task: 'Architecture, synthesis, final judgment', persona: 'main thread', model: 'opus', effort: 'high' },
];

/** Stable accent for a dispatch name: FNV-1a hue, fixed S/L so every stripe stays on-palette. */
export function stableHue(name: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hslToHex((hash >>> 0) % 360, 0.62, 0.6);
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
