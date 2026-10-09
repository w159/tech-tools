// Command Center components, part 2: layers (MASTER 9.6 shell, 9.10, 9.15). Toast, modal, popover/menu,
// the inspector drawer host and the command palette. Import from components.js, not from here.

import { h, icon, clear, normStatus } from "./dom.js";
import { StatusDot, Button, Keycap, Chip } from "./ui-core.js";

const layers = { drawer: null, modal: null, popover: null, palette: null };
const el = (id) => document.getElementById(id) || document.body;

function focusables(node) {
  return Array.from(node.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')).filter((x) => x.offsetParent !== null || x === document.activeElement);
}

export function trapFocus(container) {
  container.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const items = focusables(container);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

function giveFocusBack(target) {
  if (target && target.isConnected && typeof target.focus === "function") target.focus();
}

// ---- 9.15 toast ---------------------------------------------------------------------------------

const MAX_TOASTS = 3;

// toast(msg, { kind: ok|fail|warn|info, why, do, ttl, action: { label, onClick } }). Voice: "Prompt sent to omp in tech-tools".
export function toast(msg, opts) {
  const options = opts || {};
  const raw = normStatus(options.kind || "info");
  const kind = raw === "error" ? "fail" : raw;
  const host = el("toast-root");
  while (host.children.length >= MAX_TOASTS) host.firstChild.remove();
  let timer = null;
  const node = h(
    "div",
    { class: "toast", "data-kind": kind, role: kind === "fail" ? "alert" : "status" },
    StatusDot({ status: kind }),
    h("div", { class: "grow" }, h("div", null, String(msg)), options.why ? h("div", { class: "why" }, String(options.why)) : null, options.do ? h("div", { class: "why" }, String(options.do)) : null),
    options.action ? Button({ label: options.action.label, variant: "ghost", size: "sm", onClick: () => { options.action.onClick(); node.remove(); } }) : null,
    h("button", { class: "btn btn-ghost btn-icon btn-sm", type: "button", "aria-label": "Dismiss", onClick: () => node.remove() }, icon("close"))
  );
  host.appendChild(node);
  const ttl = options.ttl === undefined ? (kind === "fail" ? 8000 : 5000) : options.ttl;
  const arm = () => {
    if (ttl > 0) timer = setTimeout(() => node.remove(), ttl);
  };
  node.addEventListener("mouseenter", () => clearTimeout(timer));
  node.addEventListener("mouseleave", arm);
  arm();
  return node;
}

// Show an ApiError (or any error) as a toast with what / why / do.
export function toastError(err, fallback) {
  const e = err || {};
  return toast(e.error || e.message || fallback || "Something went wrong", { kind: "fail", why: e.why, do: e.do });
}

// ---- 9.10 modal (destructive confirms) -------------------------------------------------------------

export function Modal({ title, children, actions, onClose } = {}) {
  const node = h(
    "div",
    { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title || "Dialog" },
    title ? h("div", { class: "modal-head" }, h("h2", null, title)) : null,
    h("div", { class: "modal-body" }, children || []),
    actions && actions.length ? h("div", { class: "modal-actions" }, actions) : null
  );
  node._onClose = onClose || null;
  trapFocus(node);
  return node;
}

export function openModal(node) {
  closeModal();
  const host = el("modal-root");
  const scrim = h("div", { class: "scrim scrim-modal", onClick: () => closeModal() });
  layers.modal = { node, scrim, returnTo: document.activeElement };
  host.appendChild(scrim);
  host.appendChild(node);
  const target = node.querySelector("[autofocus], .modal-actions .btn-primary, .modal-actions .btn-danger, .modal-actions button, input, textarea, select, button");
  if (target) target.focus();
  return node;
}

export function closeModal() {
  const cur = layers.modal;
  if (!cur) return false;
  layers.modal = null;
  cur.scrim.remove();
  cur.node.remove();
  if (cur.node._onClose) cur.node._onClose();
  giveFocusBack(cur.returnTo);
  return true;
}

export function hasOpenModal() {
  return Boolean(layers.modal);
}

// confirm({ title, body, danger, confirmLabel, cancelLabel }) -> Promise<boolean>. Cancel on the left, initial focus on Cancel.
export function confirm({ title, body, danger, confirmLabel, cancelLabel } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };
    const cancel = h("button", { class: "btn", type: "button", onClick: () => done(false) }, cancelLabel || "Cancel");
    const ok = h("button", { class: ["btn", danger ? "btn-danger" : "btn-primary"], type: "button", onClick: () => done(true) }, confirmLabel || (danger ? "Confirm" : "OK"));
    const content = body instanceof Node ? body : h("p", null, body === undefined || body === null ? "" : String(body));
    openModal(Modal({ title, children: [content], actions: [cancel, ok], onClose: () => done(false) }));
    cancel.focus();
  });
}

