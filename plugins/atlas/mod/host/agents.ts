// host/agents.ts: agent parsing: host agent list and spawn records to band rows (pure, no `$`, no state).
// Split out of mod/register.ts (plan docs/plans/2026-11-18_atlas-mod-reorg-plan.md section 7); no behavior change.
import type { AgentState, AtlasSnapshot, SquadAgent } from '../contract';
import { headerPhaseOf } from '../view/transcript/restyle';
import { descriptionName, type SpawnMeta } from '../data/orchestration';

/** A spawn-recorded agent the host list does not (yet) contain is only presumed gone after this long. */
const SPAWN_GRACE_MS = 15_000;

// ---- pure helpers (no $) ----------------------------------------------------

/** `<cwd>` basename: the folder half of `<folder>@<branch>`. */
export function folderOf(cwd: string): string {
	const stripped = cwd.replace(/\/+$/, '');
	const cut = stripped.lastIndexOf('/');
	return cut < 0 ? stripped : stripped.slice(cut + 1);
}

// The one header parser lives in restyle.tsx; re-exported so existing importers keep working.
export { headerPhaseOf };

/** The header tally as the transcript draws it: every assistant text that opens with the ATLAS header renders a chip, not only the turn's final
 * answer (the one `turn.complete` carries). `msgs` is the lead transcript; `answer` counts once even when the host has not appended it yet. */
export function headerTallyOf(msgs: readonly { role: string; text: string }[], answer: string, snapshot: AtlasSnapshot | null): { ok: number; total: number } {
	const texts = msgs.filter((m) => m.role === 'assistant' && typeof m.text === 'string' && m.text.trim() !== '').map((m) => m.text);
	if (answer.trim() !== '' && texts.at(-1)?.trim() !== answer.trim()) texts.push(answer);
	return { ok: texts.filter((t) => headerPhaseOf(t, snapshot) !== null).length, total: texts.length };
}

/** AgentStatus (d.ts EngineInterface $.agent.list) -> band AgentState. */
const LIST_STATE: Record<string, AgentState> = {
	pending: 'spawning',
	running: 'running',
	waiting: 'input',
	idle: 'idle',
	completed: 'finished',
	failed: 'failed',
	killed: 'dead',
};

/** Host statuses that end a worker, as the turn.complete reason its report is filed under. */
export const HOST_DONE: Record<string, string> = { completed: 'answer', failed: 'error', killed: 'error' };

/** Readable persona label for a host agent type (`atlas:explorer` -> explorer). */
const typeLabel = (type: string): string => type.replace(/^atlas:/, '').toLowerCase();

/** First 3 words of an Agent call's description as a label (`list the mod pane` -> `list-the-mod`); '' when none. */
const slugOf = (task: string | undefined): string =>
	(task ?? '').toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 3).join('-') ?? '';

type ListedRow = { id: string; teammateId?: string; description?: string; type?: string; status: string };

/** One squad row per host list row, keyed by the row's unique agent id (never by position). `taken` is the
 * id -> label memo of earlier rebuilds: a label another id already holds gets this id's ordinal (`#2`), so a worker
 * that dropped out of the list can never share a name (and so an activity/lifecycle key) with a new one. */
export function mapListed(
	listed: readonly ListedRow[],
	taskAgents: readonly SquadAgent[],
	meta: Record<string, SpawnMeta> = {},
	taken: Record<string, string> = {},
): { id: string; agent: SquadAgent }[] {
	const used = new Set<string>();
	const personas = listed.map((a) => personaOf(a, taskAgents.find((t) => t.name === a.id), meta[a.id]));
	return listed.map((a, i) => {
		const recorded = taskAgents.find((t) => t.name === a.id);
		const spawned = meta[a.id];
		const persona = personas[i]!;
		const crowded = personas.filter((p) => p === persona).length > 1; // two of one role: the task tells them apart
		const task = (typeof a.description === 'string' && a.description !== '' ? a.description : recorded?.task) || undefined;
		const base = baseLabel(a, spawned, persona, task, crowded);
		const heldByOther = (label: string): boolean => Object.entries(taken).some(([id, held]) => id !== a.id && held === label);
		// A true collision reads as a short ordinal (`alpha-explorer #2`), never a host id.
		let name = base;
		for (let n = 2; used.has(name) || heldByOther(name); n++) name = `${base} #${n}`;
		used.add(name);
		return {
			id: a.id,
			agent: {
				name,
				persona,
				state: LIST_STATE[a.status] ?? 'running',
				source: 'task' as const,
				...(task !== undefined ? { task } : {}),
				...(spawned?.model ? { model: spawned.model } : {}),
			},
		};
	});
}

