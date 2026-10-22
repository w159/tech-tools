// Component kit (brief section 6). Each component is a function returning an element.
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { statusOf } from "./state.js";

const cls = (...parts) => parts.filter(Boolean).join(" ");

// --- Controls ---

/** Button({variant: primary|default|ghost|danger, size: sm|md, icon, busy, ...attrs}, ...children) */
export function Button(
  { variant = "default", size = "md", icon: iconName, busy, ...attrs } = {},
  ...children
) {
  const el = h(
    "button",
    {
      type: "button",
      ...attrs,
      class: cls(
        "btn",
        variant !== "default" && `btn-${variant}`,
        size === "sm" && "btn-sm",
        busy && "is-busy",
        attrs.class,
      ),
    },
    iconName && icon(iconName),
    ...children,
  );
  if (busy) el.setAttribute("aria-busy", "true");
  return el;
}

/** IconButton({icon, label, size}) -> square button with an accessible name and a tooltip. */
function IconButton({ icon: iconName, label, size, ...attrs }) {
  return h(
    "button",
    {
      type: "button",
      title: label,
      "aria-label": label,
      ...attrs,
      class: cls("icon-btn", size === "sm" && "sm", attrs.class),
    },
    icon(iconName),
  );
}

/** Switch({checked, label, onChange(next)}) -> role=switch button. Caller owns persistence. */
export function Switch({ checked = false, label, disabled, onChange } = {}) {
  const el = h("button", {
    type: "button",
    role: "switch",
    class: "switch",
    "aria-checked": String(!!checked),
    "aria-label": label,
    disabled,
  });
  el.addEventListener("click", () => {
    const next = el.getAttribute("aria-checked") !== "true";
    el.setAttribute("aria-checked", String(next));
    if (onChange) onChange(next);
  });
  return el;
}

/** Select({options: [{value,label}|string], value, onChange(value)}) -> native select. */
export function Select({
  options = [],
  value,
  onChange,
  label,
  ...attrs
} = {}) {
  const el = h(
    "select",
    { "aria-label": label, ...attrs, class: cls("select", attrs.class) },
    options.map((o) => {
      const opt = typeof o === "string" ? { value: o, label: o } : o;
      return h(
        "option",
        { value: opt.value, selected: String(opt.value) === String(value) },
        opt.label,
      );
    }),
  );
  if (onChange) el.addEventListener("change", () => onChange(el.value));
  return el;
}

export function Input({ mono, ...attrs } = {}) {
  return h("input", {
    type: "text",
    ...attrs,
    class: cls("input", mono && "mono", attrs.class),
  });
}

export function Textarea({ mono, ...attrs } = {}) {
  return h("textarea", {
    ...attrs,
    class: cls("textarea", mono && "mono", attrs.class),
  });
}

/** Field({label, error}, control) -> label above a control with an optional error line. */
export function Field({ label, error } = {}, control) {
  return h(
    "label",
    { class: "field" },
    h("span", { class: "label" }, label),
    control,
    error && h("span", { class: "field-error", role: "alert" }, error),
  );
}

/** Segmented({options, value, onChange}) -> button group where one button is pressed. */
export function Segmented({ options = [], value, onChange, label } = {}) {
  const el = h("div", {
    class: "segmented",
    role: "group",
    "aria-label": label,
  });
  const paint = (v) =>
    el
      .querySelectorAll("button")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.value === String(v))),
      );
  for (const o of options) {
    const opt = typeof o === "string" ? { value: o, label: o } : o;
    const b = h(
      "button",
      {
        type: "button",
        dataset: { value: opt.value },
        title: opt.title,
        disabled: opt.disabled,
      },
      opt.label,
    );
    b.addEventListener("click", () => {
      paint(opt.value);
      if (onChange) onChange(opt.value);
    });
    el.append(b);
  }
  paint(value);
  return el;
}

// --- Status ---

/** StateDot(rawState) -> dot + state word (the signature element). */
export function StateDot(raw, { word } = {}) {
  const st = statusOf(raw);
  return h(
    "span",
    { class: "state" },
    h("span", { class: cls("dot", `s-${st.tone}`), "aria-hidden": "true" }),
    h("span", {}, word || st.word),
  );
}

/** Badge(text, tone) where tone is working|needs|ok|fail|neutral. Always carries a word. */
export function Badge(text, tone = "neutral") {
  return h(
    "span",
    { class: cls("badge", tone === "neutral" ? "neutral" : `s-${tone}`) },
    text,
  );
}

/** CountBadge(n, tone) for the sidebar; renders nothing visible for zero. */
function CountBadge(n, tone) {
  return h("span", { class: cls("count-badge", tone), hidden: !n }, n);
}

