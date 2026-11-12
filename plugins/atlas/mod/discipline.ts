// discipline.ts — context discipline for the Atlas mod: push heavy inline work to
// subagents, flag contract drift, and sharpen vague prompts with repo facts.
// Every hook is gated by ATLAS_MOD!=off + an interactive session, fails open
// (a throw never blocks a tool, a prompt or an answer) and only ever adds
// model-only context or a rate-limited toast; it never rewrites user text.
// register.ts owns the single turn.complete / session.measure registrations and
// calls afterAnswer / onMeasure from them (an event may register once per matcher).
import { atom, read, update } from 'claude-code';
import type { On, EngineInterface } from 'claude-code';
import type { AtlasSnapshot } from './contract';
import { headerPhaseOf } from './restyle';
import type { HeaderCheck } from './gates';
import { EMPTY_ORCH, LEAD, onStep, onToolEnd, onToolStart } from './data/orchestration';

/** Inline tool output at or above this many chars (~1k tokens) counts as heavy. */
export const HEAVY_CHARS = 4000;
/** Heavy inline calls in one turn, with no delegation, before Atlas speaks up. */
export const HEAVY_LIMIT = 4;
/** A turn that grew the context by this many tokens inline is worth a nudge. */
export const BIG_TURN_TOKENS = 30_000;
/** Minimum gap between Atlas toasts, whatever raised them. */
export const TOAST_GAP_MS = 30_000;
const VAGUE_MAX_CHARS = 60;
const VAGUE_MAX_WORDS = 8;

/** tool -> subagent that should have done the reading/running instead. */
const ROLE: Record<string, string> = { Read: 'atlas:explorer', Grep: 'atlas:explorer', Glob: 'atlas:explorer', Bash: 'atlas:runner' };

interface Discipline {
  heavy: number; // heavy inline calls this turn
  delegated: boolean; // a subagent was dispatched this turn
  hint: string; // tool of the latest heavy call
  toastAt: number;
}
const INITIAL: Discipline = { heavy: 0, delegated: false, hint: '', toastAt: 0 };

const disciplineState = atom({ plugin: 'atlas', key: 'discipline' } as const, INITIAL);
const orchState = atom({ plugin: 'atlas', key: 'orch' } as const, EMPTY_ORCH);
const isInteractive = atom({ plugin: 'atlas', key: 'isInteractive' } as const, false);
const lastHeaderState = atom({ plugin: 'atlas', key: 'lastHeader' } as const, null);
const isModOn = atom({ plugin: 'atlas', key: 'isModOn' } as const, true);
const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null);

// ---- pure helpers -------------------------------------------------------------

