// host/bored.ts: the controller behind the `bored` tab. While the tab is open it streams
// `ssh -tt watch.ascii.theater` through $.process.spawn into a VT buffer and publishes the latest screen in boredState.
// Leaving the tab (or closing the pane, or ending the session) ends the stream, which kills the child.
// Module-level functions only: the host refuses a `$` closure created inside register().
import { atom, type EngineInterface, type HookStream, type ProcessSpawnChunk, type ProcessSpawnResult, read, update } from 'claude-code';
import type { BoredView } from '../view/panel/bored-types';
import { createBoredVt } from '../view/panel/bored-vt';

const BORED_ARGV = ['ssh', '-tt', '-o', 'StrictHostKeyChecking=no', 'watch.ascii.theater'] as const;
/** At most one state write per this many ms: the stream sends many small chunks and every write redraws the pane. */
const BORED_FLUSH_MS = 100;
const STDERR_TAIL = 200;

type BoredStream = HookStream<ProcessSpawnChunk, ProcessSpawnResult>;
/** The seam tests replace with a fake stream. It takes no `$`: the host's load rule lets `$` reach only top-level functions, so the default path calls $.process.spawn itself. */
export type BoredSpawn = () => BoredStream;

const IDLE: BoredView = { status: 'closed', screen: null, seq: 0 };
export const boredState = atom({ plugin: 'atlas', key: 'bored' } as const, IDLE as BoredView);
/** The same key hooks.ts and handlers.ts read: the sidebar tab. */
const viewState = atom({ plugin: 'atlas', key: 'atlasView' } as const, 'route');

type Run = { id: number; stream: BoredStream; stop: () => void; stopped: Promise<'stop'>; timer: { cancel(): void } | null };
let current: Run | null = null;
let runCount = 0;

/** Test seam: forget any run without touching its stream. */
export const resetBored = (): void => { current = null; };

function publish($: EngineInterface, run: Run, view: BoredView): Promise<unknown> | void {
	return current?.id === run.id ? update($, boredState, () => view) : undefined; // a stopped run never writes again
}

/** publish() for the pull loop and the timer, which cannot wait for the write: a failed write is dropped. */
function flush($: EngineInterface, run: Run, view: BoredView): void {
	void Promise.resolve(publish($, run, view)).catch(() => undefined);
}

/** Pulls the stream until it ends, is stopped or fails; folds stdout into the VT buffer and publishes at most every BORED_FLUSH_MS. */
async function pump($: EngineInterface, run: Run): Promise<void> {
	const vt = createBoredVt();
	let seq = 0;
	let dirty = false;
	let stderrTail = '';
	const view = (status: BoredView['status'], error?: string): BoredView => {
		const screen = vt.snapshot();
		return { status, ...(error !== undefined ? { error } : {}), screen: screen.rows > 0 ? screen : null, seq };
	};
	try {
		for (;;) {
			const step = await Promise.race([run.stream.next(), run.stopped]);
			if (step === 'stop') return; // stopBored already cleared `current` and called return()
			if (step.done) {
				const { code, signal } = step.value;
				const failed = code !== 0;
				const why = code === null ? `ended by signal ${signal ?? 'unknown'}` : `ssh exited with code ${code}`;
				await publish($, run, view(failed ? 'error' : 'closed', failed ? `${why}${stderrTail ? `: ${stderrTail}` : ''}` : undefined));
				return;
			}
			const { stream, text } = step.value;
			if (stream === 'stderr') { stderrTail = `${stderrTail}${text}`.replace(/\s+/g, ' ').trim().slice(-STDERR_TAIL); continue; }
			vt.feed(text);
			seq += 1;
			dirty = true;
			if (run.timer === null) {
				dirty = false;
				flush($, run, view('streaming')); // leading edge: the first chunk after a quiet spell shows at once
				run.timer = $.clock.every(BORED_FLUSH_MS, () => {
					if (dirty) { dirty = false; flush($, run, view('streaming')); }
					else { run.timer?.cancel(); run.timer = null; } // quiet for a full period: sleep until the next chunk
				});
			}
		}
	} catch (err) {
		await publish($, run, view('error', String((err as Error)?.message ?? err)));
	} finally {
		run.timer?.cancel();
		run.timer = null;
		if (current?.id === run.id) current = null; // the stream ended on its own
	}
}

/** Starts the stream; a second call while one runs does nothing. Resolves once the run is set up, not when it ends. */
export async function startBored($: EngineInterface, spawn?: BoredSpawn): Promise<void> {
	if (current !== null) return;
	let stop = (): void => undefined;
	const stopped = new Promise<'stop'>((res) => { stop = () => res('stop'); });
	let stream: BoredStream;
	runCount += 1;
	const id = runCount;
	try {
		stream = spawn !== undefined ? spawn() : $.process.spawn({ argv: BORED_ARGV });
	} catch (err) {
		await update($, boredState, (): BoredView => ({ status: 'error', error: String((err as Error)?.message ?? err), screen: null, seq: 0 }));
		return;
	}
	const run: Run = { id, stream, stop, stopped, timer: null };
	current = run;
	await update($, boredState, (): BoredView => ({ status: 'connecting', screen: null, seq: 0 }));
	void pump($, run);
}

/** Ends the stream: `return()` kills the child, and the stop promise frees a pull that is still waiting for output. */
export async function stopBored($: EngineInterface): Promise<void> {
	const run = current;
	if (run === null) return;
	current = null;
	run.timer?.cancel();
	run.timer = null;
	run.stop();
	void Promise.resolve(run.stream.return(undefined as never)).catch(() => undefined);
	await update($, boredState, () => IDLE);
}

/** Every write of the sidebar view goes through here: entering `bored` starts the stream, leaving it stops it. */
export async function setViewState($: EngineInterface, view: string, spawn?: BoredSpawn): Promise<void> {
	const before = await read($, viewState);
	await update($, viewState, () => view);
	if (view === 'bored' && before !== 'bored') await startBored($, spawn);
	else if (view !== 'bored' && before === 'bored') await stopBored($);
}
