// Shared loading / empty / error states for every region. Escaping comes from
// html.js (the single helper); the html.js <-> region-state.js import cycle is
// safe because esc is only used at call time.
import { esc } from "./html.js";

export function renderRegionState(kind, name, message) {
  if (kind === "loading") {
    return (
      '<div class="region-state loading" aria-busy="true">' +
      '<div class="skel"></div><div class="skel"></div><div class="skel"></div>' +
      "</div>"
    );
  }
  if (kind === "empty") {
    return '<div class="region-state empty">No ' + esc(name) + " yet.</div>";
  }
  if (kind === "error") {
    return (
      '<div class="region-state error" role="alert">' +
      esc(message || "Request failed") +
      ' <button class="btn" data-action="retry">Retry</button></div>'
    );
  }
  throw new Error("renderRegionState: unknown kind " + kind);
}
