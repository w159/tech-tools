// Channel naming (atlas_todo): a project's main channel is "<folder>@<branch>"; a lead's subchannel is "<main>/<lead>".
// chanInfo gives the full name plus the short display alias (the lead for subchannels), so UI can show one and title the other.

const folderName = (p) => String(p || "").replace(/\/+$/, "").split("/").pop() || "";

export function chanInfo(c) {
  const sub = Boolean(c.parent);
  return {
    full: c.name,
    alias: sub ? c.name.slice(c.parent.length + 1) : c.name,
    sub,
    parent: c.parent || null,
    folder: folderName(c.project) || String(c.name).split("@")[0],
    branch: c.branch || "",
    project: c.project || "",
  };
}

// Channel an agent belongs to: its lead subchannel when it is a member of one, else the main channel it posts in.
export function channelOf(rec, chans) {
  const hit = (c) => (c.members || []).some((m) => m.name === rec.name || (m.pane_id && m.pane_id === rec.key));
  const mine = (chans || []).filter(hit);
  const c = mine.find((x) => x.parent) || mine[0];
  return c ? chanInfo(c) : null;
}

// "folder@branch" label for a project root, from the main channels (branch is unknown for projects with no channel).
export function projectLabel(root, chans) {
  const main = (chans || []).find((c) => !c.parent && c.project === root);
  return main ? main.name : folderName(root);
}

// Presence of a channel member: pane state when a herdr pane exists, else what the channel API reports.
const PRESENCE = { working: "running", input: "waiting for input", idle: "idle", done: "exited", fail: "failed", unknown: "no pane" };
export const presenceWord = (state) => PRESENCE[state] || "no pane";

// Per-member todo counts from board owners (server keys: pending, in_progress, blocked, completed).
export function todoCounts(c) {
  const k = c || {};
  return { active: k.in_progress || 0, open: k.pending || 0, blocked: k.blocked || 0, done: k.completed || 0 };
}
export function todoSummary(c) {
  const t = todoCounts(c);
  const bits = [t.active && t.active + " active", t.open && t.open + " open", t.blocked && t.blocked + " blocked", t.done && t.done + " done"].filter(Boolean);
  return bits.length ? bits.join(", ") : "no todos";
}
export const noteText = (n) => (n ? (typeof n === "string" ? n : n.text || n.body || "") : "");
