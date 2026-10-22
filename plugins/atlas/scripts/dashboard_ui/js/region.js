// Browser glue for region renderers: one delegated click/keydown handler per host.
// data-action="retry" (from renderRegionState) and every row action route through `handlers`.
export function bindRegion(host, handlers) {
  const fire = (ev) => {
    const el = ev.target.closest("[data-action]");
    if (!el || !host.contains(el)) return;
    const fn = handlers[el.dataset.action];
    if (fn) fn(el, ev);
  };
  const onKey = (ev) => {
    if (ev.key !== "Enter" || ev.target.matches("input, textarea, select, button, a")) return;
    fire(ev);
  };
  host.addEventListener("click", fire);
  host.addEventListener("keydown", onKey);
  return () => {
    host.removeEventListener("click", fire);
    host.removeEventListener("keydown", onKey);
  };
}
