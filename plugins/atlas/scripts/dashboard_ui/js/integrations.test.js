import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom, fire } from "./rich-dom.js";
import { api } from "./api.js";
import { closeModal } from "./ui-overlays.js";

let dom, I, roots, calls, saved, resp;
let seq = 0;
beforeEach(async () => {
  dom = installRichDom();
  roots = Object.fromEntries(["toast-root", "modal-root"].map((id) => [id, dom.root(id)]));
  saved = { get: api.get, post: api.post };
  calls = [];
  resp = { get: {}, post: {} };
  api.get = async (path) => { calls.push(["get", path]); const r = resp.get[path]; if (r && r.__throw) throw r.__throw; return typeof r === "function" ? r() : r; };
  api.post = async (path, body) => { calls.push(["post", path, body]); const r = resp.post[path]; if (r && r.__throw) throw r.__throw; return r || {}; };
  I = await import("./integrations.js?i=" + ++seq);
});
afterEach(() => {
  closeModal();
  api.get = saved.get;
  api.post = saved.post;
  restoreRichDom();
});
const until = async (cond, what = "condition") => {
  const end = Date.now() + 2000;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
    await new Promise((r) => setTimeout(r, 1));
  }
};
const toasts = () => roots["toast-root"].children.map((t) => ({ msg: t.querySelector(".grow div").textContent, kind: t.getAttribute("data-kind"), why: t.querySelectorAll(".why").map((w) => w.textContent) }));
const modal = () => roots["modal-root"].querySelector(".modal");
const apiErr = (status, error, data) => ({ __throw: Object.assign(new Error(error), { status, error, data }) });

describe("cached reads, warmHp, hpThreadFor", () => {
  const HP = (threads) => ({ projects: [{ slug: "p", threads }] });
  test("getHp reuses a fresh read, force refetches, a failed read is not cached", async () => {
    resp.get["projects/hp"] = HP([]);
    const a = await I.getHp();
    expect(await I.getHp()).toBe(a);
    expect(calls.filter((c) => c[1] === "projects/hp")).toHaveLength(1);
    await I.getHp(true);
    expect(calls.filter((c) => c[1] === "projects/hp")).toHaveLength(2);
  });
  test("a rejected read evicts its entry so the next call retries", async () => {
    resp.get["projects/hp"] = { __throw: new Error("down") };
    await expect(I.getHp()).rejects.toThrow("down");
    resp.get["projects/hp"] = HP([]);
    expect(await I.getHp()).toEqual(HP([]));
    expect(calls.filter((c) => c[1] === "projects/hp")).toHaveLength(2);
  });
  test("warmHp reports a change only when the thread set differs; errors are swallowed", async () => {
    resp.get["projects/hp"] = HP([{ id: "1", cwd: "/a", status: "open", pane_id: "p1" }]);
    expect(await I.warmHp()).toBe(true);
    expect(await I.warmHp()).toBe(false);
    resp.get["projects/hp"] = HP([{ id: "1", cwd: "/a", status: "done", pane_id: "p1" }]);
    expect(await I.warmHp()).toBe(false); // still inside the cache ttl
    await I.getHp(true);
    expect(await I.warmHp()).toBe(true);
    resp.get["projects/hp"] = { __throw: new Error("x") };
    await I.getHp(true).catch(() => null);
    expect(await I.warmHp()).toBe(false);
  });
  test("each key field counts as a change: id, cwd, status, pane", async () => {
    const base = { id: "1", cwd: "/a", status: "open", pane_id: "p" };
    resp.get["projects/hp"] = HP([base]);
    await I.warmHp();
    for (const patch of [{ id: "2" }, { cwd: "/b" }, { status: "done" }, { pane_id: "q" }]) {
      resp.get["projects/hp"] = HP([{ ...base, ...patch }]);
      await I.getHp(true);
      expect(await I.warmHp()).toBe(true);
      resp.get["projects/hp"] = HP([base]);
      await I.getHp(true);
      await I.warmHp();
    }
  });
  test("a response with no projects is a (changed) empty state, not an error", async () => {
    resp.get["projects/hp"] = {};
    expect(await I.warmHp()).toBe(true);
  });
  test("hpThreadFor matches a thread by directory, ignoring trailing slashes", async () => {
    expect(I.hpThreadFor("/a")).toBeNull();
    resp.get["projects/hp"] = { projects: [{ slug: "p", threads: [{ id: "1", cwd: "/work/a/" }, { id: "2" }] }, { slug: "q", threads: [{ id: "3", cwd: "/work/b" }] }] };
    await I.warmHp();
    expect(I.hpThreadFor("/work/a")).toEqual({ project: "p", thread: { id: "1", cwd: "/work/a/" } });
    expect(I.hpThreadFor("/work/b///").project).toBe("q");
    expect(I.hpThreadFor("/work/c")).toBeNull();
    expect(I.hpThreadFor("")).toBeNull();
    expect(I.hpThreadFor(null)).toBeNull();
  });
  test("hpThreadFor tolerates projects without threads", async () => {
    resp.get["projects/hp"] = { projects: [{ slug: "p" }] };
    await I.warmHp();
    expect(I.hpThreadFor("/x")).toBeNull();
  });
});

