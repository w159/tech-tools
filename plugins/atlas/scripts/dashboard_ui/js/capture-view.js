// Seat text view for runtimes with no web UI (GET /api/v2/herd/capture). Pure helpers: fleet.js owns the DOM.

export const CAPTURE_LINES = 60;
const CAPTURE_MS = 2000;

// One poll result -> what the <pre> shows. `failure` is a thrown ApiError (or any Error); errors become text, never throw.
const failureText = (f) => "Could not read this terminal: " + (f.why || f.error || f.message || "capture failed");
const okText = (res) => (res && typeof res.text === "string" ? res.text.replace(/\s+$/, "") : "");

export function captureDisplay(res, failure) {
  if (failure) return { text: failureText(failure), isError: true };
  return { text: okText(res) || "waiting for output", isError: false };
}

// Polls fetchOnce() every `ms` until isGone() is true. A tick is skipped while isHidden() is true (hidden tab, other panel)
// and never overlaps a slow request. Returns stop().
export function pollCapture({ fetchOnce, onUpdate, isHidden, isGone, ms = CAPTURE_MS }) {
  let timer = null;
  let busy = false;
  let dead = false;
  const stop = () => { dead = true; clearInterval(timer); };
  const skip = () => busy || isHidden();
  const poll = async () => {
    try {
      onUpdate(captureDisplay(await fetchOnce()));
    } catch (err) {
      onUpdate(captureDisplay(null, err));
    }
  };
  const tick = async () => {
    if (dead) return;
    if (isGone()) return stop();
    if (skip()) return;
    busy = true;
    try {
      await poll();
    } finally {
      busy = false;
    }
  };
  timer = setInterval(tick, ms);
  tick();
  return stop;
}
