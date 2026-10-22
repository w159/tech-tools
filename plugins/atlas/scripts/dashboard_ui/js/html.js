// HTML-string helpers shared by the page region renderers. Pure: no DOM.
import { renderRegionState } from "./region-state.js";

export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/** The shared loading / error / empty state for a main region, or null when there is data to render. */
export function gate({ loaded, error, count }, name) {
  if (!loaded) return renderRegionState("loading", name);
  if (error && !count) return renderRegionState("error", name, error);
  if (!count) return renderRegionState("empty", name);
  return null;
}
