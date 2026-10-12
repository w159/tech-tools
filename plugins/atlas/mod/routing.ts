// Routing enforcement for the Atlas mod: record agentId→persona so turn.step
// can pin the persona's effort (persona model pins live in the agent
// definitions' own frontmatter, honored natively — never rewritten here),
// count header-format misses, and reinforce the contract on every prompt.
//
// Event shapes mirror plugins/atlas/.claude-plugin/types/claude-code/index.d.ts
// (AgentSpawnInput, TurnStepInput, TurnCompleteInput, PromptSubmitInput).
import { atom, read, update } from 'claude-code';
import type { On } from 'claude-code';
import type { AtlasSnapshot, Persona, SquadAgent } from './contract';

const ATLAS_PREFIX = 'atlas:';
const EFFORTS = ['low', 'medium', 'high'] as const;
type RoutableEffort = (typeof EFFORTS)[number];

const isRoutableEffort = (effort: string): effort is RoutableEffort =>
  (EFFORTS as readonly string[]).includes(effort);

// Session state this file reads/writes ($.state, contract in types/index.d.ts).
// The `$.state` key scan needs each atom declared in the file that reads it, so
// these re-declare refs register.ts owns.
const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null);
const taskAgentsState = atom({ plugin: 'atlas', key: 'taskAgents' } as const, []);
const headerMissesState = atom({ plugin: 'atlas', key: 'headerMisses' } as const, 0);

export interface RoutingDeps {
  /** Personas of the snapshot read from $.state (null before the first build). */
  getPersonas: (snapshot: AtlasSnapshot | null) => Persona[];
  logDrift: (msg: string) => void;
}

/** Track a spawned agent as a live task agent (capped at 64). */
function withAgent(agents: SquadAgent[], agentId: string, persona: string): SquadAgent[] {
  return agents.some((a) => a.name === agentId)
    ? agents.map((a) => (a.name === agentId ? { ...a, persona } : a))
    : [...agents, { name: agentId, persona, state: 'running' as const, source: 'task' as const }].slice(-64);
}

/**
 * Wires persona routing: `agent.spawn` records agentId→persona for matched
 * atlas roles (models pass through untouched — the agent definition's own
 * frontmatter pin decides); `turn.step` pins the recorded persona's effort
 * onto that agent's model requests. Unknown roles, armada dispatches and
 * forks pass through untouched. Every hook fails open: on any error the
 * event moves on unchanged.
 */
export function registerRouting(on: On, deps: RoutingDeps): void {
  // agentId -> persona name, recorded on spawn, read on turn.step.
  const byAgent = new Map<string, string>();

  on('agent.spawn', async ($, e, next) => {
    let persona: Persona | undefined;
    try {
      if (e.subagentType.startsWith(ATLAS_PREFIX)) {
        persona = deps.getPersonas(await read($, snapshotState)).find((p) => p.name === e.subagentType.slice(ATLAS_PREFIX.length));
      }
    } catch {
      persona = undefined;
    }
    if (persona && !e.fork && e.model !== undefined && e.model !== 'inherit') {
      // An explicit non-inherit model on a known role should have been denied
      // by the dispatch tripwire; never deny here, just note the drift.
      try {
        deps.logDrift(`agent.spawn: atlas:${e.subagentType.slice(ATLAS_PREFIX.length)} asked for model ${e.model}, pinned ${persona.model}`);
      } catch {
        // logging never blocks a spawn
      }
    }
    // Models pass through untouched: the agent definition's frontmatter pin
    // is honored natively, so the event is never rewritten.
    const result = await next(e);
    if (!e.fork && typeof result.agentId === 'string') {
      // Record every spawned subagent (generic `task` included) so the band's
      // conveyor shows it; non-atlas types carry persona 'unknown', which
      // mergeSquad resolves through personaOf.
      if (persona) byAgent.set(result.agentId, persona.name);
      try {
        const agentId = result.agentId;
        await update($, taskAgentsState, (agents) => withAgent(agents, agentId, persona?.name ?? 'unknown'));
      } catch {
        // recording never blocks a spawn
      }
    }
    return result;
  });

  on('turn.step', async function* ($, e, next) {
    let effort: RoutableEffort | undefined;
    try {
      if (e.agentId !== undefined) {
        const name = byAgent.get(e.agentId);
        const persona = name === undefined ? undefined : deps.getPersonas(await read($, snapshotState)).find((p) => p.name === name);
        if (persona && isRoutableEffort(persona.effort)) effort = persona.effort;
      }
    } catch {
      effort = undefined;
    }
    yield* effort !== undefined ? next({ ...e, effort }) : next(e);
  });
}

export interface HeaderDriftDeps {
  pattern: (snapshot: AtlasSnapshot | null) => string;
}

/**
 * Counts main-loop answers whose first line breaks the contract's header
 * pattern (headerFirstLinePattern). Subagent turns carry no header, so their
 * completions are skipped. Never throws; the answer always moves on.
 */
export function registerHeaderDrift(on: On, deps: HeaderDriftDeps): void {
  on('turn.complete', async ($, e, next) => {
    try {
      if (e.agentId === undefined) {
        const firstLine = e.answer.split('\n', 1)[0] ?? '';
        if (!new RegExp(deps.pattern(await read($, snapshotState))).test(firstLine)) {
          await update($, headerMissesState, (n) => n + 1);
        }
      }
    } catch {
      // a drift check never blocks the answer
    }
    return next(e);
  });
}

export interface PromptReinforceDeps {
  line: (snapshot: AtlasSnapshot | null) => string | null;
}

/**
 * Adds the contract reminder line as model-only context on every prompt
 * submission. Never alters the user's text (e.text is untouched) and never
 * blocks a prompt.
 */
export function registerPromptReinforce(on: On, deps: PromptReinforceDeps): void {
  on('prompt.submit', async ($, e, next) => {
    let context: readonly string[] | undefined;
    try {
      const line = deps.line(await read($, snapshotState));
      if (line) context = [...(e.context ?? []), line];
    } catch {
      context = undefined;
    }
    return context !== undefined ? next({ ...e, context }) : next(e);
  });
}
