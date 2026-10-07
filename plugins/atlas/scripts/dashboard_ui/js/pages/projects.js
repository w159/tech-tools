// Atlas Workboard v2 — Projects page: per-project cards with health, drill-in,
// pin, hide and mute. Prefs are persisted via PUT /api/v2/prefs (minimal keys).
// No innerHTML; all data via h() text children.
import { h, replace } from '../dom.js';
import { HerdrProjectsSection } from '../hp.js';
import { Badge, Card, EmptyState, StatusDot } from '../components.js';

const HEALTH_TONE = { ok: 'ok', warn: 'warn', fail: 'fail', idle: 'info' };

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

function describeError(err) {
  if (!err) return { title: 'Request failed', body: '' };
  return {
    title: err.status === 404 ? 'Projects API is not available yet' : (err.error || 'Request failed'),
    body: [err.why, err.do].filter(Boolean).join(' — '),
  };
}

let S = null;

function freshState(ctx) {
  return { ctx, mount: null, data: null, error: null, busy: false, destroyed: false, inFlight: false };
}

function prefsOf() {
  return (S.ctx.prefs && typeof S.ctx.prefs === 'object') ? S.ctx.prefs : {};
}

function notify(msg, kind) {
  if (S && S.ctx && typeof S.ctx.toast === 'function') S.ctx.toast(msg, { kind });
}

async function fetchProjects() {
  return S.ctx.api.get('/api/v2/projects');
}

async function refresh() {
  if (!S || S.inFlight || S.destroyed) return;
  S.inFlight = true;
  try {
    S.data = await fetchProjects();
    S.error = null;
  } catch (err) {
    S.error = err;
  } finally {
    S.inFlight = false;
  }
  draw();
}

// Toggle membership of `root` in a prefs array key, sending only that key.
async function toggleIn(key, root, label, onMsg, offMsg) {
  if (S.busy) return;
  const current = new Set(prefsOf()[key] || []);
  const adding = !current.has(root);
  if (adding) current.add(root); else current.delete(root);
  S.busy = true;
  try {
    const res = await S.ctx.api.put('/api/v2/prefs', { [key]: [...current] });
    const next = res && res.state ? res.state : res;
    if (next && typeof next === 'object') {
      S.ctx.prefs = next;
      if (S.ctx.store) S.ctx.store.set('prefs', next);
    }
    notify(`${label} ${adding ? onMsg : offMsg}`, 'ok');
  } catch (err) {
    const d = describeError(err);
    notify([d.title, d.body].filter(Boolean).join(': '), 'fail');
  }
  S.busy = false;
  draw();
}

function drillIn(p) {
  S.ctx.navigate('overview');
  S.ctx.setProject(p.root, true);
}

function stat(label, value, tone) {
  return h('div', { class: `pg-stat${tone ? ` is-${tone}` : ''}` },
    h('dd', { class: 'pg-stat-value' }, String(value)),
    h('dt', { class: 'pg-stat-label' }, label));
}

function btn(label, ariaLabel, pressed, onclick) {
  const props = { type: 'button', class: `btn btn-ghost${pressed ? ' is-on' : ''}`, 'aria-label': ariaLabel, onclick };
  if (pressed !== undefined) props['aria-pressed'] = String(!!pressed);
  return h('button', props, label);
}

function projectCard(p, flags) {
  const status = HEALTH_TONE[p.health] || 'info';
  const todos = p.todos || {};
  const name = p.name || p.root;
  return h('article', { class: `pg-proj is-${status}${flags.muted ? ' is-muted' : ''}`, 'aria-label': `Project ${name}` },
    Card({
      title: name,
      actions: [
        flags.pinned ? Badge({ status: 'info', text: 'pinned' }) : null,
        flags.muted ? Badge({ status: 'info', text: 'muted' }) : null,
        h('span', { class: 'pg-proj-health' }, StatusDot({ status }), Badge({ status, text: p.health || 'idle' })),
      ],
      children: [
        h('p', { class: 'pg-mono pg-clip', title: p.root }, p.root),
        h('dl', { class: 'pg-stats' },
          stat('runs 7d', p.runs_7d ?? 0),
          stat('agents', p.agents_active ?? 0),
          stat('todos open', todos.open ?? 0),
          stat('todos done', todos.done ?? 0),
          stat('failures 7d', p.failures_7d ?? 0, (p.failures_7d || 0) > 0 ? 'fail' : ''),
          stat('findings', p.findings_open ?? 0, (p.findings_open || 0) > 0 ? 'warn' : '')),
        h('p', { class: 'pg-hint' }, `Last active ${fmtWhen(p.last_active)}`),
        h('div', { class: 'pg-actions' },
          h('button', {
            type: 'button', class: 'btn btn-primary', 'aria-label': `Open ${name} overview`,
            onclick: () => drillIn(p),
          }, 'Drill in'),
          btn(flags.pinned ? 'Unpin' : 'Pin', `${flags.pinned ? 'Unpin' : 'Pin'} ${name}`, flags.pinned,
            () => toggleIn('pinned_projects', p.root, name, 'pinned', 'unpinned')),
          btn(flags.muted ? 'Unmute' : 'Mute', `${flags.muted ? 'Unmute' : 'Mute'} ${name} (hide its events from Activity)`, flags.muted,
            () => toggleIn('muted_projects', p.root, name, 'muted', 'unmuted')),
          btn('Hide', `Hide ${name} from lists`, undefined,
            () => toggleIn('hidden_projects', p.root, name, 'hidden', 'shown'))),
      ],
    }));
}

