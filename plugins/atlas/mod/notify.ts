// notify.ts — turn-boundary notifications: toast squad agents finishing/failing,
// notes addressed to the lead or the human, completed todos, and phase advances
// (advance.wav when sound is on); suggests the next contract step at turn end.
import type { On } from 'claude-code';
import type { AtlasSnapshot, PhaseId } from './contract';

export type NotifyEvent =
	| { type: 'agent-complete'; name: string }
	| { type: 'agent-fail'; name: string }
	| { type: 'note'; sender: string; preview: string }
	| { type: 'todo-done'; text: string }
	| { type: 'phase'; phase: PhaseId };

/** Pure diff of successive snapshots; null prev (first sight) yields nothing. Never throws. */
export function diffSnapshots(prev: AtlasSnapshot | null, next: AtlasSnapshot): NotifyEvent[] {
	if (!prev) return [];
	const events: NotifyEvent[] = [];

	// Squad agents: toast the transition into finished/failed, once per agent.
	const prevState = new Map<string, string>();
	for (const a of prev.squad ?? []) if (a?.name) prevState.set(a.name, a.state ?? '');
	for (const a of next.squad ?? []) {
		if (!a?.name) continue;
		const before = prevState.get(a.name);
		if (before === undefined || before === a.state) continue;
		if (a.state === 'finished') events.push({ type: 'agent-complete', name: a.name });
		else if (a.state === 'failed') events.push({ type: 'agent-fail', name: a.name });
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

/** Next contract step as `<phase>: <item text>` (e.g. `verify: dispatch atlas:verifier on impl-auth`), or null. */
export function nextStepSuggestion(s: AtlasSnapshot): string | null {
	const order: Record<string, number> = {};
	(s.contract?.phases ?? []).forEach((p, i) => {
		order[p?.id ?? ''] = i;
	});
	const rank = (t: { phase?: PhaseId }): number => {
		const at = t.phase ? order[t.phase] : undefined;
		return at === undefined ? Number.MAX_SAFE_INTEGER : at;
	};
	const open = (s.todos ?? [])
		.filter((t) => t?.id && t.status !== 'completed' && !t.archived)
		.sort((a, b) => rank(a) - rank(b));
	const next = open[0];
	if (!next) return null;
	const phase = next.phase ?? s.phase;
	// ponytail: strip any "[phase] " prefix generically instead of parsing contract.itemPhasePrefix
	const text = (next.content ?? '').replace(/^\[[^\]]*\]\s*/, '');
	return `${phase}: ${text}`;
}

let lastSnapshot: AtlasSnapshot | null = null;

/**
 * Registers answer-turn-boundary notifications. `on` is the mod's On; deps
 * inject the snapshot reader and the sound toggle. Toasts and the next-step
 * suggestion fire on answer-turn boundaries. Notifications never break the turn.
 */
export function registerNotify(
	on: On,
	deps: { getSnapshot: () => AtlasSnapshot | null; soundEnabled: () => boolean },
): void {
	on('turn.complete', { reason: 'answer' }, ($, e, next) => {
		try {
			const snap = deps.getSnapshot();
			if (snap) {
				for (const ev of diffSnapshots(lastSnapshot, snap)) {
					switch (ev.type) {
						case 'agent-complete':
							$.ui.toast(`✓ ${ev.name}`);
							break;
						case 'agent-fail':
							$.ui.toast(`✗ ${ev.name}`);
							break;
						case 'note':
							$.ui.toast(`${ev.sender}: ${ev.preview}`);
							break;
						case 'todo-done':
							$.ui.toast(`✓ ${ev.text}`);
							break;
						case 'phase':
							$.ui.toast(`→ ${ev.phase}`);
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
