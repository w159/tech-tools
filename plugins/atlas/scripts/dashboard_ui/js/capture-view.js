// Seat text view for runtimes with no web UI (GET /api/v2/herd/capture). Pure helpers: fleet.js owns the DOM.

export const CAPTURE_LINES = 60;
export const CAPTURE_MS = 2000;

// One poll result -> what the <pre> shows. `failure` is a thrown ApiError (or any Error); errors become text, never throw.
export function captureDisplay(res, failure) {
  if (failure) {
    const why = failure.why || failure.error || failure.message || "capture failed";
    return { text: "Could not read this terminal: " + why, isError: true };
  }
  const text = res && typeof res.text === "string" ? res.text.replace(/\s+$/, "") : "";
  return text ? { text, isError: false } : { text: "waiting for output", isError: false };
}

// Polls fetchOnce() every `ms` until isGone() is true. A tick is skipped while isHidden() is true (hidden tab, other panel)
// and never overlaps a slow request. Returns stop().
export function pollCapture({ fetchOnce, onUpdate, isHidden, isGone, ms = CAPTURE_MS }) {
  let timer = null;
  let busy = false;
  let dead = false;
  const stop = () => { dead = true; clearInterval(timer); };
  const tick = async () => {
    if (dead) return;
    if (isGone()) return stop();
    if (busy || isHidden()) return;
    busy = true;
    try {
      onUpdate(captureDisplay(await fetchOnce()));
    } catch (err) {
      onUpdate(captureDisplay(null, err));
    } finally {
      busy = false;
    }
  };
  timer = setInterval(tick, ms);
  tick();
  return stop;
}
