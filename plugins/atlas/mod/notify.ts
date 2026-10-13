// notify.ts — turn-boundary notifications: toast workers spawning/finishing/failing/blocked,
// notes addressed to the lead or the human, completed todos, and phase advances
// (advance.wav when sound is on); the one prompt.suggest: reply to a blocked worker, else the in-progress todo.
import { atom, read } from 'claude-code';
import type { On } from 'claude-code';
import type { AtlasSnapshot, PhaseId } from './contract';
import { liveWorkers } from './data/live';
import type { LiveWorker } from './data/live';
import type { LiveSnapshot } from './orchestra-types';
import { formatDuration } from './restyle';

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

const fit = (text: string, n: number): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

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

let lastSnapshot: AtlasSnapshot | null = null;

/**
 * Registers answer-turn-boundary notifications. `on` is the mod's On; deps
 * inject the sound toggle (the snapshot is read from $.state). Toasts and the next-step
 * suggestion fire on answer-turn boundaries. Notifications never break the turn.
 */
export function registerNotify(
	on: On,
	deps: { soundEnabled: () => boolean },
): void {
	on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
		try {
			const snap = await read($, snapshotState);
			if (snap) {
				for (const ev of diffSnapshots(lastSnapshot, snap)) {
					switch (ev.type) {
						case 'agent-spawn':
							$.ui.toast(`▸ ${ev.name} spawned`);
							break;
						case 'agent-complete':
							$.ui.toast(`✓ ${ev.name}${ev.age ? ` ${ev.age}` : ''}${ev.lastLine ? ` · ${fit(ev.lastLine, 40)}` : ''}`);
							break;
						case 'agent-fail':
							$.ui.toast(`✗ ${ev.name} ${ev.lastLine}`.trimEnd());
							break;
						case 'agent-blocked':
							$.ui.toast(`⏸ ${ev.name} blocked: ${ev.lastLine}`.trimEnd());
							break;
						case 'note':
							$.ui.toast(`${ev.sender}: ${ev.preview}`);
							break;
						case 'todo-done':
							$.ui.toast(`✓ ${ev.text}`);
							break;
						case 'phase':
							if (deps.soundEnabled()) {
								void $.audio.play({ asset: 'mod/fx/advance.wav' }).catch(() => {});
							}
							break;
					}
				}
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