const QUOTE_RE = /["'`\u201c\u201d]/;
const ANCHOR_RE = /[\w.-]+\/[\w./-]+|\.\w{1,5}\b|\d|\b(test|tests|should|must|until|expect|passes)\b/i;

/** Prompts that are never vague: empty, a slash command, or quoting something. */
const isExempt = (t: string): boolean => t === '' || t.startsWith('/') || QUOTE_RE.test(t);

const isShort = (t: string): boolean => t.length <= VAGUE_MAX_CHARS && t.split(/\s+/).length <= VAGUE_MAX_WORDS;

/** Short prompt with no path, number, quote or acceptance word: nothing to anchor on. */
export function isVague(text: string): boolean {
  const t = text.trim();
  return !isExempt(t) && isShort(t) && !ANCHOR_RE.test(t);
}

/** Repo, branch, phase and up to 3 open todo titles, as `key value` parts. */
function factsParts(snapshot: AtlasSnapshot, branch: string): string[] {
  const open = snapshot.todos.filter((t) => t.status !== 'completed').slice(0, 3).map((t) => t.content.slice(0, 80));
  const parts = [`repo ${snapshot.root}`, `branch ${branch || 'unknown'}`, `phase ${snapshot.phase}`];
  return open.length > 0 ? [...parts, `open todos: ${open.join(' | ')}`] : parts;
}

/** `atlas facts:` line (repo root, branch, open todo titles) or null with no board. */
export function factsLine(snapshot: AtlasSnapshot | null, branch: string): string | null {
  if (snapshot?.root == null) return null;
  return `atlas facts: ${factsParts(snapshot, branch).join('; ')}`;
}

// ---- $-carrying helpers ---------------------------------------------------------

async function isActive($: EngineInterface): Promise<boolean> {
  return (await read($, isModOn)) && (await read($, isInteractive));
}

async function patch($: EngineInterface, fn: (d: Discipline) => Partial<Discipline>): Promise<void> {
  await update($, disciplineState, (d) => ({ ...d, ...fn(d) }));
}

/** One Atlas toast per TOAST_GAP_MS, however many rules fire. */
async function toastOnce($: EngineInterface, text: string): Promise<void> {
  const now = await $.clock.now();
  if (now - (await read($, disciplineState)).toastAt < TOAST_GAP_MS) return;
  await patch($, () => ({ toastAt: now }));
  $.ui.toast(text, { timeoutMs: 8000 });
}

// ---- tool.call meter ----------------------------------------------------------------

type ToolEvent = { agentId?: string; tool: string };
type ToolResult = { text?: string };

const bytesOf = (result: ToolResult): number => result.text?.length ?? 0;
const isHeavyCall = (tool: string, bytes: number): boolean => ROLE[tool] !== undefined && bytes >= HEAVY_CHARS;

async function trackToolStart($: EngineInterface, agent: string, tool: string, input?: unknown): Promise<void> {
  try {
    const t = await $.clock.now();
    await update($, orchState, (o) => onToolStart(o, agent, tool, t, input));
  } catch {
    // the activity feed never blocks a tool
  }
}

async function trackToolEnd($: EngineInterface, agent: string): Promise<void> {
  try {
    const t = await $.clock.now();
    await update($, orchState, (o) => onToolEnd(o, agent, t));
  } catch {
    // the activity feed never blocks a tool
  }
}

/** A submitted prompt starts the lead's turn: `thinking` until a tool, the answer or an abort moves it (onStep keeps a tool in flight). */
async function trackPromptSubmit($: EngineInterface): Promise<void> {
  try {
    const t = await $.clock.now();
    await update($, orchState, (o) => onStep(o, LEAD, t));
  } catch {
    // the activity feed never blocks a prompt
  }
}

/** Delegation resets the meter; a heavy inline read/run counts toward the toast. */
async function countCall($: EngineInterface, tool: string, bytes: number): Promise<void> {
  if (tool === 'Agent') return patch($, () => ({ delegated: true, heavy: 0 }));
  if (!isHeavyCall(tool, bytes)) return;
  const heavy = (await read($, disciplineState)).heavy + 1;
  await patch($, () => ({ heavy, hint: tool }));
  if (heavy === HEAVY_LIMIT) await toastOnce($, `atlas: ${heavy} heavy inline ${tool} calls — delegate to ${ROLE[tool]}`);
}

async function meterHeavy($: EngineInterface, e: ToolEvent, result: ToolResult): Promise<void> {
  try {
    if (e.agentId === undefined && (await isActive($))) await countCall($, e.tool, bytesOf(result));
  } catch {
    // the meter never blocks a tool
  }
}

// ---- prompt.submit ------------------------------------------------------------------

/** Run `fn`, null when it throws: sharpening never blocks a prompt. */
async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

const isComposer = (e: { origin?: { kind: string } }): boolean => (e.origin?.kind ?? 'composer') === 'composer';

async function branchOf($: EngineInterface, root: string): Promise<string> {
  const git = await $.process.run(['git', '-C', root, 'rev-parse', '--abbrev-ref', 'HEAD']);
  return git.exitCode === 0 ? git.stdout.trim() : '';
}

const needsFacts = (e: { text: string; origin?: { kind: string } }): boolean => isComposer(e) && isVague(e.text);

/** `atlas facts:` line for a vague composer prompt, else null. */
async function sharpenLine($: EngineInterface, e: { text: string; origin?: { kind: string } }, snapshot: AtlasSnapshot | null): Promise<string | null> {
  const root = snapshot?.root;
  if (root == null || !needsFacts(e)) return null;
  return attempt(async () => factsLine(snapshot, await branchOf($, root)));
}

const appendContext = (context: readonly string[] | undefined, extra: string[]): readonly string[] | undefined =>
  extra.length === 0 ? context : [...(context ?? []), ...extra];

async function promptContext(
  $: EngineInterface,
  e: { text: string; context?: readonly string[]; origin?: { kind: string } },
  deps: DisciplineDeps,
): Promise<readonly string[] | undefined> {
  try {
    if (!(await isActive($))) return e.context;
    const snapshot = await read($, snapshotState);
    const extra = [deps.reinforce(snapshot), await sharpenLine($, e, snapshot)].filter((l): l is string => !!l);
    return appendContext(e.context, extra);
  } catch {
    return e.context;
  }
}

// ---- turn.complete ------------------------------------------------------------------

type TurnUsage = { input_tokens?: number; cache_creation_input_tokens?: number } | undefined;

const orZero = (n: number | undefined): number => n ?? 0;
/** New context this turn: uncached input plus freshly cached tokens. */
const grewTokens = (usage: TurnUsage): number => orZero(usage?.input_tokens) + orZero(usage?.cache_creation_input_tokens);

function headerCheck(snapshot: AtlasSnapshot, pattern: string, answer: string): NonNullable<HeaderCheck> {
  const firstLine = answer.split('\n', 1)[0] ?? '';
  const matched = new RegExp(pattern).test(firstLine);
  return { matched, phase: matched ? headerPhaseOf(answer, snapshot) : null };
}

async function checkHeader($: EngineInterface, answer: string): Promise<void> {
  const snapshot = await read($, snapshotState);
  const pattern = snapshot?.contract.headerFirstLinePattern;
  if (!snapshot || !pattern) return;
  const check = headerCheck(snapshot, pattern, answer);
  await update($, lastHeaderState, () => check);
  if (!check.matched) await toastOnce($, 'atlas: reply is missing the ATLAS | <phase> | <state> header');
}

async function nudgeBigTurn($: EngineInterface, usage: TurnUsage, d: Discipline, role: string): Promise<void> {
  const grew = grewTokens(usage);
  if (grew >= BIG_TURN_TOKENS && d.heavy > 0 && !d.delegated) {
    await toastOnce($, `atlas: that turn added ${Math.round(grew / 1000)}k tokens inline — dispatch ${role}`);
  }
}

async function auditTurn($: EngineInterface, e: { answer: string; usage?: TurnUsage }): Promise<void> {
  await checkHeader($, e.answer);
  const d = await read($, disciplineState);
  const role = ROLE[d.hint] ?? 'atlas:explorer';
  await nudgeBigTurn($, e.usage, d, role);
  await patch($, () => ({ heavy: 0, delegated: false }));
}

// ---- hooks ------------------------------------------------------------------------

/** The per-prompt contract reminder: the human header template, not the regex. */
export function reinforceLine(template: string | undefined, phase: string): string {
  return `atlas contract: open replies with ${template || 'the ATLAS status header'} (phase: ${phase})`;
}

export interface DisciplineDeps {
  /** Contract reminder appended to every prompt (null = none). */
  reinforce: (snapshot: AtlasSnapshot | null) => string | null;
}

/** The prompt.submit work: the lead is busy from the submit, then the reinforce/sharpen lines ride the prompt's context. */
export async function disciplinePrompt<E extends { text: string; context?: readonly string[]; origin?: { kind: string } }, R>(
  $: EngineInterface,
  e: E,
  next: (input: E) => Promise<R>,
  deps: DisciplineDeps,
): Promise<R> {
  await trackPromptSubmit($); // the lead is busy from the submit (the host spinner shows), not from the first model step: the band never reads idle then (critique 12 B5)
  const context = await promptContext($, e, deps);
  return context === e.context ? next(e) : next({ ...e, context });
}

const killedState = atom({ plugin: 'atlas', key: 'killed' } as const, []);
const taskAgentsState = atom({ plugin: 'atlas', key: 'taskAgents' } as const, []);

/** A TaskStop of an agent (the lead's own call): remember its id and fail its row, so no surface reads a killed worker as done. Never throws. */
async function markStopped($: EngineInterface, e: unknown): Promise<void> {
	try {
		const a = e as Record<string, unknown>; // SAFETY: TaskStop args ride flat on the event, an open string-keyed bag
		const raw = [a.task_id, a.agent_id, a.shell_id].find((v) => typeof v === 'string' && v !== '');
		if (typeof raw !== 'string') return;
		await update($, killedState, (ids) => (ids.includes(raw) ? ids : [...ids, raw].slice(-64)));
		await update($, taskAgentsState, (agents) => agents.map((t) => (t.name === raw ? { ...t, state: 'failed' as const } : t)));
	} catch {
		// a kill mark never blocks the tool
	}
}

/** Wires tool.call (heavy-inline meter, and a TaskStop's kill mark) and turn.complete. prompt.submit (reinforce + sharpen) is `disciplinePrompt`, called from register.ts's one hook: the host drops the mod when an event has two unmatched hooks. */
export function registerDiscipline(on: On, deps: DisciplineDeps): void {
  on('tool.call', async ($, e, next) => {
    const agent = e.agentId ?? LEAD;
    await trackToolStart($, agent, e.tool, e); // tool args ride flat on the event, like routing.ts reads Agent args
    const result = await next(e);
    if (e.tool === 'TaskStop') await markStopped($, e);
    await trackToolEnd($, agent);
    await meterHeavy($, e, result);
    return result;
  });

  // A distinct matcher from register.ts's { reason: 'answer' } hook: one hook per matcher.
  on('turn.complete', { reason: 'answer', isAborted: false }, async ($, e, next) => {
    try {
      if (e.agentId === undefined && (await isActive($))) await auditTurn($, e);
    } catch {
      // a drift check never blocks the answer
    }
    return next(e);
  });
}
