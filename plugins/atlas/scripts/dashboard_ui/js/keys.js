// Keymap binder mirroring the TUI keys. Pure DOM-event plumbing, no page knowledge.
export const RUN_KEYS = ["1", "2", "3", "f", "i", "m", "h", "Escape", "/"];

export function isTypingIn(el) {
  return (
    !!el &&
    (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.isContentEditable)
  );
}

// Returns an unbind function. Escape always passes so overlays can close from a field.
export function bindKeys(map, { isTyping = () => false, target = document } = {}) {
  const onKey = (ev) => {
    const fn = map[ev.key];
    if (!fn) return;
    if (ev.key !== "Escape" && isTyping()) return;
    ev.preventDefault();
    fn(ev);
  };
  target.addEventListener("keydown", onKey);
  return () => target.removeEventListener("keydown", onKey);
}
