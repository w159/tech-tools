// Channels refresh policy: the SSE `irc` event drives a re-fetch (no timer). Only while SSE is not live (conn poll,
// reconnecting, idle) a slow fallback interval runs, and it stops as soon as the stream is live again.
// startChannelSync({ store, refresh, skip(), fallbackMs, timers }) -> stop()

export const FALLBACK_MS = 30000;

export function startChannelSync({ store, refresh, skip = () => false, fallbackMs = FALLBACK_MS, timers = { set: (f, ms) => setInterval(f, ms), clear: (id) => clearInterval(id) } }) {
  // Arrow wrappers: a bare `setInterval` called as timers.set() gets this=timers and browsers throw "Illegal invocation".
  let iv = null;
  const tick = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (!skip()) refresh();
  };
  const offState = store.subscribe((st) => {
    const live = st.conn === "live";
    if (live && iv) { timers.clear(iv); iv = null; }
    else if (!live && !iv) iv = timers.set(tick, fallbackMs);
  });
  // Delivery receipts and member state change server side and arrive as `irc`; refresh() already de-dupes overlapping runs.
  const offEvent = store.onEvent((name) => { if (name === "irc" && !skip()) refresh(); });
  return () => { offState(); offEvent(); if (iv) timers.clear(iv); iv = null; };
}
