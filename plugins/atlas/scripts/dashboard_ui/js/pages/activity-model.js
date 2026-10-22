// Pure logic for the Activity page.

export const GROUPS = [
  { value: "project", label: "Project" },
  { value: "kind", label: "Kind" },
  { value: "agent", label: "Agent" },
];

export function normalizeGroup(v) {
  return GROUPS.some((g) => g.value === v) ? v : "project";
}

/** Kind select options: "All" first, then every kind the payload knows, by its plain label. */
export function kindOptions(kinds) {
  const rest = Object.entries(kinds || {}).map(([value, k]) => ({
    value,
    label: (k && k.label) || value,
  }));
  return [{ value: "", label: "All kinds" }, ...rest];
}

/** Plain label for a kind id; falls back to the id itself. */
export function kindLabel(kinds, id) {
  return (kinds && kinds[id] && kinds[id].label) || id || "";
}

/** Tone for an item status word. */
export function statusTone(status) {
  if (status === "fail" || status === "error") return "fail";
  if (status === "warn") return "needs";
  return "neutral";
}
