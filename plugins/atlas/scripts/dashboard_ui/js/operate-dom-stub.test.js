import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { body, buttonsOf, installDom, restoreDom } from "./operate-dom-stub.js";

// Contract of the shared DOM stand-in itself: the operate-surface tests lean on it, so a silent change here
// would make those tests pass for the wrong reason.
describe("operate DOM stub", () => {
  beforeEach(installDom);
  afterEach(restoreDom);

  const el = (t, cls) => { const n = document.createElement(t); if (cls) n.className = cls; return n; };

  test("appendChild returns the child, sets its parent, and re-parents from the old parent", () => {
    const a = el("div"), b = el("div"), c = el("span");
    expect(a.appendChild(c)).toBe(c);
    expect(c.parent).toBe(a);
    b.appendChild(c);
    expect(a.children).toEqual([]);
    expect(b.children).toEqual([c]);
    expect(c.parent).toBe(b);
  });

  test("append adds every argument in order; replaceChildren swaps the list and skips falsy entries", () => {
    const p = el("div"), x = el("i"), y = el("b"), z = el("u");
    p.append(x, y);
    expect(p.children).toEqual([x, y]);
    p.replaceChildren(z, null, undefined);
    expect(p.children).toEqual([z]);
    expect(x.parent === p).toBe(true); // stale back-pointer is not cleared; only the list is replaced
    p.replaceChildren();
    expect(p.children).toEqual([]);
  });

  test("insertBefore appends and returns the node", () => {
    const p = el("div"), c = el("i");
    expect(p.insertBefore(c)).toBe(c);
    expect(p.children).toEqual([c]);
  });

  test("replaceWith swaps in place; a detached node is a no-op", () => {
    const p = el("div"), a = el("i"), b = el("b"), n = el("u");
    p.append(a, b);
    a.replaceWith(n);
    expect(p.children).toEqual([n, b]);
    expect(n.parent).toBe(p);
    expect(a.parent).toBe(null);
    a.replaceWith(el("s")); // detached: nothing throws, nothing changes
    expect(p.children).toEqual([n, b]);
  });

  test("remove detaches from the parent and keeps the other siblings", () => {
    const p = el("div"), a = el("i"), b = el("b");
    p.append(a, b);
    a.remove();
    expect(p.children).toEqual([b]);
    expect(a.parent).toBe(null);
    a.remove(); // already detached
    expect(p.children).toEqual([b]);
  });

  test("attributes: set stringifies, get returns null when missing (but keeps falsy values), remove deletes", () => {
    const n = el("div");
    expect(n.getAttribute("x")).toBe(null);
    n.setAttribute("x", 0);
    expect(n.getAttribute("x")).toBe("0");
    n.setAttribute("y", "");
    expect(n.getAttribute("y")).toBe("");
    n.removeAttribute("x");
    expect(n.getAttribute("x")).toBe(null);
    expect("x" in n.attrs).toBe(false);
  });

  test("click fires every registered listener with a target and preventDefault; nothing registered is fine", () => {
    const n = el("button");
    n.click();
    const seen = [];
    n.addEventListener("click", (e) => { seen.push(["a", e.currentTarget === n, e.target === n, typeof e.preventDefault]); });
    n.addEventListener("click", () => seen.push(["b"]));
    n.addEventListener("keydown", () => seen.push(["key"]));
    n.click();
    expect(seen).toEqual([["a", true, true, "function"], ["b"]]);
  });

  test("className reads and writes the class attribute; textContent setter replaces children", () => {
    const n = el("div");
    expect(n.className).toBe("");
    n.className = "a b";
    expect(n.attrs.class).toBe("a b");
    n.textContent = "hi";
    expect(n.children.length).toBe(1);
    expect(n.textContent).toBe("hi");
    n.textContent = "";
    expect(n.children).toEqual([]);
    expect(n.firstChild).toBeUndefined();
  });

  test("textContent concatenates descendants in order; text nodes carry their string", () => {
    const p = el("div");
    p.append(document.createTextNode("a"), el("b"), document.createTextNode(7));
    p.children[1].textContent = "x";
    expect(p.textContent).toBe("ax7");
    expect(p.firstChild.textContent).toBe("a");
  });

  test("matches: #id, tag, .class and tag.class", () => {
    const n = el("li", "row on");
    n.setAttribute("id", "k");
    expect(n.matches("#k")).toBe(true);
    expect(n.matches("#z")).toBe(false);
    expect(n.matches("li")).toBe(true);
    expect(n.matches("div")).toBe(false);
    expect(n.matches(".row")).toBe(true);
    expect(n.matches(".row.on")).toBe(true);
    expect(n.matches(".row.off")).toBe(false);
    expect(n.matches("li.on")).toBe(true);
    expect(n.matches("div.on")).toBe(false);
  });

  test("querySelectorAll walks descendants depth-first, excludes self; querySelector returns first or null", () => {
    const root = el("div", "r"), a = el("p", "m"), b = el("p", "m"), deep = el("p", "m");
    a.appendChild(deep);
    root.append(a, b);
    expect(root.querySelectorAll(".m")).toEqual([a, deep, b]);
    expect(root.querySelector(".m")).toBe(a);
    expect(root.querySelector(".r")).toBe(null);
    expect(root.querySelector(".none")).toBe(null);
    expect(buttonsOf(root)).toEqual([]);
    const btn = el("button"); btn.textContent = "Go"; b.appendChild(btn);
    expect(buttonsOf(root)).toEqual(["Go"]);
  });

  test("contains and closest are inert (false / null) and focus is callable", () => {
    const n = el("div");
    expect(n.contains(n)).toBe(false);
    expect(n.closest("div")).toBe(null);
    expect(n.focus()).toBeUndefined();
    expect(n.isConnected).toBe(false);
    expect(n.classList.add("x")).toBeUndefined();
  });

  test("installDom: globals exist, body is connected and emptied on each install", () => {
    body.appendChild(el("i"));
    installDom();
    expect(body.children).toEqual([]);
    expect(body.isConnected).toBe(true);
    expect(document.body).toBe(body);
    expect(location).toBe(window.location);
    expect(location.origin).toBe("http://127.0.0.1:7421");
    expect(window.self).toBe(window.top);
    expect(window.innerWidth).toBe(1440);
    expect(window.matchMedia("x").matches).toBe(true);
    expect(new Node("a") instanceof Node).toBe(true);
    expect(document.createElementNS("ns", "svg").tag).toBe("svg");
    expect(document.createElement("a").tag).toBe("a");
    expect(document.createTextNode("t").tag).toBe("#text");
    expect(document.hidden).toBe(false);
    expect(document.activeElement).toBe(null);
    expect(document.querySelector("x")).toBe(null);
    expect(document.querySelectorAll("x")).toEqual([]);
  });

  test("getElementById finds a body descendant by id", () => {
    const n = el("div"); n.setAttribute("id", "hit");
    body.appendChild(n);
    expect(document.getElementById("hit")).toBe(n);
    expect(document.getElementById("miss")).toBe(null);
  });

  test("sessionStorage stores strings, returns null for unknown keys (keeps '' and '0')", () => {
    expect(sessionStorage.getItem("k")).toBe(null);
    sessionStorage.setItem("k", 0);
    expect(sessionStorage.getItem("k")).toBe("0");
    sessionStorage.setItem("e", "");
    expect(sessionStorage.getItem("e")).toBe("");
  });

  test("restoreDom puts the previous globals back and a second restore is a no-op", () => {
    const sentinel = { sentinel: true };
    restoreDom();
    const orig = globalThis.window;
    globalThis.window = sentinel;
    installDom();
    expect(window).not.toBe(sentinel);
    restoreDom();
    expect(window).toBe(sentinel);
    restoreDom();
    expect(window).toBe(sentinel);
    globalThis.window = orig;
  });
});
