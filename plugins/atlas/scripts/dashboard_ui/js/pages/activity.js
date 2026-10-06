// Atlas Workboard v2 — Activity page: grouped log explorer with facet filters,
// live tail, duplicate-collapse counts and saved views.
// Consumes only the documented component API (see dashboard-contract.md).
// No innerHTML: every datum reaches the DOM through h() text children.
import { h } from '../dom.js';
import {
  Badge, Card, Table, EmptyState, StatusDot, Drawer,
  openDrawer, openModal, closeModal, confirm, Modal, toast as toastFn,
} from '../components.js';

const CSS_HREF = '/ui/css/pages-insights.css';
const LIVE_MS = 8000;
const SEARCH_DEBOUNCE_MS = 400;
const GROUPS = [
  { id: 'project', label: 'Project' },
  { id: 'kind', label: 'Kind' },
  { id: 'agent', label: 'Agent' },
];
const SEVERITY_RANK = { info: 0, ok: 0, warn: 1, fail: 2 };

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

function describeError(err) {
  if (!err) return { title: 'Request failed', body: '' };
  const missing = err.status === 404;
  return {
    title: missing ? 'Activity API is not available yet' : (err.error || 'Request failed'),
    body: [err.why, err.do].filter(Boolean).join(' — '),
  };
}

// ---- module state (one page instance at a time) -----------------------------
let S = null;

function freshState(ctx) {
  const p = ctx.params || {};
  return {
    ctx,
    mount: null,
    kind: p.kind || '',
    group: GROUPS.some((g) => g.id === p.group) ? p.group : 'project',
    q: p.q || '',
    live: false,
    liveTimer: null,
    searchTimer: null,
    inFlight: false,
    cursor: '',
    data: null,
    error: null,
    newIds: new Set(),
    destroyed: false,
  };
}

function currentParams() {
  const p = { group: S.group, limit: 200 };
  if (S.ctx.project && S.ctx.project !== 'all') p.project = S.ctx.project;
  if (S.kind) p.kind = S.kind;
  if (S.q) p.q = S.q;
  return p;
}

function viewParams() {
  const p = { group: S.group };
  if (S.kind) p.kind = S.kind;
  if (S.q) p.q = S.q;
  return p;
}

function allItems(data) {
  const out = [];
  for (const g of (data && data.groups) || []) for (const it of g.items || []) out.push(it);
  return out;
}

function newestTs(data) {
  let best = '';
  for (const it of allItems(data)) if (it.ts && it.ts > best) best = it.ts;
  return best;
}

function prefsOf() {
  return (S.ctx.prefs && typeof S.ctx.prefs === 'object') ? S.ctx.prefs : {};
}

function visibleGroups(data) {
  const prefs = prefsOf();
  const mutedKinds = new Set(prefs.muted_kinds || []);
  const mutedProjects = new Set(prefs.muted_projects || []);
  const noise = prefs.noise || {};
  const minRank = SEVERITY_RANK[noise.min_severity] || 0;
  const out = [];
  for (const g of (data && data.groups) || []) {
    const items = (g.items || []).filter((it) => {
      if (mutedKinds.has(it.kind)) return false;
      if (mutedProjects.has(it.project)) return false;
      return (SEVERITY_RANK[normStatus(it.status)] || 0) >= minRank;
    });
    if (items.length) out.push({ ...g, items });
  }
  return out;
}

// ---- data -------------------------------------------------------------------
async function fetchActivity(extra) {
  return S.ctx.api.get('/api/v2/activity', { ...currentParams(), ...(extra || {}) });
}

async function refresh() {
  if (!S || S.inFlight || S.destroyed) return;
  S.inFlight = true;
  try {
    S.data = await fetchActivity();
    S.error = null;
    S.cursor = newestTs(S.data);
    S.newIds = new Set();
  } catch (err) {
    S.error = err;
  } finally {
    S.inFlight = false;
  }
  draw();
}