// --- Layout ---

/** Panel({title, actions, flush}, ...body) */
export function Panel({ title, actions, flush } = {}, ...body) {
  return h(
    "section",
    { class: "panel" },
    (title || actions) &&
      h("div", { class: "panel-head" }, title && h("h2", {}, title), actions),
    h("div", { class: cls("panel-body", flush && "flush") }, ...body),
  );
}

/** PageHeader({title, description, actions}) -> title block, one-line description, actions right. */
export function PageHeader({ title, description, actions }) {
  return h(
    "header",
    { class: "page-head" },
    h(
      "div",
      { class: "titles" },
      h("h1", {}, title),
      description && h("p", {}, description),
    ),
    actions && h("div", { class: "page-actions" }, actions),
  );
}

/** KPI({label, value, delta, href}) -> tile; a link when href is set. */
export function KPI({ label, value, delta, href }) {
  return h(
    href ? "a" : "div",
    { class: "kpi", href },
    h("span", { class: "label" }, label),
    h("span", { class: "kpi-value" }, value ?? "-"),
    delta ? h("span", { class: "kpi-delta" }, delta) : null,
  );
}

/**
 * Table({columns:[{key,label,render(row),class}], rows, onRowClick, rowKey, selected, empty})
 * A row shaped {__group: node} renders as a full-width group row.
 */
export function Table({
  columns,
  rows,
  onRowClick,
  rowKey = (r) => r.key,
  selected,
  empty,
}) {
  const body = h("tbody");
  if (!rows.length) {
    body.append(
      h(
        "tr",
        {},
        h(
          "td",
          { class: "empty-cell", colspan: columns.length },
          empty || Empty({ title: "Nothing here." }),
        ),
      ),
    );
  }
  for (const row of rows) {
    if (row.__group !== undefined) {
      body.append(
        h(
          "tr",
          { class: "group" },
          h("td", { colspan: columns.length }, row.__group),
        ),
      );
      continue;
    }
    const tr = h("tr", {
      class: cls(
        onRowClick && "clickable",
        selected != null && rowKey(row) === selected && "selected",
      ),
    });
    if (onRowClick) {
      tr.tabIndex = 0;
      tr.addEventListener("click", (ev) => {
        if (!ev.target.closest("button, a, input, select")) onRowClick(row);
      });
      tr.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && ev.target === tr) onRowClick(row);
      });
    }
    for (const c of columns)
      tr.append(
        h("td", { class: c.class }, c.render ? c.render(row) : row[c.key]),
      );
    body.append(tr);
  }
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          columns.map((c) => h("th", { class: c.class }, c.label)),
        ),
      ),
      body,
    ),
  );
}

/** Skeleton(rows) -> placeholder table rows that match the real row height. */
export function Skeleton(rows = 6) {
  return h(
    "div",
    { class: "panel", "aria-busy": "true", "aria-label": "Loading" },
    Array.from({ length: rows }, () =>
      h("div", { class: "skeleton-row" }, h("span", { class: "skeleton" })),
    ),
  );
}

/** Empty({title, body, action}) -> calm empty state with an optional action element. */
export function Empty({ title, body, action } = {}) {
  return h(
    "div",
    { class: "empty" },
    h("h3", {}, title),
    body && h("p", {}, body),
    action,
  );
}

/** Tabs({tabs:[{id,label}], active, onSelect(id)}) -> tablist. */
export function Tabs({ tabs, active, onSelect }) {
  const el = h("div", { class: "tabs", role: "tablist" });
  for (const t of tabs) {
    const b = h(
      "button",
      {
        type: "button",
        role: "tab",
        "aria-selected": String(t.id === active),
        dataset: { id: t.id },
      },
      t.label,
    );
    b.addEventListener("click", () => {
      el.querySelectorAll("button").forEach((x) =>
        x.setAttribute("aria-selected", String(x === b)),
      );
      if (onSelect) onSelect(t.id);
    });
    el.append(b);
  }
  return el;
}

export function Kbd(text) {
  return h("kbd", { class: "kbd" }, text);
}

/** Copy(text) -> mono snippet with a copy button; confirms inline and never throws. */
export function Copy(text) {
  const btn = IconButton({ icon: "copy", label: "Copy", size: "sm" });
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.replaceChildren(icon("check"));
    } catch (e) {
      toast("Copy failed", {
        kind: "error",
        detail: "Select the text and copy it by hand.",
      });
      return;
    }
    setTimeout(() => btn.replaceChildren(icon("copy")), 1500);
  });
  return h("span", { class: "copy" }, h("code", {}, text), btn);
}

