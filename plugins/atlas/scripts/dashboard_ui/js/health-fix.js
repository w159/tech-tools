// Pure helpers for the Health page: which shell command fixes a silent failure.
// No DOM, so bun can test them.

const BACKFILL = [
  'python3 plugins/atlas/scripts/session_ingest.py --backfill',
  'python3 plugins/atlas/scripts/session_ingest.py --backfill-agent omp',
];
const CMD_RE = /\b(?:python3|tail|git|npm|bun|node)\s+[^;()\n]+/;
const STALE_RE = /^stale plugin install .*run (python3 \S+ --fix)/;

// The doctor command from a hooks subsystem "stale plugin install" evidence line, if any.
export function staleInstallCommand(subs) {
  const lines = (subs || []).flatMap((s) => s.evidence || []);
  const hit = lines.map((e) => STALE_RE.exec(String(e))).find(Boolean);
  return hit ? hit[1] : null;
}

const OMP_UPGRADE = 'omp plugin upgrade atlas';
const hasText = (v) => String(v || '');

function commandFromNext(f) {
  const m = CMD_RE.exec(hasText(f && f.next));
  return m ? [m[0].trim()] : [];
}

// Commands to copy for one silent-failure row; [] means no concrete command exists.
export function fixCommands(f, subs) {
  const kind = hasText(f && f.kind);
  const byKind = [
    [/omp install is stale/.test(hasText(f && f.sample)), () => [OMP_UPGRADE]],
    [kind === 'hook_crash', () => (staleInstallCommand(subs) ? [staleInstallCommand(subs)] : [])],
    [kind === 'ingest_stalled' || /chronicle/.test(kind), () => [...BACKFILL]],
  ];
  const hit = byKind.filter(([on]) => on).map(([, run]) => run()).find((c) => c.length);
  return hit || commandFromNext(f);
}

// Kinds that are not atlas faults (agent tool-use mistakes, external causes): informational, not "happening now".
const NOT_ATLAS_FAULT = ['tool_error_unclassified', 'tool_misuse', 'tool_env', 'tool_user_code', 'tool_error_legacy'];

export function failureTone(f) {
  if (NOT_ATLAS_FAULT.includes(hasText(f && f.kind))) return 'info';
  return f && f.state === 'active' ? 'warn' : 'info';
}

// Read-only inspection commands are diagnostics, not fixes.
const isDiagnostic = (cmds) => cmds.every((c) => /^tail\s/.test(c));

// The one action a card offers. type: copy | link | none. A card never gets a dead button.
export function failureAction(f, subs) {
  if (f && f.finding_id) return { type: 'link', label: 'Open in Improve', target: `improve?finding=${encodeURIComponent(f.finding_id)}` };
  if (f && f.session_id) return { type: 'copy', label: 'Copy session id', text: String(f.session_id) };
  const cmds = fixCommands(f, subs);
  if (cmds.length) return { type: 'copy', label: isDiagnostic(cmds) ? 'Copy diagnostic command' : 'Copy fix command', text: cmds.join('\n') };
  return { type: 'none' };
}
