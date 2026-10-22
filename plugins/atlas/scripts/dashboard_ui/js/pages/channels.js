// Channels page: channel list, one feed (newest at the bottom), seat filter, search, composer.
// The Activity history lives here as the synthetic "~activity" channel.
import { h, replace, relTime } from "../dom.js";
import { PageHeader, Button, Input, Select, Textarea, toast } from "../ui.js";
import { get, post, topics, describeError } from "../api.js";
import { renderRegionState } from "../region-state.js";
import { esc, gate } from "../html.js";
import { bindRegion } from "../region.js";
import {
  channelRows,
  pickChannel,
  recipientOptions,
  isAgentAuthor,
  kindPill,
  routeText,
  clockTime,
  sameFeed,
  activityToFeed,
  filterFeed,
  seatOptions,
  HISTORY_CHANNEL,
  EVERYONE,
} from "./channels-model.js";

const POLL_MS = 5000;
// Last time each channel was viewed this session; outlives re-renders so the unread dot is stable.
const SEEN = new Map();

function feedRow(m, history) {
  const pill = kindPill(m.kind);
  const route = history ? m.from || "atlas" : routeText(m);
  const mono = history || isAgentAuthor(m.from) ? " mono" : "";
  return (
    '<article class="feed-row">' +
    `<time class="mono" datetime="${esc(m.ts)}">${esc(clockTime(m.ts))}</time>` +
    `<span class="feed-from mono">${esc(route)}</span>` +
    (pill ? `<span class="feed-pill mono">${esc(pill)}</span>` : "") +
    `<p class="feed-body${mono}">${esc(m.body)}</p></article>`
  );
}

/** The feed region as an HTML string (pure; unit-tested). `hasFilter` marks a narrowed view. */
export function renderFeedRegion({
  messages = [],
  loaded = false,
  error = null,
  history = false,
  hasFilter = false,
}) {
  if (loaded && !error && !messages.length && hasFilter)
    return '<div class="region-state empty">No messages match.</div>';
  const gated = gate({ loaded, error, count: messages.length }, "messages");
  if (gated) return gated;
  return `<div class="feed">${messages.map((m) => feedRow(m, history)).join("")}</div>`;
}

/** The channel list region as an HTML string (pure). The history entry is always first. */
export function renderChannelListRegion({
  channels = [],
  name = "",
  seen = new Map(),
  loaded = false,
  error = null,
}) {
  if (!loaded) return renderRegionState("loading", "channels");
  if (error) return renderRegionState("error", "channels", error);
  const item = (n, meta, unread) =>
    `<button type="button" class="chan-item" data-action="select" data-name="${esc(n)}"${n === name ? ' aria-current="true"' : ""}>` +
    `<span class="chan-name mono">${esc(n)}${unread ? '<i class="chan-unread" title="New messages"></i>' : ""}</span>` +
    `<span class="meta mono">${esc(meta)}</span></button>`;
  const rows = channelRows(channels).map((r) => {
    const seenAt = seen.get(r.name);
    const unread = seenAt != null && r.name !== name && r.lastActivityMs > seenAt;
    const meta = `${r.memberCount} ${r.memberCount === 1 ? "member" : "members"}${r.lastActivityMs ? ` · ${relTime(r.lastActivityMs)}` : ""}`;
    return item(r.name, meta, unread);
  });
  return [item(HISTORY_CHANNEL, "what Atlas recorded", false), ...rows].join("");
}

