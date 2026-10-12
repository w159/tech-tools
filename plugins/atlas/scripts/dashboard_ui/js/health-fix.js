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

const hasText = (v) => String(v || '');

function commandFromNext(f) {
  const m = CMD_RE.exec(hasText(f && f.next));
  return m ? [m[0].trim()] : [];
}

// Commands to copy for one silent-failure row; [] means no concrete command exists.
export function fixCommands(f, subs) {
  const kind = hasText(f && f.kind);
  const byKind = [
    [kind === 'hook_crash', () => (staleInstallCommand(subs) ? [staleInstallCommand(subs)] : [])],
    [kind === 'ingest_stalled' || /chronicle/.test(kind), () => [...BACKFILL]],
  ];
  const hit = byKind.filter(([on]) => on).map(([, run]) => run()).find((c) => c.length);
  return hit || commandFromNext(f);
}
