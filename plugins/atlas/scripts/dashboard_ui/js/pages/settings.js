// Atlas Command Center — Settings page: Behavior knobs, Ecosystem toggles,
// connectors, and dashboard preferences (theme, density, noise filters, default
// project, nav order, refresh rate).
// Reuses the existing legacy routes unchanged:
//   GET/POST /api/behavior            {updates:{KEY:value}} (empty value removes the key)
//   GET      /api/ecosystem           plugins[] + mcp.servers[]
//   POST     /api/plugins/toggle      {key,enabled}
//   POST     /api/mcp/toggle          {name,enabled}
//   GET      /api/connectors          connectors[] (secret field values come back
//                                     empty by design — set/missing only, never echoed)
//   POST     /api/connectors/env      {updates:{KEY:value}} credential save, sent
//                                     through api.post so X-Atlas-Token rides along
//   POST     /api/connectors/test     {name}
//   GET      /api/projects            legacy project rows (numeric id) for the Agents editor
//   GET/POST /api/agents              agent override editor (v1 parity)
// and the v2 prefs route GET/PUT /api/v2/prefs.
// No innerHTML; all data via h() text children. Secret inputs are type=password
// and stay empty; a dirty-draft guard warns before reload/close and before
// navigating away from Settings while credential drafts are unsaved.
import { h, replace } from '../dom.js';
import { Badge, Card, EmptyState, StatusDot, confirm } from '../components.js';
import { SettingRow, rowMatches } from '../settings-row.js';

import { DEFAULT_NAV, normalizeNav } from '../nav-order.js';

const NAV_LABELS = {
  overview: 'Overview', activity: 'Activity', health: 'Health', agents: 'Agents', colony: 'Colony', terminal: 'Terminal', channels: 'Channels',
  improve: 'Improve', projects: 'Projects', settings: 'Settings',
};
const DEFAULT_PREFS = {
  theme: 'dark', density: 'comfortable', default_project: 'all', refresh_seconds: 8,
  nav_order: DEFAULT_NAV, noise: { collapse_duplicates: true, min_severity: 'info' },
};

function describeError(err) {
  if (!err) return { title: 'Request failed', body: '' };
  return {
    title: err.status === 404 ? 'Endpoint not available' : (err.error || err.message || 'Request failed'),
    body: [err.why, err.do, err.hint].filter(Boolean).join(' — '),
  };
}

let S = null;

// Five tabs, one visible at a time. ?tab= picks it; a legacy ?cat= maps to the nearest tab; else Dashboard.
// A non-empty filter overrides and stacks every tab that has a match.
const TABS = [
  { id: 'dashboard', label: 'Dashboard' }, { id: 'behavior', label: 'Behavior' }, { id: 'models', label: 'Models' },
  { id: 'integrations', label: 'Integrations' }, { id: 'agents', label: 'Agents' },
];
const LEGACY_CAT = {
  preferences: 'dashboard', 'session-automation': 'behavior', guardrails: 'behavior', colony: 'behavior', advanced: 'behavior',
  'prompt-optimizer': 'models', 'decision-model': 'models', scoring: 'models',
  ecosystem: 'integrations', connectors: 'integrations', integrations: 'integrations', agents: 'agents',
};
const BEHAVIOR_GROUPS = ['Session automation', 'Guardrails', 'Colony', 'omp extension'];
const MODEL_GROUPS = ['Prompt optimizer', 'Decision model', 'Turn scoring'];
const tabOf = (title) => (MODEL_GROUPS.includes(title) ? 'models' : 'behavior');

function initialTab() {
  // The canonical link is #/settings?tab=x; ?tab=x#/settings still works as a fallback.
  const loc = globalThis.location || {};
  let q = null;
  let qh = null;
  try { q = new URLSearchParams(loc.search || ''); qh = new URLSearchParams(String(loc.hash || '').split('?')[1] || ''); } catch { /* no location */ }
  const pick = (k) => (qh && qh.get(k)) || (q && q.get(k));
  const tab = pick('tab');
  if (TABS.some((t) => t.id === tab)) return tab;
  const cat = pick('cat');
  return (cat && LEGACY_CAT[String(cat).toLowerCase().replace(/[^a-z0-9]+/g, '-')]) || 'dashboard';
}

function freshState(ctx) {
  return {
    ctx, mount: null, destroyed: false, busy: new Set(), drafts: {}, tests: {}, query: '', tab: initialTab(), entries: null, ui: null,
    behavior: null, ecosystem: null, connectors: null, prefs: null, projects: [],
    credDrafts: {}, projectList: null, agentPid: null, agents: null,
    ecoTab: 'plugins', ecoQuery: '', ecoLimit: ECO_PAGE,
    agentName: null, agentBody: '', agentNote: '',
    errors: {}, note: '',
  };
}

function notify(msg, kind) {
  if (S && S.ctx && typeof S.ctx.toast === 'function') S.ctx.toast(msg, { kind });
}

// The page scrolls inside <main id="main">; the document itself never scrolls.
const scroller = () => (S && S.mount && S.mount.closest('#main')) || document.getElementById('main');

// Inline "Saved" / error line that sits next to a control. Saved clears itself; an error stays until the next save.
function savedTag(id) {
  return h('span', { class: 'pg-saved', role: 'status', ...(id ? { id } : {}) });
}

const flashTimers = new WeakMap();
function flash(host, text, kind = 'ok') {
  const el = typeof host === 'string' ? document.getElementById(host)
    : host && (host.classList.contains('pg-saved') ? host : host.querySelector('.pg-saved'));
  if (!el) return;
  clearTimeout(flashTimers.get(el));
  el.textContent = text;
  el.className = `pg-saved is-${kind}`;
  if (kind === 'ok') flashTimers.set(el, setTimeout(() => { el.textContent = ''; el.className = 'pg-saved'; }, 4000));
}

// Replace one element in place, keeping which <details> were open and where focus and the caret were.
function focusRestored(next, keepId, caret) {
  const el = keepId && next.querySelector(`#${CSS.escape(keepId)}`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (caret && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(caret[0], caret[1]); } catch { /* no caret on this input type */ } }
}

function swapEl(old, make) {
  const next = make();
  if (!old || !old.isConnected) return next;
  const open = [...old.querySelectorAll('details')].map((d) => d.open);
  const active = document.activeElement;
  const keepId = active && old.contains(active) ? active.id : '';
  const caret = keepId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  old.replaceWith(next);
  next.querySelectorAll('details').forEach((d, i) => { if (open[i]) d.open = true; });
  focusRestored(next, keepId, caret);
  return next;
}

// Legacy routes answer `{ok:false,error,hint}` with HTTP 200, so check `ok` too.
async function legacyPost(path, body) {
  const res = await S.ctx.api.post(path, body);
  if (res && res.ok === false) throw Object.assign(new Error(res.error || 'request_failed'), res);
  return res;
}