describe("installModal and explain", () => {
  test("installModal shows the note, the run-this hint and the command only when given", () => {
    I.installModal("Missing", "brew install x", "needs x");
    expect(modal().querySelector("h2").textContent).toBe("Missing");
    expect(modal().querySelector(".modal-body p").textContent).toBe("needs x");
    expect(modal().querySelector(".dim").textContent).toBe("Run this in a terminal, then try again:");
    expect(modal().querySelector("code").textContent).toBe("brew install x");
    expect(modal().querySelector(".modal-actions button").textContent).toBe("Close");
    modal().querySelector(".modal-actions button").click();
    expect(modal()).toBeNull();
    I.installModal("Bare", "", "");
    expect(modal().querySelector(".dim")).toBeNull();
    expect(modal().querySelector("code")).toBeNull();
    expect(modal().querySelectorAll(".modal-body p")).toHaveLength(0);
  });
  test("424 names the missing tool for its purpose", () => {
    const cases = [["editor", "Tode is not installed"], ["thread", "Herdr-projects is not installed"], ["file", "The herdr file viewer is not installed"]];
    for (const [what, title] of cases) {
      I.explain({ status: 424, data: { install_cmd: "do-install" } }, what);
      expect(modal().querySelector("h2").textContent).toBe(title);
      expect(modal().querySelector("code").textContent).toBe("do-install");
      expect(modal().querySelector(".modal-body p").textContent).toBe("Atlas will not install it for you.");
    }
  });
  test("424 with herdr_not_found says the runtime is missing; no install command means no command block", () => {
    I.explain({ status: 424, data: { error: "herdr_not_found" } }, "file");
    expect(modal().querySelector(".modal-body p").textContent).toBe("The agent runtime was not found on this machine.");
    expect(modal().querySelector("code")).toBeNull();
  });
  test("429 on a known code warns with its explanation; on an unknown one it says Slow down", () => {
    I.explain({ status: 429, error: "duplicate_viewer" }, "file");
    expect(toasts().at(-1)).toEqual({ msg: "A viewer for this folder just opened", kind: "warn", why: ["Switch to the viewer pane that is already open, or try again in a few seconds."] });
    I.explain({ status: 429, error: "other", data: { why: "busy" } }, "file");
    expect(toasts().at(-1)).toEqual({ msg: "Slow down", kind: "warn", why: ["busy"] });
  });
  test("known error codes become plain-language failures, joined with the server's why", () => {
    I.explain({ status: 403, error: "path_outside_root", data: { why: "extra" } }, "file");
    expect(toasts().at(-1)).toEqual({ msg: "That path leaves the project folder", kind: "fail", why: ["Symlinks that point outside the folder are refused too. extra"] });
    I.explain({ status: 404, error: "bad_root" }, "file");
    expect(toasts().at(-1)).toEqual({ msg: "Directory no longer exists", kind: "fail", why: [] });
    for (const [code, msg] of [["unknown_root", "Outside the folders Atlas knows"], ["not_found", "File not found"], ["not_a_file", "That is a folder, not a file"], ["open_failed", "The runtime could not open the viewer"], ["spawn_failed", "Could not start the editor"], ["unsupported_path", "This file name cannot be opened"]]) {
      I.explain({ status: 400, error: code }, "file");
      expect(toasts().at(-1).msg).toBe(msg);
    }
  });
  test("unknown errors fall back to why, error, message, then 'Request failed', with detail and do", () => {
    I.explain({ status: 500, why: "w", error: "e", message: "m", data: { detail: 42 }, do: "try" }, "file");
    expect(toasts().at(-1)).toEqual({ msg: "w", kind: "fail", why: ["42", "try"] });
    I.explain({ status: 500, error: "e", message: "m" }, "file");
    expect(toasts().at(-1).msg).toBe("e");
    I.explain({ message: "m" }, "file");
    expect(toasts().at(-1).msg).toBe("m");
    I.explain(null, "file");
    expect(toasts().at(-1)).toEqual({ msg: "Request failed", kind: "fail", why: [] });
  });
});

