// Rail section "This machine": the live Atlas colonies from GET term/snapshot (the Atlas Colony page's data), not herdr workspaces.
import { h, replace } from "./dom.js";
import { api } from "./api.js";

const POLL_MS = 5000;

// One row per colony: green when any seat is working, amber when any is blocked, gray otherwise (idle/finished).
export function colonyRows(snap) {
  const seats = (snap && snap.seats) || [];
  return ((snap && snap.colonies) || []).map((c) => {
    const mine = seats.filter((s) => s.colony === c.id);
    const state = mine.some((s) => s.state === "working") ? "working" : mine.some((s) => s.state === "blocked") ? "blocked" : "idle";
    const project = c.project || (snap && snap.project) || "";
    return { id: c.id, project: project.split("/").filter(Boolean).pop() || project, state, seats: mine.length };
  });
}

export function MachineColonies({ getProject, poll = true } = {}) {
  const root = h("div", { class: "rail-tree machine-colonies", role: "group", "aria-label": "This machine" });
  let alive = true;
  const draw = (snap) => {
    const rows = colonyRows(snap);
    replace(root,
      h("div", { class: "tree-row tree-host" }, h("span", { class: "tree-label truncate" }, "This machine"), h("span", { class: "tree-tag dim" }, (snap && snap.host) || "")),
      rows.length
        ? rows.map((r) => h("a", { class: "tree-row rail-colony", href: "#/terminal?space=" + encodeURIComponent(r.id), "data-colony": r.id, "aria-label": r.id + ", " + r.project + ", " + r.state + ", " + r.seats + " seats" },
            h("span", { class: "tree-dot", "data-state": r.state, "aria-hidden": "true" }),
            h("span", { class: "tree-label truncate mono" }, r.id),
            h("span", { class: "tree-age dim truncate" }, r.project),
            h("span", { class: "tree-count num dim" }, String(r.seats))))
        : h("p", { class: "tree-note dim" }, "No colonies running"));
  };
  root.refresh = async () => {
    const p = getProject ? getProject() : "all";
    try { draw(await api.get("term/snapshot", !p || p === "all" ? { all: "1" } : { project: p })); } catch { draw(null); }
  };
  root.refresh();
  if (poll) {
    const t = setInterval(() => { if (!alive) return clearInterval(t); if (!document.hidden) root.refresh(); }, POLL_MS);
    root.stop = () => { alive = false; };
  }
  return root;
}