const SECTION_TIMEOUT_MS = 15000;

// A section that never answers becomes an honest error (with Retry), never an endless skeleton.
async function loadSection(name, fn) {
  let timer;
  try {
    const slow = new Promise((_, reject) => {
      timer = setTimeout(() => reject({ error: 'timed_out', why: `${name} did not answer within ${SECTION_TIMEOUT_MS / 1000}s.` }), SECTION_TIMEOUT_MS);
    });
    S[name] = await Promise.race([fn(), slow]);
    delete S.errors[name];
  } catch (err) {
    S.errors[name] = err;
  } finally {
    clearTimeout(timer);
  }
}

async function loadAll() {
  const api = S.ctx.api;
  await Promise.all([
    loadSection('behavior', () => api.get('/api/behavior')),
    loadSection('ecosystem', () => api.get('/api/ecosystem')),
    loadSection('connectors', () => api.get('/api/connectors')),
    loadSection('prefs', async () => {
      const r = await api.get('/api/v2/prefs');
      return r && r.state ? r.state : r;
    }),
    loadSection('projectsRes', () => api.get('/api/v2/projects')),
    loadSection('projectList', () => api.get('/api/projects?editable=1')),
  ]);
  S.projects = (S.projectsRes && S.projectsRes.projects) || [];
  S.entries = null;
  await bootstrapAgents();
}

// ---- Agents editor (v1 parity: overrides live in <project>/.claude/agents) ---
// The legacy agent routes want the numeric projects.id, not the v2 root path.
function legacyProjects() {
  return (S.projectList && S.projectList.projects) || [];
}

function agentRoster() {
  return (S.agents && S.agents.agents) || [];
}

async function loadAgentBody(name) {
  if (!S.agentPid || !name) { S.agentName = null; S.agentBody = ''; return; }
  try {
    const d = await S.ctx.api.get(`/api/agents/${encodeURIComponent(name)}?project_id=${encodeURIComponent(S.agentPid)}`);
    S.agentName = name;
    S.agentBody = d.content || '';
    delete S.errors.agentBody;
  } catch (err) {
    S.agentName = name;
    S.agentBody = '';
    S.errors.agentBody = err;
  }
}

async function loadAgentRoster() {
  if (!S.agentPid) {
    await loadSection('agents', () => S.ctx.api.get('/api/agents'));
    S.agentName = null; S.agentBody = '';
    return;
  }
  await loadSection('agents', () => S.ctx.api.get(`/api/agents?project_id=${encodeURIComponent(S.agentPid)}`));
  const roster = agentRoster();
  const keep = roster.some((a) => a.name === S.agentName) ? S.agentName : (roster[0] && roster[0].name) || null;
  await loadAgentBody(keep);
}

// "All projects" is not a project, so default to the most recently active real
// one (the list is recency-ordered and already free of fixtures and missing dirs).
async function bootstrapAgents() {
  const list = legacyProjects();
  const match = list.find((p) => String(p.root_path) === String(S.ctx.project)) || list[0];
  S.agentPid = match ? match.id : null;
  await loadAgentRoster();
}

async function pickAgentProject(pid) {
  S.agentPid = pid || null;
  S.agentNote = '';
  S.agentName = null;
  await loadAgentRoster();
  draw();
}

async function pickAgent(name) {
  S.agentNote = '';
  await loadAgentBody(name);
  draw();
}

async function agentAction(action) {
  if (S.busy.has('agents') || !S.agentPid || !S.agentName) return;
  S.busy.add('agents');
  draw();
  const name = S.agentName;
  try {
    const res = await legacyPost('/api/agents', {
      project_id: S.agentPid, action, name, ...(action === 'save' ? { content: S.agentBody } : {}),
    });
    S.agentNote = res.note || (action === 'save' ? 'Override saved.' : 'Override removed.');
    await loadAgentRoster();
    notify(`${name}: ${S.agentNote}`, 'ok');
  } catch (err) {
    const d = describeError(err);
    S.agentNote = [d.title, d.body].filter(Boolean).join(' — ');
    notify(`Could not ${action} ${name}: ${S.agentNote}`, 'fail');
  }
  S.busy.delete('agents');
  draw();
}

function prefs() {
  const base = (S.prefs && typeof S.prefs === 'object') ? S.prefs : (S.ctx.prefs || {});
  return {
    ...DEFAULT_PREFS, ...base,
    noise: { ...DEFAULT_PREFS.noise, ...(base.noise || {}) },
    nav_order: normalizeNav(base.nav_order),
  };
}

// Saves one preference and reports inline next to the control (statusId); nothing else on the page is rebuilt.
async function savePrefs(patch, statusId) {
  const key = 'prefs';
  if (S.busy.has(key)) return false;
  S.busy.add(key);
  let ok = false;
  try {
    const res = await S.ctx.api.put('/api/v2/prefs', patch);
    const next = res && res.state ? res.state : res;
    if (next && typeof next === 'object') {
      S.prefs = next;
      S.ctx.prefs = next;
      if (S.ctx.store) S.ctx.store.set('prefs', next);
    }
    delete S.errors.prefsSave;
    flash(statusId, 'Saved');
    ok = true;
  } catch (err) {
    S.errors.prefsSave = err;
    const d = describeError(err);
    flash(statusId, `Not saved: ${[d.title, d.body].filter(Boolean).join(' — ')}`, 'fail');
  }
  S.busy.delete(key);
  return ok;
}