// ---- 9.10 popover / menu ------------------------------------------------------------------------------

function place(node, anchor, placement) {
  const a = anchor.getBoundingClientRect();
  const pad = 8;
  node.style.left = "0px";
  node.style.top = "0px";
  const r = node.getBoundingClientRect();
  let left = placement === "end" ? a.right - r.width : a.left;
  let top = a.bottom + 4;
  if (top + r.height > innerHeight - pad && a.top - r.height - 4 > pad) top = a.top - r.height - 4;
  left = Math.max(pad, Math.min(left, innerWidth - r.width - pad));
  node.style.left = left + "px";
  node.style.top = Math.max(pad, top) + "px";
}

export function closePopover() {
  const cur = layers.popover;
  if (!cur) return false;
  layers.popover = null;
  document.removeEventListener("pointerdown", cur.outside, true);
  cur.node.remove();
  if (cur.onClose) cur.onClose();
  giveFocusBack(cur.returnTo);
  return true;
}

export function hasOpenPopover() {
  return Boolean(layers.popover);
}

// openPopover(anchor, contentNode, { placement: "start"|"end", label, onClose }) -> { node, close }
export function openPopover(anchor, content, opts) {
  closePopover();
  const o = opts || {};
  const node = h("div", { class: "popover", role: o.role || "dialog", "aria-label": o.label || "Details" }, content);
  const outside = (e) => {
    if (!node.contains(e.target) && !anchor.contains(e.target)) closePopover();
  };
  layers.popover = { node, outside, returnTo: o.returnFocus === false ? null : anchor, onClose: o.onClose || null };
  el("popover-root").appendChild(node);
  place(node, anchor, o.placement);
  document.addEventListener("pointerdown", outside, true);
  return { node, close: closePopover };
}

// openMenu(anchor, [{ label, icon, onSelect, danger, disabled, hint }], { placement, label }) : arrow keys, type-ahead, Esc.
export function openMenu(anchor, items, opts) {
  const list = h("ul", { class: "menu", role: "menu" });
  const rows = items.filter(Boolean).map((it) => {
    const btn = h("button", { class: ["menu-item", it.danger ? "is-danger" : ""], type: "button", role: "menuitem", disabled: Boolean(it.disabled), tabindex: "-1", onClick: () => { closePopover(); if (it.onSelect) it.onSelect(); } }, it.icon ? icon(it.icon) : null, h("span", { class: "grow" }, it.label), it.hint ? h("span", { class: "dim" }, it.hint) : null);
    list.appendChild(h("li", { role: "none" }, btn));
    return btn;
  });
  let buf = "";
  let bufTimer = null;
  list.addEventListener("keydown", (e) => {
    const live = rows.filter((b) => !b.disabled);
    const i = live.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); live[(i + 1) % live.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); live[(i - 1 + live.length) % live.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); live[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); live[live.length - 1].focus(); }
    else if (e.key === "Tab") { e.preventDefault(); closePopover(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      buf += e.key.toLowerCase();
      clearTimeout(bufTimer);
      bufTimer = setTimeout(() => { buf = ""; }, 600);
      const hit = live.find((b) => b.textContent.toLowerCase().startsWith(buf));
      if (hit) hit.focus();
    }
  });
  const pop = openPopover(anchor, list, { ...(opts || {}), role: "presentation", label: (opts && opts.label) || "Menu" });
  const first = rows.find((b) => !b.disabled);
  if (first) first.focus();
  return pop;
}

// ---- 9.6 inspector drawer host -------------------------------------------------------------------------
// One aside#inspector in the shell. >=1280px it docks (pushes the canvas while the canvas stays >=720px wide);
// otherwise it overlays with a scrim, traps focus and, at <=767px, becomes a bottom sheet.

const DOCK_MIN = 1280;
const CANVAS_MIN = 720;

function railWidth() {
  const rail = document.getElementById("rail");
  return rail && rail.offsetParent !== null ? rail.getBoundingClientRect().width : 0;
}

function wantsDock() {
  const w = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--inspector-w")) || 420;
  return innerWidth >= DOCK_MIN && innerWidth - railWidth() - w >= CANVAS_MIN;
}

