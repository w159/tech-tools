// Herdr/colony data plane: parse `python3 scripts/atlas_herdr.py status` stdout and merge the
// squad (channel roster + herdr panes + in-session task agents) into AgentState. Pure data layer
// over injected values, so register.ts just feeds it. Shapes mirror:
//   atlas_herdr.py      - status() envelope ({running, healthy, state, ok? agents?...}),
//                         _agent_row ({pane_id, agent, status}), _unavailable ({ok:false});
//   atlas_dash_colony.py - _state machine and STUCK_S = 15 min;
//   dashboard_ui/js/glyphs.js - TO_STATE: agent_status 'blocked' -> state 'input'.
// Exit notes carry `exit <code>` text (atlas_dash_irc.py EXIT_RE, kind 'exit').
import type { AgentState, ChannelMember, ChannelNote, SquadAgent } from '../contract';

/** One herdr agent pane as the mod needs it. */
export interface HerdrPane {
  id: string;
  name?: string;
  agent_status?: string;
}

/** Silence past this = stuck (atlas_dash_colony.py STUCK_S). */
export const STUCK_MS = 15 * 60 * 1000;

const EXIT_CODE_RE = /^exit (-?\d+)/;

// Persona catalog = plugins/atlas/agents/*.md. Dispatch names abbreviate personas
// ('impl-auth', 'verifier-ui', 'docs-cur'); longest prefix wins, else 'unknown'.
const PERSONA_NAMES = [
  'completeness-critic', 'db-prober', 'docs-auditor', 'docs-curator', 'explorer', 'implementer',
  'naming-glossary-audit', 'planner', 'rls-privilege-audit', 'runner', 'schema-inventory',
  'ui-runtime-tester', 'verifier',
];
const PERSONA_ALIASES: Record<string, string> = {
  'docs-cur': 'docs-curator', impl: 'implementer', plan: 'planner',
  scout: 'explorer', run: 'runner', ver: 'verifier',
};
const PERSONA_MATCHERS = [
  ...PERSONA_NAMES.map((n): readonly [string, string] => [n, n]),
  ...Object.entries(PERSONA_ALIASES),
].sort((a, b) => b[0].length - a[0].length);

function personaOf(name?: string, role?: string): string {
  for (const cand of [role, name]) {
    const s = cand ? cand.replace(/^atlas:/, '').toLowerCase() : '';
    if (!s) continue;
    if (s.startsWith('armada-')) return s; // armada-<dept> departments
    const hit = PERSONA_MATCHERS.find(([prefix]) => s.startsWith(prefix));
    if (hit) return hit[1];
  }
  return 'unknown';
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** Herdr/registry timestamps arrive as epoch seconds, epoch ms or ISO. */
function epochMs(ts: unknown): number {
  const s = typeof ts === 'string' ? ts.trim() : ts;
  if (s == null || s === '') return NaN;
  const n = typeof s === 'number' ? s : Number(s);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const d = Date.parse(String(s));
  return Number.isFinite(d) ? d : NaN;
}

function exitCodeOf(text: unknown): number | null {
  const m = EXIT_CODE_RE.exec(str(text) ?? '');
  if (!m) return null;
  const code = Number.parseInt(m[1] ?? '', 10);
  return Number.isFinite(code) ? code : null;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** Parse atlas_herdr.py status stdout; tolerant of tracebacks, warnings and wrapped JSON. */
export function parseHerdrStatus(stdout: string): { panes: HerdrPane[]; ok: boolean } {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    const first = stdout.indexOf('{');
    const last = stdout.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        json = JSON.parse(stdout.slice(first, last + 1));
      } catch {
        json = undefined;
      }
    }
  }
  const root = asRecord(json);
  if (!root) return { panes: [], ok: false };
  // status() sets no `ok` on success; fall back to its running/healthy pair.
  const ok =
    root.ok === false
      ? false
      : typeof root.running === 'boolean'
        ? root.running
        : typeof root.healthy === 'boolean'
          ? root.healthy
          : true;
  const rows = Array.isArray(root.agents) ? root.agents : Array.isArray(root.panes) ? root.panes : [];
  const panes: HerdrPane[] = [];
  for (const row of rows) {
    const r = asRecord(row);
    if (!r) continue;
    const id = str(r.pane_id) ?? str(r.id);
    if (!id) continue;
    const pane: HerdrPane = { id };
    const name = str(r.agent) ?? str(r.name);
    if (name !== undefined) pane.name = name;
    const status = str(r.status) ?? str(r.agent_status);
    if (status !== undefined) pane.agent_status = status;
    panes.push(pane);
  }
  return { panes, ok };
}

