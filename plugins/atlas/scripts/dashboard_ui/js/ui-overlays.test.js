import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom, fire } from "./rich-dom.js";

let dom, O, roots;
let seq = 0;
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
let timers, tid;
beforeEach(async () => {
  dom = installRichDom({ width: 1000, height: 800 });
  roots = Object.fromEntries(["toast-root", "modal-root", "popover-root", "palette-root", "inspector"].map((id) => [id, dom.root(id)]));
  timers = new Map();
  tid = 0;
  globalThis.setTimeout = (fn, ms) => { timers.set(++tid, { fn, ms }); return tid; };
  globalThis.clearTimeout = (i) => { timers.delete(i); };
  O = await import("./ui-overlays.js?o=" + ++seq);
});
afterEach(() => {
  globalThis.setTimeout = realTimers.setTimeout;
  globalThis.clearTimeout = realTimers.clearTimeout;
  restoreRichDom();
});
const btn = (label, id) => { const b = document.createElement("button"); b.textContent = label; if (id) b.setAttribute("id", id); return b; };
const trigger = (label = "opener") => { const b = btn(label); dom.body.appendChild(b); b.focus(); return b; };
const timerMs = () => [...timers.values()].map((t) => t.ms);
const runTimer = (ms) => { for (const [i, t] of [...timers]) if (t.ms === ms) { timers.delete(i); t.fn(); return; } throw new Error("no timer " + ms); };
const texts = (nodes) => nodes.map((n) => n.textContent);

