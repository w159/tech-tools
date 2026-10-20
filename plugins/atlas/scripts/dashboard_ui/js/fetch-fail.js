// One shared, dismissable "fetch failed / data may be stale" banner. Call sites keep their fallback and also
// report here; the next successful fetch of the same endpoint clears that failure.
import { h } from "./dom.js";

const fails = new Map(); // endpoint -> { page, endpoint, error, at, n }
let el = null;

const msg = (e) => String([e && e.error, e && e.message, e, "failed"].find(Boolean));
const hhmmss = (d) => d.toTimeString().slice(0, 8);

// Small pure helpers keep each function under the complexity gate.
const canPaint = () => typeof document !== "undefined" && !!document.body && !!document.body.prepend;
const lastOf = (list) => list.reduce((a, b) => (b.at >= a.at ? b : a));
function bannerText(list) {
  const last = lastOf(list);
  const total = list.reduce((s, f) => s + f.n, 0);
  return "Stale data: " + last.page + " " + last.endpoint + " failed (" + msg(last.error) + ") at " + hhmmss(last.at) + (total > 1 ? " - " + total + " failures" : "");
}
const buildBanner = () => h("div", { class: "fetch-fail-banner", role: "alert" },
  h("span", {}, bannerText([...fails.values()])),
  h("button", { class: "btn", type: "button", onClick: () => { fails.clear(); paint(); } }, "Dismiss"));
function unmount() { if (el && el.remove) el.remove(); el = null; }
function mount(node) {
  if (el && el.replaceWith) el.replaceWith(node); else document.body.prepend(node);
  el = node;
}

function paint() {
  if (!canPaint()) return;
  if (!fails.size) { unmount(); return; }
  mount(buildBanner());
}

export function reportFetchFail(page, endpoint, error) {
  const p = fails.get(endpoint);
  fails.set(endpoint, { page, endpoint, error, at: new Date(), n: (p ? p.n : 0) + 1 });
  paint();
}

export function clearFetchFail(endpoint) {
  if (fails.delete(endpoint)) paint();
}

export const fetchFailures = () => [...fails.values()];