/** Label for a host agent type; '' for a missing type or the generic `teammate`. */
const listedLabel = (type: string | undefined): string => (typeof type === 'string' && type !== 'teammate' ? typeLabel(type) : '');

/** First non-empty text, else ''. */
const firstText = (...parts: (string | undefined)[]): string => parts.find((p) => !!p) ?? '';

const GENERIC_PERSONAS = new Set(['unknown', 'general-purpose']);

const recordedPersona = (recorded: SquadAgent | undefined): string => (recorded && recorded.persona !== 'unknown' ? recorded.persona : '');

/** Persona label for one listed row. The type recorded at agent.spawn (`atlas:explorer`) is the source of truth; the name-keyed record and the list's own type are fallbacks. */
function personaOf(a: ListedRow, recorded: SquadAgent | undefined, spawned: SpawnMeta | undefined): string {
	return firstText(listedLabel(spawned?.type), recordedPersona(recorded), listedLabel(a.type), 'unknown');
}

const teammateName = (teammateId: string | undefined): string | undefined => teammateId?.split('@')[0];

/** Display label before duplicate-suffixing: spawn name, teammate name, a specific persona, the task slug, then weaker fallbacks. */
function baseLabel(a: ListedRow, spawned: SpawnMeta | undefined, persona: string, task: string | undefined, crowded = false): string {
	return firstText(
		spawned?.name,
		teammateName(a.teammateId),
		descriptionName(task),
		GENERIC_PERSONAS.has(persona) || crowded ? '' : persona,
		slugOf(task),
		persona === 'unknown' ? '' : persona,
		listedLabel(a.type),
		a.id.slice(0, 6),
	);
}

/** Sync the squad's task agents with the host's own agent list (ground truth,
 * catches spawns the agent.spawn hook missed); spawn-recorded entries not yet
 * listed stay as the instant fallback. The host id (`a142cc7b…`) is never the
 * display name: persona recorded at spawn, else the agent type, labels the row and
 * the Agent call's description is its task; the id shows (6 chars) only as a last
 * resort and as a suffix to keep duplicate labels distinct. Liveness is the host list's
 * status alone (the lead being idle says nothing: background agents outlive its turn); a
 * recorded entry the host does not list is finished only once its spawn (meta.at) is older
 * than SPAWN_GRACE_MS at `now`. Never throws. */
export function syncAgentsFromList(
	listed: readonly ListedRow[],
	taskAgents: readonly SquadAgent[],
	meta: Record<string, SpawnMeta> = {},
	now?: number,
	taken: Record<string, string> = {},
	killed: readonly string[] = [],
): SquadAgent[] {
	const known = new Set(listed.map((a) => a.id));
	const live: readonly string[] = ['spawning', 'running', 'idle', 'input', 'stuck'];
	// A TaskStop-ed worker is failed on every surface: never finished by the unlisted-after-grace rule, and failed even where the host list still shows it running.
	const killedNames = new Set([...killed, ...killed.map((id) => taken[id]).filter((n): n is string => n !== undefined)]);
	const rest = taskAgents
		.filter((t) => !known.has(t.name))
		.map((t) => {
			if (killedNames.has(t.name)) return live.includes(t.state) ? { ...t, state: 'failed' as const } : t;
			const at = meta[t.name]?.at;
			return now !== undefined && at !== undefined && now - at > SPAWN_GRACE_MS && live.includes(t.state) ? { ...t, state: 'finished' as const } : t;
		});
	const mapped = mapListed(listed, taskAgents, meta, taken).map((m) =>
		killed.includes(m.id) && live.includes(m.agent.state) ? { ...m.agent, state: 'failed' as const } : m.agent,
	);
	return [...mapped, ...rest].slice(-64);
}
