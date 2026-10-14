/**
 * `atlas_team`: one model-callable tool for the tmux worker-team flow (spawn-team, wait, reap) so an omp lead runs
 * the same team flow a Claude lead runs from the shell. It shells out to scripts/atlas_mux.py and returns its JSON.
 * Never registered in worker sessions (atlas_mux pins ATLAS_WORKER_NAME in the worker env): workers do not spawn teams.
 */
import { readFileSync } from "node:fs";
import * as nodePath from "node:path";
import type { ChannelOpenInfo, WidgetUi } from "./channel-view";
import { runCapture } from "./proc";

/** The slice of omp's ExtensionAPI this tool needs (structural, so tests and older hosts can stand in). */
export interface TeamToolHost {
	registerTool?: (tool: unknown) => void;
	typebox?: { Type: any };
}

export interface TeamParams {
	action: "spawn" | "wait" | "reap";
	class?: string;
	effort?: string;
	paths?: string[];
	task?: string;
	team?: string;
	timeout?: number;
}

export type TeamRunner = (argv: string[], cwd: string, timeoutMs: number) => Promise<{ code: number | null; stdout: string }>;

const need = (value: string | undefined, label: string): string => {
	if (!value) throw new Error(`atlas_team: ${label} is required`);
	return value;
};

const muxArgv = (pluginRoot: string, ...rest: string[]): string[] => ["python3", nodePath.join(pluginRoot, "scripts", "atlas_mux.py"), ...rest];

function spawnArgv(p: TeamParams, pluginRoot: string): string[] {
	const argv = muxArgv(pluginRoot, "spawn-team", "--class", need(p.class, "class"), "--effort", need(p.effort, "effort"), "--task", need(p.task, "task"), "--harness", "omp");
	return argv.concat(p.paths?.length ? ["--paths", p.paths.join(",")] : []);
}

/** argv for atlas_mux.py; throws on a missing required field so the model gets a clear message. */
export function teamArgv(p: TeamParams, pluginRoot: string): string[] {
	if (p.action === "spawn") return spawnArgv(p, pluginRoot);
	const argv = muxArgv(pluginRoot, p.action, "--team", need(p.team, "team"));
	return argv.concat(p.action === "wait" && p.timeout !== undefined ? ["--timeout", String(p.timeout)] : []);
}

const defaultRunner: TeamRunner = (argv, cwd, timeoutMs) => runCapture(argv, { cwd, timeoutMs, env: { ATLAS_MUX: "tmux" } });

const isWorker = (env: Record<string, string | undefined>): boolean => (env.ATLAS_WORKER_NAME ?? "").trim() !== "";
// older hosts and test doubles expose no registerTool/typebox
const canRegister = (pi: TeamToolHost): boolean => typeof pi.registerTool === "function" && !!pi.typebox?.Type;

/** Mounts the Mission Control widget on the team's channel (channel-view.ts open). */
export type TeamOpen = (ui: WidgetUi, info: ChannelOpenInfo) => void;
type TeamCtx = { cwd: string; ui?: WidgetUi; sessionManager?: { getSessionId?: () => unknown } };
type TeamView = { channel: string; members: string[] };

const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/; // atlas_mux NAME_RE; also keeps the id inside .atlas/.run/teams

type MemberRow = { name?: unknown; ok?: unknown };
/** Names of members that started (spawn result rows carry ok; team-record rows do not). */
const startedNames = (rows: unknown): string[] =>
	(Array.isArray(rows) ? (rows as MemberRow[]) : []).filter(m => typeof m?.name === "string" && m.ok !== false).map(m => String(m.name));

/** {channel, member names} from a JSON object carrying `channel` and `members[].name`; undefined otherwise. */
function teamView(rec: unknown): TeamView | undefined {
	const r = (rec ?? {}) as { channel?: unknown; members?: unknown };
	const members = startedNames(r.members);
	return typeof r.channel === "string" && members.length ? { channel: r.channel, members } : undefined;
}

