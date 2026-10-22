// Settings row: one component for behavior knobs and dashboard preferences.
// Row contract: title, description, effect line, applies badge, a control chosen by `kind`,
// "live vs saved" when they differ, and a post-save status that is only ever green when the
// server read every written layer back equal ("✓ verified · <layers>" / "✗ not saved: <layer> has <got>").
import { h } from './dom.js';
import { ModelPicker } from './model-picker.js';

const APPLIES_LABEL = { 'dashboard-restart': 'restart dashboard' };
const LAYER_LABEL = {
  live_env: 'live env', store: 'atlas store', claude_settings: 'claude settings.json',
  omp_config: 'omp config', shell_rc: '~/.atlas/env.sh', prefs: 'dashboard prefs',
};

// 'now' is the normal case and gets no badge; only a delayed effect is worth saying.
const appliesLabel = (a) => APPLIES_LABEL[a] || '';
const layerName = (l) => LAYER_LABEL[l] || String(l);
const show = (v) => (v === '' || v === null || v === undefined ? '(nothing)' : String(v));

// Stepper buttons only: clamp to the server's range so the input can never hold a value the server refuses.
export function clampNumber(range, raw) {
  const n = Number(raw);
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n)) return null;
  const r = range || {};
  let v = n;
  if (r.min !== undefined && v < r.min) v = r.min;
  if (r.max !== undefined && v > r.max) v = r.max;
  return v;
}

// `res` is the server's verified-write answer; ok must be true AND every written layer must read back ok.
export function verifyStatus(res) {
  const layers = (res && res.layers) || [];
  const bad = layers.filter((l) => !l.ok);
  if (!res || res.ok === false || bad.length) {
    const lines = bad.length ? bad.map((l) => `${layerName(l.layer)} has ${show(l.got)}`) : [(res && (res.error || res.why)) || 'the server did not confirm'];
    return { ok: false, text: `✗ not saved: ${lines.join('; ')}` };
  }
  const names = layers.map((l) => layerName(l.layer));
  return { ok: true, text: `✓ verified${names.length ? ` · ${names.join(', ')}` : ''}` };
}

function errorStatus(err, typed) {
  const d = (err && err.data) || {};
  if (d.error === 'out_of_range') {
    const r = d.range || {};
    return `✗ not saved: ${typed ?? 'that value'} is outside ${r.min}..${r.max}`;
  }
  if (d.error === 'unknown_model') {
    const m = d.matches || d.closest || [];
    return `✗ not saved: no such model${m.length ? ` (closest: ${m.slice(0, 3).join(', ')})` : ''}`;
  }
  const bad = (d.layers || []).filter((l) => !l.ok);
  if (bad.length) return verifyStatus(d).text;
  return `✗ not saved: ${[err && (err.error || err.message), err && err.why].filter(Boolean).join(' - ') || 'request failed'}`;
}

// live (this process env) vs saved (what a new session will read); text only when both exist and differ.
export function liveVsSaved(item) {
  const L = item.layers || {};
  const live = L.live_env && L.live_env.supported !== false ? L.live_env.value : undefined;
  const savedLayer = ['store', 'claude_settings', 'omp_config', 'shell_rc'].map((k) => L[k]).find((x) => x && x.supported !== false && x.value !== undefined && x.value !== null);
  const saved = savedLayer ? savedLayer.value : undefined;
  if (live === undefined || live === null || saved === undefined || String(live) === String(saved)) return null;
  const f = (v) => fmtValue(item, v);
  return `live: ${f(live)} · saved: ${f(saved)}`;
}

function isOn(item, v) {
  const s = String(v ?? '').toLowerCase();
  if (s === String(item.off ?? 'off').toLowerCase()) return false;
  // Unset means the knob's default: on for "unset is on" toggles, off for ATLAS_MODE-style ones.
  if (s === '') return String(item.default ?? '').toLowerCase() === String(item.on ?? 'on').toLowerCase();
  return true;
}
function fmtValue(item, v) {
  if (item.kind === 'toggle') return isOn(item, v) ? 'on' : 'off';
  return v === '' || v === null || v === undefined ? '(empty)' : String(v);
}

