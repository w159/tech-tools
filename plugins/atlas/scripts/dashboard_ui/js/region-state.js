// Shared loading / empty / error states for every region. Kept dependency-free;
// identical copies land from two branches, so do not edit without the lead.
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

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