export async function render(ctx) {
  const { root, params, project, setParams } = ctx;
  const S = {
    channels: [],
    name: "",
    messages: [],
    channel: null,
    seat: "",
    q: "",
    listLoaded: false,
    listError: null,
    feedLoaded: false,
    feedError: null,
    seen: SEEN,
    disposed: false,
  };
  const projectParam = project && project !== "all" ? { project } : {};
  const isHistory = () => S.name === HISTORY_CHANNEL;

  const listEl = h("nav", { class: "chan-list region", "aria-label": "Channels" });
  const feedEl = h("div", {
    class: "chan-feed region",
    role: "log",
    "aria-live": "polite",
  });
  const composerEl = h("div", { class: "chan-composer" });
  const titleEl = h("h2", { class: "chan-title mono" });
  const seatEl = Select({ options: seatOptions([]), value: "", label: "Seat" });
  const searchEl = Input({
    type: "search",
    placeholder: "Search messages",
    "aria-label": "Search messages",
  });
  const bar = h("div", { class: "chan-bar" }, titleEl, seatEl, searchEl);
  const pane = h("section", { class: "chan-pane" }, bar, feedEl, composerEl);

  function paintList() {
    listEl.innerHTML = renderChannelListRegion({
      channels: S.channels,
      name: S.name,
      seen: S.seen,
      loaded: S.listLoaded,
      error: S.listError,
    });
  }

  function paintFeed() {
    const atBottom =
      feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 40;
    const shown = filterFeed(S.messages, S);
    feedEl.innerHTML = renderFeedRegion({
      messages: shown,
      loaded: S.feedLoaded,
      error: S.feedError,
      history: isHistory(),
      hasFilter: !!(S.seat || S.q.trim()),
    });
    if (atBottom) feedEl.scrollTop = feedEl.scrollHeight;
  }

  function paintSeats() {
    const keep = S.seat;
    seatEl.replaceChildren(
      ...seatOptions(S.messages).map((o) => h("option", { value: o.value }, o.label)),
    );
    seatEl.value = keep;
    if (seatEl.value !== keep) S.seat = seatEl.value;
  }

  function paintComposer() {
    composerEl.hidden = isHistory();
    if (isHistory()) return replace(composerEl);
    const to = Select({
      options: recipientOptions(S.channel),
      value: EVERYONE,
      label: "To",
      class: "chan-to",
    });
    const body = Textarea({
      rows: 2,
      placeholder: "Message",
      "aria-label": "Message",
      class: "chan-input",
    });
    const send = Button({ variant: "primary" }, "Send");
    const go = async () => {
      const text = body.value.trim();
      if (!text) return;
      send.disabled = true;
      send.setAttribute("aria-busy", "true");
      try {
        await post("/api/v2/channels", {
          channel: S.name,
          to: to.value,
          body: text,
          from: "you",
          ...projectParam,
        });
        body.value = "";
        await loadFeed();
        // The server records the message a moment after it replies; fetch once more so it shows without waiting for the poll.
        setTimeout(
          () => loadFeed().catch((e) => console.error("channel refresh failed", e)),
          1200,
        );
      } catch (e) {
        const d = describeError(e);
        toast(d.message, { kind: "error", detail: d.detail });
      } finally {
        send.disabled = false;
        send.removeAttribute("aria-busy");
      }
    };
    send.addEventListener("click", go);
    body.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) go();
    });
    replace(
      composerEl,
      h("label", { class: "field chan-to-field" }, h("span", { class: "label" }, "To"), to),
      body,
      send,
    );
  }

  async function loadFeed() {
    if (!S.name) return;
    const name = S.name;
    let fresh;
    if (name === HISTORY_CHANNEL) {
      fresh = activityToFeed(
        await get("/api/v2/activity", { window: "7d", group: "agent", ...projectParam }),
      );
    } else {
      const res = await get(`/api/v2/channels/${encodeURIComponent(name)}`, {
        limit: 200,
        ...projectParam,
      });
      if (name !== S.name) return; // the person switched channels while this was in flight
      fresh = res.messages || [];
      S.channel = res.channel || S.channel;
    }
    if (name !== S.name) return;
    const first = !S.feedLoaded;
    S.feedError = null;
    S.feedLoaded = true;
    if (first) paintComposer();
    if (first || !sameFeed(S.messages, fresh)) {
      S.messages = fresh;
      paintSeats();
      paintFeed();
    }
    S.seen.set(name, Date.now());
    paintList();
  }

  async function select(name, { push = true } = {}) {
    // setParams fires hashchange, which re-renders this page with params.channel set.
    if (push) return setParams({ channel: name });
    S.name = name;
    S.channel = null;
    S.messages = [];
    S.seat = "";
    S.feedLoaded = false;
    S.feedError = null;
    titleEl.textContent = name || "";
    paintSeats();
    paintFeed();
    paintList();
    try {
      await loadFeed();
    } catch (e) {
      S.feedError = describeError(e).message;
      S.feedLoaded = true;
      paintFeed();
    }
  }

  async function loadList() {
    try {
      const res = await get("/api/v2/channels", projectParam);
      S.channels = res.channels || [];
      S.listError = null;
    } catch (e) {
      S.listError = describeError(e).message;
      S.listLoaded = true;
      paintList();
      throw e;
    }
    S.listLoaded = true;
    // First sight of a channel counts as read; only later activity raises the dot.
    for (const r of channelRows(S.channels))
      if (!S.seen.has(r.name)) S.seen.set(r.name, r.lastActivityMs);
    const wanted = S.name || params.channel;
    const want = wanted === HISTORY_CHANNEL ? wanted : pickChannel(S.channels, wanted);
    if (want !== S.name) await select(want, { push: false });
    else paintList();
  }

  const start = () =>
    loadList().catch((e) => console.error("channels load failed", e));

  const unbind = [
    bindRegion(listEl, {
      select: (el) => select(el.dataset.name),
      retry: () => {
        S.listLoaded = false;
        paintList();
        start();
      },
    }),
    bindRegion(feedEl, {
      retry: () => {
        S.feedLoaded = false;
        S.feedError = null;
        paintFeed();
        select(S.name, { push: false });
      },
    }),
  ];
  seatEl.addEventListener("change", () => {
    S.seat = seatEl.value;
    paintFeed();
  });
  searchEl.addEventListener("input", () => {
    S.q = searchEl.value;
    paintFeed();
  });

  replace(
    root,
    PageHeader({
      title: "Channels",
      description: "Messages between you and the agents, and what Atlas recorded.",
    }),
    h("div", { class: "chan-layout" }, listEl, pane),
  );
  paintList();
  paintFeed();
  await start();
  feedEl.scrollTop = feedEl.scrollHeight;

  let busy = false;
  const tick = async () => {
    if (busy || S.disposed || document.visibilityState === "hidden") return;
    busy = true;
    try {
      await loadList();
      await loadFeed();
    } catch (e) {
      console.error("channels refresh failed", e);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, POLL_MS);
  const unsub = topics.irc.subscribe(() => tick());
  return () => {
    S.disposed = true;
    clearInterval(timer);
    unsub();
    unbind.forEach((u) => u());
  };
}
