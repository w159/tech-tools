import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom, fire } from "./rich-dom.js";
import { agentsStore } from "./agents-store.js";
import { closeModal } from "./ui-overlays.js";

let dom, A, roots, fetched, refreshed, savedStore, realFetch, timers;
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
let seq = 0;
async function load(base) {
  dom = installRichDom({ base });
  roots = Object.fromEntries(["toast-root", "modal-root"].map((id) => [id, dom.root(id)]));
  return import("./herdr-actions.js?h=" + ++seq);
}
beforeEach(() => {
  fetched = [];
  refreshed = [];
  timers = [];
  savedStore = { get: agentsStore.get, refresh: agentsStore.refresh };
  agentsStore.refresh = (names) => { refreshed.push(names); };
  realFetch = globalThis.fetch;
  globalThis.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; };
});
afterEach(() => {
  closeModal();
  agentsStore.get = savedStore.get;
  agentsStore.refresh = savedStore.refresh;
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realTimers.setTimeout;
  globalThis.clearTimeout = realTimers.clearTimeout;
  restoreRichDom();
});
const reply = (status, body, statusText = "") => async (url, init) => {
  fetched.push([url, init]);
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, statusText, text: async () => text };
};
const toasts = () => roots["toast-root"].children.map((t) => ({ msg: t.querySelector(".grow div").textContent, kind: t.getAttribute("data-kind"), why: t.querySelectorAll(".why").map((w) => w.textContent) }));
const until = async (cond) => { const end = Date.now() + 2000; while (!cond()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => realTimers.setTimeout(r, 1)); } };

describe("hostReachable and the base meta", () => {
  test("false standalone, true under the gateway", async () => {
    expect((await load("")).hostReachable()).toBe(false);
    restoreRichDom();
    expect((await load("/atlas/")).hostReachable()).toBe(true);
  });
});

describe("sendKeys / QUICK_KEYS", () => {
  test("QUICK_KEYS are the host key bar's names", () => {
    return load("/atlas").then((m) => {
      expect(m.QUICK_KEYS).toEqual([["Enter", ["Enter"]], ["Esc", ["Escape"]], ["Tab", ["Tab"]], ["Up", ["ArrowUp"]], ["Down", ["ArrowDown"]]]);
    });
  });
  test("posts same-origin JSON to the host route, toasts, and refreshes the herd", async () => {
    const m = await load("/atlas");
    globalThis.fetch = reply(200, { ok: true });
    const res = await m.sendKeys("p1", ["Enter", "Tab"]);
    expect(res).toEqual({ ok: true });
    expect(fetched).toHaveLength(1);
    const [url, init] = fetched[0];
    expect(url).toBe("/api/pane/keys");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toEqual({ "Content-Type": "application/json", Accept: "application/json" });
    expect(JSON.parse(init.body)).toEqual({ pane_id: "p1", keys: ["Enter", "Tab"] });
    expect(toasts()).toEqual([{ msg: "Sent Enter Tab", kind: "ok", why: [] }]);
    expect(refreshed).toEqual([["herd"]]);
  });
  test("an empty response body is still success", async () => {
    const m = await load("/atlas");
    globalThis.fetch = reply(200, "");
    expect(await m.sendKeys("p", ["Enter"])).toEqual({});
  });
  test("standalone: says honestly that the host address is needed and never calls fetch", async () => {
    const m = await load("");
    globalThis.fetch = reply(200, {});
    expect(await m.sendKeys("p", ["Enter"])).toBeNull();
    expect(fetched).toHaveLength(0);
    expect(toasts()).toEqual([{ msg: "Needs the agent runtime host address", kind: "fail", why: ["Atlas is open on its own port, so the runtime host's workspace routes are on another origin.", "Open Atlas through the runtime web UI address (/atlas/) or use Colony."] }]);
    expect(refreshed).toEqual([]);
  });
  test("a host error shows its own text; 403 gets the view-only explanation", async () => {
    const m = await load("/atlas");
    globalThis.fetch = reply(500, { error: "pane gone", message: "no such pane", do: "refresh" }, "Server Error");
    expect(await m.sendKeys("p", ["Enter"])).toBeNull();
    expect(toasts().at(-1)).toEqual({ msg: "pane gone", kind: "fail", why: ["no such pane", "refresh"] });
    globalThis.fetch = reply(403, {}, "Forbidden");
    await m.sendKeys("p", ["Enter"]);
    expect(toasts().at(-1)).toEqual({ msg: "Forbidden", kind: "fail", why: ["This device is view-only on the agent runtime host."] });
    globalThis.fetch = reply(500, { error: "x", why: "because" });
    await m.sendKeys("p", ["Enter"]);
    expect(toasts().at(-1).why).toEqual(["because"]);
    expect(refreshed).toEqual([]);
  });
  test("a non-JSON error body falls back to the status text", async () => {
    const m = await load("/atlas");
    globalThis.fetch = reply(502, "<html>bad gateway</html>", "Bad Gateway");
    await m.sendKeys("p", ["Enter"]);
    expect(toasts().at(-1)).toEqual({ msg: "Bad Gateway", kind: "fail", why: [] });
  });
  test("an unreachable host is reported plainly", async () => {
    const m = await load("/atlas");
    globalThis.fetch = async () => { throw new TypeError("network"); };
    expect(await m.sendKeys("p", ["Enter"])).toBeNull();
    expect(toasts().at(-1)).toEqual({ msg: "Cannot reach the agent runtime host", kind: "fail", why: ["The terminal service did not answer.", "Recheck from Colony."] });
  });
});

