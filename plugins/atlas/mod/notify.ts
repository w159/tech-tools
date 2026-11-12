// notify.ts - turn-boundary notifications: one toast per turn for workers spawning/finishing/failing/blocked,
// notes addressed to the lead or the human, completed todos, and phase advances
// (advance.wav when sound is on); the one prompt.suggest: reply to a blocked worker, else the in-progress todo.
import { atom, read } from 'claude-code';
import type { On } from 'claude-code';
import type { AtlasSnapshot, PhaseId } from './contract';
import { endedAt, liveWorkers } from './data/live';
import type { LiveWorker } from './data/live';
import type { LiveSnapshot } from './orchestra-types';
import { cells, type Ui } from './atlas-ui';
import { clipE as clip } from './board-model';
import { lookOf } from './look';
import { noteToastText, toastText } from './panel-layout';
import { formatDuration } from './theme';

export type NotifyEvent =
	| { type: 'agent-spawn'; name: string }
	| { type: 'agent-complete'; name: string; age: string; lastLine: string }
	| { type: 'agent-fail'; name: string; lastLine: string }
	| { type: 'agent-blocked'; name: string; lastLine: string }
	| { type: 'note'; sender: string; preview: string }
	| { type: 'todo-done'; text: string }
	| { type: 'phase'; phase: PhaseId };

/** Squad + activity as live workers; a snapshot without orchestration fields reads as activity-free. */
const workersOf = (s: AtlasSnapshot): LiveWorker[] =>
	liveWorkers({ activity: {}, comms: [], todoGroups: [], ...s, squad: (s.squad ?? []).filter((a) => a?.name) } as LiveSnapshot, s.now);


/** Widest toast, in cells. The host draws a toast in a 44 cell box, 40 cells of it text, and wraps anything longer
 * mid-phrase (critique 11: `after` / `11s  +1 more` in live-110-5d6a53ef-3/frames/f0090.ans:3-4). One row the host never wraps. */
export const TOAST_MAX = 40;

/** How long a turn-boundary toast stays up. The host draws a toast over the top right of the transcript and the mod cannot move it (critique 12:
 * two live boxes cut `T1-T3 still`; critique 14: `alpha-expl... +1 more`), so a turn boundary sends one only for what needs the person: a failure,
 * a wait or a note. A routine start or finish is told by the HUD, the band and the finish card in the transcript, never by a toast. */
export const TOAST_MS = 4000;

/** A toast and its merge facts: `bare` is the same toast without its fact (used when the fact would not fit beside the count),
 * `kind` groups toasts that a `+N more` may count (a burst of agents that finished, not every toast of the turn). */
export type Toast = { text: string; bare?: string; kind?: string };

/** One toast for a turn's events: the first in full, then ` +N more`. A burst of separate toasts in
 * one turn left the stack before the host drew them, and the host then printed
 * "$.ui.toast: a toast left the stack before it was ever drawn" into the transcript.
 * N counts only the other toasts of the first one's kind (the other agents that finished in the same burst, never the todo or note toasts
 * of that turn: `+8 more` for 3 agents); a toast with no kind counts every other. The row is at most TOAST_MAX cells: the fact goes
 * first, then the name is clipped, never the count. */
export function mergeToasts(items: readonly (string | Toast)[]): string | null {
	if (items.length === 0) return null;
	const all: Toast[] = items.map((i) => (typeof i === 'string' ? { text: i } : i));
	const head = all[0]!;
	const n = all.slice(1).filter((t) => head.kind === undefined || t.kind === head.kind).length;
	// ` +2 more`, else ` +2` when that keeps the whole name (critique 14 B4: `alpha-expl... +1 more` cut a name the short count would have kept)
	const counts = n > 0 ? [` +${n} more`, ` +${n}`] : [''];
	for (const more of counts) for (const t of [head.text, head.bare]) if (t !== undefined && cells(t) + cells(more) <= TOAST_MAX) return `${t}${more}`;
	const more = counts[0]!;
	return `${clip(head.bare ?? head.text, TOAST_MAX - cells(more))}${more}`;
}

/** A toast reads bar, ATLAS mark, state, name, one fact: `▌ ◆ ATLAS  ● done  implementer-layout  9 of 9 steps`. No code, no full stop. The host
 * draws a toast as plain text, so the bar and the mark are characters; the omp and transcript painters colour the same runs. */
const FACT_MAX = 40;
export const stateToast = (state: Parameters<typeof toastText>[0], name: string, fact: string, ui: Ui): string => toastText(state, name, clip(fact.replace(/\s+/g, ' ').trim(), FACT_MAX), ui);
const factToast = (kind: string, state: Parameters<typeof toastText>[0], name: string, fact: string, ui: Ui): Toast => ({ kind, text: stateToast(state, name, fact, ui), bare: stateToast(state, name, '', ui) });
const noteToast = (sender: string, preview: string, ui: Ui): Toast => ({ kind: 'note', text: noteToastText(sender, preview, ui) });

