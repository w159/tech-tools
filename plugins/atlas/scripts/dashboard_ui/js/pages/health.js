// Atlas Workboard v2 — Health page: subsystem grid, silent-failure list with
// fix hints, and what is working. No innerHTML; all data via h() text children.
import { h, replace } from '../dom.js';
import { stableJson } from '../api.js';
import {
  Badge, Card, Table, Tabs, EmptyState, StatusDot, Drawer, openDrawer, Sparkline,
} from '../components.js';

const WINDOWS = [
  { id: '24h', label: 'Last 24h' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
];

function normStatus(s) {
  return s === 'ok' || s === 'warn' || s === 'fail' ? s : 'info';
}

function fmtWhen(iso) {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function whenNode(iso) {
  return h('time', { datetime: iso || '', title: iso || '' }, fmtWhen(iso));
}

function projName(root) {
  if (!root) return '—';
  const parts = String(root).split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(root);
}

function describeError(err) {
  if (!err) return { title: 'Request failed', body: '' };
  return {
    title: err.status === 404 ? 'Health API is not available yet' : (err.error || 'Request failed'),
    body: [err.why, err.do].filter(Boolean).join(' — '),
  };
}

let S = null;

function freshState(ctx) {
  const w = (ctx.params && ctx.params.window) || '7d';
  return {
    ctx, mount: null, data: null, error: null, destroyed: false, inFlight: false,
    window: WINDOWS.some((x) => x.id === w) ? w : '7d',
  };
}

async function fetchHealth() {
  const p = { window: S.window };
  if (S.ctx.project && S.ctx.project !== 'all') p.project = S.ctx.project;
  return S.ctx.api.get('/api/v2/health', p);
}

async function refresh(force) {
  if (!S || S.inFlight || S.destroyed) return;
  S.inFlight = true;
  const hadError = Boolean(S.error);
  let fresh = null;
  try {
    fresh = await fetchHealth();
    S.error = null;
  } catch (err) {
    S.error = err;
  } finally {
    S.inFlight = false;
  }
  if (!S || S.destroyed) return;
  if (fresh) {
    const key = stableJson(fresh);
    const same = key === S.key;
    S.data = fresh;
    S.key = key;
    if (same && !hadError && !force) return; // nothing real changed: keep the DOM (and scroll, open drawers)
  }
  draw();
}

function kv(label, value) {
  return h('div', { class: 'pg-kv' }, h('dt', {}, label), h('dd', {}, value || '—'));
}

function subsystemCard(s) {
  const status = normStatus(s.status === 'unknown' ? 'info' : s.status);
  const evidence = Array.isArray(s.evidence) ? s.evidence : [];
  const hist = Array.isArray(s.history) ? s.history : null;
  const spark = hist && hist.some((b) => b.ok || b.fail)
    ? h('div', { class: 'pg-spark', title: s.history_source || '' }, Sparkline({ values: hist.map((b) => (b.ok || 0) + (b.fail || 0)), status }), h('span', { class: 'pg-hint' }, s.history_source || 'activity per bucket'))
    : h('p', { class: 'pg-hint', title: hist ? '' : (s.history_reason || '') }, hist ? 'No activity in this window' : 'No history for this subsystem');
  const notMeasured = s.measured === false ? 'Not measured' : null;
  const reason = s.measured === false ? (s.reason || 'no data source yet') : null;
  return h('article', { class: `pg-subsys is-${status}`, 'aria-label': `${s.label || s.id}: ${s.status || 'unknown'}` },
    h('header', { class: 'pg-subsys-head' },
      StatusDot({ status }),
      h('h3', { class: 'pg-subsys-name' }, s.label || s.id),
      Badge({ status, text: s.status || 'unknown' })),
    h('p', { class: 'pg-subsys-detail', title: s.detail || '' }, s.detail || 'No detail reported.'),
    h('dl', { class: 'pg-kvs pg-kvs-inline' },
      kv('Last OK', s.last_ok ? whenNode(s.last_ok) : (notMeasured || 'No success recorded in this window')),
      kv('Last failure', s.last_fail ? whenNode(s.last_fail) : (notMeasured || 'None recorded in this window'))),
    reason && !(s.last_ok && s.last_fail)
      ? h('details', { class: 'pg-reason' }, h('summary', {}, 'Why not measured'), h('p', {}, reason))
      : null,
    spark,
    evidence.length
      ? h('details', { class: 'pg-evidence' },
        h('summary', {}, `Evidence (${evidence.length})`),
        h('ul', {}, ...evidence.map((e) => h('li', { class: 'pg-mono' }, String(e)))))
      : null);
}

function openFailure(f) {
  const body = h('div', { class: 'pg-detail' },
    h('div', { class: 'pg-detail-head' },
      Badge({ status: 'fail', text: f.kind || 'failure' }),
      f.count > 1 ? Badge({ status: 'info', text: `×${f.count}` }) : null),
    f.hint
      ? h('div', { class: 'pg-hintbox' }, h('strong', {}, 'What to do'), h('p', {}, f.hint))
      : h('p', { class: 'pg-hint' }, 'No hint recorded for this failure kind.'),
    f.sample ? h('pre', { class: 'pg-mono-block' }, f.sample) : null,
    h('dl', { class: 'pg-kvs' },
      kv('Project', f.project), kv('First seen', f.first), kv('Last seen', f.last), kv('Source', f.source)));
  openDrawer(Drawer({ title: f.kind || 'Silent failure', children: [body] }));
}

function failureColumns() {
  return [
    { key: 'kind', label: 'Kind', width: '160px', render: (r) => h('span', { class: 'pg-mono' }, r.kind || '—') },
    { key: 'count', label: 'Count', width: '72px', sortable: true, render: (r) => h('span', { class: 'pg-count' }, `×${r.count || 1}`) },
    { key: 'project', label: 'Project', width: '140px', render: (r) => projName(r.project) },
    { key: 'sample', label: 'Sample', render: (r) => h('span', { class: 'pg-clip', title: r.sample || '' }, r.sample || '—') },
    { key: 'hint', label: 'Hint', render: (r) => h('span', { class: 'pg-clip pg-hint-cell', title: r.hint || '' }, r.hint || '—') },
    { key: 'last', label: 'Last', width: '96px', sortable: true, render: (r) => whenNode(r.last) },
    { key: 'open', label: '', width: '72px', render: (r) => h('button', {
      type: 'button', class: 'btn btn-ghost', 'aria-label': `Open failure ${r.kind}`,
      onclick: (e) => { e.stopPropagation(); openFailure(r); },
    }, 'How to fix') },
  ];
}

function enforcementCard(e) {
  const enf = e || {};
  const rules = enf.top_rules || [];
  const projects = enf.projects || [];
  const c = enf.counts || {};
  return Card({
    title: `Enforcement (${enf.total || 0})`,
    actions: [h('span', { class: 'pg-group-meta' }, 'Policy working as designed — not failures')],
    children: [(enf.total || 0) > 0
      ? h('div', { class: 'pg-stack' },
        h('p', { class: 'pg-hint' },
          `${c.gate_deny || 0} denied calls, ${c.gate_block || 0} gate blocks in this window.`),
        Table({
          dense: true, rows: rules,
          columns: [
            { key: 'rule', label: 'Rule', render: (r) => h('span', { class: 'pg-mono' }, r.rule || '—') },
            { key: 'kind', label: 'Kind', width: '110px', render: (r) => Badge({ status: 'info', text: r.kind || 'enforced' }) },
            { key: 'count', label: 'Count', width: '72px', sortable: true, render: (r) => h('span', { class: 'pg-count' }, `×${r.count || 0}`) },
            { key: 'last', label: 'Last', width: '96px', render: (r) => whenNode(r.last) },
          ],
        }),
        projects.length
          ? h('p', { class: 'pg-hint' }, `By project: ${projects.map((p) => `${projName(p.project)} ×${p.count}`).join(', ')}`)
          : null)
      : h('p', { class: 'pg-hint' }, 'No denies or gate blocks in this window.')],
  });
}

function toolErrorsCard(t) {
  const te = t || {};
  const causes = te.top_causes || [];
  const c = te.counts || {};
  const legacy = te.legacy || 0;
  const legacyLine = legacy > 0
    ? h('p', { class: 'pg-hint' }, `${legacy} legacy tool errors — ${te.legacy_hint || 'pre-capture history, no error text; not attributable'}`)
    : null;
  return Card({
    title: `Tool errors by cause (${te.total || 0})`,
    actions: [h('span', { class: 'pg-group-meta' }, 'External causes — not atlas faults')],
    children: [(te.total || 0) > 0
      ? h('div', { class: 'pg-stack' },
        h('p', { class: 'pg-hint' },
          `${c.model_misuse || 0} model misuse (edit without read, bad arguments), ${c.environment || 0} environment (nonzero exit, missing path, timeout, MCP) in this window.`),
        Table({
          dense: true, rows: causes,
          columns: [
            { key: 'class', label: 'Cause', width: '110px', render: (r) => Badge({ status: 'info', text: r.class || '—' }) },
            { key: 'tool', label: 'Tool', width: '110px', render: (r) => h('span', { class: 'pg-mono' }, r.tool || '—') },
            { key: 'snippet', label: 'Error', render: (r) => h('span', { class: 'pg-clip', title: r.snippet || '' }, r.snippet || '—') },
            { key: 'count', label: 'Count', width: '72px', sortable: true, render: (r) => h('span', { class: 'pg-count' }, `×${r.count || 0}`) },
            { key: 'last', label: 'Last', width: '96px', render: (r) => whenNode(r.last) },
          ],
        }),
        legacyLine)
      : h('div', { class: 'pg-stack' },
        h('p', { class: 'pg-hint' }, 'No model-misuse or environment tool errors in this window.'),
        legacyLine)],
  });
}

function successCard(s) {
  return h('div', { class: 'pg-success' },
    StatusDot({ status: 'ok' }),
    h('span', { class: 'pg-success-kind' }, s.kind || '—'),
    h('span', { class: 'pg-count' }, `×${s.count || 0}`),
    h('span', { class: 'pg-success-last' }, fmtWhen(s.last)));
}

function body() {
  if (S.error && !S.data) {
    const d = describeError(S.error);
    return EmptyState({
      icon: 'alert', title: d.title, body: d.body || 'The health endpoint did not answer.',
      actions: [h('button', { type: 'button', class: 'btn btn-primary', onclick: refresh }, 'Retry')],
    });
  }
  if (!S.data) return h('p', { class: 'pg-hint', role: 'status' }, 'Checking subsystems…');
  const subs = S.data.subsystems || [];
  const fails = [...(S.data.silent_failures || [])].sort((a, b) => (b.count || 0) - (a.count || 0));
  const wins = S.data.successes || [];
  const bad = subs.filter((s) => s.status === 'fail').length;
  const warn = subs.filter((s) => s.status === 'warn').length;
  return h('div', { class: 'pg-stack' },
    h('p', { class: 'pg-sub', role: 'status' },
      `${subs.length} subsystems: ${bad} failing, ${warn} warning. ${fails.length} silent failure kinds in this window.`),
    Card({
      title: 'Subsystems',
      children: [subs.length
        ? h('div', { class: 'pg-subsys-grid' }, ...subs.map(subsystemCard))
        : EmptyState({ icon: 'inbox', title: 'No subsystem data', body: 'The health endpoint returned no subsystems.' })],
    }),
    Card({
      title: `Silent failures (${fails.length})`,
      actions: [h('span', { class: 'pg-group-meta' }, 'Errored or stalled without surfacing')],
      children: [fails.length
        ? Table({ columns: failureColumns(), rows: fails, dense: true, onRow: openFailure })
        : EmptyState({ icon: 'check', title: 'No silent failures', body: 'Nothing errored quietly in this window.' })],
    }),
    toolErrorsCard(S.data.tool_errors),
    enforcementCard(S.data.enforcement),
    Card({
      title: `Working (${wins.length})`,
      children: [wins.length
        ? h('div', { class: 'pg-success-grid' }, ...wins.map(successCard))
        : h('p', { class: 'pg-hint' }, 'No successful operations recorded in this window.')],
    }));
}

function draw() {
  if (!S || !S.mount || S.destroyed) return;
  replace(S.mount, 
    h('header', { class: 'pg-head' },
      h('h1', { class: 'pg-title' }, 'Health'),
      h('div', { class: 'pg-head-actions' },
        Tabs({
          tabs: WINDOWS.map((w) => ({ id: w.id, label: w.label })),
          active: S.window,
          onChange: (id) => { S.window = id; refresh(true); },
        }),
        h('button', { type: 'button', class: 'btn', onclick: () => refresh(true) }, 'Refresh'))),
    body());
}

export default {
  id: 'health',
  title: 'Health',
  icon: 'heart',
  group: 'Observe',
  async load(ctx) {
    if (S) this.destroy();
    S = freshState(ctx);
    try {
      S.data = await fetchHealth();
    } catch (err) {
      S.error = err;
    }
    return S.data;
  },
  render(ctx) {
    if (!S) S = freshState(ctx);
    S.ctx = ctx;
    S.mount = h('div', { class: 'pg-page pg-health' });
    draw();
    return S.mount;
  },
  onEvent(evt, ctx) {
    if (!S || !evt) return;
    if (evt === 'health' || (evt === 'tick' && ctx && ctx.api.mode === 'poll')) refresh();
  },
  destroy() {
    if (!S) return;
    S.destroyed = true;
    S = null;
  },
};
