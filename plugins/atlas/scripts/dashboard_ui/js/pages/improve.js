// Atlas Workboard v2 — Self-improvement page: observe → mine → propose → apply →
// remeasure strip, findings table with status actions + remeasure, by-rule
// rollup across projects, ledger, nudges, lessons and score trends.
// No innerHTML; all data via h() text children.
import { h } from '../dom.js';
import {
  Badge, Card, Table, EmptyState, StatusDot, Timeline, LineChart, Drawer, openDrawer,
} from '../components.js';

const CSS_HREF = '/ui/css/pages-insights.css';
const STAGES = ['observe', 'mine', 'propose', 'apply', 'remeasure'];
const STATUS_ACTIONS = [
  { to: 'accepted', label: 'Accept', from: ['open'] },
  { to: 'fixed', label: 'Mark fixed', from: ['open', 'accepted'] },
  { to: 'dismissed', label: 'Dismiss', from: ['open', 'accepted'] },
  { to: 'wontfix', label: "Won't fix", from: ['open', 'accepted'] },
  { to: 'open', label: 'Reopen', from: ['fixed', 'dismissed', 'wontfix'] },
];
const STATUS_TONE = {
  open: 'warn', accepted: 'info', fixed: 'ok', dismissed: 'info', wontfix: 'info',
  unverified: 'warn', partial: 'warn', superseded: 'info', refuted: 'fail',
};
const STATUS_LABEL = { partial: 'partially verified' };
const FILTER_TABS = ['all', 'open', 'accepted', 'fixed', 'dismissed', 'wontfix', 'unverified', 'partial', 'superseded', 'refuted'];
const SEVERITY_TONE = {
  fail: 'fail', high: 'fail', critical: 'fail', major: 'fail', blocker: 'fail',
  warn: 'warn', medium: 'warn', moderate: 'warn',
  info: 'info', low: 'info', minor: 'info', informational: 'info',
};
// improved/regressed are direction-aware verdicts computed server-side.
const TREND_TONE = { improved: 'ok', regressed: 'fail', flat: 'info', no_change: 'info', pending: 'info' };
const TREND_GLYPH = { improved: '▲ better', regressed: '▼ worse', flat: '■ unchanged', no_change: '■ unchanged', pending: '… pending' };

function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-atlas-css="insights"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  link.setAttribute('data-atlas-css', 'insights');
  document.head.appendChild(link);
}

function normStatus(s) {
  return s === 'ok' || s === 'warn' || s === 'fail' ? s : 'info';
}

