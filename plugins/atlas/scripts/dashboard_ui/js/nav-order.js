// Single source for the saved nav order: normalisation (Settings editor + rail) and group ordering (rail).

export const DEFAULT_NAV = ["overview", "activity", "health", "agents", "colony", "improve", "projects", "settings"];
// Mobile bottom bar / More popover entries: [page id, label].
export const MOBILE_TABS = [["overview", "Overview"], ["agents", "Agents"], ["activity", "Activity"], ["health", "Health"], ["colony", "Colony"], ["improve", "Improve"], ["projects", "Projects"], ["settings", "Settings"]];
// Ids saved by older versions map onto canonical pages.
export const NAV_ALIASES = { herd: "colony", work: "agents", irc: "agents", console: "colony", herdr: "colony" };

export function normalizeNav(order) {
  const seen = [];
  for (const raw of Array.isArray(order) ? order : []) {
    const id = NAV_ALIASES[raw] || raw;
    if (DEFAULT_NAV.includes(id) && !seen.includes(id)) seen.push(id);
  }
  for (const id of DEFAULT_NAV) if (!seen.includes(id)) seen.push(id);
  return seen;
}

// Pages are ranked by saved order; items sort within their group (stable, so the lens entries sharing
// page "agents" keep their fixed internal order) and groups sort by their first listed page.
export function orderGroups(groups, order) {
  const rank = new Map(normalizeNav(order).map((id, i) => [id, i]));
  const r = (it) => rank.get(it.page);
  return groups
    .map((g) => ({ ...g, items: g.items.map((it, i) => [it, i]).sort((a, b) => r(a[0]) - r(b[0]) || a[1] - b[1]).map((x) => x[0]) }))
    .map((g, i) => [g, i])
    .sort((a, b) => Math.min(...a[0].items.map(r)) - Math.min(...b[0].items.map(r)) || a[1] - b[1])
    .map((x) => x[0]);
}