const writtenLayers = (item) => Object.entries(item.layers || {}).filter(([k, v]) => k !== 'live_env' && v && v.supported).map(([k]) => layerName(k));

// deps: {save(item,value,extra)->res, confirm({title,body})->Promise<bool>, testUrl(value)->{ok,text}, api}
export function SettingRow(item, deps) {
  const id = `st-${item.key}`;
  const status = h('span', { class: 'st-status', role: 'status', id: `${id}-status` });
  const setStatus = (text, kind) => { statusKind = kind || 'idle'; status.textContent = text; status.setAttribute('class', `st-status is-${kind || 'idle'}`); };
  let value = String((item.value ?? item.default) ?? '');
  let statusKind = 'idle';
  let inflight = false;

  const commit = async (next, extra) => {
    // Same value as the last saved one: send nothing. Only a stale error is cleared; a good status stays.
    if (!extra && String(next) === value) { if (statusKind === 'fail') setStatus('', 'idle'); return true; }
    if (inflight) return false;
    inflight = true;
    setStatus('saving…', 'busy');
    try {
      const res = await deps.save(item, next, extra);
      const v = verifyStatus(res);
      setStatus(v.text, v.ok ? 'ok' : 'fail');
      if (v.ok) value = String(next);
      return v.ok;
    } catch (err) {
      const d = (err && err.data) || {};
      if (err && (err.status === 409 || d.error === 'needs_confirm') && !(extra && extra.confirm)) {
        inflight = false; // the confirmed retry below is a fresh commit, not a second click
        const go = await deps.confirm({ title: `Save ${item.key}?`, body: `${item.key} runs as a shell command: ${d.command || next}`, danger: true, confirmLabel: 'Save command' });
        if (go) return commit(next, { confirm: true });
        setStatus('✗ not saved: cancelled', 'fail');
        return false;
      }
      setStatus(errorStatus(err, next), 'fail');
      return false;
    } finally {
      inflight = false;
    }
  };

  const textInput = (type) => h('input', {
    id, class: 'input', type, value, 'aria-label': item.title || item.key,
    ...(item.range && type === 'number' ? { min: item.range.min, max: item.range.max, step: item.range.step || 1 } : {}),
  });
  let control;
  let clampTo = null;
  if (item.control) control = item.control;
  else if (item.kind === 'toggle') {
    const sw = h('button', { type: 'button', id, role: 'switch', class: 'pg-switch', 'aria-label': item.title || item.key });
    const paint = () => { const on = isOn(item, value); sw.setAttribute('aria-checked', String(on)); sw.setAttribute('class', `pg-switch${on ? ' is-on' : ''}`); sw.textContent = on ? 'On' : 'Off'; };
    paint();
    sw.addEventListener('click', async () => {
      const on = !isOn(item, value);
      const before = value;
      if (!(await commit(on ? (item.on ?? 'on') : (item.off ?? 'off')))) value = before;
      paint();
    });
    control = sw;
  } else if (item.kind === 'select' || item.kind === 'choice') {
    const opts = (item.options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
    if (value !== '' && !opts.some((o) => o.value === value)) opts.push({ value, label: value });
    const sel = h('select', { id, class: 'select', 'aria-label': item.title || item.key },
      ...opts.map((o) => h('option', { value: o.value, selected: o.value === value, title: o.hint || '' }, o.label || o.value)));
    sel.addEventListener('change', async () => { const next = sel.value; if (!(await commit(next))) sel.value = value; });
    control = sel;
  } else if (item.kind === 'number') {
    const input = textInput('number');
    // Typed values go to the server as typed; its 400 out_of_range is shown and the field keeps what was typed.
    const go = async () => {
      const raw = String(input.value).trim();
      if (raw === '' || !Number.isFinite(Number(raw))) { setStatus('✗ not saved: enter a number', 'fail'); input.value = value; return; }
      if (!(await commit(raw)) && !/outside/.test(status.textContent)) input.value = value;
    };
    const step = (dir) => () => { const st = (item.range && item.range.step) || 1; const n = clampNumber(item.range, Number(input.value || value || 0) + dir * st); input.value = String(n); return go(); };
    // One save path: the change event. Enter blurs the field, so Enter and blur make exactly one request.
    input.addEventListener('change', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    const dec = h('button', { type: 'button', class: 'btn st-step', 'aria-label': `Decrease ${item.title || item.key}` }, '−');
    const inc = h('button', { type: 'button', class: 'btn st-step', 'aria-label': `Increase ${item.title || item.key}` }, '+');
    dec.addEventListener('click', step(-1));
    inc.addEventListener('click', step(1));
    clampTo = input;
    control = h('span', { class: 'st-inline' }, dec, input, inc);
  } else if (item.kind === 'model') {
    control = ModelPicker({ api: deps.api, value, defaultValue: item.default, onPick: (name) => commit(name) });
  } else {
    // url, command and text: a text input; only these kinds ever take free text.
    const input = textInput('text');
    let saving = false;
    const save = async () => {
      if (saving) return;
      saving = true;
      try { await saveNow(); } finally { saving = false; }
    };
    const saveNow = async () => {
      let extra;
      if (item.kind === 'command' && input.value !== value) {
        if (!(await deps.confirm({ title: `Save ${item.key}?`, body: `This is run as a shell command on every matching prompt:\n${input.value}`, danger: true, confirmLabel: 'Save command' }))) { setStatus('✗ not saved: cancelled', 'fail'); return; }
        extra = { confirm: true };
      }
      if (!(await commit(input.value, extra))) input.value = value;
    };
    // Blur saves (change event); Enter blurs, so Enter, blur and the Save button never double-send.
    input.addEventListener('change', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    const btns = [h('button', { type: 'button', class: 'btn', id: `${id}-save` }, 'Save')];
    btns[0].addEventListener('click', save);
    if (item.kind === 'url') {
      const result = h('span', { class: 'st-hint', role: 'status' });
      const test = h('button', { type: 'button', class: 'btn', id: `${id}-test` }, 'Test');
      test.addEventListener('click', async () => {
        result.textContent = 'testing…';
        try { result.textContent = (await deps.testUrl(input.value)).text; } catch (err) { result.textContent = `✗ ${(err && err.error) || 'unreachable'}`; }
      });
      btns.push(test, result);
    }
    control = h('span', { class: 'st-inline' }, input, ...btns);
  }

  const lvs = liveVsSaved(item);
  const files = item.scope === 'shell' ? writtenLayers(item) : [];
  const search = `${item.key} ${item.title || ''} ${item.description || ''} ${item.effect || ''}`.toLowerCase();
  const el = h('li', { class: 'st-card', id: `${id}-row` },
    h('div', { class: 'st-head' },
      h('label', { class: 'st-title', for: id }, item.title || item.key),
      appliesLabel(item.applies) ? h('span', { class: 'st-badge', 'data-applies': item.applies }, appliesLabel(item.applies)) : null),
    item.description ? h('p', { class: 'st-desc' }, item.description) : null,
    item.effect ? h('p', { class: 'st-effect' }, `Effect: ${item.effect}`) : null,
    h('div', { class: 'st-ctl' }, control),
    lvs ? h('p', { class: 'st-live' }, lvs) : null,
    files.length ? h('p', { class: 'st-files' }, `Writes: ${files.join(', ')}`) : null,
    status);
  el.search = search;
  el.clampInput = clampTo;
  return el;
}

// ---- filter ---------------------------------------------------------------------------------
export function rowMatches(search, q) {
  const n = String(q || '').trim().toLowerCase();
  return !n || search.includes(n);
}
