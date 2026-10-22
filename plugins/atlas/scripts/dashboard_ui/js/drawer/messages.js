// Drawer Messages tab: channel messages to or from the agent, plus one composer (Message or Prompt).
// render(ctx, row) draws into ctx.root. ctx: {root, project, initialMode?}.
import { h, replace, relTime } from "../dom.js";
import { Button, Segmented, Select, Textarea, Empty, toast } from "../ui.js";
import { get, post, describeError } from "../api.js";
import {
  channelsFor,
  messagesFor,
  promptState,
  HUMAN_SENDERS,
} from "../pages/agents-model.js";

const HISTORY_LIMIT = 100;

function messageView(m) {
  const human = HUMAN_SENDERS.has(m.from);
  return h(
    "li",
    { class: "msg" },
    h(
      "div",
      { class: "msg-head meta" },
      h("strong", {}, m.from),
      " to ",
      m.to,
      " · ",
      relTime(m.ts),
      m.channel ? ` · ${m.channel}` : "",
    ),
    h("div", { class: human ? "msg-body" : "msg-body mono" }, m.body),
  );
}

export async function render(ctx, row) {
  const list = h("ul", { class: "msg-list" });
  const log = h(
    "div",
    { class: "msg-scroll" },
    h("p", { class: "meta" }, "Loading..."),
  );
  const host = h("div", { class: "msg-wrap" }, log);
  replace(ctx.root, host);
  let disposed = false;

  let channels = [];
  let mine = [];
  try {
    channels =
      (await get("/api/v2/channels", { project: ctx.project })).channels || [];
    mine = channelsFor(channels, row);
    const payloads = await Promise.all(
      mine
        .slice(0, 4)
        .map((c) =>
          get(`/api/v2/channels/${encodeURIComponent(c.name)}`, {
            limit: HISTORY_LIMIT,
          }),
        ),
    );
    if (disposed) return () => {};
    const msgs = messagesFor(payloads, row);
    replace(
      log,
      msgs.length
        ? list
        : Empty({
            title: "No messages yet.",
            body: `Messages to or from ${row.name} appear here.`,
          }),
    );
    msgs.forEach((m) => list.append(messageView(m)));
    log.scrollTop = log.scrollHeight;
  } catch (e) {
    replace(
      log,
      Empty({
        title: "Messages did not load.",
        body: describeError(e).message,
      }),
    );
  }

  // --- composer ---
  const prompt = promptState(row);
  let mode = ctx.initialMode === "prompt" && prompt.ok ? "prompt" : "message";
  const targets = mine.length ? mine : channels;
  const channelSelect = Select({
    label: "Channel",
    options: targets.map((c) => ({ value: c.name, label: c.name })),
    value: targets[0] && targets[0].name,
  });
  const text = Textarea({
    rows: 3,
    placeholder: `Message ${row.name}`,
    "aria-label": "Message text",
  });
  const sendBtn = Button({ variant: "primary" }, "Send");
  const hint = h("span", { class: "meta" });

  const paint = () => {
    const isPrompt = mode === "prompt";
    text.placeholder = isPrompt ? `Prompt ${row.name}` : `Message ${row.name}`;
    channelSelect.hidden = isPrompt;
    sendBtn.textContent = isPrompt ? "Send prompt" : "Send";
    hint.textContent = isPrompt
      ? "Types the text into the agent's terminal."
      : targets.length
        ? ""
        : "There are no channels yet, so a message has nowhere to go.";
    sendBtn.disabled = !isPrompt && !targets.length;
  };
  const modeSwitch = Segmented({
    label: "Send as",
    value: mode,
    options: [
      { value: "message", label: "Message" },
      {
        value: "prompt",
        label: "Prompt",
        disabled: !prompt.ok,
        title: prompt.ok ? "" : prompt.reason,
      },
    ],
    onChange: (v) => {
      mode = v;
      paint();
    },
  });

  sendBtn.addEventListener("click", async () => {
    const body = text.value.trim();
    if (!body) return;
    sendBtn.disabled = true;
    try {
      if (mode === "prompt") {
        await post(`/api/v2/agents/${encodeURIComponent(row.key)}/prompt`, {
          text: body,
        });
        toast(`Prompt sent to ${row.name}`, { kind: "ok" });
      } else {
        await post("/api/v2/channels", {
          channel: channelSelect.value,
          to: row.name,
          body,
          from: "you",
        });
        toast(`Message sent to ${row.name}`, { kind: "ok" });
      }
      text.value = "";
      if (!disposed) render(ctx, row);
    } catch (e) {
      const d = describeError(e);
      toast(d.message, { kind: "error", detail: d.detail });
    } finally {
      paint();
    }
  });

  host.append(
    h(
      "div",
      { class: "composer" },
      h("div", { class: "composer-row" }, modeSwitch, channelSelect),
      text,
      h("div", { class: "composer-row" }, hint, sendBtn),
    ),
  );
  paint();
  return () => {
    disposed = true;
  };
}