// ---- small form helpers -----------------------------------------------------
function selectEl(id, value, options, onChange, describedBy) {
  const props = { id, class: 'select', onchange: (e) => onChange(e.target.value) };
  if (describedBy) props['aria-describedby'] = describedBy;
  return h('select', props,
    ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
}

function switchEl(id, on, label, onToggle, disabled) {
  return h('button', {
    type: 'button', id, role: 'switch', class: `pg-switch${on ? ' is-on' : ''}`,
    'aria-checked': String(!!on), 'aria-label': label, disabled: !!disabled,
    onclick: () => onToggle(!on),
  }, h('span', { class: 'pg-switch-knob', 'aria-hidden': 'true' }), h('span', { class: 'pg-switch-text' }, on ? 'On' : 'Off'));
}

function sectionError(name, what) {
  const err = S.errors[name];
  if (!err) return null;
  const d = describeError(err);
  return EmptyState({
    icon: 'alert', title: `${what} unavailable: ${d.title}`, body: d.body || 'The route did not answer.',
    actions: [h('button', { type: 'button', class: 'btn', onclick: reloadAll }, 'Retry')],
  });
}

async function reloadAll() {
  if (!S || S.destroyed) return;
  await loadAll();
  draw();
}

// ---- Behavior knobs ---------------------------------------------------------


// Filtering only toggles `hidden` on existing rows: no rebuild, so typing never loses focus or scroll.
// ---- Ecosystem toggles ------------------------------------------------------
// Rebuild one inventory row from fresh data (the current tab only shows one list, so the row is looked up by key).
function redrawEcoRow(kind, id, msg, tone) {
  const key = `eco:${kind}:${id}`;
  const old = [...S.mount.querySelectorAll('li[data-eco]')].find((li) => li.dataset.eco === key);
  if (!old) return;
  const list = kind === 'plugin' ? (S.ecosystem.plugins || []) : ((S.ecosystem.mcp && S.ecosystem.mcp.servers) || []);
  const item = list.find((x) => (kind === 'plugin' ? x.key : x.name) === id);
  if (!item) return;
  const next = swapEl(old, () => (kind === 'plugin' ? pluginRow(item) : mcpRow(item)));
  if (msg) flash(next, msg, tone);
}

async function toggleEco(kind, id, enabled) {
  const key = `eco:${kind}:${id}`;
  if (S.busy.has(key)) return;
  S.busy.add(key);
  redrawEcoRow(kind, id);
  try {
    if (kind === 'plugin') await legacyPost('/api/plugins/toggle', { key: id, enabled });
    else await legacyPost('/api/mcp/toggle', { name: id, enabled });
    await loadSection('ecosystem', () => S.ctx.api.get('/api/ecosystem'));
    S.busy.delete(key);
    redrawEcoRow(kind, id, `${enabled ? 'Enabled' : 'Disabled'}. Restart Claude Code to apply.`);
  } catch (err) {
    const d = describeError(err);
    S.busy.delete(key);
    redrawEcoRow(kind, id, `Not changed: ${[d.title, d.body].filter(Boolean).join(' — ')}`, 'fail');
  }
}

function pluginRow(p) {
  const key = `eco:plugin:${p.key}`;
  const host = String(p.key).startsWith('atlas@');
  return h('li', { class: 'pg-row', dataset: { eco: key } },
    h('div', { class: 'pg-row-main' },
      h('span', { class: 'pg-row-title' }, p.name || p.key, ' ', h('span', { class: 'pg-mono pg-hint' }, p.version || '')),
      h('p', { class: 'pg-hint' }, p.description || ''),
      h('p', { class: 'pg-mono pg-hint' }, `${p.key} · ${p.skills || 0} skills · ${p.agents || 0} agents · ${(p.mcp_servers || []).length} MCP`),
      savedTag()),
    h('div', { class: 'pg-row-ctl' },
      host
        ? Badge({ status: 'info', text: 'host plugin' })
        : switchEl(`pg-plugin-${p.key}`, p.enabled, `Enable plugin ${p.name || p.key}`,
          (next) => toggleEco('plugin', p.key, next), S.busy.has(key) || !p.installed)));
}

function mcpRow(m) {
  const key = `eco:mcp:${m.name}`;
  return h('li', { class: 'pg-row', dataset: { eco: key } },
    h('div', { class: 'pg-row-main' },
      h('span', { class: 'pg-row-title pg-mono' }, m.name),
      h('p', { class: 'pg-mono pg-hint' }, `${m.origin}${m.origin_detail ? ` · ${m.origin_detail}` : ''} · ${m.transport}`),
      savedTag()),
    h('div', { class: 'pg-row-ctl' },
      switchEl(`pg-mcp-${m.name}`, m.enabled, `Enable MCP server ${m.name}`,
        (next) => toggleEco('mcp', m.name, next), S.busy.has(key) || (m.origin === 'plugin' && m.plugin_enabled === false))));
}

const ECO_PAGE = 100;

// A read-only name row for inventory items that have no toggle.
function nameRow(title, detail, badge) {
  return h('li', { class: 'pg-row' },
    h('div', { class: 'pg-row-main' },
      h('span', { class: 'pg-row-title pg-mono' }, title),
      detail ? h('p', { class: 'pg-mono pg-hint' }, detail) : null),
    badge ? h('div', { class: 'pg-row-ctl' }, badge) : null);
}

function bindingRow(b) {
  return nameRow(`${b.event}${b.matcher && b.matcher !== '*' ? ` [${b.matcher}]` : ''}`,
    `${b.script}${b.timeout ? ` · timeout ${b.timeout}s` : ''}`,
    Badge({ status: b.present ? 'ok' : 'fail', text: b.present ? 'wired' : 'script missing' }));
}

// tab id -> { label, items, row, text } ; text is what the search box matches.
function ecoTabs() {
  const e = S.ecosystem;
  const atlas = e.atlas || {};
  const user = e.user || {};
  const names = (list, owner) => (list || []).map((n) => ({ n, owner }));
  const plain = (it) => nameRow(it.n, it.owner);
  return [
    { id: 'plugins', label: 'Plugins', items: e.plugins || [], row: pluginRow, text: (p) => `${p.key} ${p.name} ${p.description}` },
    { id: 'mcp', label: 'MCP servers', items: (e.mcp && e.mcp.servers) || [], row: mcpRow, text: (m) => `${m.name} ${m.origin} ${m.origin_detail || ''}` },
    { id: 'skills', label: 'Atlas skills', items: names(atlas.skills, 'atlas plugin'), row: plain, text: (x) => x.n },
    { id: 'agents', label: 'Atlas agents', items: names(atlas.agents, 'atlas plugin'), row: plain, text: (x) => x.n },
    { id: 'styles', label: 'Output styles', items: names(atlas.output_styles, 'atlas plugin'), row: (x) => nameRow(x.n, x.owner,
      x.n === (atlas.output_style || user.active_output_style) ? Badge({ status: 'ok', text: 'active' }) : null), text: (x) => x.n },
    { id: 'bindings', label: 'Hook wirings', items: atlas.bindings || [], row: bindingRow, text: (b) => `${b.event} ${b.matcher} ${b.script}`,
      flag: (atlas.bindings || []).filter((b) => !b.present).length },
    { id: 'uskills', label: 'User skills', items: names(user.skills, '~/.claude/skills'), row: plain, text: (x) => x.n },
    { id: 'uagents', label: 'User agents', items: names(user.agents, '~/.claude/agents'), row: plain, text: (x) => x.n },
    { id: 'uhooks', label: 'User hook events', items: names(user.hook_events, '~/.claude/settings.json hooks'), row: plain, text: (x) => x.n },
  ];
}

// Search and tab changes rebuild only the Ecosystem card (focus and caret kept), never the whole page.
function setEco(patch) {
  Object.assign(S, patch);
  const old = document.getElementById('pg-sec-ecosystem');
  if (old) swapEl(old, ecosystemSection);
}

function ecosystemSection() {
  const err = sectionError('ecosystem', 'Ecosystem');
  if (err) return Card({ id: 'pg-sec-ecosystem', title: 'Ecosystem', children: [err] });
  if (!S.ecosystem) return Card({ id: 'pg-sec-ecosystem', title: 'Ecosystem', children: [h('p', { class: 'pg-hint', role: 'status' }, 'Loading…')] });
  const atlas = S.ecosystem.atlas || {};
  const tabs = ecoTabs();
  const tab = tabs.find((t) => t.id === S.ecoTab) || tabs[0];
  const q = S.ecoQuery.trim().toLowerCase();
  const matched = q ? tab.items.filter((it) => tab.text(it).toLowerCase().includes(q)) : tab.items;
  const shown = matched.slice(0, S.ecoLimit);
  const style = atlas.output_style || (S.ecosystem.user || {}).active_output_style || 'default';
  const search = h('input', {
    id: 'pg-eco-search', class: 'input', type: 'search', value: S.ecoQuery, placeholder: `Search ${tab.label.toLowerCase()}`,
    'aria-label': `Search ${tab.label}`,
  });
  search.addEventListener('input', (ev) => { setEco({ ecoQuery: ev.target.value, ecoLimit: ECO_PAGE }); });
  return Card({
    id: 'pg-sec-ecosystem',
    title: 'Ecosystem',
    children: [
      h('p', { class: 'pg-hint' }, "What Claude Code has installed that atlas can see. Plugin and MCP switches edit Claude Code's settings.json. Claude Code reads them when it starts. Every other tab is a read-only list of what atlas ships or what you have in ~/.claude."),
      atlas.hooks_disabled_globally
        ? h('p', { class: 'pg-banner is-warn', role: 'alert' }, 'Hooks are disabled globally (disableAllHooks) — Atlas hooks will not run.')
        : null,
      h('p', { class: 'pg-hint' }, `Active output style: ${style}. Atlas plugin ${atlas.plugin_enabled ? 'enabled' : 'not enabled'} at ${atlas.plugin_root || 'unknown path'}.`),
      h('div', { class: 'pg-tabs', role: 'tablist', 'aria-label': 'Ecosystem inventory' },
        ...tabs.map((t) => h('button', {
          type: 'button', role: 'tab', id: `pg-eco-tab-${t.id}`, class: `pg-tab${t.id === tab.id ? ' is-active' : ''}`,
          'aria-selected': String(t.id === tab.id), onclick: () => setEco({ ecoTab: t.id, ecoQuery: '', ecoLimit: ECO_PAGE }),
        }, `${t.label} (${t.items.length})`, t.flag ? ` · ${t.flag} missing` : ''))),
      h('div', { class: 'pg-field' }, search),
      h('div', { role: 'tabpanel', 'aria-labelledby': `pg-eco-tab-${tab.id}` },
        shown.length
          ? h('ul', { class: 'pg-rows' }, ...shown.map(tab.row))
          : h('p', { class: 'pg-hint' }, q ? `Nothing in ${tab.label.toLowerCase()} matches “${S.ecoQuery}”.` : `No ${tab.label.toLowerCase()} found.`),
        matched.length > shown.length
          ? h('p', { class: 'pg-hint' }, `Showing ${shown.length} of ${matched.length}. `,
            h('button', { type: 'button', class: 'btn', onclick: () => setEco({ ecoLimit: S.ecoLimit + ECO_PAGE }) }, 'Show more'))
          : null),
    ],
  });
}

// ---- Connectors -------------------------------------------------------------
async function testConnector(c) {
  const key = `test:${c.name}`;
  if (S.busy.has(key)) return;
  S.busy.add(key);
  delete S.tests[c.name];
  redrawConnector(c.name);
  try {
    const res = await S.ctx.api.post('/api/connectors/test', { name: c.name });
    S.tests[c.name] = res;
  } catch (err) {
    S.tests[c.name] = { ok: false, error: describeError(err).title, hint: describeError(err).body };
  }
  S.busy.delete(key);
  redrawConnector(c.name);
}

async function toggleConnector(c, enabled) {
  const key = `eco:mcp:${c.server_name}`;
  if (S.busy.has(key)) return;
  S.busy.add(key);
  redrawConnector(c.name);
  try {
    await legacyPost('/api/mcp/toggle', { name: c.server_name, enabled });
    await loadSection('connectors', () => S.ctx.api.get('/api/connectors'));
    S.busy.delete(key);
    redrawConnector(c.name, `${enabled ? 'Enabled' : 'Disabled'}. Restart Claude Code to apply.`);
  } catch (err) {
    const d = describeError(err);
    S.busy.delete(key);
    redrawConnector(c.name, `Not changed: ${[d.title, d.body].filter(Boolean).join(' — ')}`, 'fail');
  }
}

// ---- Connector credentials --------------------------------------------------
// Saved secrets are never read back: the API returns an empty `value` for
// sensitive keys and the form only reports set/missing. A draft exists only for
// keys the user actually changed, and only those keys are sent.
function credKey(f) {
  return (f && (f.user_config_key || f.env_key)) || '';
}

function credDirty() {
  return !!S && Object.keys(S.credDrafts).length > 0;
}

function connectorDirty(c) {
  return (c.fields || []).some((f) => S.credDrafts[credKey(f)] !== undefined);
}

// Dirty-draft guard: reload/close always prompts while drafts exist; a click on a
// sidebar link to another page asks first. Wired on the first draft, removed when
// the last one is saved/reverted or the page is destroyed.
let guardWired = false;

function credGuard(e) {
  if (!S || S.destroyed || !credDirty()) return;
  if (e.type === 'beforeunload') {
    e.preventDefault();
    e.returnValue = '';
    return;
  }
  const a = e.target && e.target.closest ? e.target.closest('a[href^="#/"]') : null;
  if (!a || a.dataset.page === 'settings') return;
  if (!window.confirm('Unsaved credential edits on Settings will be lost. Leave this page anyway?')) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function wireGuard() {
  if (guardWired) return;
  guardWired = true;
  window.addEventListener('beforeunload', credGuard);
  document.addEventListener('click', credGuard, true);
}

function unwireGuard() {
  if (!guardWired) return;
  guardWired = false;
  window.removeEventListener('beforeunload', credGuard);
  document.removeEventListener('click', credGuard, true);
}

// Reflect draft state without a redraw (a redraw per keystroke would steal focus):
// the page banner, plus each connector's Save/Revert enablement and edited badge.
function syncGuard() {
  if (credDirty()) wireGuard();
  else unwireGuard();
  if (!S || !S.mount) return;
  const banner = S.mount.querySelector('#pg-cred-dirty');
  if (banner) banner.hidden = !credDirty();
  const list = (S.connectors && S.connectors.connectors) || [];
  for (const c of list) {
    const row = S.mount.querySelector(`li.pg-cred-row[data-connector="${CSS.escape ? CSS.escape(c.name) : c.name}"]`);
    if (!row) continue;
    const dirty = connectorDirty(c);
    const busy = S.busy.has(`cred:${c.name}`);
    const edited = row.querySelector('.pg-cred-edited');
    if (edited) edited.hidden = !dirty;
    for (const b of row.querySelectorAll('button[data-cred-action]')) b.disabled = busy || !dirty;
  }
}

function updateCredDraft(key, input, baseline) {
  if (input.value === baseline) delete S.credDrafts[key];
  else S.credDrafts[key] = input.value;
  syncGuard();
}

function revertCreds(c) {
  for (const f of c.fields || []) delete S.credDrafts[credKey(f)];
  syncGuard();
  redrawConnector(c.name);
}

async function saveCreds(c) {
  const busyKey = `cred:${c.name}`;
  if (S.busy.has(busyKey)) return;
  const updates = {};
  for (const f of c.fields || []) {
    const k = credKey(f);
    if (k && S.credDrafts[k] !== undefined) updates[k] = S.credDrafts[k];
  }
  if (!Object.keys(updates).length) {
    notify(`Nothing changed for ${c.name}.`, 'info');
    return;
  }
  S.busy.add(busyKey);
  redrawConnector(c.name);
  try {
    const res = await legacyPost('/api/connectors/env', { updates });
    for (const k of Object.keys(updates)) delete S.credDrafts[k];
    await loadSection('connectors', () => S.ctx.api.get('/api/connectors'));
    const saved = [...new Set([...(res.updated_user_config_keys || []), ...(res.updated_env_keys || [])])];
    S.busy.delete(busyKey);
    redrawConnector(c.name, `Saved ${saved.join(', ') || Object.keys(updates).join(', ')}. Restart Claude Code so the server re-reads credentials.`);
  } catch (err) {
    const d = describeError(err);
    S.busy.delete(busyKey);
    redrawConnector(c.name, `Not saved: ${[d.title, d.body].filter(Boolean).join(' — ')}`, 'fail');
  }
}

function credFieldRow(c, f) {
  const key = credKey(f);
  if (!key) return null;
  const id = `pg-cred-${`${c.name}-${key}`.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const baseline = String(f.value || '');
  const draft = S.credDrafts[key];
  const set = !!f.is_set;
  // Booleans (type 'bool') toggle between "true" and "false" in the same draft a text input would write.
  const cur = draft !== undefined ? draft : baseline;
  const control = f.type === 'bool' ? switchEl(id, cur !== 'false', `${c.name} ${f.title || key}`, (on) => {
    if (String(on) === baseline) delete S.credDrafts[key]; else S.credDrafts[key] = String(on);
    redrawConnector(c.name);
  }) : null;
  const input = control || h('input', {
    id, class: 'input', type: f.sensitive ? 'password' : 'text',
    value: draft !== undefined ? draft : baseline,
    placeholder: f.sensitive ? (set ? 'set — type to replace' : 'enter secret') : (set ? '' : 'not set'),
    autocomplete: f.sensitive ? 'new-password' : 'off', spellcheck: 'false',
    'aria-label': `${c.name} ${f.title || key}`,
  });
  if (!control) input.addEventListener('input', () => updateCredDraft(key, input, baseline));
  return h('div', { class: 'pg-field' },
    h('label', { class: 'pg-label pg-cred-label', for: id },
      h('span', { class: 'pg-mono' }, key),
      Badge({ status: set ? 'ok' : 'warn', text: set ? 'set' : 'missing' }),
      f.source && f.source !== 'missing' ? h('span', { class: 'pg-hint' }, `· ${f.source}`) : null),
    f.description ? h('p', { class: 'pg-hint' }, f.description) : null,
    input);
}

function testLine(t) {
  if (!t) return null;
  const text = t.ok
    ? `Handshake ok${t.tool_count !== undefined ? ` — ${t.tool_count} tools` : ''}${t.elapsed_ms !== undefined ? ` in ${t.elapsed_ms}ms` : ''}.${t.note ? ` ${t.note}` : ''}`
    : `Test failed: ${t.error || 'unknown'}${t.hint ? ` — ${t.hint}` : ''}`;
  return h('p', { class: `pg-test is-${t.ok ? 'ok' : 'fail'}`, role: 'status' }, text);
}

const HEALTH_VIEW = {
  ok: ['ok', 'healthy'], idle: ['info', 'configured, unused'], degraded: ['fail', 'degraded'],
  unconfigured: ['warn', 'needs credentials'], disabled: ['idle', 'disabled'],
};

function usageLine(c) {
  const u = c.usage || {};
  if (!u.calls_total) return h('p', { class: 'pg-hint' }, 'Never called in recorded sessions.');
  const rate = u.calls ? `${Math.round((u.error_rate || 0) * 100)}% errors` : 'no calls in window';
  return h('p', { class: 'pg-hint pg-mono' },
    `${u.calls} ${u.calls === 1 ? 'call' : 'calls'} in ${u.window_days}d (${u.errors} failed, ${rate}) · ${u.calls_total} total · last used ${u.last_used ? ago(u.last_used) : 'unknown'}`);
}

function connectorRow(c) {
  const [hs, hl] = HEALTH_VIEW[c.health] || ['idle', c.health || 'unknown'];
  const status = !c.bundle_exists ? 'fail' : hs;
  const label = !c.bundle_exists ? 'bundle missing' : hl;
  const fields = (c.fields || []).map((f) => credFieldRow(c, f)).filter(Boolean);
  const dirty = connectorDirty(c);
  const saving = S.busy.has(`cred:${c.name}`);
  const testing = S.busy.has(`test:${c.name}`);
  return h('li', { class: 'pg-row pg-cred-row', dataset: { connector: c.name } },
    h('div', { class: 'pg-row-main' },
      h('span', { class: 'pg-row-title' }, StatusDot({ status }), ' ', c.name, ' ', Badge({ status, text: label }),
        h('span', { class: 'pg-cred-edited', hidden: !dirty }, Badge({ status: 'info', text: 'unsaved edits' }))),
      usageLine(c),
      (c.missing_required || []).length
        ? h('p', { class: 'pg-hint' }, `Missing: ${c.missing_required.join(', ')}.`)
        : null,
      testLine(S.tests[c.name]),
      savedTag()),
    h('div', { class: 'pg-row-ctl' },
      h('button', {
        type: 'button', class: 'btn', disabled: testing, 'aria-label': `Test connector ${c.name}`,
        onclick: () => testConnector(c),
      }, testing ? 'Testing…' : 'Test'),
      h('button', {
        type: 'button', class: 'btn btn-primary', disabled: saving || !dirty, 'aria-label': `Save credentials for ${c.name}`,
        dataset: { credAction: 'save' }, onclick: () => saveCreds(c),
      }, saving ? 'Saving…' : 'Save'),
      h('button', {
        type: 'button', class: 'btn btn-ghost', disabled: saving || !dirty, 'aria-label': `Discard unsaved edits for ${c.name}`,
        dataset: { credAction: 'revert' }, onclick: () => revertCreds(c),
      }, 'Revert'),
      switchEl(`pg-conn-${c.name}`, c.enabled, `Enable connector ${c.name}`,
        (next) => toggleConnector(c, next), S.busy.has(`eco:mcp:${c.server_name}`))),
    fields.length
      ? h('div', { class: 'pg-cred-fields', role: 'group', 'aria-label': `${c.name} credentials` }, ...fields)
      : h('p', { class: 'pg-hint pg-cred-none' }, 'No credential fields declared for this connector.'));
}

function connectorsTitle(list) {
  const ready = list.filter((c) => c.configured_hint).length;
  const degraded = list.filter((c) => c.health === 'degraded').length;
  return `Connectors (${ready}/${list.length} configured${degraded ? `, ${degraded} degraded` : ''})`;
}

// Rebuild one connector row (and the card's count) from state, leaving the rest of the page untouched.
function redrawConnector(name, msg, kind) {
  const list = (S.connectors && S.connectors.connectors) || [];
  const c = list.find((x) => x.name === name);
  const old = [...S.mount.querySelectorAll('li.pg-cred-row[data-connector]')].find((li) => li.dataset.connector === name);
  if (!c || !old) return;
  const next = swapEl(old, () => connectorRow(c));
  const head = S.mount.querySelector('#pg-sec-connectors h2');
  if (head) head.textContent = connectorsTitle(list);
  if (msg) flash(next, msg, kind);
  syncGuard();
}

function connectorsSection() {
  const err = sectionError('connectors', 'Connectors');
  if (err) return Card({ id: 'pg-sec-connectors', title: 'Connectors', children: [err] });
  if (!S.connectors) return Card({ id: 'pg-sec-connectors', title: 'Connectors', children: [h('p', { class: 'pg-hint', role: 'status' }, 'Loading…')] });
  const list = S.connectors.connectors || [];
  return Card({
    id: 'pg-sec-connectors',
    title: connectorsTitle(list),
    actions: [h('span', { class: 'pg-hint' }, S.connectors.settings_path || '')],
    children: [
      h('p', { class: 'pg-banner is-warn', id: 'pg-cred-dirty', role: 'status', hidden: !credDirty() },
        'Unsaved credential edits. Save or Revert each connector before leaving; the browser will also ask before reload or close.'),
      h('p', { class: 'pg-hint' }, 'Vendor connectors atlas ships as MCP servers (CrowdStrike, NinjaOne, Vanta, …). Each needs its own credentials before Claude Code can use it. Saved credentials are never shown or read back — a field only reports set or missing, and typing a new value replaces it. Only fields you changed are sent. Test starts the connector and completes an MCP handshake; it proves the bundle runs, not that vendor credentials are accepted — use the connector’s own status tool for that. Enabling or disabling a connector, or saving credentials, takes effect when Claude Code restarts.'),
      list.length ? h('ul', { class: 'pg-rows' }, ...list.map(connectorRow)) : h('p', { class: 'pg-hint' }, 'No connectors declared.'),
    ],
  });
}

function ago(epochS) {
  const s = Math.max(0, Date.now() / 1000 - Number(epochS));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// ---- Agents editor ----------------------------------------------------------
function agentsSection() {
  const err = sectionError('agents', 'Agents');
  if (err) return Card({ id: 'pg-sec-agents', title: 'Agents', children: [err] });
  const projects = legacyProjects();
  const roster = agentRoster();
  const rosterTable = roster.length
    ? h('div', { class: 'pg-table-wrap' }, h('table', { class: 'pg-table', 'aria-label': 'Agent roster' },
      h('thead', {}, h('tr', {},
        ...['Agent', 'Model', 'Effort', 'omp chain', 'Dispatched 7d', 'Total', 'Last used'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, ...roster.map((a) => {
        const d = a.dispatches || {};
        return h('tr', { class: a.name === S.agentName ? 'is-selected' : '' },
          h('th', { scope: 'row', class: 'pg-mono' }, a.name, a.overridden ? ' ' : '', a.overridden ? Badge({ status: 'info', text: 'overridden' }) : null),
          h('td', { class: 'pg-mono' }, a.model || '—'),
          h('td', { class: 'pg-mono' }, a.effort || (a.omp && a.omp.effort) || '—'),
          h('td', { class: 'pg-mono' }, a.omp && a.omp.model_chain.length ? a.omp.model_chain.join(' → ') : 'not generated'),
          h('td', {}, String(d.last7d || 0)),
          h('td', {}, String(d.total || 0)),
          h('td', { title: d.last_used ? new Date(d.last_used * 1000).toISOString() : '' }, d.last_used ? ago(d.last_used) : 'never'));
      }))))
    : null;
  if (S.errors.projectList) {
    // A failed or slow /api/projects fetch is not "no projects"; say so and offer Retry.
    return Card({ id: 'pg-sec-agents', title: 'Agents', children: [sectionError('projectList', 'Project list'), rosterTable] });
  }
  if (!projects.length) {
    return Card({ id: 'pg-sec-agents', title: 'Agents', children: [
      h('p', { class: 'pg-hint' }, 'No registered projects yet, so overrides cannot be edited. The plugin’s own agents are listed below; run Claude Code or omp in a project to register it.'),
      rosterTable] });
  }
  const entry = roster.find((a) => a.name === S.agentName);
  const busy = S.busy.has('agents');
  const source = !entry ? '—' : entry.overridden ? 'overridden (project)' : entry.source === 'override' ? 'override (project-only)' : 'plugin';
  const canReset = !!entry && (entry.overridden || entry.source === 'override');
  const body = h('textarea', {
    id: 'pg-agent-body', class: 'pg-agent-body', rows: '16', spellcheck: 'false', disabled: busy || !entry,
    'aria-label': 'Agent definition',
  });
  body.value = S.agentBody;
  body.addEventListener('input', (e) => { S.agentBody = e.target.value; });
  const bodyErr = S.errors.agentBody ? describeError(S.errors.agentBody) : null;
  return Card({
    id: 'pg-sec-agents',
    title: 'Agents',
    children: [
      h('p', { class: 'pg-hint' }, 'Plugin agents are listed beside this project’s same-name overrides in <project>/.claude/agents/. Save writes a project override; Reset deletes it so the plugin definition applies again. Dispatch counts come from the dispatches table; its model column is not populated, so the model shown is the agent definition’s, not what actually ran.'),
      rosterTable,
      h('div', { class: 'pg-agent-controls' },
        h('label', { class: 'pg-label', for: 'pg-agent-project' }, 'Project'),
        selectEl('pg-agent-project', String(S.agentPid || ''),
          projects.map((p) => ({ value: String(p.id), label: p.label || p.folder || p.name || p.root_path })),
          (v) => pickAgentProject(Number(v))),
        h('label', { class: 'pg-label', for: 'pg-agent-name' }, 'Agent'),
        selectEl('pg-agent-name', S.agentName || '',
          roster.map((a) => ({ value: a.name, label: `${a.name}${a.overridden ? ' (overridden)' : ''}` })),
          (v) => pickAgent(v)),
        Badge({ status: canReset ? 'info' : 'idle', text: source })),
      bodyErr ? h('p', { class: 'pg-field-error', role: 'alert' }, `${bodyErr.title}${bodyErr.body ? ` — ${bodyErr.body}` : ''}`) : null,
      body,
      h('div', { class: 'pg-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: busy || !entry, onclick: () => agentAction('save') }, 'Save override'),
        h('button', { type: 'button', class: 'btn', disabled: busy || !canReset, onclick: () => agentAction('reset') }, 'Reset'),
        h('span', { class: 'pg-hint', role: 'status' }, S.agentNote || '')),
    ],
  });
}

// ---- Preferences ------------------------------------------------------------
function moveNav(order, i, d) {
  const j = i + d;
  if (j < 0 || j >= order.length) return;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  savePrefs({ nav_order: next }, 'pg-pref-nav-status').then((ok) => {
    if (ok) swapEl(S.mount.querySelector('.pg-nav-edit'), () => navEditor(prefs()));
  });
}

function navEditor(p) {
  const order = [...p.nav_order];
  return h('ol', { class: 'pg-nav-edit', 'aria-label': 'Navigation order' },
    ...order.map((id, i) => h('li', { class: 'pg-nav-item' },
      h('span', {}, NAV_LABELS[id] || id),
      h('span', { class: 'pg-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', disabled: i === 0 || S.busy.has('prefs'),
          'aria-label': `Move ${NAV_LABELS[id] || id} up`, onclick: () => moveNav(order, i, -1) }, '↑'),
        h('button', { type: 'button', class: 'btn btn-ghost', disabled: i === order.length - 1 || S.busy.has('prefs'),
          'aria-label': `Move ${NAV_LABELS[id] || id} down`, onclick: () => moveNav(order, i, 1) }, '↓')))),
  );
}

// Selects revert to the saved value when a save fails, so the control never lies about what is stored.

// A jump bar for a very long page. Buttons, not links: a "#id" href would be read as a route change.
// ---- Settings rows: knobs and preferences share SettingRow --------------------------------
// A knob save returns the server's per-layer read-back; without one the save is reported as unverified.
async function saveKnob(item, value, extra = {}) {
  const res = await S.ctx.api.post('/api/behavior', { updates: { [item.key]: value }, ...extra });
  if (!res || !Array.isArray(res.layers)) return { ok: false, error: 'the server returned no read-back' };
  return res;
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

// Prefs verify against the state the PUT returns (what the server wrote to disk).
async function savePref(item, value) {
  const num = item.kind === 'number' ? Number(value) : value;
  const patch = item.path.includes('.') ? { noise: { ...prefs().noise, [item.path.split('.')[1]]: num } } : { [item.path]: num };
  const res = await S.ctx.api.put('/api/v2/prefs', patch);
  const next = res && res.state ? res.state : res;
  if (next && typeof next === 'object') { S.prefs = next; S.ctx.prefs = next; if (S.ctx.store) S.ctx.store.set('prefs', next); }
  const got = getPath(next, item.path);
  return { ok: String(got) === String(num), layers: [{ layer: 'prefs', wrote: num, got, ok: String(got) === String(num) }], applies: item.applies };
}

const rowDeps = () => ({
  api: S.ctx.api, confirm,
  save: (item, value, extra) => (item.pref ? savePref(item, value) : saveKnob(item, value, extra)),
  testUrl: async (url) => {
    const r = await S.ctx.api.get('/api/v2/ollama/status', { url });
    return { text: r.reachable ? `✓ reachable${r.version ? ` · ollama ${r.version}` : ''}` : '✗ not reachable' };
  },
});

function prefItems() {
  const p = prefs();
  const projects = [{ value: 'all', label: 'All projects' }, ...S.projects.map((x) => ({ value: x.root, label: x.name || x.root }))];
  const base = { pref: true, scope: 'dashboard', applies: 'now' };
  return [
    { ...base, key: 'theme', path: 'theme', title: 'Theme', description: 'Colour scheme of this dashboard.', effect: 'Repaints every page.', kind: 'select', value: p.theme,
      options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'Match system' }] },
    { ...base, key: 'density', path: 'density', title: 'Density', description: 'Row spacing across every page.', effect: 'Tightens or loosens rows.', kind: 'select', value: p.density,
      options: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }] },
    { ...base, key: 'default_project', path: 'default_project', title: 'Default project', description: 'The project selected when the dashboard opens.', effect: 'Changes the project filter on the next open.', kind: 'select', value: p.default_project,
      options: projects.some((o) => o.value === p.default_project) ? projects : [...projects, { value: p.default_project, label: p.default_project }] },
    { ...base, key: 'refresh_seconds', path: 'refresh_seconds', title: 'Fallback refresh (seconds)', description: 'How often pages re-fetch when the live connection drops.', effect: 'Does not slow normal live updates.', kind: 'number', value: p.refresh_seconds, range: { min: 2, max: 300, step: 1 } },
    { ...base, key: 'noise_min_severity', path: 'noise.min_severity', title: 'Activity: hide events below', description: 'Filters the Activity page only; duplicates always collapse.', effect: 'Hides lower severity rows on Activity.', kind: 'select', value: p.noise.min_severity,
      options: [{ value: 'info', label: 'Show everything' }, { value: 'warn', label: 'Warnings and failures' }, { value: 'fail', label: 'Failures only' }] },
    { ...base, key: 'nav_order', title: 'Sidebar order', description: 'Move pages up or down in the left sidebar.', effect: 'Reorders the sidebar.', kind: 'custom',
      control: h('div', {}, savedTag('pg-pref-nav-status'), navEditor(p)) },
  ];
}

// entries: [{tab, group, el, search}]; group is the h3 title for knob rows.
function buildEntries() {
  const deps = rowDeps();
  const out = [];
  const add = (tab, group, item) => { const el = SettingRow(item, deps); out.push({ tab, group, el, search: el.search }); };
  prefItems().forEach((it) => add('dashboard', '', it));
  const b = S.behavior || {};
  for (const g of b.groups || []) for (const k of g.knobs || []) add(tabOf(g.title), g.title, { ...k, value: k.hook_value ?? k.value });
  // Old servers still send `advanced`; those rows live under Behavior.
  for (const k of b.advanced || []) add('behavior', 'Advanced', { ...k, value: k.hook_value ?? k.value });
  return out;
}

const wideCount = (tab) => {
  const eco = S.ecosystem ? [...(S.ecosystem.plugins || []), ...((S.ecosystem.mcp && S.ecosystem.mcp.servers) || [])].length : 0;
  const conn = S.connectors && S.connectors.connectors ? S.connectors.connectors.length : 0;
  return tab === 'agents' ? agentRoster().length : eco + conn;
};

// Filtering only toggles `hidden`; rows keep their status, focus and scroll.
function applyFilter() {
  const q = S.query.trim();
  const counts = {};
  for (const e of S.entries) {
    const hit = rowMatches(e.search, q);
    e.el.hidden = !hit;
    if (hit) counts[e.tab] = (counts[e.tab] || 0) + 1;
  }
  for (const g of S.ui.groups) g.section.hidden = !S.entries.some((e) => e.tab === g.tab && e.group === g.title && !e.el.hidden);
  for (const t of TABS) {
    const ui = S.ui.tabs[t.id];
    const wide = t.id === 'integrations' || t.id === 'agents';
    const n = wide ? wideCount(t.id) : (counts[t.id] || 0);
    const hasHit = wide ? t.label.toLowerCase().includes(q.toLowerCase()) : n > 0;
    ui.panel.hidden = q ? !hasHit : t.id !== S.tab;
    ui.heading.hidden = !q;
    ui.btn.setAttribute('aria-selected', String(t.id === S.tab));
    ui.btn.setAttribute('tabindex', t.id === S.tab ? '0' : '-1');
    ui.count.textContent = String(n);
  }
}

function selectTab(id, focus) {
  S.tab = id;
  try { globalThis.history.replaceState(null, '', `${String(globalThis.location.hash || '#/settings').split('?')[0]}?tab=${id}`); } catch { /* no history */ }
  applyFilter();
  if (focus) S.ui.tabs[id].btn.focus();
}

function onTabKey(e) {
  const i = TABS.findIndex((t) => t.id === S.tab);
  const to = { ArrowRight: (i + 1) % TABS.length, ArrowLeft: (i + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  selectTab(TABS[to].id, true);
}

// Knob groups for one tab: an h3 and the server's intro over the two-column card grid. Groups without rows are skipped.
function knobGroups(tab, order) {
  const titles = [...new Set(S.entries.filter((e) => e.tab === tab).map((e) => e.group))];
  const ranked = [...order.filter((t) => titles.includes(t)), ...titles.filter((t) => !order.includes(t))];
  const intros = Object.fromEntries(((S.behavior && S.behavior.groups) || []).map((g) => [g.title, g.intro]));
  return ranked.map((title) => {
    const section = h('section', { class: 'st-group', 'aria-label': title },
      h('h3', { class: 'st-group-title' }, title),
      intros[title] ? h('p', { class: 'st-group-intro' }, intros[title]) : null,
      h('div', { class: 'st-grid' }, ...S.entries.filter((e) => e.tab === tab && e.group === title).map((e) => e.el)));
    S.ui.groups.push({ tab, title, section });
    return section;
  });
}

function pathsFooter() {
  const paths = (S.behavior && S.behavior.paths) || [];
  if (!paths.length) return null;
  return h('p', { class: 'st-paths' }, `${paths.map((p) => `${p.title} (${p.key}): ${p.value}`).join(' | ')}. Set these in your shell before starting atlas.`);
}

function panelBody(tab) {
  if (tab === 'dashboard') return [h('div', { class: 'st-grid' }, ...S.entries.filter((e) => e.tab === 'dashboard').map((e) => e.el))];
  if (tab === 'behavior') return [...knobGroups('behavior', BEHAVIOR_GROUPS), pathsFooter()];
  if (tab === 'models') return knobGroups('models', MODEL_GROUPS);
  if (tab === 'integrations') {
    return [h('h3', { class: 'st-group-title' }, 'Ecosystem'), ecosystemSection(), h('h3', { class: 'st-group-title' }, 'Connectors'), connectorsSection()];
  }
  return [agentsSection()];
}

function draw() {
  if (!S || !S.mount || S.destroyed) return;
  if (!S.entries) S.entries = buildEntries();
  S.ui = { tabs: {}, groups: [] };
  const filter = h('input', { id: 'st-filter', class: 'input st-filter', type: 'search', value: S.query, placeholder: 'Filter settings by name, key or effect', 'aria-label': 'Filter settings' });
  filter.addEventListener('input', () => { S.query = filter.value; applyFilter(); });
  const buttons = [];
  const panels = TABS.map((t) => {
    const count = h('span', { class: 'st-count' });
    const btn = h('button', { type: 'button', role: 'tab', id: `st-tab-${t.id}`, class: 'st-tab', 'aria-controls': `st-panel-${t.id}` }, t.label, ' ', count);
    btn.addEventListener('click', () => selectTab(t.id));
    const heading = h('h2', { class: 'st-tab-heading' }, t.label);
    const panel = h('div', { role: 'tabpanel', id: `st-panel-${t.id}`, class: 'st-panel', 'aria-labelledby': `st-tab-${t.id}` }, heading, ...panelBody(t.id));
    S.ui.tabs[t.id] = { btn, count, panel, heading };
    buttons.push(btn);
    return panel;
  });
  const tablist = h('div', { class: 'st-tabs', role: 'tablist', 'aria-label': 'Settings sections' }, ...buttons);
  tablist.addEventListener('keydown', onTabKey);
  replace(S.mount,
    h('header', { class: 'pg-head' },
      h('h1', { class: 'pg-title' }, 'Settings'),
      h('p', { class: 'pg-sub' }, 'Every row says what it changes and when. A save only turns green after the server reads each written layer back equal.'),
      filter),
    tablist, ...panels);
  applyFilter();
}

export default {
  id: 'settings',
  title: 'Settings',
  icon: 'settings',
  group: 'Configure',
  async load(ctx) {
    if (S) this.destroy();
    const mine = S = freshState(ctx);
    // Do not block the route on the slowest endpoint: render the page now (each section shows
    // its own "Loading…" or error state) and redraw as data lands.
    loadAll().then(() => { if (S === mine) draw(); });
    return { ok: true };
  },
  render(ctx) {
    if (!S) S = freshState(ctx);
    S.ctx = ctx;
    S.mount = h('div', { class: 'pg-page pg-settings-page' });
    draw();
    return S.mount;
  },
  destroy() {
    if (!S) return;
    unwireGuard();
    S.destroyed = true;
    S = null;
  },
};