describe("linkifyPaths", () => {
  const link = (n) => n && n.tagName === "BUTTON";
  const only = (nodes) => nodes.filter(link);
  test("without a root the text goes through rest() untouched", () => {
    expect(I.linkifyPaths("see /home/a/b.py", "")).toBe("see /home/a/b.py");
    expect(I.linkifyPaths("x", null, (s) => s.toUpperCase())).toBe("X");
    expect(I.linkifyPaths(null, "")).toBe("");
    expect(I.linkifyPaths(undefined, "/r")).toEqual([""]);
  });
  test("absolute paths under known roots and relative files with extensions become links", () => {
    const out = I.linkifyPaths("edit /home/me/app/main.py and src/util.ts now", "/home/me/app");
    const links = only(out);
    expect(links.map((l) => l.getAttribute("data-path"))).toEqual(["/home/me/app/main.py", "src/util.ts"]);
    expect(out.filter((n) => typeof n === "string")).toEqual(["edit ", " and ", " now"]);
    expect(links[0].className).toBe("path-link mono");
    expect(links[0].textContent).toBe("/home/me/app/main.py");
    expect(links[0].getAttribute("title")).toBe("Open in the file viewer (root /home/me/app)");
  });
  test("line and range suffixes are kept in the label; reverse ranges fall back to the first number", () => {
    const [a, b, c] = only(I.linkifyPaths("a.py:12 b.py:3-9 c.py:9-3", "/r"));
    expect([a.textContent, a.getAttribute("data-line")]).toEqual(["a.py:12", "12"]);
    expect([b.textContent, b.getAttribute("data-line")]).toEqual(["b.py:3-9", null]);
    expect([c.textContent, c.getAttribute("data-line")]).toEqual(["c.py:9-3", "9"]);
  });
  test("absolute paths outside well-known roots and the given root stay plain text", () => {
    expect(I.linkifyPaths("open /etc/passwd or /zzz/q/file.py", "/r")).toEqual(["open /etc/passwd or /zzz/q/file.py"]);
    expect(only(I.linkifyPaths("open /srv/x/y.py", "/r"))).toHaveLength(1);
    expect(only(I.linkifyPaths("open /weird/deep/y.py", "/weird/deep/"))).toHaveLength(1);
    for (const root of ["Users", "home", "tmp", "private", "var", "opt", "Volumes", "srv", "mnt"]) expect(only(I.linkifyPaths(`/${root}/x/y.py`, "/r"))).toHaveLength(1);
  });
  test("short paths are ignored", () => {
    expect(only(I.linkifyPaths("/a and a.c", "/r")).map((l) => l.textContent)).toEqual(["a.c"]);
    expect(only(I.linkifyPaths("/tmp/x", "/r"))).toHaveLength(1);
  });
  test("rest() is applied to each text segment", () => {
    const out = I.linkifyPaths("a b.py c", "/r", (s) => `[${s}]`);
    expect(out.filter((n) => typeof n === "string")).toEqual(["[a ]", "[ c]"]);
  });
  test("path-like pieces of a URL are not linked", () => {
    expect(only(I.linkifyPaths("see https://x.com/a/b.py and (x.com/a/b.py)", "/r")).map((l) => l.textContent)).toEqual(["x.com/a/b.py"]);
  });
  test("clicking a link posts open-file with a normalised absolute path, then toasts", async () => {
    const [l] = only(I.linkifyPaths("check ../lib/./m.py:7", "/home/me/app"));
    const ev = fire(l, "click");
    expect(ev.defaultPrevented).toBe(true);
    await until(() => toasts().length === 1);
    expect(calls.at(-1)).toEqual(["post", "open-file", { path: "/home/me/lib/m.py", root: "/home/me/app", placement: "split", line: 7 }]);
    expect(toasts()[0]).toEqual({ msg: "Opened /home/me/lib/m.py:7 in the file viewer", kind: "ok", why: [] });
  });
  test("a click does not bubble to a row handler", () => {
    const row = document.createElement("div");
    let rowClicks = 0;
    row.addEventListener("click", () => rowClicks++);
    const [l] = only(I.linkifyPaths("a.py", "/r"));
    row.appendChild(l);
    fire(l, "click");
    expect(rowClicks).toBe(0);
  });
  test("a range is sent as range, shown in the toast, and wins over a line; the path under root is shortened", async () => {
    const [l] = only(I.linkifyPaths("/r/src/a.py:3-5", "/r"));
    fire(l, "click");
    await until(() => toasts().length === 1);
    expect(calls.at(-1)[2]).toEqual({ path: "/r/src/a.py", root: "/r", placement: "split", range: [3, 5] });
    expect(toasts()[0].msg).toBe("Opened src/a.py:3-5 in the file viewer");
  });
  test("no line and no range: bare body and toast", async () => {
    const [l] = only(I.linkifyPaths("a.py", "/r"));
    fire(l, "click");
    await until(() => toasts().length === 1);
    expect(calls.at(-1)[2]).toEqual({ path: "/r/a.py", root: "/r", placement: "split" });
    expect(toasts()[0].msg).toBe("Opened a.py in the file viewer");
  });
  test("a failing open explains the error instead", async () => {
    resp.post["open-file"] = apiErr(404, "not_found", {});
    const [l] = only(I.linkifyPaths("a.py", "/r"));
    fire(l, "click");
    await until(() => toasts().length === 1);
    expect(toasts()[0].msg).toBe("File not found");
  });
  test("a relative root warns instead of posting", async () => {
    const [l] = only(I.linkifyPaths("a.py", "rel/root"));
    fire(l, "click");
    await until(() => toasts().length === 1);
    expect(calls.filter((c) => c[0] === "post")).toHaveLength(0);
    expect(toasts()[0]).toEqual({ msg: "No folder to open this file in", kind: "warn", why: ["Atlas needs the agent or project directory as the root."] });
  });
});

