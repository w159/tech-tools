import { test, expect, beforeEach, afterEach } from "bun:test";

// loadXterm memoises its result in module state, so every test evaluates its own copy of the module.
let copies = 0;
const fresh = () => import(`./pages/terminal.js?xterm-load=${++copies}`);

let saved;
let appended;
let failHref;
beforeEach(() => {
  saved = { window: globalThis.window, document: globalThis.document };
  appended = [];
  failHref = null;
  globalThis.window = { __ATLAS_BASE__: "/ui-base" };
  globalThis.document = {
    createElement: (tag) => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
    head: {
      appendChild(n) {
        appended.push(n);
        const url = n.attrs.src || n.attrs.href;
        queueMicrotask(() => (failHref && url.endsWith(failHref) ? n.onerror() : n.onload()));
      },
    },
  };
});
afterEach(() => { Object.assign(globalThis, saved); });

test("loadXterm adds the vendored stylesheet and both scripts under the app base, then resolves", async () => {
  const { loadXterm } = await fresh();
  await loadXterm();
  expect(appended.map((n) => [n.tag, n.attrs])).toEqual([
    ["link", { rel: "stylesheet", href: "/ui-base/ui/vendor/xterm/xterm.css" }],
    ["script", { src: "/ui-base/ui/vendor/xterm/xterm.js" }],
    ["script", { src: "/ui-base/ui/vendor/xterm/addon-fit.js" }],
  ]);
  const again = appended.length;
  await loadXterm();
  expect(appended.length).toBe(again); // memoised after success
});

test("loadXterm does nothing when xterm is already on the page", async () => {
  const { loadXterm } = await fresh();
  window.Terminal = class {};
  window.FitAddon = {};
  await loadXterm();
  expect(appended).toEqual([]);
});

test("a failed asset load rejects naming the file, and the next call tries again", async () => {
  const { loadXterm } = await fresh();
  failHref = "addon-fit.js";
  await expect(loadXterm()).rejects.toThrow("could not load /ui-base/ui/vendor/xterm/addon-fit.js");
  const first = appended.length;
  failHref = null;
  await loadXterm();
  expect(appended.length).toBe(first + 3);
});

test("a failed stylesheet is reported by its href", async () => {
  const { loadXterm } = await fresh();
  failHref = "xterm.css";
  await expect(loadXterm()).rejects.toThrow("could not load /ui-base/ui/vendor/xterm/xterm.css");
  failHref = null;
  await loadXterm();
});

test("the page's load() tears down any previous mount and has no data of its own", async () => {
  const { default: page } = await fresh();
  const realDestroy = page.destroy;
  let destroyed = 0;
  page.destroy = () => { destroyed++; };
  try {
    expect(await page.load()).toBeNull();
    expect(destroyed).toBe(1);
  } finally { page.destroy = realDestroy; }
});
