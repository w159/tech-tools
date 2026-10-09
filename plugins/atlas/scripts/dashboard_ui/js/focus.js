// Keep keyboard focus across a full re-render: capture the focused control's
// aria-label before the redraw, then re-focus the control carrying that label.
export function activeLabel(root) {
  const active = document.activeElement;
  return active && root.contains(active) ? active.getAttribute('aria-label') : null;
}

export function focusByLabel(root, label) {
  if (!label) return;
  for (const el of root.querySelectorAll('[aria-label]')) {
    if (el.getAttribute('aria-label') === label && typeof el.focus === 'function') { el.focus(); break; }
  }
}
