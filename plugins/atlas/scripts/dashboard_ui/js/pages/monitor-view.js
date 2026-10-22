// DOM scaffolding shared by the monitor pages: load, skeleton, error with Retry, live re-render.
import { h, replace } from "../dom.js";
import { Button, Empty, Segmented, Skeleton } from "../ui.js";
import { describeError } from "../api.js";
import { WINDOWS, normalizeWindow } from "./monitor-model.js";

/**
 * mountView(root, header, {load, paint, stores, rows}) -> cleanup.
 * load() -> Promise<data>; paint(data) -> Node. A store update re-fetches quietly: the old content
 * stays on screen and a failed quiet refresh is ignored. A failed first load shows Empty + Retry.
 */
export function mountView(
  root,
  header,
  { load, paint, stores = [], rows = 6 },
) {
  const body = h("div", { class: "stack" });
  replace(root, header, body);
  let seq = 0;
  let dead = false;
  let loaded = false;
  let timer = null;

  async function refresh(quiet) {
    const mine = ++seq;
    if (!quiet || !loaded) replace(body, Skeleton(rows));
    try {
      const data = await load();
      if (dead || mine !== seq) return;
      loaded = true;
      replace(body, paint(data));
    } catch (e) {
      if (dead || mine !== seq || (quiet && loaded)) return;
      const d = describeError(e);
      replace(
        body,
        Empty({
          title: "Could not load this page.",
          body: [d.message, d.detail].filter(Boolean).join(". "),
          action: Button({ onClick: () => refresh(false) }, "Retry"),
        }),
      );
    }
  }

  // Stream bursts collapse into one fetch.
  const onStore = () => {
    clearTimeout(timer);
    timer = setTimeout(() => refresh(true), 400);
  };
  const unsubs = stores.map((s) => s.subscribe(onStore));
  refresh(false);
  return () => {
    dead = true;
    clearTimeout(timer);
    unsubs.forEach((u) => u());
  };
}

/** Window Segmented bound to the hash (window=24h|7d|30d). */
export function WindowControl(ctx) {
  return Segmented({
    label: "Time window",
    options: WINDOWS,
    value: normalizeWindow(ctx.params.window),
    onChange: (w) => ctx.setParams({ window: w }),
  });
}

/**
 * Disclosure(open, key, summary, detail): a native details element whose open state survives
 * re-renders because `open` (a Set owned by the page) records it.
 */
export function Disclosure(open, key, summary, detail) {
  const el = h(
    "details",
    { class: "disclosure", open: open.has(key) },
    h("summary", {}, summary),
    h("div", { class: "disclosure-body" }, detail),
  );
  el.addEventListener("toggle", () => {
    if (el.open) open.add(key);
    else open.delete(key);
  });
  return el;
}