// --- Floating layers ---

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const layers = [];

function trapKey(ev) {
  const top = layers[layers.length - 1];
  if (!top) return;
  if (ev.key === "Escape") {
    ev.stopPropagation();
    top.close();
    return;
  }
  if (ev.key !== "Tab") return;
  const items = [...top.panel.querySelectorAll(FOCUSABLE)].filter(
    (n) => n.offsetParent !== null || n === document.activeElement,
  );
  if (!items.length) {
    ev.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
}

/** Mount a floating layer: focus trap, Esc to close, focus returns to the opener. */
function mountLayer(root, panel, onClose) {
  const opener = document.activeElement;
  const layer = {
    panel,
    close() {
      const i = layers.indexOf(layer);
      if (i < 0) return;
      layers.splice(i, 1);
      if (!layers.length)
        document.removeEventListener("keydown", trapKey, true);
      root.remove();
      if (opener && opener.focus && document.contains(opener)) opener.focus();
      if (onClose) onClose();
    },
  };
  if (!layers.length) document.addEventListener("keydown", trapKey, true);
  layers.push(layer);
  document.body.append(root);
  (
    panel.querySelector("[autofocus]") ||
    panel.querySelector(FOCUSABLE) ||
    panel
  ).focus();
  return layer;
}

/** Drawer({title, subtitle, onClose}, ...body) -> {el, body, close}. Only one drawer is open at a time. */
let openDrawer = null;
export function Drawer({ title, subtitle, onClose } = {}, ...body) {
  if (openDrawer) openDrawer.close();
  const titleId = `drawer-${Math.random().toString(36).slice(2, 8)}`;
  const bodyEl = h("div", { class: "drawer-body" }, ...body);
  const panel = h(
    "aside",
    {
      class: "drawer",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId,
      tabindex: "-1",
    },
    h(
      "div",
      { class: "drawer-head" },
      h(
        "div",
        { class: "titles" },
        h("h2", { id: titleId }, title),
        subtitle && h("div", { class: "meta" }, subtitle),
      ),
      IconButton({ icon: "x", label: "Close", onClick: () => ctl.close() }),
    ),
    bodyEl,
  );
  const scrim = h("div", { class: "drawer-scrim", onClick: () => ctl.close() });
  const root = h("div", {}, scrim, panel);
  const layer = mountLayer(root, panel, () => {
    openDrawer = null;
    if (onClose) onClose();
  });
  const ctl = { el: panel, body: bodyEl, close: layer.close };
  openDrawer = ctl;
  return ctl;
}

/** Modal({title, footer}, ...body) -> {el, body, close}. */
export function Modal({ title, footer, onClose } = {}, ...body) {
  const titleId = `modal-${Math.random().toString(36).slice(2, 8)}`;
  const bodyEl = h("div", { class: "modal-body" }, ...body);
  const panel = h(
    "div",
    {
      class: "modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId,
      tabindex: "-1",
    },
    h("div", { class: "modal-head" }, h("h2", { id: titleId }, title)),
    bodyEl,
    footer && h("div", { class: "modal-foot" }, footer),
  );
  const root = h("div", { class: "modal-scrim" }, panel);
  root.addEventListener("mousedown", (ev) => {
    if (ev.target === root) ctl.close();
  });
  const layer = mountLayer(root, panel, onClose);
  const ctl = { el: panel, body: bodyEl, close: layer.close };
  return ctl;
}

/** confirm({title, body, confirmLabel, danger}) -> Promise<boolean>. Esc and scrim click resolve false. */
export function confirm({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
      modal.close();
    };
    const yes = Button(
      {
        variant: danger ? "danger" : "primary",
        onClick: () => done(true),
        autofocus: true,
      },
      confirmLabel,
    );
    const no = Button({ onClick: () => done(false) }, cancelLabel);
    const modal = Modal(
      { title, footer: [no, yes], onClose: () => done(false) },
      h("p", {}, body),
    );
  });
}

/** toast(message, {kind: ok|error|warn|info, detail, ms}). Errors stay until dismissed by timeout of 8s. */
export function toast(message, { kind = "info", detail = "", ms } = {}) {
  const host = document.getElementById("toasts") || document.body;
  const el = h(
    "div",
    { class: cls("toast", kind), role: kind === "error" ? "alert" : "status" },
    h("strong", {}, message),
    detail && h("span", { class: "detail" }, detail),
  );
  host.append(el);
  setTimeout(() => el.remove(), ms || (kind === "error" ? 8000 : 4000));
  return el;
}
