// Model picker for model-kind settings. Fed by GET /api/v2/ollama/models (scope=all, filtered and
// sorted here so the chips never refetch), with an ollama status line and a "Pull another…" job.
import { h } from './dom.js';

export const SCOPES = [['local', 'Local'], ['cloud', 'Cloud'], ['all', 'All']];
export const SORTS = [['latest', 'Latest'], ['size', 'Size'], ['name', 'Name'], ['popular', 'Popular']];

// Models without the `completion` capability (embedding, image) cannot answer a prompt; hidden unless showAll.
// A server that sends no capabilities is treated as completion-capable.
export const canGenerate = (m) => !Array.isArray(m.capabilities) || m.capabilities.includes('completion');

export function filterModels(models, { scope = 'all', q = '', showAll = true } = {}) {
  const needle = String(q).trim().toLowerCase();
  return (models || []).filter((m) => (showAll || canGenerate(m)) && (scope === 'all' || (scope === 'cloud') === !!m.cloud) && (!needle || String(m.name).toLowerCase().includes(needle)));
}

// Missing values sort last for every key so a cloud row with no size never outranks a real one.
export function sortModels(models, sort = 'latest') {
  const list = [...(models || [])];
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  const cmp = {
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
    size: (a, b) => (num(b.size_bytes) ?? -1) - (num(a.size_bytes) ?? -1),
    latest: (a, b) => String(b.modified_at || '').localeCompare(String(a.modified_at || '')),
    popular: (a, b) => (num(a.popularity_rank) ?? 1e9) - (num(b.popularity_rank) ?? 1e9),
  }[sort] || (() => 0);
  return list.sort(cmp);
}

