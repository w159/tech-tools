// Intents: pure module turning contract `Intent` values into safe argv.
// Allowlist: ids, owners, channels, phases, text caps, pane ids are strictly validated;
// argv always begins with 'python3' + a real script path — never a shell string.
// Read plugins/atlas/scripts/atlas_todo.py, atlas_herdr.py, atlas_mux.py for EXACT flags.

import type { PhaseId } from './contract';

export const PHASES: readonly PhaseId[] = ['research', 'theory', 'test', 'validate', 'implement', 'verify', 'done', 'blocked'];

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const PANE_RE = /^[A-Za-z0-9:_.-]{1,64}$/;
// Real channel names are `<basename>@<branch>[/lead-<id>]` (atlas_todo main_channel), so they may contain @ and /.
const CHANNEL_RE = /^[A-Za-z0-9_.:@/-]{1,128}$/;
const TEXT_CAP = 2000;

// argv always begins: python3 <pluginRoot>/scripts/<script>.py — never a shell string.
const argvHead = (pluginRoot: string, name: string) => ['python3', `${pluginRoot}/scripts/${name}.py`];

export type IntentResult =
  | { ok: true; argv: string[]; kind: 'cli' }
  | { ok: true; kind: 'ui'; tab?: string; agent?: string }
  | { ok: false; error: string };

/** Validate a shared id-like string (todo ids, owners, channels, agents, names). */
const idOk = (id: string): boolean => ID_RE.test(id);

/** Validate a herdr pane id (herdr pane regex: ^[A-Za-z0-9:_.-]{1,64}$). */
const paneOk = (paneId: string): boolean => PANE_RE.test(paneId);

export function intentToArgv(i: unknown, ctx: { pluginRoot: string; root: string; channel: string | null }): IntentResult {
  if (typeof i !== 'object' || i === null) return { ok: false, error: 'not an intent object' };
  const x = i as Record<string, unknown>;
  const t = x.t;
  const fail = (error: string): IntentResult => ({ ok: false, error });

  const isStr = (v: unknown): v is string => typeof v === 'string';
  const needId = (v: unknown): IntentResult | { id: string } => {
    if (!isStr(v)) return fail('missing id');
    if (!idOk(v)) return fail(`bad id: ${v.slice(0, 32)}`);
    return { id: v };
  };
  const needOwner = (v: unknown): IntentResult | { owner: string } => {
    if (!isStr(v)) return fail('missing owner');
    if (!idOk(v)) return fail(`bad owner: ${v.slice(0, 32)}`);
    return { owner: v };
  };
  const needName = (v: unknown, label: string): IntentResult | { name: string } => {
    if (!isStr(v)) return fail(`missing ${label}`);
    if (!idOk(v)) return fail(`bad ${label}: ${v.slice(0, 32)}`);
    return { name: v };
  };
  const needPhase = (v: unknown): IntentResult | { phase: PhaseId } => {
    if (!isStr(v)) return fail('missing phase');
    if (!(PHASES as readonly string[]).includes(v)) return fail(`bad phase: ${v.slice(0, 32)}`);
    return { phase: v as PhaseId };
  };
  const needText = (v: unknown, label: string): IntentResult | { text: string } => {
    if (!isStr(v)) return fail(`missing ${label}`);
    const text = v.trim();
    if (text.length === 0) return fail(`empty ${label}`);
    if (text.length > TEXT_CAP) return fail(`${label} too long: ${text.length} > ${TEXT_CAP}`);
    return { text };
  };
  const needPaneId = (v: unknown): IntentResult | { paneId: string } => {
    if (!isStr(v)) return fail('missing paneId');
    if (!paneOk(v)) return fail(`bad paneId: ${v.slice(0, 32)}`);
    return { paneId: v };
  };

  switch (t) {
    case 'todo.phase': {
      const id = needId(x.id); if (!('id' in id)) return id as IntentResult;
      const phase = needPhase(x.phase); if (!('phase' in phase)) return phase as IntentResult;
      return {
        ok: true, kind: 'cli', argv: [
          ...argvHead(ctx.pluginRoot, 'atlas_todo'), 'status', '--id', id.id, '--status', phase.phase, '--root', ctx.root,
        ],
      };
    }
    case 'todo.claim': {
      const id = needId(x.id); if (!('id' in id)) return id as IntentResult;
      const owner = needOwner(x.owner); if (!('owner' in owner)) return owner as IntentResult;
      return {
        ok: true, kind: 'cli', argv: [
          ...argvHead(ctx.pluginRoot, 'atlas_todo'), 'claim', '--id', id.id, '--owner', owner.owner, '--root', ctx.root,
        ],
      };
    }
    case 'todo.complete': {
      const id = needId(x.id); if (!('id' in id)) return id as IntentResult;
      const evidence = needText(x.evidence, 'evidence'); if (!('text' in evidence)) return evidence as IntentResult;
      return {
        ok: true, kind: 'cli', argv: [
          ...argvHead(ctx.pluginRoot, 'atlas_todo'), 'complete', '--id', id.id, '--evidence', evidence.text, '--root', ctx.root,
        ],
      };
    }
    case 'note': {
      const to = needName(x.to, 'to'); if (!('name' in to)) return to as IntentResult;
      const text = needText(x.text, 'text'); if (!('text' in text)) return text as IntentResult;
      const channel = ctx.channel;
      if (channel === null || !CHANNEL_RE.test(channel)) return fail(`bad channel: ${String(channel).slice(0, 32)}`);
      return {
        ok: true, kind: 'cli', argv: [
          ...argvHead(ctx.pluginRoot, 'atlas_todo'), 'note',
          '--root', ctx.root,
          '--channel', channel,
          '--owner', 'human',
          '--channel', channel,
          '--to', to.name,
          text.text,
        ],
      };
    }
    case 'steer': {
      const paneId = needPaneId(x.paneId); if (!('paneId' in paneId)) return paneId as IntentResult;
      const text = needText(x.text, 'text'); if (!('text' in text)) return text as IntentResult;
      return {
        ok: true, kind: 'cli', argv: [
          ...argvHead(ctx.pluginRoot, 'atlas_herdr'), 'prompt', '--pane', paneId.paneId, '--text', text.text,
        ],
      };
    }
    case 'stop': {
      const run = x.run;
      if (!isStr(run)) return fail('missing run');
      if (!idOk(run)) return fail(`bad run: ${run.slice(0, 32)}`);
      return {
        ok: true, kind: 'cli', argv: [
          ...argvHead(ctx.pluginRoot, 'atlas_mux'), 'kill', '--run', run,
        ],
      };
    }
    case 'tab': {
      const tab = x.tab;
      if (tab !== 'colony' && tab !== 'channel' && tab !== 'board' && tab !== 'squad' && tab !== 'collab') {
        return fail(`bad tab: ${String(tab).slice(0, 32)}`);
      }
      return { ok: true, kind: 'ui', tab };
    }
    case 'inspect': {
      const agent = needName(x.agent, 'agent'); if (!('name' in agent)) return agent as IntentResult;
      return { ok: true, kind: 'ui', agent: agent.name };
    }
    default:
      return fail(`unknown intent: ${String(t).slice(0, 32)}`);
  }
}
