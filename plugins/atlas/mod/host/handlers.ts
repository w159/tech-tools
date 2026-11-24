// host/handlers.ts: slot and HUD state, sidebar and band handlers.
// Split out of mod/register.ts (plan docs/plans/2026-11-18_atlas-mod-reorg-plan.md section 7); no behavior change.
import { atom, type ClientElements, type EngineInterface, read, type RenderElement, update } from 'claude-code';
import type { AtlasSnapshot } from '../contract';
import { intentToArgv } from '../input/intents';
import type { BandHandlers } from '../view/band/band';
import type { HealthIn } from '../data/idle-health';
import { hookStats } from './hook-log';
import { denyAgeSecs, noteDenied, pulseOf } from '../data/pulse';
import { historyView } from '../data/history';
import { deniedCalls } from '../design/vocab';
import type { SidebarHandlers } from '../view/panel/pane/sidebar';
import { noteUsage } from './usage';
import { flipsOf, PANE_BOARD, PANE_ID, PANE_ON_DEMAND, rootOf, S, toastUnplaced } from './atoms';
import { rebuild } from './poll';
import { gateGroups } from './core-tick';

const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null);
const usageState = atom({ plugin: 'atlas', key: 'usage' } as const, { tokens: null, contextPct: null });

const paneOpenedState = atom({ plugin: 'atlas', key: 'paneOpened' } as const, false); // herdrTick stays idle until the pane has been opened

const recipientState = atom({ plugin: 'atlas', key: 'sidebarRecipient' } as const, null);
const expandedState = atom({ plugin: 'atlas', key: 'sidebarExpanded' } as const, null);
const draftState = atom({ plugin: 'atlas', key: 'sidebarDraft' } as const, '');

const flipState = atom({ plugin: 'atlas', key: 'sidebarFlips' } as unknown as { readonly plugin: 'atlas'; readonly key: 'sidebarDraft' }, '');

const spinnerTickState = atom({ plugin: 'atlas', key: 'spinnerTick' } as const, 0); // written by restyle's ticker; renders only read it

const viewState = atom({ plugin: 'atlas', key: 'atlasView' } as const, 'route'); // docs and the tab strip list route first

export type HudState = { maxRows: number; wanted: number; shown: number; fullscreen: boolean };
/** `.atlas/.run/statusline-rows.json`: the rows the status line printed last and the rows its full grid would take. */
export type StatuslineRows = { ts: number; rows: number; fullRows: number; billing?: 'plan' | 'api' };
const STATUSLINE_ROWS_FRESH_MS = 15_000;