function colonyState(
  m: ChannelMember,
  now: number,
  lastAtMs: number | undefined,
  noteExitCode: number | null,
  pane?: HerdrPane,
): AgentState {
  if (m.ended_at) {
    const code = typeof m.exit_code === 'number' ? m.exit_code : noteExitCode;
    return code === null ? 'dead' : code === 0 ? 'finished' : 'failed';
  }
  const status = pane?.agent_status;
  const age = lastAtMs === undefined ? NaN : now - lastAtMs;
  const quietPastStuck = Number.isFinite(age) && age > STUCK_MS; // ponytail: no open-todo check - SquadAgent carries no todos; add todo lookups if false-stuck shows up
  if (status === 'blocked') return 'input'; // glyphs.js: blocked -> input, even when silent
  if (status === 'working' || status === 'running' || status === 'idle') {
    return quietPastStuck ? 'stuck' : status === 'idle' ? 'idle' : 'running';
  }
  if (noteExitCode !== null) return noteExitCode === 0 ? 'finished' : 'failed';
  // ponytail: no-note members read as running (ChannelMember has no joined timestamp to age from)
  return quietPastStuck ? 'stuck' : 'running';
}

/**
 * Merge the sources into one squad:
 * - colony agents from channel `members`, state from herdr `panes`, note age (STUCK_MS) and
 *   exit notes (`exit <code>` -> finished/failed; ended_at without one -> dead);
 * - `taskAgents` (in-session, from $.agent.list()) win a same-name clash and borrow the
 *   colony pane id and last-note timestamp.
 */
export function mergeSquad(
  members: ChannelMember[],
  notes: ChannelNote[],
  panes: HerdrPane[],
  taskAgents: SquadAgent[],
  now: number,
): SquadAgent[] {
  const lastNote = new Map<string, { at: number; ts: string }>();
  const exitNote = new Map<string, { at: number; code: number | null }>();
  for (const n of notes) {
    const owner = typeof n.owner === 'string' ? n.owner : '';
    if (!owner) continue;
    const at = epochMs(n.ts);
    if (Number.isFinite(at)) {
      const cur = lastNote.get(owner);
      if (!cur || at > cur.at) lastNote.set(owner, { at, ts: n.ts });
    }
    if (n.kind === 'exit' || EXIT_CODE_RE.test(str(n.text) ?? '')) {
      const cur = exitNote.get(owner);
      if (!cur || (Number.isFinite(at) && at >= cur.at)) exitNote.set(owner, { at, code: exitCodeOf(n.text) });
    }
  }
  const colony: SquadAgent[] = [];
  for (const m of Array.isArray(members) ? members : []) {
    const name = typeof m?.name === 'string' ? m.name : '';
    // The lead is the titan in the band (plan §3.1), not a squad sprite.
    if (!name || name === 'lead' || name.startsWith('lead-')) continue;
    const last = lastNote.get(name);
    const exit = exitNote.get(name);
    const pane = (m.pane_id ? panes.find((p) => p.id === m.pane_id) : undefined)
      ?? (m.name ? panes.find((p) => p.name === m.name) : undefined); // registry lags pane ids
    colony.push({
      name,
      persona: personaOf(name, typeof m.role === 'string' ? m.role : undefined),
      state: colonyState(m, now, last?.at, exit ? exit.code : null, pane),
      source: 'colony',
      lastNoteTs: last?.ts,
      paneId: m.pane_id,
    });
  }
  const byName = new Map<string, SquadAgent>();
  for (const t of Array.isArray(taskAgents) ? taskAgents : []) {
    const name = typeof t?.name === 'string' ? t.name : '';
    if (!name) continue;
    byName.set(name, {
      ...t,
      persona: t.persona && t.persona !== 'unknown' ? t.persona : personaOf(name),
      source: 'task',
    });
  }
  for (const c of colony) {
    const t = byName.get(c.name);
    // Task source is the native, instant one (plan §2); colony only supplements it.
    byName.set(c.name, t
      ? { ...t, paneId: t.paneId ?? c.paneId, lastNoteTs: t.lastNoteTs ?? c.lastNoteTs }
      : c);
  }
  return [...byName.values()];
}