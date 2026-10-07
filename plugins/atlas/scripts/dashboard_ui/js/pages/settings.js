// Atlas Workboard v2 — Settings page: Behavior knobs, Ecosystem toggles,
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
import { Badge, Card, EmptyState, StatusDot } from '../components.js';
import { IntegrationsPanel } from '../integrations.js';

import { DEFAULT_NAV, normalizeNav } from '../nav-order.js';

const NAV_LABELS = {
  overview: 'Overview', activity: 'Activity', health: 'Health', agents: 'Agents', colony: 'Colony',
  improve: 'Self-improvement', projects: 'Projects', settings: 'Settings',
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

function freshState(ctx) {
  return {
    ctx, mount: null, destroyed: false, busy: new Set(), drafts: {}, tests: {},
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
  if (!S.agentPid) { S.agents = { agents: [] }; S.agentName = null; S.agentBody = ''; return; }
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

async function savePrefs(patch, okMsg) {
  const key = 'prefs';
  if (S.busy.has(key)) return;
  S.busy.add(key);
  try {
    const res = await S.ctx.api.put('/api/v2/prefs', patch);
    const next = res && res.state ? res.state : res;
    if (next && typeof next === 'object') {
      S.prefs = next;
      S.ctx.prefs = next;
      if (S.ctx.store) S.ctx.store.set('prefs', next);
    }
    delete S.errors.prefsSave;
    notify(okMsg || 'Preferences saved', 'ok');
  } catch (err) {
    S.errors.prefsSave = err;
    const d = describeError(err);
    notify([d.title, d.body].filter(Boolean).join(': '), 'fail');
  }
  S.busy.delete(key);
  draw();
}

// ---- small form helpers -----------------------------------------------------
function field(id, label, control, hint) {
  return h('div', { class: 'pg-field' },
    h('label', { class: 'pg-label', for: id }, label),
    control,
    hint ? h('p', { class: 'pg-hint', id: `${id}-hint` }, hint) : null);
}

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
async function saveKnob(knob, value) {
  const key = `knob:${knob.key}`;
  if (S.busy.has(key)) return;
  S.busy.add(key);
  draw();
  try {
    const res = await legacyPost('/api/behavior', { updates: { [knob.key]: value } });
    S.note = res.note || S.note;
    delete S.drafts[knob.key];
    await loadSection('behavior', () => S.ctx.api.get('/api/behavior'));
    notify(`${knob.title || knob.key} saved. ${res.note || ''}`.trim(), 'ok');
  } catch (err) {
    const d = describeError(err);
    notify([`Could not save ${knob.key}`, d.title, d.body].filter(Boolean).join(': '), 'fail');
  }
  S.busy.delete(key);
  draw();
}

function knobControl(knob) {
  const id = `pg-knob-${knob.key}`;
  const busy = S.busy.has(`knob:${knob.key}`);
  const value = knob.value === undefined ? '' : String(knob.value);
  if (knob.kind === 'toggle') {
    const on = value === String(knob.on ?? 'on');
    return switchEl(id, on, `${knob.title || knob.key}`, (next) => saveKnob(knob, next ? (knob.on ?? 'on') : (knob.off ?? 'off')), busy);
  }
  if (knob.kind === 'choice') {
    return selectEl(id, value, (knob.options || []).map((o) => ({ value: o, label: o })), (v) => saveKnob(knob, v));
  }
  const draft = S.drafts[knob.key] !== undefined ? S.drafts[knob.key] : value;
  const input = h('input', {
    id, class: 'input', type: knob.kind === 'number' ? 'number' : 'text', value: draft,
    disabled: busy, 'aria-label': knob.title || knob.key,
  });
  input.addEventListener('input', (e) => { S.drafts[knob.key] = e.target.value; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveKnob(knob, input.value); } });
  return h('span', { class: 'pg-inline' }, input,
    h('button', { type: 'button', class: 'btn', disabled: busy, onclick: () => saveKnob(knob, input.value),
      'aria-label': `Save ${knob.title || knob.key}` }, 'Save'));
}

function knobRow(knob) {
  return h('li', { class: 'pg-row' },
    h('div', { class: 'pg-row-main' },
      h('label', { class: 'pg-row-title', for: `pg-knob-${knob.key}` }, knob.title || knob.key),
      h('p', { class: 'pg-hint' }, knob.description || ''),
      h('p', { class: 'pg-mono pg-hint' }, `${knob.key} · from ${knob.source || 'default'}${knob.ref ? ` · ${knob.ref}` : ''}`)),
    h('div', { class: 'pg-row-ctl' }, knobControl(knob)));
}

// Read-only: shows the omp roles atlas's agents name and whether each resolves to a model.
function ompSection(omp) {
  if (!omp) return null;
  if (!omp.exists) {
    return h('section', { class: 'pg-knob-group', 'aria-label': 'omp model roles' },
      h('h3', { class: 'pg-h3' }, 'omp model roles'),
      h('p', { class: 'pg-hint' }, `No omp config found at ${omp.path}. Atlas’s omp agents are not in use on this machine.`));
  }
  const unresolved = (omp.roles || []).filter((r) => !r.resolves);
  return h('section', { class: 'pg-knob-group', 'aria-label': 'omp model roles' },
    h('h3', { class: 'pg-h3' }, 'omp model roles'),
    h('p', { class: 'pg-hint' }, `Read from ${omp.path} (read-only; edit it with omp). Atlas’s omp agents name @atlas-worker, @atlas-verifier and @atlas-mechanic first, then fall back to @default / @smol. `
      + (unresolved.length ? `${unresolved.length} role${unresolved.length === 1 ? '' : 's'} not defined, so those agents use their fallback.` : 'Every role resolves.')),
    h('div', { class: 'pg-table-wrap' }, h('table', { class: 'pg-table', 'aria-label': 'omp model roles' },
      h('thead', {}, h('tr', {}, ...['Role', 'Resolves', 'Model', 'Falls back to'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, ...(omp.roles || []).map((r) => h('tr', {},
        h('th', { scope: 'row', class: 'pg-mono' }, `@${r.role}`),
        h('td', {}, Badge({ status: r.resolves ? 'ok' : (r.falls_back_to ? 'warn' : 'fail'), text: r.resolves ? 'yes' : 'not defined' })),
        h('td', { class: 'pg-mono' }, r.model || '—'),
        h('td', { class: 'pg-mono' }, r.resolves ? '—' : (r.falls_back_to ? `@${r.falls_back_to} (${r.fallback_model})` : 'nothing'))))))),
    (omp.other || []).length
      ? h('details', { class: 'pg-evidence' }, h('summary', {}, `Other roles (${omp.other.length})`),
        h('ul', { class: 'pg-rows' }, ...omp.other.map((o) => nameRow(`@${o.role}`, o.model))))
      : null);
}

function behaviorSection() {
  const err = sectionError('behavior', 'Behavior knobs');
  if (err) return Card({ title: 'Behavior', children: [err] });
  if (!S.behavior) return Card({ title: 'Behavior', children: [h('p', { class: 'pg-hint', role: 'status' }, 'Loading…')] });
  const groups = S.behavior.groups || [];
  const advanced = S.behavior.advanced || [];
  return Card({
    title: 'Behavior',
    actions: [h('span', { class: 'pg-hint' }, S.behavior.settings_path || '')],
    children: [
      h('p', { class: 'pg-hint' }, S.note || S.behavior.note || ''),
      ...groups.map((g) => h('section', { class: 'pg-knob-group', 'aria-label': g.title },
        h('h3', { class: 'pg-h3' }, g.title),
        h('ul', { class: 'pg-rows' }, ...(g.knobs || []).map(knobRow)))),
      advanced.length
        ? h('details', { class: 'pg-evidence' },
          h('summary', {}, `Other ATLAS_* variables the code reads (${advanced.length})`),
          h('ul', { class: 'pg-rows' }, ...advanced.map((a) => knobRow({
            key: a.key, title: a.key, description: '', kind: 'text', value: a.value, source: a.source, ref: a.ref,
          }))))
        : null,
      ompSection(S.behavior.omp),
    ],
  });
}

// ---- Ecosystem toggles ------------------------------------------------------
async function toggleEco(kind, id, label, enabled) {
  const key = `eco:${kind}:${id}`;
  if (S.busy.has(key)) return;
  S.busy.add(key);
  draw();
  try {
    const res = kind === 'plugin'
      ? await legacyPost('/api/plugins/toggle', { key: id, enabled })
      : await legacyPost('/api/mcp/toggle', { name: id, enabled });
    await loadSection('ecosystem', () => S.ctx.api.get('/api/ecosystem'));
    notify(`${label} ${enabled ? 'enabled' : 'disabled'}. ${res.note || ''}`.trim(), 'ok');
  } catch (err) {
    const d = describeError(err);
    notify([`Could not toggle ${label}`, d.title, d.body].filter(Boolean).join(': '), 'fail');
  }
  S.busy.delete(key);
  draw();
}

function pluginRow(p) {
  const key = `eco:plugin:${p.key}`;
  const host = String(p.key).startsWith('atlas@');
  return h('li', { class: 'pg-row' },
    h('div', { class: 'pg-row-main' },
      h('span', { class: 'pg-row-title' }, p.name || p.key, ' ', h('span', { class: 'pg-mono pg-hint' }, p.version || '')),
      h('p', { class: 'pg-hint' }, p.description || ''),
      h('p', { class: 'pg-mono pg-hint' }, `${p.key} · ${p.skills || 0} skills · ${p.agents || 0} agents · ${(p.mcp_servers || []).length} MCP`)),
    h('div', { class: 'pg-row-ctl' },
      host
        ? Badge({ status: 'info', text: 'host plugin' })
        : switchEl(`pg-plugin-${p.key}`, p.enabled, `Enable plugin ${p.name || p.key}`,
          (next) => toggleEco('plugin', p.key, p.name || p.key, next), S.busy.has(key) || !p.installed)));
}

function mcpRow(m) {
  const key = `eco:mcp:${m.name}`;
  return h('li', { class: 'pg-row' },
    h('div', { class: 'pg-row-main' },
      h('span', { class: 'pg-row-title pg-mono' }, m.name),
      h('p', { class: 'pg-mono pg-hint' }, `${m.origin}${m.origin_detail ? ` · ${m.origin_detail}` : ''} · ${m.transport}`)),
    h('div', { class: 'pg-row-ctl' },
      switchEl(`pg-mcp-${m.name}`, m.enabled, `Enable MCP server ${m.name}`,
        (next) => toggleEco('mcp', m.name, m.name, next), S.busy.has(key) || (m.origin === 'plugin' && m.plugin_enabled === false))));
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

function setEco(patch) {
  Object.assign(S, patch);
  draw();
}

function ecosystemSection() {
  const err = sectionError('ecosystem', 'Ecosystem');
  if (err) return Card({ title: 'Ecosystem', children: [err] });
  if (!S.ecosystem) return Card({ title: 'Ecosystem', children: [h('p', { class: 'pg-hint', role: 'status' }, 'Loading…')] });
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
    title: 'Ecosystem',
    children: [
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
      h('p', { class: 'pg-hint' }, 'Plugin and MCP toggles are written to Claude settings; reload Claude Code to apply. Other tabs are read-only inventory.'),
    ],
  });
}

// ---- Connectors -------------------------------------------------------------
async function testConnector(c) {
  const key = `test:${c.name}`;
  if (S.busy.has(key)) return;
  S.busy.add(key);
  delete S.tests[c.name];
  draw();
  try {
    const res = await S.ctx.api.post('/api/connectors/test', { name: c.name });
    S.tests[c.name] = res;
  } catch (err) {
    S.tests[c.name] = { ok: false, error: describeError(err).title, hint: describeError(err).body };
  }
  S.busy.delete(key);
  draw();
}

async function toggleConnector(c, enabled) {
  const key = `eco:mcp:${c.server_name}`;
  if (S.busy.has(key)) return;
  S.busy.add(key);
  draw();
  try {
    await legacyPost('/api/mcp/toggle', { name: c.server_name, enabled });
    await loadSection('connectors', () => S.ctx.api.get('/api/connectors'));
    notify(`${c.name} ${enabled ? 'enabled' : 'disabled'}. Reload Claude Code to apply.`, 'ok');
  } catch (err) {
    const d = describeError(err);
    notify([`Could not toggle ${c.name}`, d.title, d.body].filter(Boolean).join(': '), 'fail');
  }
  S.busy.delete(key);
  draw();
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
    const row = S.mount.querySelector(`li[data-connector="${CSS.escape ? CSS.escape(c.name) : c.name}"]`);
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
  draw();
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
  draw();
  try {
    const res = await legacyPost('/api/connectors/env', { updates });
    for (const k of Object.keys(updates)) delete S.credDrafts[k];
    syncGuard();
    await loadSection('connectors', () => S.ctx.api.get('/api/connectors'));
    const saved = [...new Set([...(res.updated_user_config_keys || []), ...(res.updated_env_keys || [])])];
    notify(`${c.name}: saved ${saved.join(', ') || Object.keys(updates).join(', ')}. Reload Claude Code so the server re-reads credentials.`, 'ok');
  } catch (err) {
    const d = describeError(err);
    notify([`Could not save ${c.name} credentials`, d.title, d.body].filter(Boolean).join(': '), 'fail');
  }
  S.busy.delete(busyKey);
  draw();
}

function credFieldRow(c, f) {
  const key = credKey(f);
  if (!key) return null;
  const id = `pg-cred-${`${c.name}-${key}`.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const baseline = String(f.value || '');
  const draft = S.credDrafts[key];
  const set = !!f.is_set;
  const input = h('input', {
    id, class: 'input', type: f.sensitive ? 'password' : 'text',
    value: draft !== undefined ? draft : baseline,
    placeholder: f.sensitive ? (set ? 'set — type to replace' : 'enter secret') : (set ? '' : 'not set'),
    autocomplete: f.sensitive ? 'new-password' : 'off', spellcheck: 'false',
    'aria-label': `${c.name} ${f.title || key}`,
  });
  input.addEventListener('input', () => updateCredDraft(key, input, baseline));
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
      testLine(S.tests[c.name])),
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

function connectorsSection() {
  const err = sectionError('connectors', 'Connectors');
  if (err) return Card({ title: 'Connectors', children: [err] });
  if (!S.connectors) return Card({ title: 'Connectors', children: [h('p', { class: 'pg-hint', role: 'status' }, 'Loading…')] });
  const list = S.connectors.connectors || [];
  const ready = list.filter((c) => c.configured_hint).length;
  const degraded = list.filter((c) => c.health === 'degraded').length;
  return Card({
    title: `Connectors (${ready}/${list.length} configured${degraded ? `, ${degraded} degraded` : ''})`,
    actions: [h('span', { class: 'pg-hint' }, S.connectors.settings_path || '')],
    children: [
      h('p', { class: 'pg-banner is-warn', id: 'pg-cred-dirty', role: 'status', hidden: !credDirty() },
        'Unsaved credential edits. Save or Revert each connector before leaving; the browser will also ask before reload or close.'),
      h('p', { class: 'pg-hint' }, 'Saved credentials are never shown or read back — a field only reports set or missing, and typing a new value replaces it. Only fields you changed are sent. Test starts the connector and completes an MCP handshake; it proves the bundle runs, not that vendor credentials are accepted — use the connector’s own status tool for that.'),
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
  if (err) return Card({ title: 'Agents', children: [err] });
  const projects = legacyProjects();
  if (!projects.length) {
    return Card({ title: 'Agents', children: [h('p', { class: 'pg-hint' }, 'No registered projects yet. Agent overrides are stored per project; run Claude Code in a project first.')] });
  }
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
  savePrefs({ nav_order: next }, 'Navigation order saved');
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

function refreshField(p) {
  const input = h('input', {
    id: 'pg-pref-refresh', class: 'input', type: 'number', min: '2', max: '300', value: String(p.refresh_seconds),
    'aria-describedby': 'pg-pref-refresh-hint',
  });
  const err = h('p', { class: 'pg-field-error', role: 'alert' }, '');
  const commit = () => {
    const n = Number(input.value);
    if (!Number.isInteger(n) || n < 2 || n > 300) { err.textContent = 'Enter a whole number from 2 to 300.'; return; }
    err.textContent = '';
    if (n !== p.refresh_seconds) savePrefs({ refresh_seconds: n }, 'Refresh interval saved');
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  return h('div', { class: 'pg-field' },
    h('label', { class: 'pg-label', for: 'pg-pref-refresh' }, 'Polling fallback interval (seconds)'),
    input,
    h('p', { class: 'pg-hint', id: 'pg-pref-refresh-hint' }, 'Used only when the live stream is unavailable.'),
    err);
}

function integrationsSection() {
  return Card({
    id: 'integrations',
    title: 'Integrations',
    actions: [h('span', { class: 'pg-hint' }, 'herdr tooling, read-only')],
    children: [S.integrations || (S.integrations = IntegrationsPanel())],
  });
}

function prefsSection() {
  const p = prefs();
  const fail = S.errors.prefs && !S.prefs
    ? h('p', { class: 'pg-banner is-warn', role: 'alert' },
      `Saved preferences could not be loaded (${describeError(S.errors.prefs).title}); showing defaults.`)
    : null;
  const projectOptions = [{ value: 'all', label: 'All projects' },
    ...S.projects.map((x) => ({ value: x.root, label: x.name || x.root }))];
  if (!projectOptions.some((o) => o.value === p.default_project)) {
    projectOptions.push({ value: p.default_project, label: p.default_project });
  }
  return Card({
    title: 'Dashboard preferences',
    children: [
      fail,
      h('div', { class: 'pg-form' },
        field('pg-pref-theme', 'Theme', selectEl('pg-pref-theme', p.theme,
          [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'Match system' }],
          (v) => savePrefs({ theme: v }, 'Theme saved'))),
        field('pg-pref-density', 'Density', selectEl('pg-pref-density', p.density,
          [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }],
          (v) => savePrefs({ density: v }, 'Density saved'))),
        field('pg-pref-project', 'Default project', selectEl('pg-pref-project', p.default_project, projectOptions,
          (v) => savePrefs({ default_project: v }, 'Default project saved')), 'Opened when the dashboard loads.'),
        refreshField(p),
        h('fieldset', { class: 'pg-fieldset' },
          h('legend', { class: 'pg-label' }, 'Noise filters'),
          h('div', { class: 'pg-row' },
            h('div', { class: 'pg-row-main' },
              h('span', { class: 'pg-row-title' }, 'Collapse duplicate events'),
              h('p', { class: 'pg-hint' }, 'Identical events show once with a ×count.')),
            h('div', { class: 'pg-row-ctl' },
              switchEl('pg-pref-collapse', p.noise.collapse_duplicates, 'Collapse duplicate events',
                (next) => savePrefs({ noise: { ...p.noise, collapse_duplicates: next } }, 'Noise filter saved'), S.busy.has('prefs')))),
          field('pg-pref-minsev', 'Hide events below severity', selectEl('pg-pref-minsev', p.noise.min_severity,
            [{ value: 'info', label: 'Show everything' }, { value: 'warn', label: 'Warnings and failures' }, { value: 'fail', label: 'Failures only' }],
            (v) => savePrefs({ noise: { ...p.noise, min_severity: v } }, 'Noise filter saved')))),
        h('fieldset', { class: 'pg-fieldset' }, h('legend', { class: 'pg-label' }, 'Navigation order'), navEditor(p))),
    ],
  });
}

function draw() {
  if (!S || !S.mount || S.destroyed) return;
  const active = document.activeElement;
  const keepId = active && S.mount.contains(active) ? active.id : '';
  const caret = keepId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = S.mount.scrollTop;
  replace(S.mount, 
    h('header', { class: 'pg-head' },
      h('h1', { class: 'pg-title' }, 'Settings'),
      h('p', { class: 'pg-sub' }, 'Behavior and ecosystem changes are written to Claude settings and apply after you reload Claude Code. Preferences apply to this dashboard immediately.')),
    h('div', { class: 'pg-settings' },
      prefsSection(), integrationsSection(), behaviorSection(), ecosystemSection(), connectorsSection(), agentsSection()));
  S.mount.scrollTop = scroll;
  if (keepId) {
    const el = S.mount.querySelector(`#${CSS.escape ? CSS.escape(keepId) : keepId}`);
    if (el && typeof el.focus === 'function') el.focus();
    if (el && caret && typeof el.setSelectionRange === 'function') {
      try { el.setSelectionRange(caret[0], caret[1]); } catch { /* input types without a caret */ }
    }
  }
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
