// Channels page (brief 5.4): channel list, message feed, composer. Live by stream trigger plus a 5 s poll.
import { h, replace, relTime } from "../dom.js";
import {
  PageHeader,
  Badge,
  Button,
  Empty,
  Select,
  Skeleton,
  Textarea,
  toast,
} from "../ui.js";
import { get, post, topics, describeError } from "../api.js";
import {
  channelRows,
  pickChannel,
  recipientOptions,
  isAgentAuthor,
  kindPill,
  routeText,
  clockTime,
  sameFeed,
  EVERYONE,
} from "./channels-model.js";

const POLL_MS = 5000;
// Last time each channel was viewed this session; outlives re-renders so the unread dot is stable.
const SEEN = new Map();

export async function render(ctx) {
  const { root, params, project, setParams } = ctx;
  const state = {
    channels: [],
    name: "",
    messages: [],
    channel: null,
    seen: SEEN,
  };
  const listEl = h("nav", { class: "chan-list", "aria-label": "Channels" });
  const feedEl = h("div", {
    class: "chan-feed",
    role: "log",
    "aria-live": "polite",
  });
  const composerEl = h("div", { class: "chan-composer" });
  const titleEl = h("h2", { class: "chan-title" });
  const pane = h(
    "section",
    { class: "chan-pane" },
    titleEl,
    feedEl,
    composerEl,
  );
  replace(
    root,
    PageHeader({
      title: "Channels",
      description: "Messages between you and the agents.",
    }),
    Skeleton(6),
  );

  const projectParam = project && project !== "all" ? { project } : {};

  function paintList() {
    const rows = channelRows(state.channels);
    replace(
      listEl,
      rows.length
        ? null
        : h("p", { class: "meta chan-none" }, "No channels yet."),
      rows.map((r) => {
        const seenAt = state.seen.get(r.name);
        const unread =
          seenAt != null && r.name !== state.name && r.lastActivityMs > seenAt;
        const b = h(
          "button",
          {
            type: "button",
            class: "chan-item",
            "aria-current": r.name === state.name ? "true" : null,
          },
          h(
            "span",
            { class: "chan-name" },
            r.name,
            unread &&
              h("span", { class: "chan-unread", title: "New messages" }),
          ),
          h(
            "span",
            { class: "meta" },
            `${r.memberCount} ${r.memberCount === 1 ? "member" : "members"}${r.lastActivityMs ? ` · ${relTime(r.lastActivityMs)}` : ""}`,
          ),
        );
        b.addEventListener("click", () => select(r.name));
        return b;
      }),
    );
  }

  function paintFeed() {
    const atBottom =
      feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 40;
    replace(
      feedEl,
      state.messages.length
        ? state.messages.map((m) => {
            const pill = kindPill(m.kind);
            return h(
              "article",
              { class: "chan-msg" },
              h(
                "div",
                { class: "chan-msg-head" },
                h("time", { class: "meta", datetime: m.ts }, clockTime(m.ts)),
                h("span", { class: "chan-route" }, routeText(m)),
                pill && Badge(pill),
              ),
              h(
                "p",
                {
                  class: isAgentAuthor(m.from) ? "chan-body mono" : "chan-body",
                },
                m.body,
              ),
            );
          })
        : Empty({ title: "No messages yet." }),
    );
    if (atBottom) feedEl.scrollTop = feedEl.scrollHeight;
  }

  function paintComposer() {
    const to = Select({
      options: recipientOptions(state.channel),
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
          channel: state.name,
          to: to.value,
          body: text,
          from: "you",
          ...projectParam,
        });
        body.value = "";
        await loadFeed();
        // The server records the message a moment after it replies; fetch once more so it shows without waiting for the poll.
        setTimeout(
          () =>
            loadFeed().catch((e) => console.error("channel refresh failed", e)),
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
      h(
        "label",
        { class: "field chan-to-field" },
        h("span", { class: "label" }, "To"),
        to,
      ),
      body,
      send,
    );
  }

  async function loadFeed() {
    if (!state.name) return;
    const name = state.name;
    const res = await get(`/api/v2/channels/${encodeURIComponent(name)}`, {
      limit: 200,
      ...projectParam,
    });
    if (name !== state.name) return; // the person switched channels while this was in flight
    const fresh = res.messages || [];
    const first = !state.channel || state.channel.name !== name;
    state.channel = res.channel || state.channel;
    if (first) paintComposer();
    if (first || !sameFeed(state.messages, fresh)) {
      state.messages = fresh;
      paintFeed();
    }
    state.seen.set(name, Date.now());
    paintList();
  }

  async function loadList() {
    const res = await get("/api/v2/channels", projectParam);
    state.channels = res.channels || [];
    // First sight of a channel counts as read; only later activity raises the dot.
    for (const r of channelRows(state.channels))
      if (!state.seen.has(r.name)) state.seen.set(r.name, r.lastActivityMs);
    const want = pickChannel(state.channels, state.name || params.channel);
    if (want !== state.name) await select(want, { push: false });
    else paintList();
  }

  async function select(name, { push = true } = {}) {
    // setParams fires hashchange, which re-renders this page with params.channel set.
    if (push) return setParams({ channel: name });
    state.name = name;
    state.channel = null;
    state.messages = [];
    titleEl.textContent = name || "";
    replace(feedEl, Skeleton(3));
    paintList();
    try {
      await loadFeed();
    } catch (e) {
      replace(
        feedEl,
        Empty({
          title: "This channel did not load.",
          body: describeError(e).message,
          action: Button(
            { onClick: () => select(name, { push: false }) },
            "Retry",
          ),
        }),
      );
    }
  }

  let busy = false;
  const tick = async () => {
    if (busy || document.visibilityState === "hidden") return;
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

  try {
    await loadList();
  } catch (e) {
    replace(
      root,
      PageHeader({
        title: "Channels",
        description: "Messages between you and the agents.",
      }),
      Empty({
        title: "Channels did not load.",
        body: describeError(e).message,
        action: Button({ onClick: () => render(ctx) }, "Retry"),
      }),
    );
    return;
  }
  replace(
    root,
    PageHeader({
      title: "Channels",
      description: "Messages between you and the agents.",
    }),
    h("div", { class: "chan-layout" }, listEl, pane),
  );
  paintList();
  paintComposer();
  paintFeed();
  feedEl.scrollTop = feedEl.scrollHeight;

  const timer = setInterval(tick, POLL_MS);
  const unsub = topics.irc.subscribe(() => tick());
  return () => {
    clearInterval(timer);
    unsub();
  };
}