// Live tail: ask only for rows newer than the cursor and merge them on top.
async function tailOnce() {
  if (!S || !S.live || S.inFlight || S.destroyed || !S.data) return;
  S.inFlight = true;
  try {
    const fresh = await fetchActivity({ since: S.cursor });
    const known = new Set(allItems(S.data).map((it) => it.id));
    const incoming = allItems(fresh).filter((it) => !known.has(it.id));
    if (incoming.length) {
      const byKey = new Map((S.data.groups || []).map((g) => [g.key, g]));
      for (const g of fresh.groups || []) {
        const add = (g.items || []).filter((it) => !known.has(it.id));
        if (!add.length) continue;
        const into = byKey.get(g.key);
        if (into) {
          into.items = [...add, ...(into.items || [])];
          into.count = (into.count || 0) + add.length;
          into.last = g.last || into.last;
        } else {
          const copy = { ...g, items: add };
          S.data.groups = [copy, ...(S.data.groups || [])];
          byKey.set(g.key, copy);
        }
      }
      for (const it of incoming) S.newIds.add(it.id);
      S.cursor = newestTs(S.data) || S.cursor;
      S.error = null;
      S.inFlight = false;
      draw();
      return;
    }
  } catch (err) {
    S.error = err;
  }
  S.inFlight = false;
}

function setLive(on) {
  S.live = on;
  if (S.liveTimer) { clearInterval(S.liveTimer); S.liveTimer = null; }
  if (on) S.liveTimer = setInterval(tailOnce, LIVE_MS);
  draw();
}

// ---- saved views ------------------------------------------------------------
async function putPrefs(patch) {
  const res = await S.ctx.api.put('/api/v2/prefs', patch);
  const next = res && res.state ? res.state : res;
  if (next && typeof next === 'object' && S.ctx.store) S.ctx.store.set('prefs', next);
  return next;
}

function savedViews() {
  return (prefsOf().saved_views || []).filter((v) => v && v.page === 'activity');
}

function applyView(view) {
  const p = view.params || {};
  S.kind = p.kind || '';
  S.group = GROUPS.some((g) => g.id === p.group) ? p.group : 'project';
  S.q = p.q || '';
  refresh();
}

function openSaveViewModal() {
  const input = h('input', {
    type: 'text', class: 'input', id: 'pg-view-name', maxlength: '60',
    placeholder: 'e.g. Failing hooks this week', 'aria-label': 'View name',
  });
  const errLine = h('p', { class: 'pg-field-error', role: 'alert' }, '');
  const onSave = async () => {
    const name = input.value.trim();
    if (!name) { errLine.textContent = 'Give the view a name.'; input.focus(); return; }
    const all = prefsOf().saved_views || [];
    const view = { id: `v${Date.now().toString(36)}`, name, page: 'activity', params: viewParams() };
    try {
      await putPrefs({ saved_views: [...all, view] });
      closeModal();
      notify(`Saved view “${name}”`, 'ok');
      draw();
    } catch (err) {
      errLine.textContent = describeError(err).body || describeError(err).title;
    }
  };
  const actions = [
    h('button', { type: 'button', class: 'btn', onclick: () => closeModal() }, 'Cancel'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: onSave }, 'Save view'),
  ];
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onSave(); } });
  openModal(Modal({
    title: 'Save current filters as a view',
    children: [
      h('label', { class: 'pg-label', for: 'pg-view-name' }, 'View name'),
      input,
      h('p', { class: 'pg-hint' }, `Saves group by ${S.group}${S.kind ? `, kind ${S.kind}` : ''}${S.q ? `, search “${S.q}”` : ''}.`),
      errLine,
    ],
    actions,
  }));
  setTimeout(() => input.focus(), 0);
}

async function deleteView(view) {
  const ok = await confirm({ title: `Delete view “${view.name}”?`, body: 'Only the saved filter set is removed.', danger: true });
  if (!ok) return;
  try {
    await putPrefs({ saved_views: (prefsOf().saved_views || []).filter((v) => v.id !== view.id) });
    notify('View deleted', 'ok');
    draw();
  } catch (err) {
    notify(describeError(err).title, 'fail');
  }
}

function notify(msg, kind) {
  const t = (S && S.ctx && S.ctx.toast) || toastFn;
  if (typeof t === 'function') t(msg, { kind });
}

// ---- detail drawer ----------------------------------------------------------
function kv(label, value) {
  return h('div', { class: 'pg-kv' },
    h('dt', {}, label),
    h('dd', {}, value === undefined || value === null || value === '' ? '—' : value));
}

