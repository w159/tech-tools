// Pure logic for the Board page. No DOM, no network (unit-tested in board-model.test.js).
import { flattenTodos } from "./agents-model.js";

export const COLUMNS = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

export const STATUS_TONE = {
  open: "neutral",
  in_progress: "working",
  blocked: "needs",
  done: "ok",
};

export function statusLabel(status) {
  return (COLUMNS.find((c) => c.status === status) || { label: status }).label;
}

/** Items per column, keeping server order. Unknown statuses land in Open. */
export function columnsOf(state) {
  const cols = Object.fromEntries(COLUMNS.map((c) => [c.status, []]));
  for (const it of flattenTodos(state)) (cols[it.status] || cols.open).push(it);
  return cols;
}

/** Menu entries for one card, in display order. `assign` is handled by the page (needs a picker). */
export function menuFor(item, { archived = false } = {}) {
  if (archived)
    return [
      { id: "restore", label: "Restore" },
      { id: "remove", label: "Remove", danger: true },
    ];
  const out = [];
  if (item.status === "open" || item.status === "blocked")
    out.push({ id: "start", label: "Start" });
  if (item.status !== "done") out.push({ id: "done", label: "Mark done" });
  if (item.status === "done" || item.status === "in_progress")
    out.push({ id: "reopen", label: "Reopen" });
  if (item.status !== "done" && item.status !== "blocked")
    out.push({ id: "blocked", label: "Mark blocked" });
  out.push({ id: "assign", label: "Assign to agent" });
  out.push({ id: "remove", label: "Remove", danger: true });
  return out;
}

/**
 * POST /api/v2/todos body for a menu action. `project` is the item's own project root when the
 * board shows all projects. Op names come from OPS in atlas_dash_work.py.
 * "Start" only moves the item to In progress. The server's own op "start" spawns an agent pane,
 * which a card menu click should not do silently; Assign covers handing it to an agent.
 */
export function opBody(action, item, project, extra = {}) {
  const base = { project: item.project || project, id: item.id };
  switch (action) {
    case "start":
      return {
        ...base,
        op: "status",
        status: "in_progress",
        evidence: "started from the Command Center",
      };
    case "restore":
      return { ...base, op: "restore" };
    case "done":
      return {
        ...base,
        op: "status",
        status: "done",
        evidence: "marked done from the Command Center",
      };
    case "reopen":
      return { ...base, op: "status", status: "open" };
    case "blocked":
      return { ...base, op: "status", status: "blocked" };
    case "assign":
      return { ...base, op: "assign", owner: extra.owner || "" };
    case "remove":
      return { ...base, op: "remove" };
    default:
      throw new Error(`unknown board action: ${action}`);
  }
}
