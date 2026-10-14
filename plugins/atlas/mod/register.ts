// register.ts — the Atlas mod entrypoint (plan docs/plans/2026-10-09-atlas-mod.md §3).
// Declared by hooks/hooks.json "modules": ["./mod/register.ts"]. Kill switch:
// ATLAS_MOD=off turns every wired handler into a pass-through (register itself
// has no `$`: the flag is read at the first event, session.start). Harness
// constraints honored: static imports only, `$` flows only through top-level
// `function` declarations and handler parameters, and no ui.* call runs unless
// a person is at the prompt (hooks also run headless, surface null).
import { atom, read, update } from 'claude-code';
import type { EngineInterface, On, PluginOptions } from 'claude-code';
import { SnapshotBuilder } from './snapshot';
import type { AgentState, AtlasSnapshot, FsLike, PhaseId, SquadAgent } from './contract';
import { PHASES, intentToArgv } from './intents';
import { bandTree, railPhase, type BandHandlers } from './band';
import { activeCount, liveWorkers } from './data/live';
import { sidebarTree, type GateGroup, type SidebarHandlers } from './pane/sidebar';
import { gatesError, headerGroup, parseGates } from './gates';
import { registerRouting, registerCompletion } from './routing';
import { registerDiscipline } from './discipline';
import { PHASE_RE, registerRestyle } from './restyle';
import { registerNotify } from './notify';
import { ownRows, paneExit, paneTool, parseMuxStatus, teamsOf } from './data/mux';
import type { TeamTool } from './orchestra-types';
import { EMPTY_ORCH, onComplete, parseWt, pushCall, type SpawnMeta, type WtRow } from './data/orchestration';

const REBUILD_MS = 1500;
const WT_MS = 5000;
const MUX_MS = 5000;
const HERDR_MS = 5000;
const GATES_MS = 30_000;
const PANE_ID = 'atlas';
// The auto open (first render with a viewport) is docked only and asks no keyboard; /atlas-cc opens a
// 12-row pane on demand, takes focus, and Esc closes it.
const PANE_DOCK = { id: PANE_ID, title: 'Atlas', columns: 56 } as const;
const PANE_ON_DEMAND = { id: PANE_ID, title: 'Atlas', rows: 12, closeOnEscape: true, focus: true } as const;
const TICK_MS = 250;
const DOCK_MIN_COLUMNS = 144; // the engine places an unasked pane only from 144 columns (UiOpenResult); below that it waits undrawn

/** The pane opens by itself only docked: a fullscreen terminal wide enough to leave the transcript its room. */
export const shouldDock = (v: { isFullscreen?: boolean; columns: number }): boolean => v.isFullscreen === true && v.columns >= DOCK_MIN_COLUMNS;

/** Toast why a pane waits undrawn, once per open call. */
const toastUnplaced = ($: EngineInterface) => (r: { isPlaced: boolean; reason?: string }): void => {
	if (!r.isPlaced && r.reason) $.ui.toast(`atlas: ${r.reason}`, { timeoutMs: 6000 });
};

// ---- session state ($.state: per-session, versioned, survives module reload) --
// Contract in types/index.d.ts. Render hooks read these (a write redraws exactly
// the readers); only handlers and ticks write, never a render hook. The scan
// that validates `$.state` keys needs each atom declared in the file that reads
// it, so routing.ts, notify.ts and restyle.tsx re-declare the few they read.
// usage: null = 'not measured yet' (rendered `--`); 0 stays a legitimate value.

const isModOn = atom({ plugin: 'atlas', key: 'isModOn' } as const, true); // ATLAS_MOD kill switch, set at session.start
const isInteractive = atom({ plugin: 'atlas', key: 'isInteractive' } as const, false);
const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null);
const usageState = atom({ plugin: 'atlas', key: 'usage' } as const, { tokens: null, contextPct: null });
const taskAgentsState = atom({ plugin: 'atlas', key: 'taskAgents' } as const, []);
const orchState = atom({ plugin: 'atlas', key: 'orch' } as const, EMPTY_ORCH);
const headerPhaseState = atom({ plugin: 'atlas', key: 'headerPhase' } as const, null);
const paneOpenedState = atom({ plugin: 'atlas', key: 'paneOpened' } as const, false); // herdrTick stays idle until the pane has been opened
// Sidebar UI state and gate data: handlers write, the Pane render hook reads.
const recipientState = atom({ plugin: 'atlas', key: 'sidebarRecipient' } as const, null);
const expandedState = atom({ plugin: 'atlas', key: 'sidebarExpanded' } as const, null);
const draftState = atom({ plugin: 'atlas', key: 'sidebarDraft' } as const, '');
const spinnerTickState = atom({ plugin: 'atlas', key: 'spinnerTick' } as const, 0); // written by restyle's ticker; renders only read it
const lastHeaderState = atom({ plugin: 'atlas', key: 'lastHeader' } as const, null);
const gatesState = atom({ plugin: 'atlas', key: 'gates' } as const, []);
const viewState = atom({ plugin: 'atlas', key: 'atlasView' } as const, 'route'); // docs and the tab strip list route first
const todoExpandedState = atom({ plugin: 'atlas', key: 'todoExpanded' } as const, null as boolean | null); // pane key `o` override; null follows ATLAS_TODO_EXPANDED
const todoExpanded = async ($: EngineInterface): Promise<boolean> => (await read($, todoExpandedState)) ?? (await $.env.get('ATLAS_TODO_EXPANDED').catch(() => undefined)) === '1';