/** Pure diff of successive snapshots; null prev (first sight) yields nothing. Never throws. */
export function diffSnapshots(prev: AtlasSnapshot | null, next: AtlasSnapshot): NotifyEvent[] {
	if (!prev) return [];
	const events: NotifyEvent[] = [];

	// Workers: toast spawn and the transition into done/failed/blocked, once per change.
	const before = new Map(workersOf(prev).map((w) => [w.name, w.state]));
	for (const w of workersOf(next)) {
		const was = before.get(w.name);
		if (was === w.state) continue;
		if (was === undefined) {
			if (w.state === 'working') events.push({ type: 'agent-spawn', name: w.name });
		} else if (w.state === 'done') {
			if (was === 'failed') continue; // failure is terminal: a failed worker read done later raises no done toast
			const age = endedAt(w, next.now) - w.startedAt; // the worker's own run, not the lag until the turn that saw it finish
			events.push({ type: 'agent-complete', name: w.name, age: age > 0 ? formatDuration(age) : '', lastLine: w.lastLine });
		} else if (w.state === 'failed') events.push({ type: 'agent-fail', name: w.name, lastLine: w.lastLine });
		else if (w.state === 'blocked') events.push({ type: 'agent-blocked', name: w.name, lastLine: w.lastLine });
	}

	// New notes addressed to the lead or the human (seq not seen before).
	const seenSeqs = new Set((prev.notes ?? []).map((n) => n?.seq));
	for (const n of next.notes ?? []) {
		if (!n || seenSeqs.has(n.seq)) continue;
		if (!/human/i.test(n.to ?? '')) continue; // a note to the lead is the lead's to read; only the person needs a toast
		events.push({ type: 'note', sender: n.owner ?? 'unknown', preview: (n.text ?? '').slice(0, 60) });
	}

	// Todos newly completed.
	const prevStatus = new Map<string, string>();
	for (const t of prev.todos ?? []) if (t?.id) prevStatus.set(t.id, t.status ?? '');
	for (const t of next.todos ?? []) {
		if (!t?.id || t.status !== 'completed' || prevStatus.get(t.id) === 'completed') continue;
		events.push({ type: 'todo-done', text: t.content ?? '' });
	}

	// Phase advance.
	if (prev.phase && next.phase && prev.phase !== next.phase) {
		events.push({ type: 'phase', phase: next.phase });
	}

	return events;
}

/** The one prompt suggestion: reply to the first blocked worker, else the in-progress todo as `<phase>: <title>`, else null. */
export function nextStepSuggestion(s: AtlasSnapshot): string | null {
	const blocked = workersOf(s).find((w) => w.state === 'blocked');
	if (blocked) return `reply ${blocked.name}: ${blocked.lastLine}`;
	const t = (s.todos ?? []).find((x) => x?.id && x.status === 'in_progress' && !x.archived);
	// ponytail: strip any "[phase] " prefix generically instead of parsing contract.itemPhasePrefix
	return t ? `${t.phase ?? s.phase}: ${(t.content ?? '').replace(/^\[[^\]]*\]\s*/, '')}` : null;
}

// The live snapshot is read from $.state (declared here for the key scan).
const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null);

/** True when `next` was built before `prev` (both stamped, lower seq): a late write that must not be applied or diffed. */
export const isOlder = (prev: AtlasSnapshot | null, next: AtlasSnapshot): boolean =>
	prev?.seq !== undefined && next.seq !== undefined && next.seq < prev.seq;

/**
 * Registers answer-turn-boundary notifications. `on` is the mod's On; deps
 * inject the sound toggle (the snapshot is read from $.state). Toasts and the next-step
 * suggestion fire on answer-turn boundaries. Notifications never break the turn.
 */
export function registerNotify(
	on: On,
	deps: { soundEnabled: () => boolean },
): void {
	// Per registration, not module-level: a second registerNotify (another test, a re-register) must not inherit this one's baseline.
	let lastSnapshot: AtlasSnapshot | null = null;
	on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
		try {
			const snap = await read($, snapshotState);
			if (snap && !isOlder(lastSnapshot, snap)) {
				const texts: (string | Toast)[] = [];
				const ui = (await lookOf($)).ui;
				for (const ev of diffSnapshots(lastSnapshot, snap)) {
					switch (ev.type) {
						// A routine start or finish (agent-spawn, agent-complete, todo-done) sends no host toast: the host draws a toast over the top right of
						// the transcript and cut the names (critique 14 B4: `alpha-expl... +1 more`). The HUD rows, the band and the finish card the mod places
						// in the transcript (transcript/placed.ts) say it in surfaces the mod owns; the host toast stays for what needs the person.
						case 'agent-fail':
							// no toast: a failure is no wait (critique 16 C2: the host box over the failed card cut it to `explorer failed ·`): the card, HUD row, band and board say it
							break;
						case 'agent-blocked':
							texts.push(factToast('agent-blocked', 'waiting', ev.name, 'needs a reply', ui));
							break;
						case 'note':
							texts.push(noteToast(ev.sender, clip(ev.preview.replace(/\s+/g, ' ').trim(), FACT_MAX), ui));
							break;
						case 'phase':
							if (deps.soundEnabled()) {
								void $.audio.play({ asset: 'mod/fx/advance.wav' }).catch(() => {});
							}
							break;
					}
				}
				const merged = mergeToasts(texts);
				if (merged) $.ui.toast(merged, { timeoutMs: TOAST_MS });
				lastSnapshot = snap;
				const suggestion = nextStepSuggestion(snap);
				if (suggestion) void $.prompt.suggest({ text: suggestion });
			}
		} catch {
			// a bad snapshot must never break the turn
		}
		return next(e);
	});
}