function body() {
  if (S.error && !S.data) {
    const d = describeError(S.error);
    return EmptyState({
      icon: 'alert', title: d.title, body: d.body || 'The projects endpoint did not answer.',
      actions: [h('button', { type: 'button', class: 'btn btn-primary', onclick: refresh }, 'Retry')],
    });
  }
  if (!S.data) return h('p', { class: 'pg-hint', role: 'status' }, 'Loading projects…');

  const prefs = prefsOf();
  const pinned = new Set(prefs.pinned_projects || []);
  const hidden = new Set(prefs.hidden_projects || []);
  const muted = new Set(prefs.muted_projects || []);
  const all = S.data.projects || [];
  const shown = all.filter((p) => !hidden.has(p.root));
  const hiddenRows = all.filter((p) => hidden.has(p.root));
  shown.sort((a, b) => (pinned.has(b.root) - pinned.has(a.root))
    || String(b.last_active || '').localeCompare(String(a.last_active || '')));

  if (!all.length) {
    return EmptyState({
      icon: 'folder', title: 'No projects yet',
      body: 'A project appears once an Atlas session has run in a directory that has a .atlas/ folder.',
    });
  }
  return h('div', { class: 'pg-stack' },
    shown.length
      ? h('div', { class: 'pg-proj-grid' }, ...shown.map((p) => projectCard(p, { pinned: pinned.has(p.root), muted: muted.has(p.root) })))
      : EmptyState({ icon: 'eye-off', title: 'Every project is hidden', body: 'Unhide one below to see it here.' }),
    hiddenRows.length
      ? h('section', { class: 'pg-hidden', 'aria-label': 'Hidden projects' },
        h('h2', { class: 'pg-h2' }, `Hidden (${hiddenRows.length})`),
        h('ul', { class: 'pg-list' }, ...hiddenRows.map((p) => h('li', { class: 'pg-hidden-row' },
          h('span', {}, p.name || p.root), ' ',
          h('span', { class: 'pg-mono pg-hint' }, p.root), ' ',
          btn('Unhide', `Unhide ${p.name || p.root}`, undefined,
            () => toggleIn('hidden_projects', p.root, p.name || p.root, 'hidden', 'shown'))))))
      : null);
}

function draw() {
  if (!S || !S.mount || S.destroyed) return;
  const active = document.activeElement;
  const label = active && S.mount.contains(active) ? active.getAttribute('aria-label') : null;
  replace(S.mount, 
    h('header', { class: 'pg-head' },
      h('h1', { class: 'pg-title' }, 'Projects'),
      h('p', { class: 'pg-sub' }, 'Pin the ones you watch, mute noisy ones, hide the rest. Muting hides a project’s events from Activity; hiding removes it from this list.'),
      h('div', { class: 'pg-head-actions' },
        h('button', { type: 'button', class: 'btn', onclick: refresh }, 'Refresh'))),
    S.hp,
    body());
  if (label) {
    for (const el of S.mount.querySelectorAll('[aria-label]')) {
      if (el.getAttribute('aria-label') === label && typeof el.focus === 'function') { el.focus(); break; }
    }
  }
}

export default {
  id: 'projects',
  title: 'Projects',
  icon: 'folder',
  group: 'Configure',
  async load(ctx) {
    if (S) this.destroy();
    S = freshState(ctx);
    try {
      S.data = await fetchProjects();
    } catch (err) {
      S.error = err;
    }
    return S.data;
  },
  render(ctx) {
    if (!S) S = freshState(ctx);
    S.ctx = ctx;
    S.mount = h('div', { class: 'pg-page pg-projects' });
    S.hp = HerdrProjectsSection();
    draw();
    return S.mount;
  },
  destroy() {
    if (!S) return;
    S.destroyed = true;
    S = null;
  },
};