/** Reads the status line's row report; null when missing, malformed or older than 15 s. */
export async function readStatuslineRows($: EngineInterface, root: string | null | undefined): Promise<StatuslineRows | null> {
	try {
		if (root === undefined || root === null || root === '') return null;
		const text = await $.fs.read(`${root.replace(/\/+$/, '')}/.atlas/.run/statusline-rows.json`);
		const doc = JSON.parse(text) as Partial<StatuslineRows>;
		const { ts, rows, fullRows, billing } = doc;
		if (![ts, rows, fullRows].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
		const age = (await $.clock.now()) - (ts as number);
		const bill = billing === 'plan' || billing === 'api' ? { billing } : {}; // an older status line writes no billing: unknown
		return age >= 0 && age < STATUSLINE_ROWS_FRESH_MS ? { ts: ts as number, rows: rows as number, fullRows: fullRows as number, ...bill } : null;
	} catch {
		return null;
	}
}

/** The AbovePrompt tree, in the one order the slot draws it: the band (with its worker rows) FIRST, then the breathing blank, then the HUD box, then whatever the next hook draws.
 * When the host clips a tree taller than the slot it keeps the top rows and prints `n more` for the rest (index.d.ts, AbovePrompt `maxRows` and `scroll.bodyRows`; inline,
 * `maxRows` is the terminal's height, so the mod cannot know how many rows will survive): a clip then eats the HUD's last rows and never the band (critique 23, live-150-1 f0053, f0055). */
export function atlasSlot(els: ClientElements, parts: { /** Y1d: the narrow idle health strip, the rows directly above the band. */ strip?: readonly RenderElement[]; band: RenderElement; gapRow: readonly RenderElement[]; hud: readonly RenderElement[]; pad?: readonly RenderElement[]; lead?: number; below: RenderElement }): RenderElement {
	const lower = [...parts.hud, ...(parts.pad ?? [])]; // `pad`: blank rows under the HUD that keep the slot one height through a run
	return els.Box({ flexDirection: 'column', flexShrink: 0, children: [...(parts.lead ? [els.Box({ height: parts.lead, flexShrink: 0, children: [] })] : []), ...(parts.strip ?? []), parts.band, ...parts.gapRow, ...(lower.length > 0 ? [els.Box({ flexDirection: 'column', flexShrink: 0, children: lower })] : []), parts.below] });
}

export { fitHudToBand, hudGapRows, hudSlotCap, slotHold } from '../view/band/slot';

export const resetSlotHold = (): void => { S.slotHeld = 0; };
/** Test reset for the session clock. Not part of resetCore(): the product calls resetCore() after session.start has set it. */
export const resetSessionStart = (): void => { S.sessionStartMs = null; };

/** Rows below the AbovePrompt slot in the inline renderer: prompt box (3), the status line (its reported rows, 5 when unknown), mode line and a blank (2), the blank row Claude Code draws between the content and the prompt's top rule (1), and Claude Code's own agent list ("main" plus one row per running agent). */
export function inlineBelowRows(statusRows: number | null, running: number): number {
	return 3 + (statusRows ?? 5) + 2 + 1 + (running > 0 ? 1 + running : 0);
}

/** The row budget for the HUD and band: the slot's `maxRows` in fullscreen; inline that slot is the whole terminal, so the rows below it come off the viewport height and the smaller wins. */
export function effectiveRows(maxRows: number, viewport: { rows: number; isFullscreen?: boolean } | undefined, statusRows: number | null, running: number): number {
	if (viewport === undefined || viewport.isFullscreen === true || !Number.isFinite(viewport.rows)) return maxRows;
	return Math.max(0, Math.min(maxRows, viewport.rows - inlineBelowRows(statusRows, running)));
}
let lastHudSig: string | undefined;
/** Test seam: forget the last written state. */
export const resetHudStateSig = (): void => { lastHudSig = undefined; };

/** Writes `.atlas/.run/hud-state.json` ({ts, maxRows, wanted, shown, fullscreen, starved}) for the Claude Code status line. 17.15.1: `starved` is always false. The mod never asks the status line to shrink to one row; the user's status line prints in full whenever it is configured, and a plan longer than the slot folds inside the HUD (hud-surface fitRows). The field stays in the file for status line scripts that read it. Skips an unchanged state; fail soft, never throws out of render. */
export async function publishHudState($: EngineInterface, root: string | null | undefined, state: HudState): Promise<void> {
	try {
		if (root === undefined || root === null || root === '') return;
		const now = await $.clock.now();
		const sig = `${root}|${state.maxRows}|${state.wanted}|${state.shown}|${state.fullscreen}`;
		if (sig === lastHudSig) return;
		lastHudSig = sig;
		const path = `${root.replace(/\/+$/, '')}/.atlas/.run/hud-state.json`;
		await $.fs.write(path, JSON.stringify({ ts: now, ...state, starved: false })); // the Python reader treats a half file as no state, so no temp + mv fork
	} catch {
		lastHudSig = undefined;
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

/** Post the draft to the selected member (the lead when none) through the note intent. */
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
function guardedBy($: EngineInterface): (fn: () => Promise<unknown>) => void {
	return (fn) => {
		fn().catch((err: unknown) => $.ui.toast(`atlas: ${String(err)}`, { timeoutMs: 6000 }));
	};
}

/** Closures for the sidebar view: each writes $.state (never the render hook) and reports failures as toasts. */
export function sidebarHandlers($: EngineInterface, surface: 'terminal'): SidebarHandlers {
	const guarded = guardedBy($);
	return {
		selectRecipient: (name) => guarded(() => update($, recipientState, (cur) => (cur === name ? null : name))),
		toggle: (key) => guarded(() => update($, expandedState, (cur) => (cur === key ? null : key))),
		flip: (key) => guarded(() => update($, flipState, (cur) => { const ks = flipsOf(cur); return (ks.includes(key) ? ks.filter((k) => k !== key) : [...ks, key]).join('\n'); })),
		draftChange: (text) => guarded(() => update($, draftState, () => text)),
		send: (text) => guarded(() => sendNote($, text)),
		focus: (key) => guarded(() => $.ui.focus({ requestId: PANE_ID, key })),
		setView: (v) => guarded(() => update($, viewState, () => v)),
		toggleTodos: () => guarded(() => openBoard($)),
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

/** Open (or retitle and focus) the Board pane; the press behind it is what the engine counts as asked, so it is placed at any width. */
export async function openBoard($: EngineInterface): Promise<void> {
	// A second pane opens as a tab BEHIND the shown one (`focus` is only a request the host refuses while a pane holds the
	// keys), so with the Atlas pane shown the board draws inside it (view `board`); `o` again returns to the route.
	const panes = await (async () => $.ui.panes())().catch(() => []); // a surface that lists none leaves the open below as it was
	if (panes.some((p) => p.id === PANE_ID && p.isShown)) {
		await update($, viewState, (cur) => (cur === 'board' ? 'route' : 'board'));
		void rebuild($);
		return;
	}
	const boardOpen = $.ui.open(PANE_BOARD);
	void noteUsage($, 'mod.open.board');
	toastUnplaced($, await boardOpen);
	void rebuild($); // the board draws the snapshot; refresh it so a press never shows a stale list
}

/** Band presses: open (or focus) the pane on a view, close it, or open the Board pane. */
/** Wave 42: the idle health's raw inputs: uptime on the clock, the version and branch read at boot, the tokens the host measured, whether the card is open. */
export async function healthInOf($: EngineInterface, clockNow: number): Promise<HealthIn> {
	const usage = await read($, usageState);
	// Y1d: the pane counts as up only while the engine has it placed: below 144 columns an unasked pane is open but waits undrawn, and the band, the card and the narrow strip then stand in for it
	const listed = await (async () => $.ui.panes())().catch(() => undefined);
	const panelUp = (await read($, paneOpenedState)) && (listed === undefined || listed.some((p) => p.id === PANE_ID && p.isPlaced));
	if (panelUp) S.healthOpenNow = false; // round 2 (D1): card and panel never show at once; a card open when the panel opens is closed (and stays closed when the panel closes)
	noteDenied(deniedCalls(await gateGroups($)), clockNow); // N3: the gates chip reads red until DENY_RED_SECS after the denied count last rose
	const denyAge = denyAgeSecs(clockNow);
	const hist = historyView(clockNow); // Y1a: what earlier sessions recorded, drawn as `prev`
	return {
		...(denyAge !== undefined ? { denyAgeSecs: denyAge } : {}),
		...(S.sessionStartMs !== null ? { upSecs: Math.max(0, Math.floor((clockNow - S.sessionStartMs) / 1000)) } : {}),
		...(S.pluginVersion ? { version: S.pluginVersion } : {}),
		...(S.branchName ? { branch: S.branchName } : {}),
		...(S.tmuxHere !== undefined ? { tmux: S.tmuxHere } : {}),
		...(typeof usage.tokens === 'number' ? { tokens: usage.tokens } : {}),
		...(typeof S.usageWindow === 'number' ? { window: S.usageWindow } : {}),
		hooks: hookStats(clockNow, 40, S.runClock.startMs ?? undefined), // the panel's RECENT grows into the free rows of a tall pane
		pulse: pulseOf(clockNow),
		...(hist ? { hist } : {}),
		open: S.healthOpenNow,
		...(panelUp ? { panel: true } : {}), // the side panel is up: it says the gates, the uptime, the context and the events; the band and the card say only what it does not
	};
}

export function bandHandlers($: EngineInterface): BandHandlers {
	const guarded = guardedBy($);
	return {
		openView: (v) =>
			guarded(async () => {
				// Open first, before any await: the engine counts the open as asked (placed at any width) only while the press is behind it.
				const opened = $.ui.open(PANE_ON_DEMAND);
				void noteUsage($, 'mod.open.ondemand');
				await update($, viewState, () => v);
				await update($, paneOpenedState, () => true);
				toastUnplaced($, await opened);
			}),
		closePane: () => guarded(async () => { await $.ui.close({ id: PANE_ID }); }), // the engine then runs the ui.close hook, which clears paneOpenedState
			toggleTodos: () => guarded(() => openBoard($)),
		toggleHealth: () => guarded(() => { S.healthOpenNow = !S.healthOpenNow; return update($, spinnerTickState, (n) => { S.beatFrame = n + 1; return n + 1; }); }),
	};
}