function syncInspector() {
  const cur = layers.drawer;
  const root = document.documentElement;
  if (!cur) {
    root.removeAttribute("data-inspector");
    return;
  }
  const docked = wantsDock();
  root.setAttribute("data-inspector", docked ? "docked" : "overlay");
  cur.scrim.hidden = docked;
  cur.node.setAttribute("aria-modal", docked ? "false" : "true");
  cur.trap = !docked;
}
window.addEventListener("resize", syncInspector);

// Drawer({ title, children, onClose, header (Node, replaces the title row), tabs (Node), footer (Node, pinned bottom) }) -> .drawer
export function Drawer({ title, onClose, children, header, tabs, footer } = {}) {
  const closeBtn = h("button", { class: "btn btn-ghost btn-icon", type: "button", "aria-label": "Close panel", onClick: () => closeDrawer() }, icon("close"));
  const node = h(
    "div",
    { class: "drawer", role: "complementary", "aria-label": title || "Details" },
    h("button", { class: "sheet-handle", type: "button", "aria-label": "Close panel", tabindex: "-1", onClick: () => closeDrawer() }, h("span")),
    header ? h("div", { class: "drawer-head" }, header, closeBtn) : h("div", { class: "drawer-head" }, h("h2", null, title || ""), closeBtn),
    tabs || null,
    h("div", { class: "drawer-body" }, children || []),
    footer ? h("div", { class: "drawer-foot" }, footer) : null
  );
  node._onClose = onClose || null;
  node.addEventListener("keydown", (e) => {
    if (!layers.drawer || !layers.drawer.trap || e.key !== "Tab") return;
    const items = focusables(node);
    if (!items.length) return;
    if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items[items.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === items[items.length - 1]) { e.preventDefault(); items[0].focus(); }
  });
  return node;
}

export function openDrawer(node, opts) {
  const o = opts || {};
  const host = document.getElementById("inspector");
  const returnTo = layers.drawer ? layers.drawer.returnTo : document.activeElement;
  if (layers.drawer) {
    const prev = layers.drawer;
    layers.drawer = null;
    prev.node.remove();
    if (prev.node._onClose) prev.node._onClose();
  }
  const scrim = document.getElementById("inspector-scrim") || h("div", { class: "scrim scrim-inspector", id: "inspector-scrim" });
  scrim.onclick = () => closeDrawer();
  if (!scrim.isConnected) host.parentNode.insertBefore(scrim, host);
  layers.drawer = { node, scrim, returnTo, trap: false };
  clear(host).appendChild(node);
  host.hidden = false;
  syncInspector();
  if (o.focus !== false) {
    const target = node.querySelector("[data-autofocus]") || node.querySelector(".drawer-head h2, .drawer-head button") || node;
    if (target !== node && !target.hasAttribute("tabindex") && target.tagName === "H2") target.tabIndex = -1;
    target.focus();
  }
  return node;
}

export function closeDrawer() {
  const cur = layers.drawer;
  if (!cur) return false;
  layers.drawer = null;
  const host = document.getElementById("inspector");
  cur.node.remove();
  host.hidden = true;
  cur.scrim.hidden = true;
  document.documentElement.removeAttribute("data-inspector");
  if (cur.node._onClose) cur.node._onClose();
  giveFocusBack(cur.returnTo);
  return true;
}

export function hasOpenDrawer() {
  return Boolean(layers.drawer);
}

// ---- 9.10 command palette ---------------------------------------------------------------------------------

// Subsequence fuzzy score: higher is better, -1 no match. Consecutive and word-start hits score more.
export function fuzzy(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let score = 0;
  let run = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    run = at === ti ? run + 1 : 0;
    score += 1 + run * 2 + (at === 0 || /[\s\-_/:.]/.test(t[at - 1]) ? 3 : 0);
    ti = at + 1;
  }
  return score - t.length * 0.01;
}

const PREFIX = { ">": "Actions", "@": "Agents", "#": "Go to" };

export function isPaletteOpen() {
  return Boolean(layers.palette);
}

export function closePalette() {
  const cur = layers.palette;
  if (!cur) return false;
  layers.palette = null;
  clear(el("palette-root"));
  giveFocusBack(cur.returnTo);
  return true;
}

