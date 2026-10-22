// Pure helpers shared by the monitor pages (overview, activity, health, improve, projects). No DOM.
import { baseName } from "../dom.js";

export const WINDOWS = [
  { value: "24h", label: "24h", title: "Last 24 hours" },
  { value: "7d", label: "7d", title: "Last 7 days" },
  { value: "30d", label: "30d", title: "Last 30 days" },
];

/** Anything but a known window falls back to 7d (the server default). */
export function normalizeWindow(v) {
  return WINDOWS.some((w) => w.value === v) ? v : "7d";
}

/** Sidebar project -> ?project= value; "all" and empty are omitted. */
export function projectParam(p) {
  return p && p !== "all" ? p : undefined;
}

/** Last path segment, or a plain-English stand-in when the row has no project. */
export function projectLabel(root) {
  return root ? baseName(root) : "No project";
}

/** Whole seconds between two ISO stamps; null when either is missing or invalid. */
export function secondsBetween(start, end) {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
}

/** Map a severity word to a StateDot raw state and a plain word. */
export function severityState(sev) {
  if (sev === "fail" || sev === "error" || sev === "critical")
    return { raw: "fail", word: "Failing" };
  if (sev === "warn" || sev === "warning")
    return { raw: "input", word: "Warning" };
  return { raw: "ready", word: "Info" };
}

/** Split an attention action target "health#abc" into {route, focus}. */
export function parseTarget(target) {
  const [route, focus] = String(target || "").split("#");
  return { route: route || "", focus: focus || "" };
}