describe("openEditor", () => {
  test("posts the path (with a line when given) and toasts the last path segment", async () => {
    expect(await I.openEditor({ path: "/a/b/proj" })).toBe(true);
    expect(calls.at(-1)).toEqual(["post", "open-editor", { path: "/a/b/proj" }]);
    expect(toasts().at(-1).msg).toBe("Opening proj in tode");
    await I.openEditor({ path: "/a/b/proj/", line: 9 });
    expect(calls.at(-1)).toEqual(["post", "open-editor", { path: "/a/b/proj/", line: 9 }]);
    expect(toasts().at(-1).msg).toBe("Opening proj in tode");
  });
  test("a failure is explained and returns false; a 424 offers the tode install", async () => {
    resp.post["open-editor"] = apiErr(424, "tode_missing", { install_cmd: "install tode" });
    expect(await I.openEditor({ path: "/a" })).toBe(false);
    expect(modal().querySelector("h2").textContent).toBe("Tode is not installed");
    expect(modal().querySelector("code").textContent).toBe("install tode");
  });
});

describe("FilesPanel", () => {
  test("without a directory it says so, using the label", () => {
    expect(I.FilesPanel({ root: "", label: "agent" }).textContent).toBe("No directory is known for this agent.");
    expect(I.FilesPanel({}).textContent).toBe("No directory is known for this item.");
  });
  test("shows the directory, a copy button, the chip and the empty-files note", () => {
    const chip = document.createElement("span");
    chip.textContent = "chip";
    const p = I.FilesPanel({ root: "/work/x", label: "thread", chip });
    expect(p.querySelector(".cwd").textContent).toBe("/work/x");
    expect(p.querySelector(".cwd").getAttribute("title")).toBe("/work/x");
    expect(p.querySelector("[aria-label='Copy directory']")).not.toBeNull();
    expect(p.querySelector(".files-panel") || p).toBeTruthy();
    expect(p.querySelector("span.chip") || chip.parentNode).toBe(p);
    expect(p.querySelector(".dim").textContent).toBe("No file paths in this thread's recent task or messages.");
    expect(p.querySelector("h3").textContent).toBe("Files mentioned");
  });
  test("Open in editor launches the editor on the directory", async () => {
    const p = I.FilesPanel({ root: "/work/x" });
    const btn = p.querySelectorAll("button").find((b) => b.textContent === "Open in editor");
    btn.click();
    await until(() => calls.some((c) => c[1] === "open-editor"));
    expect(calls.at(-1)).toEqual(["post", "open-editor", { path: "/work/x" }]);
  });
  test("files mentioned in the texts are listed once each, with lines kept apart, absolute paths filtered", () => {
    const p = I.FilesPanel({ root: "/work/x", texts: ["fix a.py:3 and a.py:3 and a.py", "also /etc/hosts and /work/x/b.py:9-12", null, 7] });
    const items = p.querySelectorAll(".files-list li button");
    expect(items.map((b) => b.textContent)).toEqual(["a.py:3", "a.py", "/work/x/b.py:9"]);
    expect(items.map((b) => b.getAttribute("data-line"))).toEqual(["3", null, "9"]);
    expect(p.querySelector(".files-list")).not.toBeNull();
  });
  test("the mention list is capped at 20", () => {
    const text = Array.from({ length: 30 }, (_, i) => `f${i}.py`).join(" ");
    expect(I.FilesPanel({ root: "/r", texts: [text] }).querySelectorAll(".files-list li")).toHaveLength(20);
  });
  test("the open-by-path form parses path and :line from the Open button and from Enter", async () => {
    const p = I.FilesPanel({ root: "/work/x" });
    const input = p.querySelector("input");
    const open = p.querySelectorAll("button").find((b) => b.textContent === "Open");
    input.value = " src/app.py:42 ";
    open.click();
    await until(() => calls.some((c) => c[1] === "open-file"));
    expect(calls.at(-1)).toEqual(["post", "open-file", { path: "/work/x/src/app.py", root: "/work/x", placement: "split", line: 42 }]);
    calls.length = 0;
    input.value = "README.md";
    fire(input, "keydown", { key: "Enter" });
    await until(() => calls.some((c) => c[1] === "open-file"));
    expect(calls.at(-1)[2]).toEqual({ path: "/work/x/README.md", root: "/work/x", placement: "split" });
    calls.length = 0;
    fire(input, "keydown", { key: "a" });
    input.value = "   ";
    open.click();
    input.value = ":5";
    open.click();
    expect(calls).toEqual([]);
  });
});