function fmtWhen(iso) {
  if (!iso) return '—';
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

function text(v) {
  if (v === undefined || v === null || v === '') return '—';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// Table-cell variant of text(): long floats (rates, scores) round to 3 decimals.
function cell(v) {
  return typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v) ? String(Math.round(v * 1000) / 1000) : text(v);
}

function describeError(err) {
  if (!err) return { title: 'Request failed', body: '' };
  return {
    title: err.status === 404 ? 'Self-improvement API is not available yet' : (err.error || 'Request failed'),
    body: [err.why, err.do].filter(Boolean).join(' — '),
  };
}

let S = null;

function freshState(ctx) {
  return { ctx, mount: null, data: null, error: null, busy: new Set(), destroyed: false, inFlight: false, filter: 'all' };
}

function notify(msg, kind) {
  if (S && S.ctx && typeof S.ctx.toast === 'function') S.ctx.toast(msg, { kind });
}

async function fetchImprove() {
  const p = {};
  if (S.ctx.project && S.ctx.project !== 'all') p.project = S.ctx.project;
  return S.ctx.api.get('/api/v2/improve', p);
}

async function refresh() {
  if (!S || S.inFlight || S.destroyed) return;
  S.inFlight = true;
  try {
    S.data = await fetchImprove();
    S.error = null;
  } catch (err) {
    S.error = err;
  } finally {
    S.inFlight = false;
  }
  draw();
}

// Mutations: the response is `{ok,state,next}`; `state` is the fresh object, so
// swap it in without a second round trip.
async function mutate(finding, path, payload, okMsg) {
  const key = `${finding.id}:${path}`;
  if (S.busy.has(key)) return;
  S.busy.add(key);
  draw();
  try {
    const res = await S.ctx.api.post(path, payload);
    if (res && res.ok === false) throw Object.assign(new Error(res.error), res);
    if (res && res.state && typeof res.state === 'object' && Array.isArray(res.state.findings)) S.data = res.state;
    notify(res && res.next ? `${okMsg}. ${res.next}` : okMsg, 'ok');
    if (!(res && res.state && Array.isArray(res.state.findings))) {
      S.busy.delete(key);
      S.inFlight = false;
      await refresh();
      return;
    }
  } catch (err) {
    const d = describeError(err);
    notify([d.title, d.body].filter(Boolean).join(': '), 'fail');
  }
  S.busy.delete(key);
  draw();
}

const setStatus = (f, to) => mutate(f, '/api/v2/improve/finding', { id: f.id, status: to },
  `“${f.title || f.id}” marked ${to}`);
const remeasure = (f) => mutate(f, '/api/v2/improve/remeasure', { id: f.id },
  `Re-measured “${f.title || f.id}”`);

function kv(label, value) {
  return h('div', { class: 'pg-kv' }, h('dt', {}, label), h('dd', {}, text(value)));
}

const statusText = (s) => STATUS_LABEL[s] || s || 'open';

function trendBadge(trend) {
  if (!trend) return h('span', { class: 'pg-hint' }, '—');
  return Badge({ status: TREND_TONE[trend] || 'info', text: TREND_GLYPH[trend] || trend });
}

function openFinding(f) {
  const body = h('div', { class: 'pg-detail' },
    h('div', { class: 'pg-detail-head' },
      Badge({ status: STATUS_TONE[f.status] || 'info', text: statusText(f.status) }),
      Badge({ status: SEVERITY_TONE[f.severity] || 'info', text: f.severity || 'info' }),
      f.trend ? trendBadge(f.trend) : null),
    h('p', { class: 'pg-detail-title' }, f.title || f.id),
    f.evidence ? h('pre', { class: 'pg-mono-block' }, text(f.evidence)) : null,
    f.detail ? h('pre', { class: 'pg-mono-block' }, text(f.detail)) : null,
    f.proposed_action ? h('p', {}, h('strong', {}, 'Proposed: '), f.proposed_action) : null,
    h('dl', { class: 'pg-kvs' },
      kv('Rule', f.rule), kv('Source', f.source), kv('Project', f.project),
      kv('Metric', f.metric), kv('Baseline', f.baseline), kv('Current', f.current),
      kv('Target', f.target), kv('Verdict', f.verdict), kv('Verified by', f.verifier),
      kv(f.time_source === 'file' ? 'Ledger file updated' : 'First seen', f.first),
      kv('Last seen', f.last), kv('ID', f.id)));
  openDrawer(Drawer({ title: f.title || 'Finding', children: [body] }));
}

// ---- sections ---------------------------------------------------------------
function stageStrip() {
  const stages = (S.data.loop && S.data.loop.stages) || [];
  const byId = new Map(stages.map((s) => [s.id, s]));
  return h('ol', { class: 'pg-loop', 'aria-label': 'Self-improvement loop' },
    ...STAGES.map((id, i) => {
      const s = byId.get(id) || { id, label: id, count: 0, status: 'info' };
      const status = normStatus(s.status);
      return h('li', { class: `pg-stage is-${status}` },
        h('span', { class: 'pg-stage-step', 'aria-hidden': 'true' }, String(i + 1)),
        h('span', { class: 'pg-stage-label' }, s.label || id),
        h('span', { class: 'pg-stage-count' }, String(s.count ?? 0)),
        Badge({ status, text: s.status || 'idle' }));
    }));
}

// Only doctor findings have a settable status / remeasure; ledger rows are
// append-only verdicts, so they get no buttons (the server would answer 400).
function findingActions(f) {
  if (!f.actionable) return h('span', { class: 'pg-hint', title: 'Ledger verdicts are append-only' }, 'read-only');
  const status = f.status || 'open';
  const btns = STATUS_ACTIONS.filter((a) => a.from.includes(status)).map((a) => h('button', {
    type: 'button', class: 'btn btn-ghost', disabled: S.busy.has(`${f.id}:/api/v2/improve/finding`),
    'aria-label': `${a.label}: ${f.title || f.id}`,
    onclick: (e) => { e.stopPropagation(); setStatus(f, a.to); },
  }, a.label));
  btns.push(h('button', {
    type: 'button', class: 'btn btn-ghost', disabled: S.busy.has(`${f.id}:/api/v2/improve/remeasure`),
    'aria-label': `Remeasure: ${f.title || f.id}`,
    onclick: (e) => { e.stopPropagation(); remeasure(f); },
  }, S.busy.has(`${f.id}:/api/v2/improve/remeasure`) ? 'Measuring…' : 'Remeasure'));
  return h('div', { class: 'pg-actions' }, ...btns);
}

function findingColumns() {
  return [
    { key: 'status', label: 'Status', width: '112px', render: (r) => Badge({ status: STATUS_TONE[r.status] || 'info', text: statusText(r.status) }) },
    { key: 'title', label: 'Finding', render: (r) => {
      const has = (v) => v !== null && v !== undefined;
      const delta = has(r.baseline) && has(r.current)
        ? h('span', { class: 'pg-evt pg-delta', title: 'Baseline → now' },
          h('span', { class: 'pg-hint' }, 'baseline → now'),
          h('span', { class: 'pg-mono' }, `${cell(r.baseline)} → ${cell(r.current)}`),
          r.trend ? trendBadge(r.trend) : null)
        : has(r.current)
          ? h('span', { class: 'pg-evt pg-delta', title: 'No baseline recorded for this finding' },
            h('span', { class: 'pg-hint' }, 'now (no baseline)'),
            h('span', { class: 'pg-mono' }, cell(r.current)))
          : null;
      return h('div', { class: 'pg-finding-title' },
        h('span', { class: 'pg-evt' },
          h('span', { class: 'pg-evt-title' }, r.title || r.id),
          Badge({ status: SEVERITY_TONE[r.severity] || 'info', text: r.severity || 'info' })),
        delta);
    } },
    { key: 'rule', label: 'Rule · project', width: '170px', render: (r) => h('div', { class: 'pg-rulecell' },
      h('span', { class: 'pg-mono pg-wrap', title: r.rule || '' }, r.rule || '—'),
      r.project ? h('span', { class: 'pg-group-meta pg-wrap', title: r.project }, projName(r.project)) : null) },
    { key: 'last', label: 'Last seen', width: '84px', sortable: true, render: (r) => whenNode(r.last) },
    { key: 'actions', label: 'Actions', width: '210px', render: findingActions },
  ];
}

function findingsCard() {
  const all = S.data.findings || [];
  const counts = { all: all.length };
  for (const f of all) counts[f.status || 'open'] = (counts[f.status || 'open'] || 0) + 1;
  // Hide empty status tabs so ten filters never overflow; keep the active one.
  const tabs = FILTER_TABS.filter((t) => t === 'all' || t === S.filter || counts[t] || ['open', 'accepted', 'wontfix'].includes(t));
  const rows = S.filter === 'all' ? all : all.filter((f) => (f.status || 'open') === S.filter);
  return Card({
    title: `Findings (${all.length})`,
    actions: [h('div', { class: 'pg-segment', role: 'group', 'aria-label': 'Filter findings by status' },
      ...tabs.map((t) => h('button', {
        type: 'button', class: `pg-seg${S.filter === t ? ' is-active' : ''}`, 'aria-pressed': String(S.filter === t),
        onclick: () => { S.filter = t; draw(); },
      }, `${statusText(t)} ${counts[t] || 0}`)))],
    children: [rows.length
      ? Table({ columns: findingColumns(), rows, dense: true, onRow: openFinding })
      : EmptyState({
        icon: 'check', title: all.length ? `No ${statusText(S.filter)} findings` : 'No findings yet',
        body: all.length ? 'Pick another status filter.' : 'atlas-doctor has nothing to report for this scope.',
        command: all.length ? undefined : 'python3 plugins/atlas/scripts/atlas_doctor.py',
      })],
  });
}

const RULES_SHOWN = 12;

function byRuleCard() {
  const all = [...(S.data.by_rule || [])].sort((a, b) => (b.open || 0) - (a.open || 0) || (b.count || 0) - (a.count || 0));
  const rules = S.allRules ? all : all.slice(0, RULES_SHOWN);
  return Card({
    title: `By rule, across projects (${all.length})`,
    actions: all.length > RULES_SHOWN ? [h('button', {
      type: 'button', class: 'btn btn-ghost', 'aria-pressed': String(Boolean(S.allRules)),
      onclick: () => { S.allRules = !S.allRules; draw(); },
    }, S.allRules ? `Top ${RULES_SHOWN} only` : `Show all ${all.length}`)] : [],
    children: [rules.length
      ? Table({
        dense: true, rows: rules,
        columns: [
          { key: 'rule', label: 'Rule', render: (r) => h('span', { class: 'pg-mono pg-clip', title: r.rule }, r.rule || '—') },
          { key: 'count', label: 'Findings', width: '82px', sortable: true, render: (r) => h('span', { class: 'pg-count', title: `${r.doctor || 0} doctor, ${r.ledger || 0} ledger` }, `×${r.count || 0}`) },
          { key: 'open', label: 'Open', width: '64px', sortable: true, render: (r) => h('span', { class: 'pg-count' }, String(r.open || 0)) },
          { key: 'delta', label: 'Baseline → now', width: '220px', render: (r) => (r.baseline === null || r.baseline === undefined)
            ? h('span', { class: 'pg-hint', title: 'No baseline recorded for this rule' }, 'no baseline')
            : h('span', { class: 'pg-evt' }, h('span', { class: 'pg-mono' }, `${cell(r.baseline)} → ${cell(r.current)}`), trendBadge(r.trend)) },
        ],
      })
      : h('p', { class: 'pg-hint' }, 'No rule has recurred across projects.')],
  });
}

function improvementsCard() {
  const imp = S.data.improvements || { verdicts: {}, items: [] };
  const v = imp.verdicts || {};
  const items = imp.items || [];
  const chips = ['improved', 'no_change', 'regressed', 'pending'].map((k) => h('span', { class: 'pg-verdict' },
    Badge({ status: TREND_TONE[k], text: k.replace('_', ' ') }), h('span', { class: 'pg-count' }, String(v[k] || 0))));
  return Card({
    title: `Remeasured improvements (${items.length})`,
    actions: [h('span', { class: 'pg-group-meta' }, 'Verdicts account for metric direction')],
    children: [
      h('div', { class: 'pg-verdicts' }, ...chips),
      items.length
        ? Table({
          dense: true, rows: [...items].sort((a, b) => (a.verdict === 'pending') - (b.verdict === 'pending')).slice(0, 15),
          columns: [
            { key: 'title', label: 'Improvement', render: (r) => h('span', { class: 'pg-clip', title: r.title }, r.title || '—') },
            { key: 'metric', label: 'Metric', width: '150px', render: (r) => h('span', { class: 'pg-mono pg-clip' }, r.metric || '—') },
            { key: 'delta', label: 'Baseline → now', width: '130px', render: (r) => h('span', { class: 'pg-mono' }, `${cell(r.baseline)} → ${cell(r.current)}`) },
            { key: 'verdict', label: 'Verdict', width: '110px', render: (r) => Badge({ status: TREND_TONE[r.verdict] || 'info', text: String(r.verdict || 'pending').replace('_', ' ') }) },
          ],
        })
        : h('p', { class: 'pg-hint' }, 'No improvement baselines recorded yet.'),
    ],
  });
}

function assetVerdictsCard() {
  const av = S.data.asset_verdicts || { by_kind: [], recent: [], total: 0 };
  return Card({
    title: `Asset verdicts (${av.total || 0})`,
    actions: [h('span', { class: 'pg-group-meta' }, `${av.applied || 0} applied · ${av.restored || 0} restored`)],
    children: [(av.by_kind || []).length
      ? h('div', { class: 'pg-stack' },
        Table({
          dense: true, rows: av.by_kind,
          columns: [
            { key: 'kind', label: 'Kind', width: '120px', render: (r) => h('span', { class: 'pg-mono' }, r.kind) },
            { key: 'count', label: 'Verdicts', width: '84px', render: (r) => h('span', { class: 'pg-count' }, `×${r.count}`) },
            { key: 'verdicts', label: 'Breakdown', render: (r) => h('span', { class: 'pg-clip' }, Object.entries(r.verdicts || {}).map(([k, n]) => `${k} ${n}`).join(' · ')) },
            { key: 'applied', label: 'Applied / restored', width: '140px', render: (r) => `${r.applied} / ${r.restored}` },
          ],
        }))
      : h('p', { class: 'pg-hint' }, 'No asset verdicts recorded for this scope.')],
  });
}

const LEDGER_SHOWN = 40;

function ledgerCard() {
  const ledger = [...(S.data.ledger || [])].reverse();
  const rows = S.allLedger ? ledger : ledger.slice(0, LEDGER_SHOWN);
  return Card({
    title: `Verification ledger (${ledger.length})`,
    actions: ledger.length > LEDGER_SHOWN ? [h('button', {
      type: 'button', class: 'btn btn-ghost', 'aria-pressed': String(Boolean(S.allLedger)),
      onclick: () => { S.allLedger = !S.allLedger; draw(); },
    }, S.allLedger ? `Latest ${LEDGER_SHOWN} only` : `Show all ${ledger.length}`)] : [],
    children: [ledger.length
      ? Timeline({
        items: rows.map((e) => {
          const fromFile = e.time_source === 'file';
          return {
            // a ledger file's mtime is shared by every row in it; never show it as a verification time
            ts: fromFile ? '' : (e.time || ''),
            title: e.title || e.id,
            detail: [statusText(e.status), e.verdict, fromFile ? `undated entry (ledger file updated ${fmtWhen(e.time)})` : null, e.detail].filter(Boolean).join(' — '),
            meta: e.severity && e.severity !== 'info' ? e.severity : undefined,
            status: normStatus(TREND_TONE[e.status] || (e.status === 'fixed' ? 'ok' : e.status === 'refuted' ? 'fail' : STATUS_TONE[e.status])),
          };
        }),
      })
      : h('p', { class: 'pg-hint' }, 'No verdicts recorded in .atlas/.run/findings.json yet.')],
  });
}

function nudgesCard() {
  const n = S.data.nudges || {};
  const recent = n.recent || [];
  return Card({
    title: 'Nudges',
    children: [
      h('dl', { class: 'pg-kvs pg-kvs-inline' },
        kv('Last nudge', n.last ? fmtWhen(n.last) : 'never'),
        kv('Sessions nudged', n.sessions_nudged),
        kv('Throttle', n.throttle_min !== undefined ? `${n.throttle_min} min` : '—'),
        kv('Source', n.source)),
      recent.length
        ? h('ul', { class: 'pg-list' }, ...recent.slice(0, 12).map((r) => h('li', {},
          h('span', { class: 'pg-mono' }, typeof r === 'object' ? text(r.ts || r.time || '') : ''),
          ' ', typeof r === 'object' ? text(`session ${r.session || ''}${r.emitted ? ` · ${r.emitted} emitted` : ''}`) : String(r))))
        : h('p', { class: 'pg-hint' }, 'No nudges sent recently.'),
    ],
  });
}

function lessonsCard() {
  const lessons = S.data.lessons || [];
  const scoped = S.ctx && S.ctx.project && S.ctx.project !== 'all';
  return Card({
    title: `Lessons (${lessons.length})`,
    actions: [h('span', { class: 'pg-group-meta' }, scoped ? `Project: ${projName(S.ctx.project)}` : 'All projects')],
    children: [lessons.length
      ? h('ul', { class: 'pg-list' }, ...lessons.slice(0, 20).map((l) => h('li', {},
        typeof l === 'object' ? text(l.title || l.lesson || l.name || l) : String(l),
        typeof l === 'object' && l.project_name && !scoped ? h('span', { class: 'pg-group-meta' }, ` · ${l.project_name}`) : null)))
      : h('p', { class: 'pg-hint' }, scoped ? 'No lessons recorded in this project’s docs/lessons/.' : 'No lessons recorded in docs/lessons/.')],
  });
}

// One small chart per judgment: unlike scales (reply_chars in the thousands,
// banned_punct counts, 0-1 rates) must never share a y-axis. Null days are
// dropped, not plotted as zero.
function scoreChart(sc, s) {
  const keep = s.values.map((v, i) => [sc.labels[i], v]).filter(([, v]) => v !== null && v !== undefined);
  const goodUp = s.direction === 'up';
  return h('div', { class: 'pg-score', 'aria-label': `${s.name}: ${goodUp ? 'higher' : 'lower'} is better` },
    h('div', { class: 'pg-score-head' },
      h('span', { class: 'pg-mono pg-score-name' }, s.name),
      h('span', { class: 'pg-group-meta', title: goodUp ? 'Higher is better' : 'Lower is better' }, goodUp ? '▲ higher is better' : '▼ lower is better'),
      trendBadge(s.trend)),
    keep.length >= 2
      ? LineChart({ labels: keep.map((k) => k[0]), series: [{ name: s.name, values: keep.map((k) => k[1]) }], height: 110 })
      : h('p', { class: 'pg-hint' }, 'Needs two days of data.'),
    h('p', { class: 'pg-group-meta' }, `${cell(s.first)} → ${cell(s.latest)} · range ${cell(s.min)}–${cell(s.max)} · n=${s.samples}`));
}

function scoresCard() {
  const sc = S.data.scores || {};
  const has = Array.isArray(sc.labels) && sc.labels.length && Array.isArray(sc.series) && sc.series.length;
  return Card({
    title: 'Score trends (14d)',
    actions: [h('span', { class: 'pg-group-meta' }, 'One chart per judgment, own scale')],
    children: [has
      ? h('div', { class: 'pg-scores' }, ...sc.series.map((s) => scoreChart(sc, s)))
      : h('p', { class: 'pg-hint' }, 'Scores appear after at least two doctor runs.')],
  });
}

function enforcementCard() {
  const enf = S.data.enforcement || {};
  const rules = enf.top_rules || [];
  const projects = enf.projects || [];
  const c = enf.counts || {};
  return Card({
    title: `Policy adherence (${enf.total || 0} enforced, 7d)`,
    actions: [h('span', { class: 'pg-group-meta' }, 'Friction from rules working as designed — not failures')],
    children: [(enf.total || 0) > 0
      ? h('div', { class: 'pg-stack' },
        h('p', { class: 'pg-hint' }, `${c.gate_deny || 0} denied calls, ${c.gate_block || 0} gate blocks. Frequent hits on one rule mean the agent keeps reaching for the wrong tool or the rule is too broad.`),
        Table({
          dense: true, rows: rules,
          columns: [
            { key: 'rule', label: 'Rule', render: (r) => h('span', { class: 'pg-mono' }, r.rule || '—') },
            { key: 'kind', label: 'Kind', width: '110px', render: (r) => Badge({ status: 'info', text: r.kind || 'enforced' }) },
            { key: 'count', label: 'Hits', width: '72px', sortable: true, render: (r) => h('span', { class: 'pg-count' }, `×${r.count || 0}`) },
            { key: 'hint', label: 'Meaning', render: (r) => h('span', { class: 'pg-clip pg-hint-cell', title: r.hint || '' }, r.hint || '—') },
          ],
        }),
        projects.length
          ? h('p', { class: 'pg-hint' }, `By project: ${projects.map((p) => `${projName(p.project)} ×${p.count}`).join(', ')}`)
          : null)
      : h('p', { class: 'pg-hint' }, 'No denies or gate blocks in the last 7 days.')],
  });
}

function body() {
  if (S.error && !S.data) {
    const d = describeError(S.error);
    return EmptyState({
      icon: 'alert', title: d.title, body: d.body || 'The improve endpoint did not answer.',
      actions: [h('button', { type: 'button', class: 'btn btn-primary', onclick: refresh }, 'Retry')],
    });
  }
  if (!S.data) return h('p', { class: 'pg-hint', role: 'status' }, 'Loading findings…');
  return h('div', { class: 'pg-stack' },
    stageStrip(), findingsCard(),
    byRuleCard(), improvementsCard(),
    scoresCard(),
    h('div', { class: 'pg-two' }, assetVerdictsCard(), enforcementCard()),
    ledgerCard(),
    h('div', { class: 'pg-two' }, nudgesCard(), lessonsCard()));
}

function draw() {
  if (!S || !S.mount || S.destroyed) return;
  const active = document.activeElement;
  const label = active && S.mount.contains(active) ? active.getAttribute('aria-label') : null;
  S.mount.replaceChildren(
    h('header', { class: 'pg-head' },
      h('h1', { class: 'pg-title' }, 'Self-improvement'),
      h('p', { class: 'pg-sub' }, 'Observe, mine, propose, apply, then remeasure — every change is checked against its baseline.'),
      h('div', { class: 'pg-head-actions' },
        h('button', { type: 'button', class: 'btn', onclick: refresh }, 'Refresh'))),
    body());
  if (label) {
    for (const el of S.mount.querySelectorAll('[aria-label]')) {
      if (el.getAttribute('aria-label') === label && typeof el.focus === 'function') { el.focus(); break; }
    }
  }
}

export default {
  id: 'improve',
  title: 'Self-improvement',
  icon: 'trending-up',
  group: 'Improve',
  async load(ctx) {
    ensureCss();
    if (S) this.destroy();
    S = freshState(ctx);
    try {
      S.data = await fetchImprove();
    } catch (err) {
      S.error = err;
    }
    return S.data;
  },
  render(ctx) {
    if (!S) S = freshState(ctx);
    S.ctx = ctx;
    S.mount = h('div', { class: 'pg-page pg-improve' });
    draw();
    return S.mount;
  },
  // SSE: `improve` carries the full route body (hash-gated server side, so it
  // only fires on change). `tick` with polled:true is the polling fallback.
  onEvent(name, _ctx, data) {
    if (!S || S.destroyed || S.busy.size) return;
    if (name === 'improve' && data && Array.isArray(data.findings)) {
      S.data = data;
      S.error = null;
      draw();
    } else if (name === 'tick' && data && data.polled) {
      refresh();
    }
  },
  destroy() {
    if (!S) return;
    S.destroyed = true;
    S = null;
  },
};
