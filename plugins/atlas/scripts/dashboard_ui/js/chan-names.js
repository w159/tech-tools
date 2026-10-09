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
    lead: c.lead || null,
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
const PRESENCE = { working: "running", input: "waiting for input", idle: "idle", parked: "parked", done: "exited", fail: "failed", unknown: "no pane" };
export const presenceWord = (state) => PRESENCE[state] || "no pane";

// Todo counts for one owner. Items (atlas_dash_work._todo_view statuses: open|in_progress|done|blocked) are the source of truth:
// each counts once, blocked is its own bucket. Server owner counts (pending|in_progress|completed, blocked still inside
// pending/in_progress) are only a fallback when no items were sent.
export function todoCounts(c, items) {
  if (items && items.length) {
    const n = (s) => items.filter((i) => i.status === s).length;
    return { active: n("in_progress"), open: n("open"), blocked: n("blocked"), done: n("done") };
  }
  const k = c || {};
  return { active: k.in_progress || 0, open: k.pending || 0, blocked: 0, done: k.completed || 0 };
}
// Summary of normalised counts (todoCounts shape).
export function todoSummary(t) {
  const bits = [t.active && t.active + " active", t.open && t.open + " open", t.blocked && t.blocked + " blocked", t.done && t.done + " done"].filter(Boolean);
  return bits.length ? bits.join(", ") : "no todos";
}
export const noteText = (n) => (n ? (typeof n === "string" ? n : n.text || n.body || "") : "");

// Presence word state for a channel member: the live pane record wins, else what the channel API reports.
export function memberState(m, rec) {
  if (m.parked || m.state === "parked") return "parked"; // the server decided nothing will read its messages: no pane record overrides it
  return rec ? rec.state : m.state === "blocked" ? "input" : ["working", "idle", "done"].includes(m.state) ? m.state : "unknown";
}

// Per-member board rows for one channel: channel members joined with GET /channels/<name> board.owners, lead first.
// A member with no board owner still gets a row (zero counts); an owner that is no longer a member is kept too.
// Row: {name, role, parent, pane_id, state, counts{active,open,blocked,done}, items, current, note{text,ts}|null}.
export function memberBoard(meta, board) {
  const owners = new Map(((board && board.owners) || []).map((o) => [o.owner, o]));
  const members = ((meta && meta.members) || []).slice();
  for (const o of owners.values()) if (!members.some((m) => m.name === o.owner)) members.push({ name: o.owner, kind: o.role, parent: o.parent });
  const rows = members.map((m) => {
    const o = owners.get(m.name) || {};
    const items = o.items || [];
    const note = o.last_note ? { text: noteText(o.last_note), ts: o.last_note.ts || 0 } : null;
    return {
      name: m.name,
      role: o.role || m.kind || "subagent",
      parent: o.parent || m.parent || null,
      pane_id: m.pane_id || null,
      state: m.state || null,
      counts: todoCounts(o.counts, items),
      items,
      current: (items.find((i) => i.status === "in_progress") || {}).content || "",
      note,
    };
  });
  return rows.sort((a, b) => (b.role === "lead") - (a.role === "lead") || a.name.localeCompare(b.name));
}

// Lead subchannels (those with a parent) in listed order: the supervision lens shows one tree per lead.
export const leadChannels = (chans) => (chans || []).filter((c) => c.parent);