/** The live (unarchived) team record; reap moves it to teams/archive, so a reaped team never re-mounts. */
function teamRecordView(root: string, team: string | undefined): TeamView | undefined {
	if (!team || !TEAM_ID_RE.test(team)) return undefined;
	try {
		return teamView(JSON.parse(readFileSync(nodePath.join(root, ".atlas", ".run", "teams", `${team}.json`), "utf8")));
	} catch {
		return undefined;
	}
}

function sessionIdOf(ctx: TeamCtx): string | undefined {
	const sid = ctx.sessionManager?.getSessionId?.();
	return typeof sid === "string" ? sid : undefined;
}

function lastJson(stdout: string): unknown {
	try {
		return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
	} catch {
		return undefined;
	}
}

export function registerTeamTool(
	pi: TeamToolHost,
	pluginRoot: string,
	run: TeamRunner = defaultRunner,
	env: Record<string, string | undefined> = process.env,
	onOpen?: TeamOpen,
): boolean {
	if (isWorker(env) || !canRegister(pi)) return false;
	pi.registerTool!(teamToolDef(pi.typebox!.Type, pluginRoot, run, env, onOpen));
	return true;
}

function teamToolDef(T: any, pluginRoot: string, run: TeamRunner, env: Record<string, string | undefined>, onOpen?: TeamOpen) {
	// The widget mounts from the `task` channel-open path only, so a tmux team needs its own mount: after spawn (the
	// result names channel + members) and before each wait (it blocks for minutes; the view's poll keeps painting).
	const safeOpen = (ui: WidgetUi, info: ChannelOpenInfo) => {
		try {
			onOpen?.(ui, info);
		} catch {
			// fail soft: the tool result matters more than the widget
		}
	};
	const show = (ctx: TeamCtx, view: TeamView | undefined) => {
		if (view && ctx.ui) safeOpen(ctx.ui, { ...view, cwd: ctx.cwd, sessionId: sessionIdOf(ctx) });
	};
	// The lead's wait is its poll: re-mount from the live team record before it blocks.
	const beforeRun = (p: TeamParams, ctx: TeamCtx) => p.action === "wait" && show(ctx, teamRecordView(env.ATLAS_PROJECT_ROOT || ctx.cwd, p.team));
	const afterRun = (p: TeamParams, ctx: TeamCtx, stdout: string) => p.action === "spawn" && show(ctx, teamView(lastJson(stdout)));
	return {
		name: "atlas_team",
		label: "Atlas team",
		description:
			"Run parallel workers as a tmux team. action=spawn {class, effort, task, paths?} sizes a team from the resolver and returns {team_id}; " +
			"action=wait {team, timeout?} blocks until every worker exits and returns each STATUS; action=reap {team} archives and kills the session. Returns the JSON.",
		parameters: T.Object({
			action: T.Union([T.Literal("spawn"), T.Literal("wait"), T.Literal("reap")]),
			class: T.Optional(T.String()),
			effort: T.Optional(T.String()),
			paths: T.Optional(T.Array(T.String())),
			task: T.Optional(T.String()),
			team: T.Optional(T.String()),
			timeout: T.Optional(T.Number()),
		}),
		async execute(_id: string, params: unknown, _signal: unknown, _onUpdate: unknown, ctx: TeamCtx) {
			const p = params as TeamParams;
			// wait blocks up to its own timeout; give the child a margin so mux reports the timeout itself.
			const ms = ((p.action === "wait" ? (p.timeout ?? 600) : 60) + 30) * 1000;
			beforeRun(p, ctx);
			const { stdout } = await run(teamArgv(p, pluginRoot), ctx.cwd, ms);
			afterRun(p, ctx, stdout);
			return { content: [{ type: "text" as const, text: stdout.trim() || '{"ok": false, "error": "no output"}' }], details: undefined };
		},
	};
}
