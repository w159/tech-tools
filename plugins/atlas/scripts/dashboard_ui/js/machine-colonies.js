// Rail section "This machine": the live Atlas colonies from GET term/snapshot (the Terminal page's data), not herdr workspaces.
import { h, replace } from "./dom.js";
import { api } from "./api.js";
import { spaceName, lastSnap } from "./pages/terminal.js";

const POLL_MS = 5000;

// One row per colony: green when any seat is working, amber when any is blocked, gray otherwise (idle/finished).
export function colonyRows(snap) {
  const seats = (snap && snap.seats) || [];
  return ((snap && snap.colonies) || []).map((c) => {
    const mine = seats.filter((s) => s.colony === c.id);
    const state = mine.some((s) => s.state === "working") ? "working" : mine.some((s) => s.state === "blocked") ? "blocked" : "idle";
    const project = c.project || (snap && snap.project) || "";
    return { id: c.id, name: spaceName(c), title: c.title || "", project: project.split("/").filter(Boolean).pop() || project, finished: Boolean(c.finished), state, seats: mine.length };
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
        ? rows.map((r) => h("a", { class: "tree-row rail-colony" + (r.finished ? " is-finished" : ""), href: "#/terminal?space=" + encodeURIComponent(r.id), "data-colony": r.id, "aria-label": r.name + ", " + r.project + ", " + r.state + ", " + r.seats + " seats" },
            h("span", { class: "tree-dot", "data-state": r.state, "aria-hidden": "true" }),
            h("span", { class: "tree-label truncate", title: r.title || r.id }, r.name),
            h("span", { class: "tree-age dim truncate" }, r.finished ? "finished" : r.project),
            h("span", { class: "tree-count num dim" }, String(r.seats))))
        : h("p", { class: "tree-note dim" }, "No colonies running"));
  };
  root.refresh = async () => {
    const p = getProject ? getProject() : "all";
    const q = !p || p === "all" ? { all: "1" } : { project: p };
    try {
      const snap = await api.get("term/snapshot", q);
      lastSnap.key = JSON.stringify(q); lastSnap.snap = snap;
      draw(snap);
    } catch { draw(null); }
  };
  root.refresh();
  if (poll) {
    const t = setInterval(() => { if (!alive) return clearInterval(t); if (!document.hidden) root.refresh(); }, POLL_MS);
    root.stop = () => { alive = false; };
  }
  return root;
}
