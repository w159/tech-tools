// notify.ts - turn-boundary notifications: one toast per turn for workers spawning/finishing/failing/blocked,
// notes addressed to the lead or the human, completed todos, and phase advances
// (advance.wav when sound is on); the one prompt.suggest: reply to a blocked worker, else the in-progress todo.
import { atom, read } from 'claude-code';
import type { On } from 'claude-code';
import type { AtlasSnapshot, PhaseId } from './contract';
import { liveWorkers } from './data/live';
import type { LiveWorker } from './data/live';
import type { LiveSnapshot } from './orchestra-types';
import { clip, type Ui } from './atlas-ui';
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


/** Widest merged toast: a terminal row, so the host never has to wrap it. */
export const TOAST_MAX = 100;

/** One toast for a turn's events: the first (most urgent) in full, the rest counted. A burst of separate toasts in
 * one turn left the stack before the host drew them, and the host then printed
 * "$.ui.toast: a toast left the stack before it was ever drawn" into the transcript. */
export function mergeToasts(texts: readonly string[]): string | null {
	if (texts.length === 0) return null;
	if (texts.length === 1) return texts[0]!;
	const more = `  +${texts.length - 1} more`;
	return `${clip(texts[0]!, TOAST_MAX - more.length)}${more}`;
}

/** A toast reads bar, ATLAS mark, state, name, one fact: `▌ ◆ ATLAS  ● done  implementer-layout  9 of 9 steps`. No code, no full stop. The host
 * draws a toast as plain text, so the bar and the mark are characters; the omp and transcript painters colour the same runs. */
const FACT_MAX = 40;
export const stateToast = (state: Parameters<typeof toastText>[0], name: string, fact: string, ui: Ui): string => toastText(state, name, clip(fact.replace(/\s+/g, ' ').trim(), FACT_MAX), ui);

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
			const age = next.now - w.startedAt;
			events.push({ type: 'agent-complete', name: w.name, age: age > 0 ? formatDuration(age) : '', lastLine: w.lastLine });
		} else if (w.state === 'failed') events.push({ type: 'agent-fail', name: w.name, lastLine: w.lastLine });
		else if (w.state === 'blocked') events.push({ type: 'agent-blocked', name: w.name, lastLine: w.lastLine });
	}

	// New notes addressed to the lead or the human (seq not seen before).
	const seenSeqs = new Set((prev.notes ?? []).map((n) => n?.seq));
	for (const n of next.notes ?? []) {
		if (!n || seenSeqs.has(n.seq)) continue;
		if (!/lead|human/i.test(n.to ?? '')) continue;
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
				const texts: string[] = [];
				const ui = (await lookOf($)).ui;
				for (const ev of diffSnapshots(lastSnapshot, snap)) {
					switch (ev.type) {
						case 'agent-spawn':
							texts.push(stateToast('running', ev.name, 'started', ui));
							break;
						case 'agent-complete':
							texts.push(stateToast('done', ev.name, ev.age ? `after ${ev.age}` : '', ui)); // duration only: the agent's last line is free text (a `1.`, half a path), never a toast fact
							break;
						case 'agent-fail':
							texts.push(stateToast('failed', ev.name, '', ui));
							break;
						case 'agent-blocked':
							texts.push(stateToast('waiting', ev.name, 'needs a reply', ui));
							break;
						case 'note':
							texts.push(noteToastText(ev.sender, clip(ev.preview.replace(/\s+/g, ' ').trim(), FACT_MAX), ui));
							break;
						case 'todo-done':
							texts.push(stateToast('done', 'task', ev.text, ui));
							break;
						case 'phase':
							if (deps.soundEnabled()) {
								void $.audio.play({ asset: 'mod/fx/advance.wav' }).catch(() => {});
							}
							break;
					}
				}
				const merged = mergeToasts(texts);
				if (merged) $.ui.toast(merged);
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