describe("trapFocus", () => {
  const setup = () => {
    const c = document.createElement("div");
    const a = btn("a"), b = btn("b"), dis = btn("dis");
    dis.disabled = true;
    c.append(a, dis, b);
    dom.body.appendChild(c);
    O.trapFocus(c);
    return { c, a, b };
  };
  test("Tab on the last control wraps to the first; Shift+Tab on the first wraps to the last", () => {
    const { c, a, b } = setup();
    b.focus();
    const ev = fire(c, "keydown", { key: "Tab", shiftKey: false });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
    const ev2 = fire(c, "keydown", { key: "Tab", shiftKey: true });
    expect(ev2.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(b);
  });
  test("Tab in the middle, other keys and an empty container are left alone", () => {
    const { c, a, b } = setup();
    a.focus();
    const ev = fire(c, "keydown", { key: "Tab", shiftKey: false });
    expect(ev.defaultPrevented).toBeFalsy();
    expect(document.activeElement).toBe(a);
    b.focus();
    expect(fire(c, "keydown", { key: "x" }).defaultPrevented).toBeFalsy();
    const empty = document.createElement("div");
    dom.body.appendChild(empty);
    O.trapFocus(empty);
    expect(fire(empty, "keydown", { key: "Tab" }).defaultPrevented).toBeFalsy();
  });
});

describe("toast", () => {
  test("renders message, status dot and a dismiss button in the toast root", () => {
    const n = O.toast("Saved");
    expect(roots["toast-root"].children).toEqual([n]);
    expect(n.className).toBe("toast");
    expect(n.getAttribute("data-kind")).toBe("info");
    expect(n.getAttribute("role")).toBe("status");
    expect(n.querySelector(".grow div").textContent).toBe("Saved");
    expect(n.querySelector(".dot")).not.toBeNull();
    expect(n.querySelector("[aria-label=Dismiss]")).not.toBeNull();
  });
  test("failures are alerts; 'error' reads as fail", () => {
    for (const kind of ["fail", "error"]) {
      const n = O.toast("x", { kind });
      expect(n.getAttribute("data-kind")).toBe("fail");
      expect(n.getAttribute("role")).toBe("alert");
    }
    expect(O.toast("x", { kind: "ok" }).getAttribute("role")).toBe("status");
  });
  test("why and do lines appear only when given", () => {
    const n = O.toast("x", { why: "because", do: "retry" });
    expect(texts(n.querySelectorAll(".why"))).toEqual(["because", "retry"]);
    expect(O.toast("x").querySelectorAll(".why")).toHaveLength(0);
    expect(O.toast("x", { do: "d" }).querySelectorAll(".why")).toHaveLength(1);
  });
  test("keeps at most three, dropping the oldest", () => {
    const a = O.toast("a"), b = O.toast("b"), c = O.toast("c"), d = O.toast("d");
    expect(roots["toast-root"].children).toEqual([b, c, d]);
    expect(a.parentNode).toBeNull();
  });
  test("auto-dismiss: 5s default, 8s for failures, custom ttl, ttl 0 stays", () => {
    O.toast("a");
    O.toast("b", { kind: "fail" });
    O.toast("c", { ttl: 1234 });
    expect(timerMs()).toEqual([5000, 8000, 1234]);
    const stay = O.toast("d", { ttl: 0 });
    expect(timers.size).toBe(3);
    expect(stay.parentNode).not.toBeNull();
  });
  test("the timer removes the toast", () => {
    const n = O.toast("a");
    runTimer(5000);
    expect(n.parentNode).toBeNull();
  });
  test("hover pauses the dismissal and leaving re-arms it", () => {
    const n = O.toast("a");
    fire(n, "mouseenter");
    expect(timers.size).toBe(0);
    fire(n, "mouseleave");
    expect(timerMs()).toEqual([5000]);
  });
  test("the dismiss button removes it", () => {
    const n = O.toast("a");
    n.querySelector("[aria-label=Dismiss]").click();
    expect(n.parentNode).toBeNull();
  });
  test("an action runs its callback and dismisses", () => {
    let ran = 0;
    const n = O.toast("a", { action: { label: "Undo", onClick: () => ran++ } });
    const act = n.querySelectorAll("button")[0];
    expect(act.textContent).toBe("Undo");
    act.click();
    expect(ran).toBe(1);
    expect(n.parentNode).toBeNull();
  });
  test("with no #toast-root the body hosts toasts", () => {
    roots["toast-root"].remove();
    const n = O.toast("a");
    expect(n.parentNode).toBe(dom.body);
  });
  test("toastError prefers error, then message, then the fallback, and carries why/do", () => {
    const a = O.toastError({ error: "Nope", message: "m", why: "w", do: "d" });
    expect(a.querySelector(".grow div").textContent).toBe("Nope");
    expect(texts(a.querySelectorAll(".why"))).toEqual(["w", "d"]);
    expect(a.getAttribute("data-kind")).toBe("fail");
    expect(O.toastError({ message: "m" }).querySelector(".grow div").textContent).toBe("m");
    expect(O.toastError({}, "fallback").querySelector(".grow div").textContent).toBe("fallback");
    expect(O.toastError(null).querySelector(".grow div").textContent).toBe("Something went wrong");
  });
});

describe("Modal / openModal / closeModal", () => {
  test("Modal is a labelled dialog; the head exists only with a title", () => {
    const m = O.Modal({ title: "Delete?", children: ["body"], actions: [btn("Cancel")] });
    expect(m.getAttribute("role")).toBe("dialog");
    expect(m.getAttribute("aria-modal")).toBe("true");
    expect(m.getAttribute("aria-label")).toBe("Delete?");
    expect(m.querySelector(".modal-head h2").textContent).toBe("Delete?");
    expect(m.querySelector(".modal-body").textContent).toBe("body");
    expect(m.querySelector(".modal-actions button").textContent).toBe("Cancel");
    const bare = O.Modal({});
    expect(bare.getAttribute("aria-label")).toBe("Dialog");
    expect(bare.querySelector(".modal-head")).toBeNull();
    expect(bare.querySelector(".modal-actions")).toBeNull();
    expect(O.Modal({ actions: [] }).querySelector(".modal-actions")).toBeNull();
  });
  test("a Modal traps Tab", () => {
    const a = btn("a"), b = btn("b");
    const m = O.Modal({ actions: [a, b] });
    O.openModal(m);
    b.focus();
    expect(fire(m, "keydown", { key: "Tab" }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
  });
  test("openModal mounts scrim + node and focuses the first control in document order", () => {
    const cancel = btn("Cancel");
    const ok = btn("OK");
    ok.className = "btn btn-primary";
    const m = O.Modal({ children: ["text"], actions: [cancel, ok] });
    expect(O.hasOpenModal()).toBe(false);
    expect(O.openModal(m)).toBe(m);
    expect(O.hasOpenModal()).toBe(true);
    expect(roots["modal-root"].children.map((c) => c.className)).toEqual(["scrim scrim-modal", "modal"]);
    // querySelector with a selector list returns the first match in document order, so the first action button wins
    expect(document.activeElement).toBe(cancel);
  });
  test("focus target: an [autofocus] or field in the body comes before the action buttons", () => {
    const auto = btn("A"); auto.setAttribute("autofocus", "");
    O.openModal(O.Modal({ children: [auto], actions: [btn("x")] }));
    expect(document.activeElement).toBe(auto);
    const field = document.createElement("input");
    O.openModal(O.Modal({ children: [field], actions: [btn("x")] }));
    expect(document.activeElement).toBe(field);
    const only = btn("only");
    O.openModal(O.Modal({ actions: [only] }));
    expect(document.activeElement).toBe(only);
  });
  test("a modal with nothing focusable leaves focus where it was", () => {
    const opener = trigger();
    O.openModal(O.Modal({ children: ["text only"] }));
    expect(document.activeElement).toBe(opener);
  });
  test("closeModal removes both, runs onClose, restores focus, and is false when nothing is open", () => {
    expect(O.closeModal()).toBe(false);
    const opener = trigger();
    let closed = 0;
    O.openModal(O.Modal({ actions: [btn("x")], onClose: () => closed++ }));
    expect(document.activeElement).not.toBe(opener);
    expect(O.closeModal()).toBe(true);
    expect(roots["modal-root"].children).toHaveLength(0);
    expect(closed).toBe(1);
    expect(O.hasOpenModal()).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(O.closeModal()).toBe(false);
  });
  test("clicking the scrim closes; opening another modal closes the first (running its onClose)", () => {
    let first = 0;
    O.openModal(O.Modal({ onClose: () => first++ }));
    roots["modal-root"].querySelector(".scrim").click();
    expect(first).toBe(1);
    expect(O.hasOpenModal()).toBe(false);
    O.openModal(O.Modal({ onClose: () => first++ }));
    O.openModal(O.Modal({}));
    expect(first).toBe(2);
    expect(roots["modal-root"].children).toHaveLength(2);
  });
  test("focus is not given back to an opener that left the page", () => {
    const opener = trigger();
    O.openModal(O.Modal({ actions: [btn("x")] }));
    opener.remove();
    O.closeModal();
    expect(opener.focusCalls).toBe(1);
  });
});

describe("confirm", () => {
  const buttons = () => roots["modal-root"].querySelectorAll(".modal-actions button");
  test("resolves true on the confirm button, false on cancel", async () => {
    const p = O.confirm({ title: "Sure?", body: "Really" });
    expect(roots["modal-root"].querySelector(".modal-body p").textContent).toBe("Really");
    expect(texts(buttons())).toEqual(["Cancel", "OK"]);
    expect(buttons()[1].className).toBe("btn btn-primary");
    buttons()[1].click();
    expect(await p).toBe(true);
    expect(O.hasOpenModal()).toBe(false);
    const q = O.confirm({ title: "Sure?" });
    buttons()[0].click();
    expect(await q).toBe(false);
  });
  test("initial focus is on Cancel", () => {
    O.confirm({ title: "t" });
    expect(document.activeElement).toBe(buttons()[0]);
  });
  test("danger styling and custom labels", async () => {
    const p = O.confirm({ title: "t", danger: true, confirmLabel: "Delete", cancelLabel: "Keep" });
    expect(texts(buttons())).toEqual(["Keep", "Delete"]);
    expect(buttons()[1].className).toBe("btn btn-danger");
    expect(texts(O.confirm({ title: "t", danger: true }) && buttons())).toEqual(["Cancel", "Confirm"]);
    buttons()[0].click();
    expect(await p).toBe(false);
  });
  test("a Node body is used as is; an empty body renders an empty paragraph", () => {
    const n = document.createElement("section");
    O.confirm({ body: n });
    expect(n.parentNode.className).toBe("modal-body");
    O.confirm({});
    expect(roots["modal-root"].querySelector(".modal-body p").textContent).toBe("");
  });
  test("dismissing the modal (scrim) resolves false exactly once", async () => {
    const p = O.confirm({ title: "t" });
    roots["modal-root"].querySelector(".scrim").click();
    expect(await p).toBe(false);
  });
});

describe("popover and menu", () => {
  const anchorAt = (rect) => { const a = btn("anchor"); a.rect = { width: rect.right - rect.left, height: rect.bottom - rect.top, ...rect }; dom.body.appendChild(a); a.focus(); return a; };
  const content = (w, h) => { const c = document.createElement("div"); c.rect = { left: 0, top: 0, right: w, bottom: h, width: w, height: h }; return c; };
  // place() measures the popover element itself, so give the next created popover a size
  const sizeNext = (w, h) => {
    const orig = document.createElement;
    document.createElement = (t) => { const n = orig(t); if (t === "div") { Object.defineProperty(n, "rect", { get() { return this.getAttribute("class") === "popover" ? { width: w, height: h } : undefined; }, set() {}, configurable: true }); } return n; };
  };
  test("opens under the anchor, left-aligned, 4px below", () => {
    sizeNext(200, 100);
    const a = anchorAt({ left: 50, right: 150, top: 20, bottom: 40 });
    const p = O.openPopover(a, content(1, 1), { label: "Info" });
    expect(O.hasOpenPopover()).toBe(true);
    expect(p.node.getAttribute("aria-label")).toBe("Info");
    expect(p.node.getAttribute("role")).toBe("dialog");
    expect(roots["popover-root"].children).toEqual([p.node]);
    expect([p.node.style.left, p.node.style.top]).toEqual(["50px", "44px"]);
  });
  test("end placement aligns the right edges", () => {
    sizeNext(200, 100);
    const a = anchorAt({ left: 400, right: 500, top: 20, bottom: 40 });
    const p = O.openPopover(a, content(1, 1), { placement: "end" });
    expect(p.node.style.left).toBe("300px");
  });
  test("clamps to the viewport with an 8px pad; flips above when it would overflow the bottom", () => {
    sizeNext(200, 100);
    const a = anchorAt({ left: 950, right: 990, top: 700, bottom: 760 });
    const p = O.openPopover(a, content(1, 1));
    expect(p.node.style.left).toBe("792px");
    expect(p.node.style.top).toBe("596px");
    const nearTop = anchorAt({ left: 0, right: 10, top: 0, bottom: 5 });
    O.closePopover();
    const q = O.openPopover(nearTop, content(1, 1));
    expect(q.node.style.left).toBe("8px");
    expect(q.node.style.top).toBe("9px");
  });
  test("does not flip when there is no room above either", () => {
    sizeNext(100, 790);
    const a = anchorAt({ left: 10, right: 20, top: 20, bottom: 30 });
    const p = O.openPopover(a, content(1, 1));
    expect(p.node.style.top).toBe("34px");
  });
  test("a pointerdown outside closes it, one inside or on the anchor does not", () => {
    const a = anchorAt({ left: 0, right: 10, top: 0, bottom: 10 });
    const inner = btn("in");
    const p = O.openPopover(a, inner);
    document.dispatchEvent({ type: "pointerdown", target: inner });
    expect(O.hasOpenPopover()).toBe(true);
    document.dispatchEvent({ type: "pointerdown", target: a });
    expect(O.hasOpenPopover()).toBe(true);
    document.dispatchEvent({ type: "pointerdown", target: dom.body });
    expect(O.hasOpenPopover()).toBe(false);
    expect(p.node.parentNode).toBeNull();
    expect(document.listenerCount("pointerdown")).toBe(0);
  });
  test("closing runs onClose and returns focus to the anchor unless returnFocus is false", () => {
    let closed = 0;
    const a = anchorAt({ left: 0, right: 10, top: 0, bottom: 10 });
    O.openPopover(a, btn("x"), { onClose: () => closed++ });
    document.activeElement = dom.body;
    expect(O.closePopover()).toBe(true);
    expect(closed).toBe(1);
    expect(document.activeElement).toBe(a);
    expect(O.closePopover()).toBe(false);
    O.openPopover(a, btn("x"), { returnFocus: false });
    document.activeElement = dom.body;
    O.closePopover();
    expect(document.activeElement).toBe(dom.body);
  });
  test("opening a second popover closes the first", () => {
    const a = anchorAt({ left: 0, right: 10, top: 0, bottom: 10 });
    const p1 = O.openPopover(a, btn("1"));
    const p2 = O.openPopover(a, btn("2"));
    expect(p1.node.parentNode).toBeNull();
    expect(roots["popover-root"].children).toEqual([p2.node]);
    expect(document.listenerCount("pointerdown")).toBe(1);
  });

  describe("openMenu", () => {
    const mk = (items, opts) => { const a = anchorAt({ left: 0, right: 10, top: 0, bottom: 10 }); const pop = O.openMenu(a, items, opts); return { a, pop, rows: pop.node.querySelectorAll("button"), list: pop.node.querySelector("ul") }; };
    test("renders items (skipping falsy), roles, hints, danger and disabled; focuses the first enabled", () => {
      const { pop, rows } = mk([null, { label: "One", hint: "o", icon: "plus" }, { label: "Two", disabled: true }, { label: "Three", danger: true }, false]);
      expect(pop.node.getAttribute("role")).toBe("presentation");
      expect(pop.node.getAttribute("aria-label")).toBe("Menu");
      expect(texts(rows)).toEqual(["Oneo", "Two", "Three"]);
      expect(rows[0].getAttribute("role")).toBe("menuitem");
      expect(rows[0].querySelector(".dim").textContent).toBe("o");
      expect(rows[0].querySelector("svg")).not.toBeNull();
      expect(rows[1].disabled).toBe(true);
      expect(rows[2].className).toBe("menu-item is-danger");
      expect(document.activeElement).toBe(rows[0]);
    });
    test("first item disabled: focus goes to the first enabled one; all disabled focuses nothing", () => {
      const m = mk([{ label: "A", disabled: true }, { label: "B" }]);
      expect(document.activeElement).toBe(m.rows[1]);
      O.closePopover();
      const all = mk([{ label: "A", disabled: true }]);
      expect(document.activeElement).toBe(all.a);
    });
    test("a custom label is used", () => {
      expect(mk([{ label: "A" }], { label: "Row actions" }).pop.node.getAttribute("aria-label")).toBe("Row actions");
    });
    test("selecting closes the menu first, then runs the handler", () => {
      const order = [];
      const { rows } = mk([{ label: "A", onSelect: () => order.push(["sel", O.hasOpenPopover()]) }, { label: "B" }]);
      rows[0].click();
      expect(order).toEqual([["sel", false]]);
      const m2 = mk([{ label: "NoHandler" }]);
      m2.rows[0].click();
      expect(O.hasOpenPopover()).toBe(false);
    });
    test("arrows wrap and skip disabled; Home/End jump", () => {
      const { rows, list } = mk([{ label: "A" }, { label: "B", disabled: true }, { label: "C" }, { label: "D" }]);
      const key = (k) => fire(list, "keydown", { key: k });
      expect(key("ArrowDown").defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(rows[2]);
      key("ArrowDown");
      expect(document.activeElement).toBe(rows[3]);
      key("ArrowDown");
      expect(document.activeElement).toBe(rows[0]);
      key("ArrowUp");
      expect(document.activeElement).toBe(rows[3]);
      key("Home");
      expect(document.activeElement).toBe(rows[0]);
      key("End");
      expect(document.activeElement).toBe(rows[3]);
    });
    test("Tab closes the menu", () => {
      const { list } = mk([{ label: "A" }]);
      expect(fire(list, "keydown", { key: "Tab" }).defaultPrevented).toBe(true);
      expect(O.hasOpenPopover()).toBe(false);
    });
    test("type-ahead focuses the first label starting with the typed prefix and resets after 600ms; modifiers are ignored", () => {
      const { rows, list } = mk([{ label: "Alpha" }, { label: "Beta" }, { label: "Bravo" }]);
      fire(list, "keydown", { key: "b" });
      expect(document.activeElement).toBe(rows[1]);
      fire(list, "keydown", { key: "r" });
      expect(document.activeElement).toBe(rows[2]);
      expect(timerMs()).toContain(600);
      runTimer(600);
      fire(list, "keydown", { key: "a" });
      expect(document.activeElement).toBe(rows[0]);
      fire(list, "keydown", { key: "b", ctrlKey: true });
      fire(list, "keydown", { key: "b", metaKey: true });
      expect(document.activeElement).toBe(rows[0]);
      fire(list, "keydown", { key: "z" });
      expect(document.activeElement).toBe(rows[0]);
    });
  });
});

describe("drawer", () => {
  const rail = () => { const r = document.createElement("div"); r.setAttribute("id", "rail"); dom.body.appendChild(r); r.rect = { width: 200 }; return r; };
  const open = (opts, drawerOpts) => { const d = O.Drawer({ title: "Agent", children: ["body"], ...(drawerOpts || {}) }); O.openDrawer(d, opts); return d; };
  test("Drawer structure: head with title or custom header, close button, tabs, footer", () => {
    const d = O.Drawer({ title: "Agent", children: ["body"], tabs: btn("tabs"), footer: btn("foot") });
    expect(d.getAttribute("role")).toBe("complementary");
    expect(d.getAttribute("aria-label")).toBe("Agent");
    expect(d.querySelector(".drawer-head h2").textContent).toBe("Agent");
    expect(d.querySelector(".drawer-head [aria-label='Close panel']")).not.toBeNull();
    expect(d.querySelector(".drawer-body").textContent).toBe("body");
    expect(d.querySelector(".drawer-foot button").textContent).toBe("foot");
    const hdr = document.createElement("div");
    const d2 = O.Drawer({ header: hdr });
    expect(d2.querySelector(".drawer-head h2")).toBeNull();
    expect(d2.querySelector(".drawer-head").firstChild).toBe(hdr);
    expect(d2.getAttribute("aria-label")).toBe("Details");
    expect(O.Drawer({}).querySelector(".drawer-foot")).toBeNull();
  });
  test("wide viewport docks: inspector marked docked, scrim hidden, not modal", () => {
    dom.setSize(1600, 900);
    const d = open();
    expect(O.hasOpenDrawer()).toBe(true);
    expect(roots.inspector.firstChild).toBe(d);
    expect(roots.inspector.hidden).toBe(false);
    expect(document.documentElement.getAttribute("data-inspector")).toBe("docked");
    expect(d.getAttribute("aria-modal")).toBe("false");
    expect(document.getElementById("inspector-scrim").hidden).toBe(true);
  });
  test("narrow viewport overlays with a modal scrim", () => {
    dom.setSize(1000, 900);
    const d = open();
    expect(document.documentElement.getAttribute("data-inspector")).toBe("overlay");
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById("inspector-scrim").hidden).toBe(false);
  });
  test("docking needs room: viewport >= 1280 and 720px of canvas left after the rail and drawer", () => {
    rail();
    dom.setSize(1279, 900);
    open();
    expect(document.documentElement.getAttribute("data-inspector")).toBe("overlay");
    O.closeDrawer();
    dom.setSize(1280, 900);
    open();
    expect(document.documentElement.getAttribute("data-inspector")).toBe("overlay");
    O.closeDrawer();
    dom.setSize(1340, 900);
    open();
    expect(document.documentElement.getAttribute("data-inspector")).toBe("docked");
  });
  test("a rail that is not displayed takes no width; --inspector-w overrides the 420px default", () => {
    dom.setSize(1280, 900);
    const r = rail();
    r.remove();
    open();
    expect(document.documentElement.getAttribute("data-inspector")).toBe("docked");
    O.closeDrawer();
    globalThis.getComputedStyle = () => ({ getPropertyValue: () => "700" });
    open();
    expect(document.documentElement.getAttribute("data-inspector")).toBe("overlay");
  });
  test("resizing the window re-evaluates dock vs overlay", () => {
    dom.setSize(1000, 900);
    open();
    expect(document.documentElement.getAttribute("data-inspector")).toBe("overlay");
    dom.setSize(1600, 900);
    dom.win.dispatchEvent({ type: "resize" });
    expect(document.documentElement.getAttribute("data-inspector")).toBe("docked");
  });
  test("a resize with no drawer open clears the marker", () => {
    document.documentElement.setAttribute("data-inspector", "stale");
    dom.win.dispatchEvent({ type: "resize" });
    expect(document.documentElement.getAttribute("data-inspector")).toBeNull();
  });
  test("focus goes to [data-autofocus], else the title (made focusable) / first head button, unless focus:false", () => {
    const af = btn("af"); af.setAttribute("data-autofocus", "");
    open(undefined, { children: [af] });
    expect(document.activeElement).toBe(af);
    O.closeDrawer();
    const d = open();
    const h2 = d.querySelector("h2");
    expect(document.activeElement).toBe(h2);
    expect(h2.tabIndex).toBe(-1);
    O.closeDrawer();
    document.activeElement = dom.body;
    open({ focus: false });
    expect(document.activeElement).toBe(dom.body);
  });
  test("Tab is trapped only while overlaying", () => {
    dom.setSize(1000, 900);
    const first = btn("first"), last = btn("last");
    const d = open(undefined, { children: [first, last] });
    const lastBtn = d.querySelectorAll("button").at(-1);
    lastBtn.focus();
    const ev = fire(d, "keydown", { key: "Tab", shiftKey: false });
    expect(ev.defaultPrevented).toBe(true);
    O.closeDrawer();
    dom.setSize(1600, 900);
    const d2 = open(undefined, { children: [first, last] });
    d2.querySelectorAll("button").at(-1).focus();
    expect(fire(d2, "keydown", { key: "Tab", shiftKey: false }).defaultPrevented).toBeFalsy();
  });
  test("shift-Tab on the first focusable wraps to the last when overlaying", () => {
    dom.setSize(1000, 900);
    const d = open(undefined, { children: [btn("x")] });
    const all = d.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])');
    all[0].focus();
    const ev = fire(d, "keydown", { key: "Tab", shiftKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(all.at(-1));
  });
  test("opening another drawer replaces the first, runs its onClose and keeps the original return focus", () => {
    const opener = trigger();
    let first = 0;
    const d1 = open(undefined, { onClose: () => first++ });
    const d2 = open();
    expect(first).toBe(1);
    expect(d1.parentNode).toBeNull();
    expect(roots.inspector.children).toEqual([d2]);
    O.closeDrawer();
    expect(document.activeElement).toBe(opener);
  });
  test("closeDrawer hides the host and scrim, clears the marker, runs onClose; false when none", () => {
    expect(O.closeDrawer()).toBe(false);
    let closed = 0;
    const d = open(undefined, { onClose: () => closed++ });
    expect(O.closeDrawer()).toBe(true);
    expect(closed).toBe(1);
    expect(d.parentNode).toBeNull();
    expect(roots.inspector.hidden).toBe(true);
    expect(document.getElementById("inspector-scrim").hidden).toBe(true);
    expect(document.documentElement.getAttribute("data-inspector")).toBeNull();
    expect(O.hasOpenDrawer()).toBe(false);
  });
  test("the scrim and the close buttons close it", () => {
    dom.setSize(1000, 900);
    open();
    document.getElementById("inspector-scrim").click();
    expect(O.hasOpenDrawer()).toBe(false);
    open();
    roots.inspector.querySelector(".drawer-head [aria-label='Close panel']").click();
    expect(O.hasOpenDrawer()).toBe(false);
    open();
    roots.inspector.querySelector(".sheet-handle").click();
    expect(O.hasOpenDrawer()).toBe(false);
  });
  test("the scrim is created once, before the inspector, and reused", () => {
    open();
    const scrim = document.getElementById("inspector-scrim");
    expect(scrim.nextSibling).toBe(roots.inspector);
    O.closeDrawer();
    open();
    expect(document.querySelectorAll("#inspector-scrim")).toHaveLength(1);
  });
});

describe("fuzzy", () => {
  test("empty query scores 0; non-subsequence is -1; case-insensitive", () => {
    expect(O.fuzzy("", "anything")).toBe(0);
    expect(O.fuzzy("zz", "abc")).toBe(-1);
    expect(O.fuzzy("ba", "abc")).toBe(-1);
    expect(O.fuzzy("ABC", "abc")).toBeGreaterThan(0);
  });
  test("scores: consecutive runs, word starts, and shorter text rank higher", () => {
    expect(O.fuzzy("a", "a")).toBeCloseTo(1 + 2 + 3 - 0.01, 10);
    expect(O.fuzzy("ab", "ab")).toBeCloseTo((1 + 2 + 3) + (1 + 4) - 0.02, 10);
    expect(O.fuzzy("ab", "ab")).toBeGreaterThan(O.fuzzy("ab", "axb"));
    expect(O.fuzzy("b", "a b")).toBeGreaterThan(O.fuzzy("b", "aab"));
    expect(O.fuzzy("go", "go home")).toBeGreaterThan(O.fuzzy("go", "go home now please"));
    for (const sep of [" ", "-", "_", "/", ":", "."]) expect(O.fuzzy("b", "a" + sep + "b")).toBeGreaterThan(O.fuzzy("b", "ab"));
  });
  test("a non-consecutive match gets no run bonus", () => {
    expect(O.fuzzy("ac", "abc")).toBeCloseTo((1 + 2 + 3) + 1 - 0.03, 10);
  });
});

describe("command palette", () => {
  const entries = () => [
    { group: "Go to", label: "Overview", id: "p-overview", run: () => ran.push("overview") },
    { group: "Agents", label: "omp main", hint: "tech-tools", id: "a-1", run: () => ran.push("agent") },
    { group: "Actions", label: "New thread", keys: "g n", icon: "plus", run: () => ran.push("thread") },
    { group: "Projects", label: "Billing", run: () => ran.push("billing") },
    { group: "Go to", label: "Health", id: "p-health", run: () => ran.push("health") },
  ];
  let ran;
  beforeEach(() => { ran = []; });
  const input = () => roots["palette-root"].querySelector("input");
  const rowsOf = () => roots["palette-root"].querySelectorAll("[role=option]");
  const labels = () => rowsOf().map((r) => r.querySelector(".grow").textContent);
  const type = (v) => { input().value = v; fire(input(), "input"); };
  const key = (k, extra) => fire(input(), "keydown", { key: k, ...(extra || {}) });

  test("opens as a labelled combobox dialog with focus in the input; groups appear in fixed order", () => {
    const opener = trigger();
    O.openPalette({ entries });
    expect(O.isPaletteOpen()).toBe(true);
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute("role")).toBe("combobox");
    expect(roots["palette-root"].querySelector(".palette").getAttribute("aria-label")).toBe("Command palette");
    expect(labels()).toEqual(["omp main", "Overview", "Health", "New thread", "Billing"]);
    expect(texts(roots["palette-root"].querySelectorAll(".palette-group"))).toEqual(["Agents", "Go to", "Actions", "Projects"]);
    expect(texts(roots["palette-root"].querySelectorAll(".palette-filter button"))).toEqual(["Agents", "Go to", "Actions", "Projects"]);
    O.closePalette();
    expect(document.activeElement).toBe(opener);
  });
  test("the first row is selected and referenced by aria-activedescendant", () => {
    O.openPalette({ entries });
    expect(rowsOf().map((r) => r.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false", "false"]);
    expect(input().getAttribute("aria-activedescendant")).toBe("pal-0");
  });
  test("a second open while open does nothing", () => {
    O.openPalette({ entries });
    O.openPalette({ entries });
    expect(roots["palette-root"].querySelectorAll(".palette")).toHaveLength(1);
  });
  test("row details: hint and keycaps", () => {
    O.openPalette({ entries });
    const hint = roots["palette-root"].querySelector(".hint");
    expect(hint.textContent).toBe("tech-tools");
    expect(texts(roots["palette-root"].querySelectorAll("li button .row kbd"))).toEqual(["g", "n"]);
  });
  test("typing filters by fuzzy label or hint and resets the selection", () => {
    O.openPalette({ entries });
    key("ArrowDown");
    type("ov");
    expect(labels()).toEqual(["Overview"]);
    expect(rowsOf()[0].getAttribute("aria-selected")).toBe("true");
    type("tech");
    expect(labels()).toEqual(["omp main"]);
    type("zzzz");
    expect(labels()).toEqual([]);
    expect(roots["palette-root"].querySelector(".palette-empty").textContent).toBe("No matches. Try fewer letters, or clear the filter.");
    expect(input().getAttribute("aria-activedescendant")).toBe("");
  });
  test("prefix characters filter by group: > actions, @ agents, # pages", () => {
    O.openPalette({ entries });
    type(">");
    expect(labels()).toEqual(["New thread"]);
    type("@");
    expect(labels()).toEqual(["omp main"]);
    type("#h");
    expect(labels()).toEqual(["Health"]);
    type("> new");
    expect(labels()).toEqual(["New thread"]);
  });
  test("the hint matches count slightly less than label matches", () => {
    const es = () => [{ group: "Go to", label: "Settings", run() {} }, { group: "Go to", label: "Other", hint: "settings", run() {} }];
    O.openPalette({ entries: es });
    type("settings");
    expect(labels()).toEqual(["Settings", "Other"]);
  });
  test("recent ids float to the top of their group", () => {
    O.openPalette({ entries, recent: () => ["p-health"] });
    expect(labels()).toEqual(["omp main", "Health", "Overview", "New thread", "Billing"]);
  });
  test("recent order matters: earlier is stronger", () => {
    O.openPalette({ entries, recent: () => ["p-health", "p-overview"] });
    expect(labels().slice(1, 3)).toEqual(["Health", "Overview"]);
    O.closePalette();
    O.openPalette({ entries, recent: () => ["p-overview", "p-health"] });
    expect(labels().slice(1, 3)).toEqual(["Overview", "Health"]);
  });
  test("initial text pre-fills and filters", () => {
    O.openPalette({ entries, initial: "bill" });
    expect(input().value).toBe("bill");
    expect(labels()).toEqual(["Billing"]);
  });
  test("arrows move the selection within bounds and scroll it into view; Enter runs it and closes", () => {
    O.openPalette({ entries });
    key("ArrowUp");
    expect(input().getAttribute("aria-activedescendant")).toBe("pal-0");
    const down = key("ArrowDown");
    expect(down.defaultPrevented).toBe(true);
    expect(input().getAttribute("aria-activedescendant")).toBe("pal-1");
    expect(rowsOf()[1].getAttribute("aria-selected")).toBe("true");
    expect(rowsOf()[0].getAttribute("aria-selected")).toBe("false");
    expect(document.getElementById("pal-1").scrolledIntoView).toBe(1);
    for (let i = 0; i < 10; i++) key("ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toBe("pal-4");
    key("ArrowUp");
    expect(input().getAttribute("aria-activedescendant")).toBe("pal-3");
    key("ArrowUp");
    key("ArrowUp");
    key("ArrowUp");
    key("ArrowUp");
    expect(input().getAttribute("aria-activedescendant")).toBe("pal-0");
    key("ArrowDown");
    key("Enter");
    expect(ran).toEqual(["overview"]);
    expect(O.isPaletteOpen()).toBe(false);
    expect(roots["palette-root"].children).toHaveLength(0);
  });
  test("Enter with no results just closes", () => {
    O.openPalette({ entries });
    type("zzzz");
    key("Enter");
    expect(ran).toEqual([]);
    expect(O.isPaletteOpen()).toBe(false);
  });
  test("clicking a row runs it; the mouse moves the selection; the scrim and Escape close", () => {
    O.openPalette({ entries });
    fire(rowsOf()[2], "mousemove");
    expect(rowsOf().map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false", "false"]);
    expect(input().getAttribute("aria-activedescendant")).toBe("pal-2");
    rowsOf()[3].querySelector("button").click();
    expect(ran).toEqual(["thread"]);
    expect(O.isPaletteOpen()).toBe(false);
    O.openPalette({ entries });
    key("Escape");
    expect(O.isPaletteOpen()).toBe(false);
    O.openPalette({ entries });
    roots["palette-root"].querySelector(".scrim").click();
    expect(O.isPaletteOpen()).toBe(false);
    expect(ran).toEqual(["thread"]);
  });
  test("Tab cycles the group filter forward, Shift+Tab back; past either end the filter clears", () => {
    O.openPalette({ entries });
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(labels()).toEqual(["omp main"]);
    key("Tab");
    expect(labels()).toEqual(["Overview", "Health"]);
    key("Tab");
    expect(labels()).toEqual(["New thread"]);
    key("Tab");
    expect(labels()).toEqual(["Billing"]);
    key("Tab", { shiftKey: true });
    expect(labels()).toEqual(["New thread"]);
    key("Tab", { shiftKey: true });
    key("Tab", { shiftKey: true });
    expect(labels()).toEqual(["omp main"]);
    key("Tab", { shiftKey: true });
    expect(labels()).toHaveLength(5);
    key("Tab", { shiftKey: true });
    expect(labels()).toHaveLength(5);
    key("Tab"); key("Tab"); key("Tab"); key("Tab"); key("Tab");
    expect(labels()).toHaveLength(5);
  });
  test("group chips toggle the filter and return focus to the input", () => {
    O.openPalette({ entries });
    const chip = (name) => roots["palette-root"].querySelectorAll(".palette-filter button").find((b) => b.textContent === name);
    chip("Go to").click();
    expect(labels()).toEqual(["Overview", "Health"]);
    expect(chip("Go to").getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(input());
    chip("Go to").click();
    expect(labels()).toHaveLength(5);
    expect(chip("Go to").getAttribute("aria-pressed")).toBe("false");
  });
  test("results are capped at 60", () => {
    const many = () => Array.from({ length: 80 }, (_, i) => ({ group: "Go to", label: "Item " + i, run() {} }));
    O.openPalette({ entries: many });
    expect(rowsOf()).toHaveLength(60);
  });
  test("an entry's glyph stands in when it has no icon", () => {
    const g = document.createElement("i");
    O.openPalette({ entries: () => [{ group: "Go to", label: "G", glyph: g, run() {} }] });
    expect(rowsOf()[0].querySelector("i")).toBe(g);
  });
  test("closePalette is false when closed", () => {
    expect(O.closePalette()).toBe(false);
  });
  test("Tab inside the panel is trapped", () => {
    O.openPalette({ entries });
    const panel = roots["palette-root"].querySelector(".palette");
    const bs = panel.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])');
    bs.at(-1).focus();
    expect(fire(panel, "keydown", { key: "Tab" }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(bs[0]);
  });
});