export function fmtSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i += 1; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export function fmtAge(iso, now = Date.now()) {
  // Server sends epoch seconds; ISO strings and epoch ms are also accepted.
  const t = typeof iso === 'number' ? (iso < 1e11 ? iso * 1000 : iso) : Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// Polls a pull job until it reports done or error; onProgress gets every update.
export async function pollJob(api, id, onProgress, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxPolls = 3600) {
  for (let i = 0; i < maxPolls; i += 1) {
    const job = await api.get(`/api/v2/ollama/jobs/${encodeURIComponent(id)}`);
    onProgress(job);
    if (job.status === 'done' || job.status === 'error') return job;
    await sleep(1000);
  }
  return { status: 'error', error: 'timed_out' };
}

const rowText = (m) => [m.name, m.params || '', m.cloud ? 'cloud' : fmtSize(m.size_bytes), fmtAge(m.modified_at)].filter(Boolean);

export function ModelPicker({ api, value, defaultValue = '', onPick }) {
  let current = value;
  let open = false;
  let models = null;
  let scope = 'all';
  let sort = 'latest';
  let q = '';
  let showAll = false;
  const status = h('p', { class: 'mp-status', role: 'status' });
  const list = h('ul', { class: 'mp-list', role: 'listbox' });
  const pullBox = h('div', { class: 'mp-pull' });
  const trigger = h('button', { type: 'button', class: 'btn mp-trigger', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, current || 'Choose a model');
  const panel = h('div', { class: 'mp-panel', hidden: true });

  const allBtn = h('button', { type: 'button', class: 'btn mp-show-all', hidden: true });
  allBtn.addEventListener('click', () => { showAll = !showAll; paintList(); });
  const resetBtn = h('button', { type: 'button', class: 'btn mp-reset', hidden: true }, 'Reset to default');
  resetBtn.addEventListener('click', async () => {
    current = defaultValue; trigger.textContent = current; setOpen(false); paintList();
    await onPick(defaultValue);
  });
  const paintList = () => {
    const shown = sortModels(filterModels(models, { scope, q, showAll }), sort);
    const hiddenN = (models || []).filter((m) => !canGenerate(m)).length;
    allBtn.hidden = !hiddenN;
    allBtn.textContent = showAll ? 'Hide non-text models' : `Show all (${hiddenN} hidden)`;
    // The current value is pinned first even when it is not an installed tag (for example the default `nimble`).
    const pinned = current && !(models || []).some((m) => m.name === current) ? h('li', {}, h('button', { type: 'button', class: 'mp-row is-current mp-pinned', role: 'option', 'aria-selected': 'true' },
      h('span', { class: 'mp-name' }, current), h('span', { class: 'mp-meta' }, 'current'))) : null;
    const rows = shown;
    list.replaceChildren(...[pinned, ...(rows.length ? rows.map((m) => {
      const [name, ...meta] = rowText(m);
      const pick = h('button', { type: 'button', class: `mp-row${m.name === current ? ' is-current' : ''}`, role: 'option', 'aria-selected': String(m.name === current) },
        h('span', { class: m.running ? 'mp-dot is-running' : 'mp-dot', title: m.running ? 'running' : 'not loaded' }, m.running ? '●' : '○'),
        h('span', { class: 'mp-name' }, name),
        h('span', { class: 'mp-meta' }, meta.join(' · ')));
      pick.addEventListener('click', async () => {
        current = m.name; trigger.textContent = current; setOpen(false); paintList();
        await onPick(m.name);
      });
      return h('li', {}, pick);
    }) : [h('li', { class: 'mp-empty' }, models ? 'No models match.' : 'Loading…')])].filter(Boolean));
    resetBtn.hidden = !defaultValue || current === defaultValue;
  };

  const load = async () => {
    try {
      const res = await api.get('/api/v2/ollama/models', { scope: 'all' });
      models = (res && res.models) || [];
    } catch (err) { models = []; status.textContent = `✗ models unavailable: ${(err && err.error) || 'request failed'}`; }
    paintList();
  };
  const loadStatus = async () => {
    try {
      const s = await api.get('/api/v2/ollama/status');
      const running = (s.ps || []).length;
      status.textContent = s.reachable ? `ollama ${s.version || ''} reachable · ${running} running`.replace('  ', ' ') : 'ollama not reachable';
    } catch (err) { status.textContent = 'ollama not reachable'; }
  };

  const chipRow = h('div', { class: 'mp-chips', role: 'group', 'aria-label': 'Model scope' });
  const paintChips = () => chipRow.replaceChildren(...SCOPES.map(([v, label]) => {
    const b = h('button', { type: 'button', class: `chip${v === scope ? ' is-on' : ''}`, 'aria-pressed': String(v === scope) }, label);
    b.addEventListener('click', () => { scope = v; paintChips(); paintList(); });
    return b;
  }));
  const sortSel = h('select', { class: 'select', 'aria-label': 'Sort models' }, ...SORTS.map(([v, l]) => h('option', { value: v }, l)));
  sortSel.addEventListener('change', () => { sort = sortSel.value; paintList(); });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search models', 'aria-label': 'Search models' });
  search.addEventListener('input', () => { q = search.value; paintList(); });

  const pullBtn = h('button', { type: 'button', class: 'btn mp-pull-open' }, 'Pull another…');
  pullBtn.addEventListener('click', () => {
    const name = h('input', { class: 'input', type: 'text', placeholder: 'model:tag', 'aria-label': 'Model to pull' });
    const go = h('button', { type: 'button', class: 'btn' }, 'Pull');
    const progress = h('span', { class: 'mp-progress', role: 'status' });
    go.addEventListener('click', async () => {
      if (!name.value.trim()) return;
      progress.textContent = 'starting…';
      try {
        const start = await api.post('/api/v2/ollama/pull', { name: name.value.trim() });
        const job = await pollJob(api, start.job || start.id, (j) => { progress.textContent = j.percent != null ? `${j.status} ${j.percent}%` : (j.lines && j.lines[j.lines.length - 1]) || j.status; });
        progress.textContent = job.status === 'done' ? `✓ pulled ${name.value.trim()}` : `✗ pull failed: ${job.error || 'error'}`;
        if (job.status === 'done') await load();
      } catch (err) { progress.textContent = `✗ pull failed: ${(err && err.error) || 'request failed'}`; }
    });
    pullBox.replaceChildren(name, go, progress);
  });

  panel.appendChild(status); panel.appendChild(chipRow);
  panel.appendChild(h('div', { class: 'mp-tools' }, sortSel, search));
  panel.appendChild(list); panel.appendChild(allBtn); panel.appendChild(resetBtn); panel.appendChild(pullBtn); panel.appendChild(pullBox);
  paintChips();

  function setOpen(next) {
    open = next;
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open && models === null) { paintList(); load(); loadStatus(); }
  }
  trigger.addEventListener('click', () => setOpen(!open));
  const root = h('div', { class: 'mp' }, trigger, panel);
  root.setOpen = setOpen;
  return root;
}