function openDetail(item) {
  const ref = item.ref && typeof item.ref === 'object' ? item.ref : {};
  const refRows = Object.keys(ref).map((k) => kv(k, typeof ref[k] === 'object' ? JSON.stringify(ref[k]) : String(ref[k])));
  const body = h('div', { class: 'pg-detail' },
    h('div', { class: 'pg-detail-head' },
      Badge({ status: normStatus(item.status), text: item.status || 'info' }),
      item.count > 1 ? Badge({ status: 'info', text: `×${item.count} duplicates collapsed` }) : null),
    h('p', { class: 'pg-detail-title' }, item.title || '(no title)'),
    item.detail ? h('pre', { class: 'pg-mono-block' }, item.detail) : null,
    h('dl', { class: 'pg-kvs' },
      kv('When', item.ts), kv('Kind', item.kind), kv('Project', item.project), kv('Agent', item.agent),
      ...refRows));
  openDrawer(Drawer({ title: item.title || 'Activity detail', children: [body] }));
}

// ---- rendering --------------------------------------------------------------
function kindOptions() {
  const kinds = new Set();
  for (const it of allItems(S.data)) if (it.kind) kinds.add(it.kind);
  if (S.kind) kinds.add(S.kind);
  return [...kinds].sort();
}

function select(id, label, value, options, onChange) {
  const sel = h('select', { id, class: 'select', onchange: (e) => onChange(e.target.value) },
    ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  return h('div', { class: 'pg-facet' }, h('label', { class: 'pg-label', for: id }, label), sel);
}

function filterRow() {
  const q = h('input', {
    type: 'search', id: 'pg-act-q', class: 'input', value: S.q,
    placeholder: 'Search title or detail', 'aria-label': 'Search activity', 'data-search': 'true',
  });
  q.addEventListener('input', (e) => {
    clearTimeout(S.searchTimer);
    const v = e.target.value;
    S.searchTimer = setTimeout(() => { S.q = v.trim(); refresh(); }, SEARCH_DEBOUNCE_MS);
  });
  return h('div', { class: 'pg-filters', role: 'search' },
    select('pg-act-group', 'Group by', S.group, GROUPS.map((g) => ({ value: g.id, label: g.label })),
      (v) => { S.group = v; refresh(); }),
    select('pg-act-kind', 'Kind', S.kind,
      [{ value: '', label: 'All kinds' }, ...kindOptions().map((k) => ({ value: k, label: k }))],
      (v) => { S.kind = v; refresh(); }),
    h('div', { class: 'pg-facet pg-facet-grow' }, h('label', { class: 'pg-label', for: 'pg-act-q' }, 'Search'), q),
    h('div', { class: 'pg-facet pg-facet-actions' },
      h('button', {
        type: 'button', class: `btn pg-live${S.live ? ' is-on' : ''}`, 'aria-pressed': String(S.live),
        title: 'Poll for new activity every few seconds', onclick: () => setLive(!S.live),
      }, S.live ? '● Live' : '○ Live tail'),
      h('button', { type: 'button', class: 'btn', onclick: refresh }, 'Refresh'),
      h('button', { type: 'button', class: 'btn', onclick: openSaveViewModal }, 'Save view')));
}

function viewsRow() {
  const views = savedViews();
  if (!views.length) return null;
  return h('div', { class: 'pg-views', role: 'group', 'aria-label': 'Saved views' },
    h('span', { class: 'pg-label' }, 'Saved views'),
    ...views.map((v) => h('span', { class: 'pg-chip-wrap' },
      h('button', { type: 'button', class: 'pg-chip', onclick: () => applyView(v) }, v.name),
      h('button', {
        type: 'button', class: 'pg-chip-x', 'aria-label': `Delete view ${v.name}`, title: 'Delete view',
        onclick: () => deleteView(v),
      }, '×'))));
}

function columns() {
  return [
    { key: 'ts', label: 'When', width: '96px', render: (r) => whenNode(r.ts) },
    { key: 'status', label: 'Status', width: '84px', render: (r) => Badge({ status: normStatus(r.status), text: r.status || 'info' }) },
    { key: 'kind', label: 'Kind', width: '120px', render: (r) => h('span', { class: 'pg-mono' }, r.kind || '—') },
    { key: 'title', label: 'Event', render: (r) => h('span', { class: 'pg-evt' },
      h('span', { class: `pg-evt-title${S.newIds.has(r.id) ? ' is-new' : ''}` }, r.title || '(no title)'),
      r.count > 1 ? h('span', { class: 'pg-count', title: `${r.count} identical events collapsed` }, `×${r.count}`) : null,
      S.newIds.has(r.id) ? h('span', { class: 'pg-new' }, 'new') : null) },
    { key: 'agent', label: 'Agent', width: '120px', render: (r) => r.agent || '—' },
    { key: 'project', label: 'Project', width: '140px', render: (r) => projName(r.project) },
    { key: 'open', label: '', width: '72px', render: (r) => h('button', {
      type: 'button', class: 'btn btn-ghost', 'aria-label': `Open details: ${r.title || r.kind}`,
      onclick: (e) => { e.stopPropagation(); openDetail(r); },
    }, 'Details') },
  ];
}

function groupCard(g) {
  const keyLabel = g.label || g.key || '—';
  return h('section', { class: 'pg-group', 'aria-label': `${keyLabel} (${g.count || g.items.length} events)` },
    Card({
      title: keyLabel,
      actions: [
        h('span', { class: 'pg-group-meta' }, `${g.count || g.items.length} events · last ${fmtWhen(g.last)}`),
      ],
      children: [Table({
        columns: columns(), rows: g.items, dense: true, onRow: openDetail,
        empty: h('p', { class: 'pg-hint' }, 'No events in this group.'),
      })],
    }));
}

function body() {
  if (S.error && !S.data) {
    const d = describeError(S.error);
    return EmptyState({
      icon: 'alert', title: d.title, body: d.body || 'The activity endpoint did not answer.',
      actions: [h('button', { type: 'button', class: 'btn btn-primary', onclick: refresh }, 'Retry')],
    });
  }
  if (!S.data) return h('p', { class: 'pg-hint', role: 'status' }, 'Loading activity…');
  const groups = visibleGroups(S.data);
  if (!groups.length) {
    return EmptyState({
      icon: 'inbox', title: 'No activity matches',
      body: 'Clear a filter, widen the search, or check Settings → noise filters if events are being hidden.',
      actions: [h('button', { type: 'button', class: 'btn', onclick: () => { S.kind = ''; S.q = ''; refresh(); } }, 'Clear filters')],
    });
  }
  return h('div', { class: 'pg-groups' }, ...groups.map(groupCard));
}

function draw() {
  if (!S || !S.mount || S.destroyed) return;
  const active = document.activeElement;
  const keepFocusId = active && S.mount.contains(active) ? active.id : '';
  const caret = active && active.id === 'pg-act-q' ? active.selectionStart : null;
  const total = S.data ? visibleGroups(S.data).reduce((n, g) => n + g.items.length, 0) : 0;
  S.mount.replaceChildren(...[
    h('header', { class: 'pg-head' },
      h('h1', { class: 'pg-title' }, 'Activity'),
      h('p', { class: 'pg-sub' }, S.data ? `${total} events shown, grouped by ${S.group}. Identical events are collapsed with a count.` : 'Everything Atlas observed, grouped and de-duplicated.'),
      S.live ? h('span', { class: 'pg-live-flag', role: 'status' }, StatusDot({ status: 'ok' }), ' Live — checking every 8s') : null),
    filterRow(), viewsRow(), body(),
  ].filter(Boolean));
  if (keepFocusId) {
    const el = S.mount.querySelector(`#${keepFocusId}`);
    if (el) { el.focus(); if (caret !== null && el.setSelectionRange) el.setSelectionRange(caret, caret); }
  }
}

export default {
  id: 'activity',
  title: 'Activity',
  icon: 'activity',
  group: 'Observe',
  async load(ctx) {
    ensureCss();
    if (S) this.destroy();
    S = freshState(ctx);
    try {
      S.data = await fetchActivity();
      S.cursor = newestTs(S.data);
    } catch (err) {
      S.error = err;
    }
    return S.data;
  },
  render(ctx) {
    if (!S) S = freshState(ctx);
    S.ctx = ctx;
    S.mount = h('div', { class: 'pg-page pg-activity' });
    draw();
    return S.mount;
  },
  onEvent(evt) {
    if (!S || !S.live || !evt) return;
    if (evt.type === 'tick' || evt === 'tick') tailOnce();
  },
  destroy() {
    if (!S) return;
    S.destroyed = true;
    clearInterval(S.liveTimer);
    clearTimeout(S.searchTimer);
    S = null;
  },
};
