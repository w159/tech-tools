// Pure logic for the Projects page: pinned, visible and hidden splits and the pref patches.

/** Split projects into pinned (first), visible and hidden, each newest-active first. */
export function splitProjects(projects, pinned = [], hidden = []) {
  const byActivity = (a, b) =>
    String(b.last_active || "").localeCompare(String(a.last_active || ""));
  const hid = new Set(hidden);
  const pin = new Set(pinned);
  const all = [...(projects || [])].sort(byActivity);
  const shown = all.filter((p) => !hid.has(p.root));
  return {
    visible: [
      ...shown.filter((p) => pin.has(p.root)),
      ...shown.filter((p) => !pin.has(p.root)),
    ],
    hidden: all.filter((p) => hid.has(p.root)),
  };
}

/** Toggle `root` in a pref list, returning a new array. */
export function toggled(list, root) {
  const set = new Set(list || []);
  if (set.has(root)) set.delete(root);
  else set.add(root);
  return [...set];
}

/** Pin and Hide are exclusive: hiding a pinned project unpins it. */
export function hidePatch(prefs, root) {
  const hidden = toggled(prefs.hidden_projects, root);
  const nowHidden = hidden.includes(root);
  return {
    hidden_projects: hidden,
    pinned_projects: nowHidden
      ? (prefs.pinned_projects || []).filter((r) => r !== root)
      : prefs.pinned_projects || [],
  };
}

export function pinPatch(prefs, root) {
  return { pinned_projects: toggled(prefs.pinned_projects, root) };
}

/** Health word for a project row: the API sends ok|warn|fail. */
export function projectHealth(h) {
  if (h === "fail") return { raw: "fail", word: "Failing" };
  if (h === "warn") return { raw: "input", word: "Warning" };
  if (h === "ok") return { raw: "done", word: "Healthy" };
  return { raw: "unknown", word: "Unknown" };
}
