// Channels model: pure helpers for the list, the recipient select and the feed (brief 5.4).

export const EVERYONE = "all";
const HUMAN = new Set(["you", "human", "user"]);

/** Channel list rows, newest activity first. `last_activity` is epoch seconds on the wire. */
export function channelRows(channels) {
  return [...(channels || [])]
    .map((c) => ({
      name: c.name,
      memberCount: (c.members || []).length,
      lastActivityMs: c.last_activity ? c.last_activity * 1000 : 0,
      current: !!c.current,
    }))
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs);
}

/** The channel to open: the hash value when it exists, else the current lead channel, else the newest. */
export function pickChannel(channels, wanted) {
  const rows = channelRows(channels);
  if (wanted && rows.some((r) => r.name === wanted)) return wanted;
  return (rows.find((r) => r.current) || rows[0] || {}).name || "";
}

/** Recipient options for the composer: everyone first, then each member. */
export function recipientOptions(channel) {
  const members = ((channel && channel.members) || [])
    .map((m) => m.name)
    .filter(Boolean);
  return [
    { value: EVERYONE, label: "Everyone" },
    ...members.map((n) => ({ value: n, label: n })),
  ];
}

/** Agent-authored messages render in mono; the human ("you") renders in sans. */
export const isAgentAuthor = (from) =>
  !!from && !HUMAN.has(String(from).toLowerCase());

/** Pill text for system-level kinds, else "". */
export const kindPill = (kind) =>
  kind === "exit" || kind === "system" ? kind : "";

export const routeText = (m) =>
  `${m.from || "unknown"} -> ${m.to === EVERYONE || !m.to ? "everyone" : m.to}`;

/** "09:41" in local time; "" for an unparseable stamp. */
export function clockTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Messages in time order with duplicate ids dropped, so a poll never doubles a row. */
export function mergeMessages(existing, incoming) {
  const seen = new Map();
  for (const m of [...(existing || []), ...(incoming || [])])
    seen.set(m.id ?? `${m.ts}|${m.from}|${m.body}`, m);
  return [...seen.values()].sort((a, b) =>
    String(a.ts).localeCompare(String(b.ts)),
  );
}

/** Cheap change check for the poll: same length and same last id means nothing new. */
export function sameFeed(a, b) {
  const last = (l) => (l && l.length ? l[l.length - 1].id : null);
  return (a || []).length === (b || []).length && last(a) === last(b);
}