// openPalette({ entries: () => [{ group: "Agents"|"Go to"|"Actions"|"Projects", label, hint, keys, icon, run, id }], recent: () => string[] })
// Prefix filters: ">" actions, "@" agents, "#" pages. Tab cycles the group filter. combobox + listbox, aria-activedescendant.
export function openPalette({ entries, recent, initial } = {}) {
  if (layers.palette) return;
  const returnTo = document.activeElement;
  layers.palette = { returnTo };
  const host = el("palette-root");
  const all = entries();
  const groupsInOrder = ["Agents", "Go to", "Actions", "Projects"];
  let groupFilter = null;
  let shown = [];
  let sel = 0;
  const list = h("ul", { role: "listbox", id: "palette-list", "aria-label": "Results", class: "palette-list" });
  const input = h("input", { type: "text", role: "combobox", "aria-expanded": "true", "aria-controls": "palette-list", "aria-autocomplete": "list", "aria-label": "Search agents, pages and actions", placeholder: "Search agents, pages and actions", autocomplete: "off", spellcheck: "false" });
  const chips = h("div", { class: "palette-filter", "aria-label": "Filter group" });
  const done = () => closePalette();
  const pick = (i) => {
    const e = shown[i];
    done();
    if (e && e.run) e.run();
  };
  const compute = () => {
    let q = input.value.trim();
    let g = groupFilter;
    if (PREFIX[q[0]]) { g = PREFIX[q[0]]; q = q.slice(1).trim(); }
    const recentIds = recent ? recent() : [];
    const rows = [];
    for (const e of all) {
      if (g && e.group !== g) continue;
      const sc = q ? Math.max(fuzzy(q, e.label), e.hint ? fuzzy(q, e.hint) - 2 : -1) : 0;
      if (q && sc < 0) continue;
      const rec = e.id && recentIds.indexOf(e.id);
      rows.push({ e, sc: sc + (rec >= 0 && rec !== undefined && rec !== false ? 2 - rec * 0.1 : 0) });
    }
    rows.sort((a, b) => groupsInOrder.indexOf(a.e.group) - groupsInOrder.indexOf(b.e.group) || b.sc - a.sc);
    shown = rows.map((r) => r.e).slice(0, 60);
    sel = 0;
  };
  const draw = () => {
    clear(list);
    clear(chips);
    for (const g of groupsInOrder) chips.appendChild(Chip({ label: g, selected: groupFilter === g, onClick: () => { groupFilter = groupFilter === g ? null : g; compute(); draw(); input.focus(); } }));
    if (!shown.length) list.appendChild(h("li", { class: "palette-empty", role: "presentation" }, "No matches. Try fewer letters, or clear the filter."));
    let last = "";
    shown.forEach((e, i) => {
      if (e.group !== last) {
        last = e.group;
        list.appendChild(h("li", { class: "palette-group", role: "presentation" }, e.group));
      }
      list.appendChild(
        h("li", { role: "option", id: "pal-" + i, "aria-selected": i === sel ? "true" : "false", onMousemove: () => { if (sel !== i) { sel = i; mark(); } } },
          h("button", { type: "button", tabindex: "-1", onClick: () => pick(i) }, e.icon ? icon(e.icon) : e.glyph || null, h("span", { class: "grow truncate" }, e.label), e.hint ? h("span", { class: "hint" }, e.hint) : null, e.keys ? h("span", { class: "row" }, e.keys.split(" ").map((k) => Keycap(k))) : null))
      );
    });
    input.setAttribute("aria-activedescendant", shown.length ? "pal-" + sel : "");
  };
  const mark = () => {
    list.querySelectorAll('[role="option"]').forEach((li, i) => li.setAttribute("aria-selected", i === sel ? "true" : "false"));
    input.setAttribute("aria-activedescendant", "pal-" + sel);
    const cur = document.getElementById("pal-" + sel);
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
  };
  input.addEventListener("input", () => { compute(); draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
    else if (e.key === "Escape") { e.preventDefault(); done(); }
    else if (e.key === "Tab") {
      e.preventDefault();
      const i = groupFilter ? groupsInOrder.indexOf(groupFilter) : -1;
      const next = e.shiftKey ? i - 1 : i + 1;
      groupFilter = next < 0 || next >= groupsInOrder.length ? null : groupsInOrder[next];
      compute();
      draw();
    }
  });
  const panel = h("div", { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": "Command palette" }, input, chips, list, h("div", { class: "palette-foot" }, h("span", null, Keycap("\u2191\u2193"), " navigate"), h("span", null, Keycap("\u21B5"), " select"), h("span", null, Keycap("esc"), " close"), h("span", null, Keycap("\u21E5"), " filter group")));
  trapFocus(panel);
  host.append(h("div", { class: "scrim scrim-palette", onClick: done }), panel);
  if (initial) input.value = initial;
  compute();
  draw();
  input.focus();
}
