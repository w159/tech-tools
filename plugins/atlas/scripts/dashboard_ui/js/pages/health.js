// Atlas Workboard v2 — Health page: subsystem grid, silent-failure list with
// fix hints, and what is working. No innerHTML; all data via h() text children.
import { h, replace } from '../dom.js';
import { changeKey, keepView } from '../keep-view.js';
import {
  Badge, Card, Table, Tabs, EmptyState, StatusDot, Sparkline,
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
    const key = changeKey(fresh);
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

// Calendar day of an ISO time, for "stops counting on <date>".
const day = (iso) => (iso ? String(iso).slice(0, 10) : '—');

function subsystemCard(s) {
  const status = normStatus(s.status === 'unknown' ? 'info' : s.status);
  const evidence = Array.isArray(s.evidence) ? s.evidence : [];
  const hist = Array.isArray(s.history) ? s.history : null;
  const spark = hist && hist.some((b) => b.ok || b.fail)
    ? h('div', { class: 'pg-spark', title: s.history_source || '' }, Sparkline({ values: hist.map((b) => (b.ok || 0) + (b.fail || 0)), status }), h('span', { class: 'pg-hint' }, s.history_source || 'activity per bucket'))
    : h('p', { class: 'pg-hint', title: hist ? '' : (s.history_reason || '') }, hist ? 'No activity in this window' : 'No history for this subsystem');
  const notMeasured = s.measured === false ? 'Not measured' : null;
  const reason = s.measured === false ? (s.reason || 'no data source yet') : null;
  const needsYou = s.status === 'warn' || s.status === 'fail';
  const explain = (s.warn_means || s.next)
    ? h('div', { class: 'pg-hintbox' },
      needsYou ? h('strong', {}, `Why ${s.status}`) : h('strong', {}, 'If this warns'),
      s.warn_means ? h('p', {}, s.warn_means) : null,
      s.next ? h('p', {}, h('strong', {}, 'Do this: '), s.next) : null)
    : null;
  return h('article', { id: `sub-${s.id}`, class: `pg-subsys is-${status}`, 'aria-label': `${s.label || s.id}: ${s.status || 'unknown'}` },
    h('header', { class: 'pg-subsys-head' },
      StatusDot({ status }),
      h('h3', { class: 'pg-subsys-name' }, s.label || s.id),
      Badge({ status, text: s.status || 'unknown' })),
    s.what ? h('p', { class: 'pg-hint' }, s.what) : null,
    h('p', { class: 'pg-subsys-detail' }, s.detail || 'No detail reported.'),
    needsYou ? explain : null,
    h('dl', { class: 'pg-kvs pg-kvs-inline' },
      kv(s.ok_label || 'Last OK', s.last_ok ? whenNode(s.last_ok) : (notMeasured || 'No success recorded in this window')),
      kv(s.fail_label || 'Last failure', s.last_fail ? whenNode(s.last_fail) : (notMeasured || 'None recorded in this window'))),
    reason && !(s.last_ok && s.last_fail)
      ? h('details', { class: 'pg-reason', 'data-keep': `why-${s.id}` }, h('summary', {}, 'Why not measured'), h('p', {}, reason))
      : null,
    spark,
    needsYou ? null : h('details', { class: 'pg-evidence', 'data-keep': `about-${s.id}` }, h('summary', {}, 'About this check'), explain),
    evidence.length
      ? h('details', { class: 'pg-evidence', 'data-keep': `ev-${s.id}` },
        h('summary', {}, `Evidence (${evidence.length})`),
        h('ul', {}, ...evidence.map((e) => h('li', { class: 'pg-mono' }, String(e)))))
      : null);
}

function clip(s, n) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function agesOutText(f, active) {
  if (!f.ages_out) return 'when fixed';
  return `${day(f.ages_out)}${active ? ' unless it recurs' : ', no action needed'}`;
}

function failureFacts(f, active) {
  return h('dl', { class: 'pg-kvs pg-kvs-inline' },
    kv('Times', `×${f.count || 1}`),
    kv('Project', projName(f.project)),
    kv('Last seen', f.last ? whenNode(f.last) : null),
    kv(f.ages_out ? 'Stops counting' : 'Clears', agesOutText(f, active)));
}

// One silent failure as a card with an id, so "Open in Health" from Overview lands on it.
function failureCard(f) {
  const active = f.state === 'active';
  const tone = active ? 'warn' : 'info';
  const stateText = active ? 'happening now' : 'historic';
  const title = f.title || f.kind;
  const sample = String(f.sample || '');
  return h('article', { id: f.id, class: `pg-subsys is-${tone}`, 'aria-label': `${title}: ${stateText}` },
    h('header', { class: 'pg-subsys-head' },
      StatusDot({ status: tone }),
      h('h3', { class: 'pg-subsys-name' }, title),
      Badge({ status: tone, text: stateText })),
    f.what ? h('p', { class: 'pg-hint' }, f.what) : null,
    sample ? h('pre', { class: 'pg-mono-block' }, clip(sample, 220)) : null,
    h('div', { class: 'pg-hintbox' }, h('strong', {}, 'Do this'), h('p', {}, f.next || f.hint || 'No action recorded for this failure kind.')),
    failureFacts(f, active));
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

function silentFailuresCard(fails) {
  const now = fails.filter((f) => f.state === 'active');
  const old = fails.filter((f) => f.state !== 'active');
  const grid = (list) => h('div', { class: 'pg-subsys-grid' }, ...list.map(failureCard));
  const historic = old.length
    ? [
      h('h3', { class: 'pg-sub' }, `Historic, aging out (${old.length})`),
      h('p', { class: 'pg-hint' }, 'Seen earlier in this window and not since. No action needed; each stops counting on the date shown.'),
      grid(old),
    ]
    : [];
  return Card({
    title: `Silent failures (${fails.length})`,
    actions: [h('span', { class: 'pg-group-meta' }, 'Errored or stalled without surfacing')],
    children: [fails.length
      ? h('div', { class: 'pg-stack' },
        h('h3', { class: 'pg-sub' }, `Happening now (${now.length})`),
        now.length ? grid(now) : h('p', { class: 'pg-hint' }, 'Nothing is failing quietly right now: no failure was seen in the last 24h.'),
        ...historic)
      : EmptyState({ icon: 'check', title: 'No silent failures', body: 'Nothing errored quietly in this window.' })],
  });
}

function subsystemsCard(subs) {
  return Card({
    title: 'Subsystems',
    children: [subs.length
      ? h('div', { class: 'pg-subsys-grid' }, ...subs.map(subsystemCard))
      : EmptyState({ icon: 'inbox', title: 'No subsystem data', body: 'The health endpoint returned no subsystems.' })],
  });
}

function workingCard(wins) {
  return Card({
    title: `Working (${wins.length})`,
    children: [wins.length
      ? h('div', { class: 'pg-success-grid' }, ...wins.map(successCard))
      : h('p', { class: 'pg-hint' }, 'No successful operations recorded in this window.')],
  });
}

function errorBody() {
  const d = describeError(S.error);
  return EmptyState({
    icon: 'alert', title: d.title, body: d.body || 'The health endpoint did not answer.',
    actions: [h('button', { type: 'button', class: 'btn btn-primary', onclick: refresh }, 'Retry')],
  });
}

function summaryLine(subs) {
  const bad = subs.filter((s) => s.status === 'fail').length;
  const warn = subs.filter((s) => s.status === 'warn').length;
  const winLabel = (WINDOWS.find((w) => w.id === S.window) || WINDOWS[1]).label.toLowerCase();
  return h('p', { class: 'pg-sub', role: 'status' },
    `${subs.length} subsystems: ${bad} failing, ${warn} warning. Measured over the ${winLabel}; checked ${fmtWhen(S.data.checked_at)} (${S.data.checked_at}). `,
    'OK means no failure was seen. Warn means something needs a look; the card says what and what to do. "Happening now" means seen in the last 24h; "historic" only waits to age out of the window.');
}

function body() {
  if (S.error && !S.data) return errorBody();
  if (!S.data) return h('p', { class: 'pg-hint', role: 'status' }, 'Checking subsystems…');
  const subs = S.data.subsystems || [];
  const fails = [...(S.data.silent_failures || [])].sort((a, b) => (b.count || 0) - (a.count || 0));
  return h('div', { class: 'pg-stack' },
    summaryLine(subs),
    subsystemsCard(subs),
    silentFailuresCard(fails),
    toolErrorsCard(S.data.tool_errors),
    enforcementCard(S.data.enforcement),
    workingCard(S.data.successes || []));
}

function draw() {
  if (!S || !S.mount || S.destroyed) return;
  keepView(S.mount, (t) => replace(t,
    h('header', { class: 'pg-head' },
      h('h1', { class: 'pg-title' }, 'Health'),
      h('div', { class: 'pg-head-actions' },
        Tabs({
          tabs: WINDOWS.map((w) => ({ id: w.id, label: w.label })),
          active: S.window,
          onChange: (id) => { S.window = id; refresh(true); },
        }),
        h('button', { type: 'button', class: 'btn', onclick: () => refresh(true) }, 'Refresh'))),
    body()));
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
