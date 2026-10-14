// DOM buttons shared by Health failure cards and Overview attention items.
import { h, copyText } from './dom.js';
import { failureAction } from './health-fix.js';

// The card's one action (copy / open), or null when nothing concrete exists.
export function actionButton(f, subs, navigate) {
  const a = failureAction(f, subs);
  if (a.type === 'none') return null;
  const btn = h('button', { type: 'button', class: 'btn', title: a.text || a.target }, a.label);
  btn.addEventListener('click', async () => {
    if (a.type === 'link') return navigate(a.target);
    const ok = await copyText(a.text);
    btn.textContent = ok ? 'Copied' : 'Copy failed: select the text in Do this';
    setTimeout(() => { btn.textContent = a.label; }, 2500);
    return undefined;
  });
  return btn;
}

// Persists the dismissal server side, then lets the caller refresh. A recurrence re-opens the item.
export function dismissButton(f, api, onDone, undo = false) {
  const btn = h('button', { type: 'button', class: 'btn btn-ghost', title: undo ? 'Show this item again' : 'Hide until it happens again' }, undo ? 'Restore' : 'Dismiss');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await api.post('/api/v2/dismiss', undo ? { id: f.id, undo: true } : { id: f.id });
      onDone();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = `Failed: ${(err && err.error) || 'retry'}`;
    }
  });
  return btn;
}
