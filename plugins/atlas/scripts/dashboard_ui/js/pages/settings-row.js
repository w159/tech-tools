// Settings row anatomy (brief 5.9): title + control, description, Current line, inline result, More.
import { h } from "../dom.js";
import { Button, Input, Select, Switch } from "../ui.js";

const OK_VISIBLE_MS = 3000;

/** Inline save result: "Saved" for 3 s, a failure sentence until the next change. Never a toast. */
export function makeFeedback() {
  const el = h("p", {
    class: "setting-result",
    role: "status",
    "aria-live": "polite",
  });
  let timer = null;
  const clear = () => {
    clearTimeout(timer);
    el.replaceChildren();
    el.className = "setting-result";
  };
  const show = (tone, text) => {
    clear();
    el.className = `setting-result is-${tone}`;
    el.append(
      h("span", {
        class: `dot s-${tone === "ok" ? "ok" : "fail"}`,
        "aria-hidden": "true",
      }),
      h("span", {}, text),
    );
    if (tone === "ok") timer = setTimeout(clear, OK_VISIBLE_MS);
  };
  return {
    el,
    clear,
    ok: (t = "Saved") => show("ok", t),
    fail: (t) => show("fail", t),
  };
}

/**
 * Row({meta:{key,title,description,section}, control, current, extra, more, feedback}) -> <div.setting>.
 * `current` and `extra` are strings or nodes shown under the description.
 */
export function Row({ meta, control, current, extra, more, feedback }) {
  return h(
    "div",
    { class: "setting", dataset: { key: meta.key, section: meta.section } },
    h(
      "div",
      { class: "setting-main" },
      h(
        "h3",
        { class: "setting-title" },
        meta.title,
        h("code", { class: "setting-key" }, meta.key),
      ),
      control && h("div", { class: "setting-control" }, control),
    ),
    meta.description && h("p", { class: "setting-desc" }, meta.description),
    h("p", { class: "setting-current" }, current),
    extra && h("div", { class: "setting-extra" }, extra),
    feedback && feedback.el,
    more,
  );
}

/** Switch bound to a save callback that resolves true when the server accepted the change. */
export function SwitchControl({ checked, label, save }) {
  return Switch({ checked, label, onChange: (next) => save(next) });
}

export function SelectControl({ options, value, label, save }) {
  return Select({
    options,
    value,
    label,
    class: "setting-select",
    onChange: (v) => save(v),
  });
}

/** Text or number input with a Save button; Enter saves too. `save(value)` returns a promise. */
export function InputControl({
  value,
  placeholder,
  label,
  mono,
  number,
  range,
  save,
  type,
}) {
  const attrs = { value: value ?? "", placeholder, "aria-label": label, mono };
  if (number) {
    Object.assign(attrs, {
      type: "number",
      inputmode: "numeric",
      class: "setting-number",
    });
    if (range)
      Object.assign(attrs, {
        min: range.min,
        max: range.max,
        step: range.step || 1,
      });
  } else if (type) attrs.type = type;
  const input = Input(attrs);
  const btn = Button({ size: "sm" }, "Save");
  const go = async () => {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    try {
      await save(input.value.trim());
    } finally {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  };
  btn.addEventListener("click", go);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") go();
  });
  return h("div", { class: "setting-input" }, input, btn);
}
