// register.ts — the Atlas mod entrypoint (plan docs/plans/2026-10-09-atlas-mod.md §3).
// Declared by hooks/hooks.json "modules": ["./mod/register.ts"]. Kill switch:
// ATLAS_MOD=off turns every wired handler into a pass-through (register itself
// has no `$`: the flag is read at the first event, session.start). Harness
// constraints honored: static imports only, `$` flows only through top-level
// `function` declarations and handler parameters, and no ui.* call runs unless
// a person is at the prompt (hooks also run headless, surface null).
import type { EngineInterface, On, PluginOptions } from 'claude-code';
import { SnapshotBuilder } from './snapshot';
import type { AgentState, AtlasSnapshot, FsLike, PhaseId, SquadAgent } from './contract';
import { completeProps } from './props';
import { PHASES, intentToArgv } from './intents';
import { registerRouting, registerHeaderDrift, registerPromptReinforce } from './routing';
import { registerRestyle } from './restyle';
import { registerNotify } from './notify';

const REBUILD_MS = 1500;
const HERDR_MS = 5000;
const PANE_ID = 'atlas';
const SPRITES_PANE_ID = 'atlas-sprites';
const BAND_KEY = 'atlas-band';
const PANE_KEY = 'atlas-pane';
const SPRITES_KEY = 'atlas-sprites';
const BAND_MODULE = './band.tsx';
const STOP_CONFIRM = ['Kill it', 'Leave it'] as const;

type PaneTab = 'colony' | 'channel' | 'board' | 'squad' | 'collab';

// ---- module state (plugin-scoped, shared across hook dispatches) ------------

let modOn = true; // ATLAS_MOD kill switch, evaluated at session.start
let interactive = false;
let builder: SnapshotBuilder | null = null;
let snapshot: AtlasSnapshot | null = null;
let tab: PaneTab = 'colony';
let herdrStdout = '';
let headerPhase: PhaseId | null = null;
let headerMisses = 0;
let lastSeenSeq = 0;
let lastFingerprint = '';
// Unknown until session.measure carries a value: null = 'not measured yet',
// rendered `--`; 0 stays a legitimate measured value.
let usage: { tokens: number | null; costUsd: number | null; contextPct: number | null } = {
	tokens: null,
	costUsd: null,
	contextPct: null,
};
let bandGeom = { columns: 0, maxRows: 0 };
let paneGeom = { columns: 0, rows: 0 };
let taskAgents: SquadAgent[] = [];
let pendingDrift: string[] = []; // drained to $.ui.log by a handler that has $

// ---- pure helpers (no $) ----------------------------------------------------

/** `<cwd>` basename: the folder half of `<folder>@<branch>`. */
function folderOf(cwd: string): string {
	const stripped = cwd.replace(/\/+$/, '');
	const cut = stripped.lastIndexOf('/');
	return cut < 0 ? stripped : stripped.slice(cut + 1);
}

/** PhaseId the answer's header first line pins (`# atlas: [implement] ...`), else null. */
function headerPhaseOf(answer: string): PhaseId | null {
	const contract = snapshot?.contract;
	if (!contract || contract.headerFirstLinePattern === '') return null;
	const firstLine = answer.split('\n', 1)[0] ?? '';
	let re: RegExp;
	try {
		re = new RegExp(contract.headerFirstLinePattern);
	} catch {
		return null;
	}
	if (!re.test(firstLine)) return null;
	const m = /\[([a-z]+)\]/i.exec(firstLine);
	const phase = m?.[1]?.toLowerCase();
	return phase !== undefined && (PHASES as readonly string[]).includes(phase) ? (phase as PhaseId) : null;
}

/** Fresh Client props for the posting instance (band or pane geometry). */
function clientPropsFor(module: string): Record<string, unknown> {
	if (snapshot === null) return {};
	if (module === BAND_MODULE) {
		return completeProps({ snapshot, columns: bandGeom.columns, maxRows: bandGeom.maxRows, usage });
	}
	return completeProps({ snapshot, columns: paneGeom.columns, rows: paneGeom.rows });
}