// ---- module caches left out of $.state ---------------------------------------
// builder: a class instance with methods, not JSON (a reload leaves it null until
//   the next session.start). herdrStdout / lastFingerprint: derived perf caches
//   that refill on the next tick. gatesBusy: a run of atlas_gates.py is in flight.
//   pendingDrift: a transient queue drained by the next handler that has `$`.
let builder: SnapshotBuilder | null = null;
let herdrStdout = '';
let lastFingerprint = '';
let wtAt = -Infinity; // last atlas_wt.py status run (ms clock)
let wtRows: WtRow[] = [];
let lastRailPhase: string | null = null; // last phase the band lit, kept through a blocked reply
let muxStdout = '';
let muxAgents: (SquadAgent & TeamTool)[] = [];
let muxFirstSeen: Record<string, number> = {}; // team worker name -> first mux sight (ms), its lane's start
let muxCalls: Record<string, { uses: number; calls: number[] }> = {}; // team worker name -> pane-log tool_use count and call times (sparkline)
let sessionUuid = '';
/** raw host agent id -> display name, kept across rebuilds: a finished agent drops out of the host list but its id must keep resolving. */
let nameMemo: Record<string, string> = {};
let gatesBusy = false;
let pendingDrift: string[] = [];
let paneChecked = false; // the unasked pane open is decided once per session
let tickTimer: { cancel(): void } | null = null;
/** A spawn-recorded agent the host list does not (yet) contain is only presumed gone after this long. */
const SPAWN_GRACE_MS = 15_000;

// ---- pure helpers (no $) ----------------------------------------------------

/** `<cwd>` basename: the folder half of `<folder>@<branch>`. */
function folderOf(cwd: string): string {
	const stripped = cwd.replace(/\/+$/, '');
	const cut = stripped.lastIndexOf('/');
	return cut < 0 ? stripped : stripped.slice(cut + 1);
}

/** PhaseId the answer's header first line pins (`ATLAS | <glyph> <phase>[ n/m] | <state>`), else null. */
export function headerPhaseOf(answer: string, snapshot: AtlasSnapshot | null): PhaseId | null {
	const pattern = snapshot?.contract.headerFirstLinePattern ?? '';
	if (pattern === '') return null;
	const firstLine = answer.split('\n', 1)[0] ?? '';
	let re: RegExp;
	try {
		re = new RegExp(pattern);
	} catch {
		return null;
	}
	if (!re.test(firstLine)) return null;
	const phase = PHASE_RE.exec(firstLine)?.[1];
	return phase !== undefined && (PHASES as readonly string[]).includes(phase) ? (phase as PhaseId) : null;
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
const HOST_DONE: Record<string, string> = { completed: 'answer', failed: 'error', killed: 'error' };

/** Readable persona label for a host agent type (`atlas:explorer` -> explorer). */
const typeLabel = (type: string): string => type.replace(/^atlas:/, '').toLowerCase();

/** First 3 words of an Agent call's description as a label (`list the mod pane` -> `list-the-mod`); '' when none. */
const slugOf = (task: string | undefined): string =>
	(task ?? '').toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 3).join('-') ?? '';

type ListedRow = { id: string; teammateId?: string; description?: string; type?: string; status: string };

/** One squad row per host list row, keyed by the row's unique agent id (never by position). `taken` is the
 * id -> label memo of earlier rebuilds: a label another id already holds gets this id's suffix, so a worker
 * that dropped out of the list can never share a name (and so an activity/lifecycle key) with a new one. */