describe("newWorkspace", () => {
  const modal = () => roots["modal-root"].querySelector(".modal");
  const field = (id) => modal().querySelectorAll("input").find((i) => i.getAttribute("id") === id) || null;
  const inputs = () => modal().querySelectorAll("input");
  const btn = (label) => modal().querySelectorAll(".modal-actions button").find((b) => b.textContent === label);
  test("opens a dialog with a name field and a directory field prefilled with the default", async () => {
    const m = await load("/atlas");
    m.newWorkspace("/work/x");
    expect(modal().querySelector("h2").textContent).toBe("New workspace");
    expect(modal().querySelectorAll("label").map((l) => l.textContent)).toEqual(["Name", "Directory"]);
    expect(inputs().map((i) => i.value)).toEqual(["", "/work/x"]);
    expect(inputs()[1].getAttribute("placeholder")).toBe("/path/to/project");
    expect(modal().querySelector(".field-hint").textContent).toBe("Leave empty for the runtime default.");
    expect(btn("Cancel")).toBeTruthy();
    expect(btn("Create").className).toBe("btn btn-primary");
  });
  test("focuses the name field after the dialog is up", async () => {
    const m = await load("/atlas");
    m.newWorkspace();
    expect(timers).toHaveLength(1);
    expect(timers[0][1]).toBe(0);
    timers[0][0]();
    expect(document.activeElement).toBe(inputs()[0]);
  });
  test("Create posts the trimmed name and directory, closes, and refreshes", async () => {
    const m = await load("/atlas");
    globalThis.fetch = reply(200, {});
    m.newWorkspace("");
    inputs()[0].value = "  api  ";
    inputs()[1].value = " /srv/api ";
    btn("Create").click();
    await until(() => refreshed.length === 1);
    expect(roots["modal-root"].children).toHaveLength(0);
    expect(fetched[0][0]).toBe("/api/workspace/create");
    expect(JSON.parse(fetched[0][1].body)).toEqual({ label: "api", cwd: "/srv/api" });
    expect(toasts().at(-1).msg).toBe("Workspace created");
  });
  test("empty fields are left out of the request", async () => {
    const m = await load("/atlas");
    globalThis.fetch = reply(200, {});
    m.newWorkspace("");
    inputs()[0].value = "   ";
    btn("Create").click();
    await until(() => fetched.length === 1);
    expect(JSON.parse(fetched[0][1].body)).toEqual({});
  });
  test("Enter in the name field submits; other keys do not; Cancel closes without a request", async () => {
    const m = await load("/atlas");
    globalThis.fetch = reply(200, {});
    m.newWorkspace("/d");
    fire(modal().querySelector(".field"), "keydown", { key: "a" });
    expect(fetched).toHaveLength(0);
    fire(modal().querySelector(".field"), "keydown", { key: "Enter" });
    await until(() => fetched.length === 1);
    expect(JSON.parse(fetched[0][1].body)).toEqual({ cwd: "/d" });
    m.newWorkspace("");
    btn("Cancel").click();
    expect(roots["modal-root"].children).toHaveLength(0);
    expect(fetched).toHaveLength(1);
  });
  test("a host failure toasts and still closes the dialog", async () => {
    const m = await load("/atlas");
    globalThis.fetch = reply(403, {}, "Forbidden");
    m.newWorkspace("");
    btn("Create").click();
    await until(() => toasts().length === 1);
    expect(toasts()[0].msg).toBe("Forbidden");
    expect(roots["modal-root"].children).toHaveLength(0);
    expect(refreshed).toEqual([]);
  });
});

describe("focusPane", () => {
  test("no pane id is a visible warning, not a silent no-op", async () => {
    const m = await load("");
    m.focusPane("");
    m.focusPane(null);
    expect(toasts()).toEqual([
      { msg: "This item has no live pane", kind: "warn", why: ["Its agent has not started or has exited."] },
      { msg: "This item has no live pane", kind: "warn", why: ["Its agent has not started or has exited."] },
    ]);
    expect(location.hash).toBe("");
  });
  test("a pane Atlas lists opens in the inspector's terminal tab", async () => {
    const m = await load("");
    agentsStore.get = (id) => (id === "p1" ? { key: "omp:p1 x" } : null);
    m.focusPane("p1");
    expect(location.hash).toBe("#/agents?agent=omp%3Ap1%20x&tab=terminal");
  });
  test("an unlisted pane goes to the herdr console deep link", async () => {
    const m = await load("");
    agentsStore.get = () => null;
    m.focusPane("w 1/2");
    expect(location.hash).toBe("#/herdr?pane=w%201%2F2");
    expect(toasts()).toEqual([]);
  });
});