/** Track a spawned atlas persona as a live task agent (capped). */
function recordAgent(agentId: string, persona: string): void {
	const existing = taskAgents.find((a) => a.name === agentId);
	if (existing !== undefined) {
		existing.persona = persona;
		return;
	}
	taskAgents.push({ name: agentId, persona, state: 'running', source: 'task' });
	if (taskAgents.length > 64) taskAgents = taskAgents.slice(-64);
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

/** Sync the squad's task agents with the host's own agent list (ground truth,
 * catches spawns the agent.spawn hook missed); spawn-recorded entries not yet
 * listed stay as the instant fallback. Never throws. */
function syncAgentsFromList(listed: readonly { id: string; name?: string; status: string }[]): void {
	const known = new Set<string>();
	const mapped: SquadAgent[] = [];
	for (const a of listed) {
		const name = typeof a.name === 'string' && a.name !== '' ? a.name : a.id;
		known.add(name);
		mapped.push({
			name,
			persona: taskAgents.find((t) => t.name === name)?.persona ?? 'unknown',
			state: LIST_STATE[a.status] ?? 'running',
			source: 'task',
		});
	}
	taskAgents = [...mapped, ...taskAgents.filter((t) => !known.has(t.name))].slice(-64);
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
	const root = snapshot?.root;
	if (root === undefined || root === null || root === '') return 'no-root';
	const base = `${root.replace(/\/+$/, '')}/.atlas/.run`;
	const parts = [await statSig($, `${base}/todos.json`), await statSig($, `${base}/channels.json`)];
	try {
		const files = await $.fs.list(`${base}/board`);
		for (const file of files) parts.push(`${file.name}=${await statSig($, `${base}/board/${file.name}`)}`);
	} catch {
		parts.push('no-board');
	}
	return parts.join('|');
}

/** Rebuild the snapshot from disk + live state; never throws. */
async function rebuild($: EngineInterface): Promise<void> {
	if (builder === null) return;
	try {
		syncAgentsFromList(await $.agent.list());
	} catch {
		// no agent list in this harness: keep spawn-recorded agents
	}
	try {
		const now = await $.clock.now();
		const snap = await builder.build({
			headerPhase,
			headerMisses,
			taskAgents,
			herdrStdout,
			usage,
			lastSeenSeq,
			now,
		});
		snapshot = snap;
		for (const note of snap.notes) if (note.seq > lastSeenSeq) lastSeenSeq = note.seq;
		if (interactive) $.ui.invalidate('ui.render');
	} catch {
		// keep the last good snapshot
	}
}

/** 1.5 s tick: rebuild only when the data files moved. */
async function rebuildTick($: EngineInterface): Promise<void> {
	if (builder === null) return;
	const fingerprint = await dataFingerprint($);
	if (fingerprint === lastFingerprint && snapshot !== null) return;
	lastFingerprint = fingerprint;
	await rebuild($);
}

/** 5 s tick: herdr pane status, only while the Colony tab is showing. */
async function herdrTick($: EngineInterface): Promise<void> {
	if (tab !== 'colony' || snapshot === null) return;
	const out = await $.process
		.run(['python3', `${$.plugin.root}/scripts/atlas_herdr.py`, 'status'])
		.catch(() => undefined);
	if (out === undefined || out.stdout === herdrStdout) return;
	herdrStdout = out.stdout;
	await rebuild($);
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

// ---- entrypoint -------------------------------------------------------------

export async function register(on: On, options: PluginOptions): Promise<void> {
	// Sibling registrars, wired by their real signatures. Persona routing pins
	// model/effort and records spawned agents; the header-drift counter and the
	// prompt reinforce line read the live contract; restyles and turn-boundary
	// notifications read the live snapshot. (register has no `$`, so drift logs
	// queue and a handler drains them.)
	registerRouting(on, {
		getPersonas: () => snapshot?.personas ?? [],
		recordAgent,
		logDrift: (msg) => {
			pendingDrift.push(msg);
		},
	});
	registerHeaderDrift(on, {
		pattern: () => snapshot?.contract.headerFirstLinePattern ?? '',
		onMiss: () => {
			headerMisses += 1;
		},
	});
	registerPromptReinforce(on, {
		line: () =>
			snapshot?.contract.headerFirstLinePattern
				? `atlas contract: open replies with a header line matching ${snapshot.contract.headerFirstLinePattern} (phase: ${snapshot.phase})`
				: null,
	});
	registerRestyle(on, { getSnapshot: () => snapshot });
	registerNotify(on, { getSnapshot: () => snapshot, soundEnabled: () => options.atlas_mod_sound === true });

	// Session boot: read the kill switch, resolve the board, build the first
	// snapshot, start timers and register commands — interactive sessions only;
	// headless (-p / SDK) stays inert.
	on('session.start', async ($, e, next) => {
		try {
			modOn = (await $.env.get('ATLAS_MOD').catch(() => undefined)) !== 'off';
			// A fresh session is unmeasured again, whatever an earlier one measured,
			// and its agents are its own.
			usage = { tokens: null, costUsd: null, contextPct: null };
			taskAgents = [];
			if (!modOn) return next(e);
			interactive = e.isInteractive;
			builder = new SnapshotBuilder(engineFs($), $.plugin.root);
			const sessionId = await $.session.id();
			const envRoot = await $.env.get('ATLAS_PROJECT_ROOT');
			await builder.init(e.cwd, { ATLAS_PROJECT_ROOT: envRoot }, sessionId, folderOf(e.cwd), await gitBranch($, e.cwd));
			await rebuild($);
			if (interactive) {
				await $.command.register({ name: 'atlas-cc', description: 'Open the Atlas command center', argumentHint: '[colony|channel|board|squad|collab]' });
				await $.command.register({ name: 'atlas-say', description: 'Post a note to the lead channel', argumentHint: '<message>' });
				await $.command.register({ name: 'atlas-todo', description: 'Add a todo to the board', argumentHint: '<text>' });
				await $.command.register({ name: 'atlas-sprites', description: 'Open the sprite gallery pane' });
				$.clock.every(REBUILD_MS, () => {
					void rebuildTick($);
				});
				$.clock.every(HERDR_MS, () => {
					void herdrTick($);
				});
			}
		} catch {
			// a failed boot must not block the session
		}
		return next(e);
	});

	// Usage figures (tokens / cost / context fill), pushed after each turn.
	on('session.measure', (_$, e, next) => {
		if (modOn) {
			usage = {
				tokens: e.context.tokens ?? usage.tokens,
				costUsd: e.cost?.usd ?? usage.costUsd,
				contextPct: e.context.percent ?? usage.contextPct,
			};
		}
		return next(e);
	});

	// Header phase from the last main-loop ANSWER (reason 'answer': the matcher
	// keeps this a distinct registration beside routing.ts's un-matchered
	// turn.complete drift counter); task agents finish per turn; queued
	// routing-drift lines reach the debug log here, where `$` exists.
	on('turn.complete', { reason: 'answer' }, ($, e, next) => {
		try {
			if (!modOn) return next(e);
			for (const msg of pendingDrift.splice(0)) $.ui.log(msg, { to: 'debug' });
			if (e.agentId === undefined) {
				headerPhase = headerPhaseOf(e.answer);
			} else {
				for (const agent of taskAgents) {
					if (agent.name === e.agentId) agent.state = 'finished';
				}
			}
		} catch {
			// a drift check never blocks the answer
		}
		return next(e);
	});

	// The band above the prompt (terminal + interactive only).
	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		if (!modOn || snapshot === null || !interactive || e.surface !== 'terminal') return next(e);
		bandGeom = { columns: e.props.bodyColumns, maxRows: e.props.maxRows };
		const { Client } = $.ui.resolve(e);
		return Client({ key: BAND_KEY, module: './band.tsx', props: completeProps({ snapshot, columns: e.props.bodyColumns, maxRows: e.props.maxRows, usage }) });
	});

	// The docked command-center pane and the sprites gallery pane.
	on('ui.render', { component: 'Pane' }, async ($, e, next) => {
		if (!modOn || snapshot === null || e.surface !== 'terminal') return next(e);
		paneGeom = { columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows };
		const { Client } = $.ui.resolve(e);
		if (e.requestId === SPRITES_PANE_ID) {
			return Client({ key: SPRITES_KEY, module: './pane/sprites.tsx', props: completeProps({ columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows }) });
		}
		if (e.requestId !== PANE_ID) return next(e);
		const props = completeProps({ snapshot, columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows });
		// module must be a string literal in source: the host reads it off the tree.
		switch (tab) {
			case 'channel':
				return Client({ key: PANE_KEY, module: './pane/channel.tsx', props });
			case 'board':
				return Client({ key: PANE_KEY, module: './pane/board.tsx', props });
			case 'squad':
				return Client({ key: PANE_KEY, module: './pane/squad.tsx', props });
			case 'collab':
				return Client({ key: PANE_KEY, module: './pane/collab.tsx', props });
			default:
				return Client({ key: PANE_KEY, module: './pane/colony.tsx', props });
		}
	});

	// Client posts: validate the intent, run it, answer with fresh props.
	on('ui.message', async ($, e, next) => {
		try {
			if (!modOn) return next(e);
			const raw = e.data as { t?: unknown; run?: unknown } | null;
			if (raw !== null && typeof raw === 'object' && raw.t === 'stop') {
				if (!interactive) {
					$.ui.log('atlas: stopping a run needs an interactive session');
					return next(e);
				}
				const answer = await $.ui.ask(`Stop run ${String(raw.run ?? '')}?`, STOP_CONFIRM);
				if (answer !== STOP_CONFIRM[0]) {
					return { props: clientPropsFor(e.module) }; // declined: nothing ran
				}
			}
			const res = intentToArgv(e.data, {
				pluginRoot: $.plugin.root,
				root: snapshot?.root ?? '',
				channel: snapshot?.channel ?? null,
			});
			if (!res.ok) {
				$.ui.log(`atlas: ${res.error}`);
				return next(e);
			}
			if (res.kind === 'ui') {
				if (res.tab !== undefined) tab = res.tab as PaneTab;
				else tab = 'colony'; // inspect: focus the colony
				await $.ui.open({ id: PANE_ID, title: 'Atlas' });
				return { props: clientPropsFor(e.module) };
			}
			const out = await $.process.run(res.argv);
			if (out.exitCode !== 0) $.ui.log(`atlas: ${out.stderr.trim() || `exit ${out.exitCode}`}`);
			await rebuild($);
			return { props: clientPropsFor(e.module) };
		} catch {
			return next(e);
		}
	});

	// /atlas-cc [tab] — open (or retitle to) the command center.
	on('command.run', { command: 'atlas-cc' }, async ($, e) => {
		const arg = e.args.trim().toLowerCase();
		if (arg === 'colony' || arg === 'channel' || arg === 'board' || arg === 'squad' || arg === 'collab') tab = arg;
		await $.ui.open({ id: PANE_ID, title: 'Atlas' });
		void rebuild($);
		return {};
	});

	// /atlas-say <message> — post a note to the lead channel.
	on('command.run', { command: 'atlas-say' }, async ($, e) => {
		const text = e.args.trim();
		if (text === '') return { text: 'usage: /atlas-say <message>' };
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

	// /atlas-sprites — the gallery pane.
	on('command.run', { command: 'atlas-sprites' }, async ($, _e) => {
		await $.ui.open({ id: SPRITES_PANE_ID, title: 'Atlas sprites' });
		return {};
	});
}