export function mapListed(
	listed: readonly ListedRow[],
	taskAgents: readonly SquadAgent[],
	meta: Record<string, SpawnMeta> = {},
	taken: Record<string, string> = {},
): { id: string; agent: SquadAgent }[] {
	const labels = new Map<string, number>();
	return listed.map((a) => {
		const recorded = taskAgents.find((t) => t.name === a.id);
		const spawned = meta[a.id];
		const persona = personaOf(a, recorded, spawned);
		const task = (typeof a.description === 'string' && a.description !== '' ? a.description : recorded?.task) || undefined;
		const base = baseLabel(a, spawned, persona, task);
		const n = (labels.get(base) ?? 0) + 1;
		labels.set(base, n);
		const heldByOther = Object.entries(taken).some(([id, label]) => id !== a.id && label === base);
		return {
			id: a.id,
			agent: {
				name: n === 1 && !heldByOther ? base : `${base}-${a.id.slice(0, 4)}`,
				persona,
				state: LIST_STATE[a.status] ?? 'running',
				source: 'task' as const,
				...(task !== undefined ? { task } : {}),
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
function baseLabel(a: ListedRow, spawned: SpawnMeta | undefined, persona: string, task: string | undefined): string {
	return firstText(
		spawned?.name,
		teammateName(a.teammateId),
		GENERIC_PERSONAS.has(persona) ? '' : persona,
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
): SquadAgent[] {
	const known = new Set(listed.map((a) => a.id));
	const live: readonly string[] = ['spawning', 'running', 'idle', 'input', 'stuck'];
	const rest = taskAgents
		.filter((t) => !known.has(t.name))
		.map((t) => {
			const at = meta[t.name]?.at;
			return now !== undefined && at !== undefined && now - at > SPAWN_GRACE_MS && live.includes(t.state) ? { ...t, state: 'finished' as const } : t;
		});
	return [...mapListed(listed, taskAgents, meta, taken).map((m) => m.agent), ...rest].slice(-64);
}

// ---- $-carrying top-level functions ----------------------------------------

/** FsLike adapter over the engine's `$.fs` (missing path => undefined, never throws). */
function engineFs($: EngineInterface): FsLike {
	return {
		read: async (path) => $.fs.read(path).catch(() => undefined),
		stat: async (path) => {
			const s = await $.fs.stat(path).catch(() => undefined);
			return s === undefined ? undefined : { size: s.size, mtimeMs: s.mtimeMs };
		},
		exists: (path) => $.fs.exists(path),
		list: async (path) => (await $.fs.list(path)).map((entry) => entry.name),
	};
}

/** `<path>` signature `mtime:size`, '-' when missing. */
async function statSig($: EngineInterface, path: string): Promise<string> {
	try {
		const s = await $.fs.stat(path);
		return `${s.mtimeMs}:${s.size}`;
	} catch {
		return '-';
	}
}

/** Todos + channels + board note-file fingerprint: what a rebuild is due on. */
async function dataFingerprint($: EngineInterface): Promise<string> {
	// The host's agent list moves without any data file changing (a subagent
	// finishing writes nothing), so its id:status pairs belong in the fingerprint,
	// or the pane keeps showing a finished agent as running.
	const agentSig = await Promise.resolve()
		.then(() => $.agent.list())
		// A running subagent's transcript tail moves with no data file: re-bucket every 5 s while any runs.
		.then(async (rows) => `${rows.map((a) => `${a.id}:${a.status}`).join(',')}${rows.some((a) => a.status === 'running') ? `@${Math.floor((await $.clock.now()) / MUX_MS)}` : ''}`)
		.catch(() => '-');
	// Usage, header phase and header misses move on session.measure / turn.complete
	// with no file change; they feed the snapshot, so they belong here too.
	const liveSig = `${JSON.stringify(await read($, usageState))}:${await read($, headerPhaseState)}`;
	// Tool calls, moods and comms move on events with no file change; a 5 s bucket
	// keeps the elapsed counters fresh while anything is working.
	const orch = await read($, orchState);
	const acts = Object.entries(orch.activity);
	const orchSig = `${orch.comms.length}:${acts.map(([k, a]) => `${k}=${a.tool ?? ''}${a.toolCount}${a.mood}`).join(',')}:${acts.some(([, a]) => a.tool !== null) ? Math.floor((await $.clock.now()) / 5000) : 0}`;
	const root = (await read($, snapshotState))?.root;
	if (root === undefined || root === null || root === '') return `no-root|${agentSig}|${liveSig}`;
	const base = `${root.replace(/\/+$/, '')}/.atlas/.run`;
	const parts = [agentSig, liveSig, orchSig, await statSig($, `${base}/todos.json`), await statSig($, `${base}/channels.json`), await statSig($, `${base}/findings.json`)];
	try {
		const files = await $.fs.list(`${base}/board`);
		for (const file of files) parts.push(`${file.name}=${await statSig($, `${base}/board/${file.name}`)}`);
	} catch {
		parts.push('no-board');
	}
	return parts.join('|');
}

/** `atlas_wt.py status` rows, re-run at most every WT_MS (git is the slow part). */
async function worktrees($: EngineInterface, now: number): Promise<WtRow[]> {
	if (now - wtAt >= WT_MS) {
		wtAt = now;
		const root = (await read($, snapshotState))?.root;
		const out = root ? await $.process.run(['python3', `${$.plugin.root}/scripts/atlas_wt.py`, '--root', root, 'status']).catch(() => undefined) : undefined;
		wtRows = out?.exitCode === 0 ? parseWt(out.stdout) : [];
	}
	return wtRows;
}

/** Snapshot root, '' when no board is in view. */
const rootOf = (snap: AtlasSnapshot | null): string => snap?.root || '';

/** Rebuild the snapshot from disk + live state; never throws. */
async function rebuild($: EngineInterface): Promise<void> {
	if (builder === null) return;
	let listed: { id: string; status: string }[] = [];
	const names: Record<string, string> = {};
	try {
		const rows = await $.agent.list();
		listed = rows.map((a) => ({ id: a.id, status: a.status }));
		const { meta } = await read($, orchState);
		const spawnNow = await $.clock.now();
		await update($, taskAgentsState, (agents) => {
			// the same rows the squad gets, keyed by host id: a label belongs to one id, never to a list position
			for (const m of mapListed(rows, agents, meta, nameMemo)) names[m.id] = m.agent.name;
			return syncAgentsFromList(rows, agents, meta, spawnNow, nameMemo);
		});
		Object.assign(nameMemo, names);
		// A worker the host lists as finished whose own turn.complete never reached us (or carried no
		// agentId): report it by the host row's id, never by guessing a running worker.
		const gone = rows.filter((a) => HOST_DONE[a.status] !== undefined);
		if (gone.length > 0) {
			await update($, orchState, (o) =>
				gone.reduce(
					(acc, a) =>
						acc.stage[a.id] === undefined || acc.stage[a.id] === 'reported'
							? acc
							: onComplete(acc, a.id, { reason: HOST_DONE[a.status] ?? 'answer', answer: '', tokens: 0 }, spawnNow),
					o,
				),
			);
		}
	} catch {
		// no agent list in this harness: keep spawn-recorded agents
	}
	try {
		const now = await $.clock.now();
		const snap = await builder.build({
			headerPhase: await read($, headerPhaseState),
			taskAgents: await read($, taskAgentsState),
			mux: muxAgents,
			herdrStdout,
			usage: await read($, usageState),
			now,
			orch: await read($, orchState),
			names: { ...nameMemo },
			listed,
			wt: await worktrees($, now),
		});
		// The snapshot write redraws the band, pane and restyles that read it.
		await update($, snapshotState, () => snap);
	} catch (err) {
		$.ui.log(`atlas: rebuild failed: ${String(err)}`, { to: 'debug' });
		// keep the last good snapshot
	}
}

/** 1.5 s tick: rebuild only when the data files moved. */
async function rebuildTick($: EngineInterface): Promise<void> {
	if (builder === null) return;
	const fingerprint = await dataFingerprint($);
	if (fingerprint === lastFingerprint && (await read($, snapshotState)) !== null) return;
	lastFingerprint = fingerprint;
	await rebuild($);
}

/** 5 s tick: herdr pane status, only once the pane was opened. */
async function herdrTick($: EngineInterface): Promise<void> {
	if (!(await read($, paneOpenedState)) || (await read($, snapshotState)) === null) return;
	const out = await $.process
		.run(['python3', `${$.plugin.root}/scripts/atlas_herdr.py`, 'status'])
		.catch(() => undefined);
	if (out === undefined || out.stdout === herdrStdout) return;
	herdrStdout = out.stdout;
	await rebuild($);
}

/** 5 s tick: atlas_mux.py status of the lead channel's run (`--run` is the channel's last segment) and of each
 * spawn-team team on that channel (a team registers under its team id); rebuilds when the output or a pane tool moved. */
async function muxTick($: EngineInterface): Promise<void> {
	const snap = await read($, snapshotState);
	const root = rootOf(snap);
	if (root === '' || snap === null) return;
	// No early return on zero runs: a reaped team (record archived, no board channel) must clear its lanes, not freeze them.
	const { runs, own } = await muxRuns($, root, snap);
	const outs = await Promise.all(runs.map((r) => muxStatus($, root, r.id)));
	const agents = await withPaneTools($, root, ownRows(outs.flatMap((o, i) => parseMuxStatus(o, runs[i]!.members)), own));
	const sig = `${outs.join('\n')}|${agents.map((a) => `${a.tool ?? ''}${a.lastTool ?? ''}${a.target ?? ''}${a.uses ?? ''}`).join(',')}`;
	if (sig === muxStdout) return;
	muxStdout = sig;
	muxAgents = agents;
	await rebuild($);
}

/** `--root` is a `status` option: before the subcommand argparse rejects it (exit 2), which kept every mux row out. */
async function muxStatus($: EngineInterface, root: string, run: string): Promise<string> {
	const out = await $.process.run(['python3', `${$.plugin.root}/scripts/atlas_mux.py`, 'status', '--run', run, '--root', root]).catch(() => undefined);
	return out?.exitCode === 0 ? out.stdout : '';
}

/** Status runs: the board channel's, plus each `.atlas/.run/teams/<id>.json` team on the board channel or on this
 * session's lead channel (`<folder>@<branch>/lead-<session6>`, which the board channel need not be). `own`: the
 * worker names this session may show (team members and board members). */
async function muxRuns($: EngineInterface, root: string, snap: AtlasSnapshot): Promise<{ runs: { id: string; members: string[] }[]; own: Set<string> }> {
	const dir = `${root.replace(/\/+$/, '')}/.atlas/.run/teams`;
	const names = (await $.fs.list(dir).catch(() => [])).map((e) => e.name).filter((n) => n.endsWith('.json'));
	const records = await Promise.all(names.map(async (name) => ({ name, text: (await $.fs.read(`${dir}/${name}`).catch(() => undefined)) ?? '' })));
	const board = snap.channel ?? '';
	const teams = teamsOf(records, [board, `lead-${snap.sessionId.slice(0, 6)}`]);
	const runs = [...(board ? [{ id: board.split('/').pop() ?? board, members: [] }] : []), ...teams];
	return { runs, own: new Set([...teams.flatMap((t) => t.members), ...snap.members.map((m) => m.name)]) };
}

/** Tool uses that appeared in a pane log since the last read become calls at `now` (the first read is the baseline). */
function paneCalls(name: string, uses: number, now: number): number[] {
	const prev = (muxCalls[name] ??= { uses, calls: [] });
	for (let n = prev.uses; n < uses; n++) prev.calls = pushCall(prev.calls, now);
	prev.uses = uses;
	return prev.calls;
}

/** Running team workers get their tool / last tool / target from their pane log (the pane feed writes stream-json there)
 * and a first-seen start, so the lane's age counts up. ponytail: reads each running worker's whole log every MUX_MS;
 * tail-read if logs grow past a few MB. */
async function withPaneTools($: EngineInterface, root: string, agents: SquadAgent[]): Promise<(SquadAgent & TeamTool)[]> {
	const logs = `${root.replace(/\/+$/, '')}/.atlas/.run/logs`;
	const now = await $.clock.now();
	return Promise.all(
		agents.map(async (a) => {
			const startedAt = (muxFirstSeen[a.name] ??= now);
			if (a.state !== 'running') return a;
			const log = (await $.fs.read(`${logs}/${a.name}.log`).catch(() => undefined)) ?? '';
			const pane = paneTool(log);
			return { ...a, state: paneExit(log) ?? a.state, startedAt, ...pane, calls: paneCalls(a.name, pane.uses ?? 0, now) };
		}),
	);
}

/** Current branch of `cwd` (fall back to 'main' outside a repo). */
async function gitBranch($: EngineInterface, cwd: string): Promise<string> {
	try {
		const out = await $.process.run(['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']);
		const branch = out.stdout.trim();
		return branch === '' ? 'main' : branch;
	} catch {
		return 'main';
	}
}

/** Gate groups from one atlas_gates.py run; a nonzero exit or bad JSON becomes a single error group. */
function groupsFromRun(out: { exitCode: number; stdout: string; stderr: string }): GateGroup[] {
	try {
		if (out.exitCode !== 0) throw new Error(out.stderr.trim().split('\n').pop() || `exit ${out.exitCode}`);
		return parseGates(out.stdout);
	} catch (err) {
		return [gatesError(err instanceof Error ? err.message : String(err))];
	}
}

/** Run atlas_gates.py and store its groups; a missing script, nonzero exit or bad JSON becomes an error group. Skips when a run is in flight. */
async function runGates($: EngineInterface): Promise<void> {
	if (gatesBusy || sessionUuid === '') return;
	const root = rootOf(await read($, snapshotState));
	if (root === '') return;
	gatesBusy = true;
	try {
		const out = await $.process
			.run(['python3', `${$.plugin.root}/scripts/atlas_gates.py`, '--session', sessionUuid, '--root', root, '--json'])
			.catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }));
		const groups = groupsFromRun(out);
		await update($, gatesState, () => groups);
	} finally {
		gatesBusy = false;
	}
}

/** Board root and channel for the note intent. */
const noteContext = (snapshot: AtlasSnapshot | null): { root: string; channel: string | null } => ({ root: rootOf(snapshot), channel: snapshot?.channel ?? null });

/** Argv for posting `note` to `who` through the note intent, or the toast text explaining why not. */
function noteArgv($: EngineInterface, who: string, note: string, snapshot: AtlasSnapshot | null): { argv: string[] } | { error: string } {
	const ctx = noteContext(snapshot);
	const res = intentToArgv({ t: 'note', channel: ctx.channel ?? '', to: who, text: note }, { pluginRoot: $.plugin.root, ...ctx });
	if (!res.ok) return { error: res.error };
	return res.kind === 'cli' ? { argv: res.argv } : { error: 'no board in view' };
}

/** Post the draft to the selected member (the lead when none) through the same note intent /atlas-say uses. */
async function sendNote($: EngineInterface, text: string): Promise<void> {
	const note = text.trim();
	if (note === '') return;
	const who = (await read($, recipientState)) ?? 'lead';
	const built = noteArgv($, who, note, await read($, snapshotState));
	if ('error' in built) {
		$.ui.toast(`atlas: ${built.error}`, { timeoutMs: 6000 });
		return; // the draft stays
	}
	const out = await $.process.run(built.argv);
	if (out.exitCode !== 0) {
		$.ui.toast(`atlas: ${out.stderr.trim() || `exit ${out.exitCode}`}`, { timeoutMs: 6000 });
		return;
	}
	await update($, draftState, () => '');
	$.ui.toast(`Sent to ${who}`, { timeoutMs: 3000 });
	void rebuild($);
}

/** Run a handler's async work, reporting a failure as a toast instead of an unhandled rejection. */
const guardedBy = ($: EngineInterface) => (fn: () => Promise<unknown>): void => {
	fn().catch((err: unknown) => $.ui.toast(`atlas: ${String(err)}`, { timeoutMs: 6000 }));
};

/** Closures for the sidebar view: each writes $.state (never the render hook) and reports failures as toasts. */
function sidebarHandlers($: EngineInterface, surface: 'terminal'): SidebarHandlers {
	const guarded = guardedBy($);
	return {
		selectRecipient: (name) => guarded(() => update($, recipientState, (cur) => (cur === name ? null : name))),
		toggle: (key) => guarded(() => update($, expandedState, (cur) => (cur === key ? null : key))),
		draftChange: (text) => guarded(() => update($, draftState, () => text)),
		send: (text) => guarded(() => sendNote($, text)),
		focus: (key) => guarded(() => $.ui.focus({ requestId: PANE_ID, key })),
		setView: (v) => guarded(() => update($, viewState, () => v)),
		toggleTodos: () => guarded(async () => { const open = await todoExpanded($); await update($, todoExpandedState, () => !open); }),
		expand: (key) =>
			guarded(async () => {
				await update($, expandedState, () => key);
				await $.ui.focus({ requestId: PANE_ID, key });
			}),
		copy: (text) =>
			guarded(async () => {
				const res = await $.ui.copy({ text, surface });
				$.ui.toast(res.isCopied ? 'Copied' : 'Copy failed', { timeoutMs: 3000 });
			}),
	};
}

/** Band footer presses: open (or focus) the pane on a view, as /atlas-cc does, or fold the board. */
function bandHandlers($: EngineInterface): BandHandlers {
	const guarded = guardedBy($);
	return {
		openView: (v) =>
			guarded(async () => {
				// Open first, before any await: the engine counts the open as asked (placed at any width) only while the press is behind it.
				const opened = $.ui.open(PANE_ON_DEMAND);
				await update($, viewState, () => v);
				await update($, paneOpenedState, () => true);
				toastUnplaced($)(await opened);
			}),
		toggleTodos: () => guarded(async () => { const open = await todoExpanded($); await update($, todoExpandedState, () => !open); }),
	};
}

/** Script groups plus the header group built from the last answer. */
async function gateGroups($: EngineInterface): Promise<GateGroup[]> {
	return [...(await read($, gatesState)).filter((g) => g.id !== 'header'), headerGroup(await read($, lastHeaderState))];
}

// ---- entrypoint -------------------------------------------------------------

export async function register(on: On, options: PluginOptions): Promise<void> {
	// Sibling registrars, wired by their real signatures. Persona routing pins
	// model/effort and records spawned agents and turn completions; the
	// prompt reinforce line reads the live contract; restyles and turn-boundary
	// notifications read the snapshot from $.state themselves. (register has no
	// `$`, so drift logs queue and a handler drains them.)
	registerRouting(on, {
		getPersonas: (snapshot) => snapshot?.personas ?? [],
		logDrift: (msg) => {
			pendingDrift.push(msg);
		},
	});
	registerCompletion(on);
	registerDiscipline(on, {
		reinforce: (snapshot) =>
			snapshot?.contract.headerFirstLinePattern
				? `atlas contract: open replies with a header line matching ${snapshot.contract.headerFirstLinePattern} (phase: ${snapshot.phase})`
				: null,
	});
	registerRestyle(on); // its turn.start also drops the previous turn's header phase
	registerNotify(on, { soundEnabled: () => options.atlas_mod_sound === true });

	// Session boot: read the kill switch, resolve the board, build the first
	// snapshot, start timers and register commands — interactive sessions only;
	// headless (-p / SDK) stays inert.
	on('session.start', async ($, e, next) => {
		try {
			const modOn = (await $.env.get('ATLAS_MOD').catch(() => undefined)) !== 'off';
			await update($, isModOn, () => modOn);
			// A fresh session is unmeasured again, whatever an earlier one measured,
			// and its agents are its own.
			await update($, usageState, () => ({ tokens: null, contextPct: null }));
			await update($, taskAgentsState, () => []);
			await update($, paneOpenedState, () => false);
			paneChecked = false;
			if (!modOn) return next(e);
			const interactive = e.isInteractive;
			await update($, isInteractive, () => interactive);
			builder = new SnapshotBuilder(engineFs($), $.plugin.root);
			const sessionId = await $.session.id();
			sessionUuid = sessionId;
			nameMemo = {};
			muxStdout = '';
			muxAgents = [];
			muxFirstSeen = {};
			muxCalls = {};
			const envRoot = await $.env.get('ATLAS_PROJECT_ROOT');
			await builder.init(e.cwd, { ATLAS_PROJECT_ROOT: envRoot }, sessionId, folderOf(e.cwd), await gitBranch($, e.cwd));
			await rebuild($);
			if (interactive) {
				await $.command.register({ name: 'atlas-cc', description: 'Open and focus the Atlas sidebar' });
				await $.command.register({ name: 'atlas-say', description: 'Post a note to the lead channel', argumentHint: '<message>' });
				await $.command.register({ name: 'atlas-todo', description: 'Add a todo to the board', argumentHint: '<text>' });
				$.clock.every(REBUILD_MS, () => {
					void rebuildTick($);
				});
				$.clock.every(HERDR_MS, () => {
					void herdrTick($);
				});
				$.clock.every(MUX_MS, () => {
					void muxTick($);
				});
				$.clock.every(GATES_MS, () => {
					void runGates($);
				});
				void runGates($);
				// The tick only runs while a worker is live, so an idle session redraws nothing.
				tickTimer?.cancel();
				tickTimer = $.clock.every(TICK_MS, () => {
					void (async () => {
						const snap = await read($, snapshotState);
						if (snap && activeCount(liveWorkers(snap, Date.now())) > 0) await update($, spinnerTickState, (n) => n + 1);
					})().catch(() => undefined);
				});
			}
		} catch (err) {
			// a failed boot must not block the session
			$.ui.log(`atlas: boot failed: ${String(err)}`, { to: 'debug' });
		}
		return next(e);
	});

	// Usage figures (tokens / context fill), pushed after each turn.
	on('session.measure', async ($, e, next) => {
		if (await read($, isModOn)) {
			await update($, usageState, (usage) => ({
				tokens: e.context.tokens ?? usage.tokens,
				contextPct: e.context.percent ?? usage.contextPct,
			}));
		}
		return next(e);
	});

	// Header phase from the last main-loop ANSWER (reason 'answer': the matcher
	// keeps this a distinct registration beside routing.ts's un-matchered
	// turn.complete drift counter); task agents finish per turn; queued
	// routing-drift lines reach the debug log here, where `$` exists.
	on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
		try {
			if (!(await read($, isModOn))) return next(e);
			for (const msg of pendingDrift.splice(0)) $.ui.log(msg, { to: 'debug' });
			if (e.agentId === undefined) {
				const phase = headerPhaseOf(e.answer, await read($, snapshotState));
				await update($, headerPhaseState, () => phase);
				void runGates($);
			} else {
				const agentId = e.agentId;
				await update($, taskAgentsState, (agents) =>
					agents.map((agent) => (agent.name === agentId || agent.name === nameMemo[agentId] ? { ...agent, state: 'finished' as const } : agent)),
				);
			}
		} catch {
			// a drift check never blocks the answer
		}
		return next(e);
	});

	// The band above the prompt: bordered section (terminal + interactive only).
	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		if (e.surface !== 'terminal' || e.props.hasSurvey || !(await read($, isModOn)) || !(await read($, isInteractive))) return next(e);
		// Unasked, the pane docks only beside a fullscreen transcript wide enough for it; checked once, at the first render that knows the viewport.
		if (!paneChecked && e.viewport) {
			paneChecked = true;
			if (shouldDock(e.viewport)) {
				await update($, paneOpenedState, () => true);
				void $.ui.open(PANE_DOCK).then(toastUnplaced($));
			}
		}
		const snapshot = await read($, snapshotState);
		if (snapshot === null) return next(e);
		const gates = await gateGroups($);
		lastRailPhase = railPhase(snapshot, lastRailPhase); // a blocked reply keeps the phase lit before it
		const band = bandTree($.ui.resolve(e), { snapshot, live: liveWorkers(snapshot, Date.now()), gates, columns: e.props.bodyColumns, tick: await read($, spinnerTickState), maxRows: e.props.maxRows, lastPhase: lastRailPhase, todoExpanded: await todoExpanded($) }, bandHandlers($));
		return $.ui.resolve(e).Box({ flexDirection: 'column', flexShrink: 0, children: [band, await next(e)] });
	});

	// The Atlas sidebar: a native tree, so its elements join the engine's focus ring.
	on('ui.render', { component: 'Pane' }, async ($, e, next) => {
		if (e.surface !== 'terminal' || e.requestId !== PANE_ID || !(await read($, isModOn))) return next(e);
		const snapshot = await read($, snapshotState);
		if (snapshot === null) return next(e);
		return sidebarTree($.ui.resolve(e), {
			snapshot,
			gates: await gateGroups($),
			ui: { recipient: await read($, recipientState), expanded: await read($, expandedState), draft: await read($, draftState), view: await read($, viewState) },
			columns: e.props.bodyColumns,
			rows: e.props.scroll.bodyRows,
			tick: await read($, spinnerTickState),
		}, sidebarHandlers($, e.surface));
	});

	// A tree this plugin drew was refused: surface it in the debug log.
	on('ui.fault', ($, e, next) => {
		$.ui.log(`atlas: ${e.component} ${e.module} ${e.phase}: ${e.reason}`, { to: 'debug' });
		return next(e);
	});

	// /atlas-cc — open the sidebar and give it the keyboard; it stays until the person closes it.
	on('command.run', { command: 'atlas-cc' }, async ($) => {
		await update($, paneOpenedState, () => true);
		toastUnplaced($)(await $.ui.open(PANE_ON_DEMAND));
		void rebuild($);
		return {};
	});

	// Session over: the spinner clock stops.
	on('session.end', (_$, e, next) => {
		tickTimer?.cancel();
		tickTimer = null;
		return next(e);
	});

	// The person closed the pane (Esc or the close mark): /atlas-cc opens it again next time.
	on('ui.close', async ($, e, next) => {
		if (e.id === PANE_ID) {
			await update($, paneOpenedState, () => false);
			await update($, viewState, () => 'route'); // reopen on the first tab, not the last one used
		}
		return next(e);
	});

	// /atlas-say <message> — post a note to the lead channel.
	on('command.run', { command: 'atlas-say' }, async ($, e) => {
		const text = e.args.trim();
		if (text === '') return { text: 'usage: /atlas-say <message>' };
		const snapshot = await read($, snapshotState);
		const res = intentToArgv(
			{ t: 'note', channel: snapshot?.channel ?? '', to: 'lead', text },
			{ pluginRoot: $.plugin.root, root: snapshot?.root ?? '', channel: snapshot?.channel ?? null },
		);
		if (!res.ok || res.kind !== 'cli') return { text: `atlas: ${res.ok ? 'no board in view' : res.error}` };
		const out = await $.process.run(res.argv);
		void rebuild($);
		return { text: out.exitCode === 0 ? 'sent' : `atlas: ${out.stderr.trim() || `exit ${out.exitCode}`}` };
	});

	// /atlas-todo <text> — add a todo at the current phase.
	on('command.run', { command: 'atlas-todo' }, async ($, e) => {
		const text = e.args.trim();
		if (text === '') return { text: 'usage: /atlas-todo <text>' };
		const snapshot = await read($, snapshotState);
		const out = await $.process.run([
			'python3',
			`${$.plugin.root}/scripts/atlas_todo.py`,
			'add',
			'--root',
			snapshot?.root ?? '',
			text,
			'--phase',
			snapshot?.phase ?? 'research',
		]);
		void rebuild($);
		return { text: out.exitCode === 0 ? 'added' : `atlas: ${out.stderr.trim() || `exit ${out.exitCode}`}` };
	});
}