describe("IntegrationsRow", () => {
  test("shows a reading state, then a chip per tool with state words and versions", async () => {
    resp.get.integrations = { tools: [{ name: "tode", installed: true, enabled: true, version: "1.2" }, { name: "herdr-projects", installed: true, enabled: true }, { name: "captains-deck", installed: true, enabled: false, version: "v3" }, { name: "cmux-browser-mcp", installed: false }, { name: "mystery", installed: false }] };
    const row = I.IntegrationsRow();
    expect(row.getAttribute("aria-label")).toBe("Integrations");
    expect(row.textContent).toBe("IntegrationsReading");
    await until(() => row.querySelectorAll("a").length === 5);
    const chips = row.querySelectorAll("a");
    expect(chips.map((c) => c.getAttribute("data-tool"))).toEqual(["tode", "herdr-projects", "captains-deck", "cmux-browser-mcp", "mystery"]);
    expect(chips.map((c) => c.textContent)).toEqual(["tode" + "v1.2", "herdr-projectson", "Captain's Deckoff", "cmux-browser MCPmissing", "mysterymissing"]);
    expect(chips.map((c) => c.getAttribute("data-installed"))).toEqual(["true", "true", "true", "false", "false"]);
    expect(chips[0].getAttribute("title")).toBe("tode: installed v1.2");
    expect(chips[1].getAttribute("title")).toBe("herdr-projects: installed");
    expect(chips[2].getAttribute("title")).toBe("Captain's Deck: installed, disabled v3");
    expect(chips[3].getAttribute("title")).toBe("cmux-browser MCP: not installed");
    expect(chips[0].getAttribute("href")).toBe("#/settings#integrations");
  });
  test("a failed read shows why instead", async () => {
    resp.get.integrations = { __throw: Object.assign(new Error("x"), { error: "daemon down" }) };
    const row = I.IntegrationsRow();
    await until(() => row.textContent.includes("Unavailable"));
    expect(row.textContent).toBe("IntegrationsUnavailable: daemon down");
  });
  test("a failure with no error code says request failed", async () => {
    resp.get.integrations = { __throw: {} };
    const row = I.IntegrationsRow();
    await until(() => row.textContent.includes("Unavailable"));
    expect(row.textContent).toBe("IntegrationsUnavailable: request failed");
  });
  test("a read with no tools renders just the label", async () => {
    resp.get.integrations = {};
    const row = I.IntegrationsRow();
    await until(() => !row.textContent.includes("Reading"));
    expect(row.textContent).toBe("Integrations");
  });
});
