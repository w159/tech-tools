import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom, fire } from "./rich-dom.js";
import { api } from "./api.js";
import { agentsStore } from "./agents-store.js";
import { closeModal } from "./ui-overlays.js";

let dom, roots, calls, resp, saved, savedStore, realNow, clock;
let H;
const realSetTimeout = globalThis.setTimeout;
// integrations.js memoises reads by Date.now(): move a fake clock 10s on per test so no cached read is ever served,
// and the entries left behind carry a fake future stamp that later readers treat as stale.
let tick = 0;
beforeEach(async () => {
  dom = installRichDom();
  roots = Object.fromEntries(["toast-root", "modal-root"].map((id) => [id, dom.root(id)]));
  realNow = Date.now;
  clock = realNow.call(Date) + 3_600_000 + (++tick) * 1_000_000;
  Date.now = () => clock;
  calls = [];
  resp = { hp: { installed: true, configured: true, projects: [] } };
  saved = { get: api.get, post: api.post };
  savedStore = agentsStore.get;
  api.get = async (path) => { calls.push(["get", path]); if (path === "projects/hp") { if (resp.hpErr) throw resp.hpErr; return resp.hp; } return {}; };
  api.post = async (path, body) => { calls.push(["post", path, body]); if (resp.postErr && resp.postErr[path]) throw resp.postErr[path]; return (resp.post && resp.post[path]) || {}; };
  H = await import("./hp.js");
});
afterEach(() => {
  closeModal();
  Date.now = realNow;
  api.get = saved.get;
  api.post = saved.post;
  agentsStore.get = savedStore;
  restoreRichDom();
});
const until = async (cond, what = "condition") => { const end = realNow.call(Date) + 2000; while (!cond()) { if (realNow.call(Date) > end) throw new Error("timed out: " + what); await new Promise((r) => realSetTimeout(r, 1)); } };
const modal = () => roots["modal-root"].querySelector(".modal");
const field = (id) => document.getElementById(id);
const setVal = (id, v, ev = "input") => { const el = field(id); el.value = v; fire(el, ev); };
const act = (label) => modal().querySelectorAll(".modal-actions button").find((b) => b.textContent === label);
const toasts = () => roots["toast-root"].children.map((t) => ({ msg: t.querySelector(".grow div").textContent, kind: t.getAttribute("data-kind"), why: t.querySelectorAll(".why").map((w) => w.textContent) }));
const PROJECTS = [{ slug: "alpha", goal: "Ship it", repos: ["/work/alpha"], threads: [] }, { slug: "beta", repos: [], threads: [] }];

describe("openNewThread: unavailable cases", () => {
  test("a failed read is explained, not thrown", async () => {
    resp.hpErr = Object.assign(new Error("x"), { status: 500, error: "boom", data: {} });
    await H.openNewThread();
    expect(toasts().at(-1).msg).toBe("boom");
    expect(modal()).toBeNull();
  });
  test("not installed shows the install command", async () => {
    resp.hp = { installed: false, install_cmd: "herdr plugin install x" };
    await H.openNewThread();
    expect(modal().querySelector("h2").textContent).toBe("herdr-projects is not installed");
    expect(modal().querySelector("code").textContent).toBe("herdr plugin install x");
    expect(modal().querySelector(".modal-body p").textContent).toBe("Threads need the herdr-projects plugin.");
  });
  test("installed but not configured shows the dry-run command and a warning, never a run button", async () => {
    resp.hp = { installed: true, configured: false, hint: "Set a root first." };
    await H.openNewThread();
    expect(modal().querySelector("h2").textContent).toBe("herdr-projects is not set up");
    expect(modal().querySelector(".hp-configure p").textContent).toBe("Set a root first.");
    expect(modal().querySelector("code").textContent).toBe("herdr-projects configure --dry-run");
    expect(modal().querySelector(".hp-warn").textContent).toContain("edits agent hook configs");
    expect(modal().querySelectorAll(".modal-actions button").map((b) => b.textContent)).toEqual(["Close"]);
  });
  test("the default hint is used when the server gives none", async () => {
    resp.hp = { installed: true, configured: false };
    await H.openNewThread();
    expect(modal().querySelector(".hp-configure p").textContent).toBe("herdr-projects has no project root yet.");
  });
  test("configured with no projects tells how to create one", async () => {
    resp.hp = { installed: true, configured: true, projects: [] };
    await H.openNewThread();
    expect(modal().querySelector("h2").textContent).toBe("No herdr project yet");
    expect(modal().querySelector("code").textContent).toBe("herdr-projects new <name>");
    resp.hp = { installed: true, configured: true };
    await H.openNewThread();
    expect(modal().querySelector("h2").textContent).toBe("No herdr project yet");
  });
});

describe("openNewThread: form", () => {
  beforeEach(() => { resp.hp = { installed: true, configured: true, projects: PROJECTS }; });
  test("defaults: first project, its first repo, worktree kind; the project select shows the goal", async () => {
    await H.openNewThread();
    expect(modal().querySelector("h2").textContent).toBe("New herdr thread");
    expect(field("hp-project").value).toBe("alpha");
    expect(field("hp-project").querySelectorAll("option").map((o) => o.textContent)).toEqual(["alpha - Ship it", "beta"]);
    expect(field("hp-repo").value).toBe("/work/alpha");
    expect(field("hp-kind").value).toBe("worktree");
    expect(field("hp-kind").querySelectorAll("option").map((o) => o.value)).toEqual(["worktree", "tab", "checkout"]);
    expect(field("hp-title").getAttribute("required")).toBe("");
    expect(field("hp-error").hidden).toBe(true);
  });
  test("opts.project and opts.repo are honoured; an unknown project falls back to the first", async () => {
    await H.openNewThread({ project: "beta", repo: "/elsewhere" });
    expect(field("hp-project").value).toBe("beta");
    expect(field("hp-repo").value).toBe("/elsewhere");
    await H.openNewThread({ project: "nope" });
    expect(field("hp-project").value).toBe("alpha");
    await H.openNewThread({ project: "beta" });
    expect(field("hp-repo").value).toBe("");
  });
  test("Cancel closes the dialog", async () => {
    await H.openNewThread();
    act("Cancel").click();
    expect(modal()).toBeNull();
  });
  const review = () => act("Review").click();
  const msg = () => field("hp-error");
  test("validation: title, task, repo (unless tab), absolute path", async () => {
    await H.openNewThread();
    review();
    expect([msg().textContent, msg().hidden]).toEqual(["Give the thread a title.", false]);
    setVal("hp-title", "   ");
    review();
    expect(msg().textContent).toBe("Give the thread a title.");
    setVal("hp-title", "Fix it");
    review();
    expect(msg().textContent).toBe("Describe the task.");
    setVal("hp-task", "do it");
    setVal("hp-repo", "");
    review();
    expect(msg().textContent).toBe("A repo directory is required unless the kind is tab.");
    setVal("hp-repo", "relative/dir");
    review();
    expect(msg().textContent).toBe("The repo directory must be an absolute path.");
    setVal("hp-kind", "tab", "change");
    review();
    expect(msg().textContent).toBe("The repo directory must be an absolute path.");
    setVal("hp-repo", "");
    review();
    expect(modal().querySelector("h2").textContent).toBe("Start this thread?");
  });
  test("the confirm step lists what will happen and the worktree branch it will create", async () => {
    await H.openNewThread();
    setVal("hp-title", "  Fix Login: Redirect!  ");
    setVal("hp-task", "Make it work\nplease");
    review();
    expect(modal().querySelector("h2").textContent).toBe("Start this thread?");
    expect(modal().querySelectorAll("dt").map((d) => d.textContent)).toEqual(["Project", "Title", "Kind", "Repo", "Branch"]);
    expect(modal().querySelectorAll("dd").map((d) => d.textContent)).toEqual(["alpha", "Fix Login: Redirect!", "worktree", "/work/alpha", "hp/alpha/<id>-fix-login-redirect"]);
    expect(modal().querySelector(".hp-task").textContent).toBe("Make it work\nplease");
    expect(modal().querySelector("details").getAttribute("open")).toBe("");
    expect(modal().textContent).toContain("No profile, yolo or safety flags are sent");
    expect(act("Start thread").className).toBe("btn btn-primary");
  });
  test("tab and checkout threads have no predicted branch; an empty repo reads none", async () => {
    await H.openNewThread();
    setVal("hp-title", "T");
    setVal("hp-task", "x");
    setVal("hp-kind", "tab", "change");
    setVal("hp-repo", "");
    review();
    expect(modal().querySelectorAll("dd").map((d) => d.textContent)).toEqual(["alpha", "T", "tab", "none", "decided by herdr-projects"]);
  });
  test("Back returns to the form with everything typed so far", async () => {
    await H.openNewThread();
    setVal("hp-project", "beta", "change");
    setVal("hp-title", "Mine");
    setVal("hp-task", "Do");
    setVal("hp-repo", "/x");
    setVal("hp-kind", "checkout", "change");
    review();
    act("Back").click();
    expect(modal().querySelector("h2").textContent).toBe("New herdr thread");
    expect(["hp-project", "hp-title", "hp-task", "hp-repo", "hp-kind"].map((id) => field(id).value)).toEqual(["beta", "Mine", "Do", "/x", "checkout"]);
    expect(field("hp-error").hidden).toBe(true);
  });
  test("Start posts the thread, closes, toasts with id and branch, refreshes and calls onDone", async () => {
    let done;
    resp.post = { "projects/hp/threads": { thread: { id: "7", branch: "hp/alpha/7-fix" } } };
    await H.openNewThread({ onDone: (r) => { done = r; } });
    setVal("hp-title", " Fix ");
    setVal("hp-task", "Task text");
    review();
    const reads = calls.filter((c) => c[1] === "projects/hp").length;
    act("Start thread").click();
    await until(() => done, "onDone");
    expect(calls.find((c) => c[0] === "post")).toEqual(["post", "projects/hp/threads", { project: "alpha", title: "Fix", repo: "/work/alpha", kind: "worktree", task: "Task text" }]);
    expect(modal()).toBeNull();
    expect(toasts().at(-1)).toEqual({ msg: "Thread started in alpha", kind: "ok", why: ["id 7, hp/alpha/7-fix"] });
    expect(calls.filter((c) => c[1] === "projects/hp").length).toBe(reads + 1);
    expect(done).toEqual({ thread: { id: "7", branch: "hp/alpha/7-fix" } });
  });
  test("with no branch from the server the predicted one is shown; with no thread info there is no why", async () => {
    await H.openNewThread();
    setVal("hp-title", "A b");
    setVal("hp-task", "x");
    review();
    act("Start thread").click();
    await until(() => toasts().length === 1, "toast");
    expect(toasts()[0].why).toEqual(["hp/alpha/<id>-a-b"]);
    await H.openNewThread();
    setVal("hp-title", "T");
    setVal("hp-task", "x");
    setVal("hp-kind", "tab", "change");
    setVal("hp-repo", "");
    review();
    act("Start thread").click();
    await until(() => toasts().length === 2, "second toast");
    expect(toasts()[1].why).toEqual([]);
    expect(calls.filter((c) => c[0] === "post").at(-1)[2].repo).toBeUndefined();
  });
  test("a refresh failure after starting does not turn success into an error", async () => {
    let done = 0;
    await H.openNewThread({ onDone: () => done++ });
    setVal("hp-title", "T");
    setVal("hp-task", "x");
    review();
    resp.hpErr = new Error("refresh down");
    act("Start thread").click();
    await until(() => done === 1, "onDone");
    expect(toasts().at(-1).kind).toBe("ok");
  });
  test("a server error is shown in the dialog with the button restored; 424 opens the install help", async () => {
    resp.postErr = { "projects/hp/threads": Object.assign(new Error("x"), { status: 400, error: "bad_task", why: "too long", data: { detail: "max 5k" }, do: "shorten" }) };
    await H.openNewThread();
    setVal("hp-title", "T");
    setVal("hp-task", "x");
    review();
    const go = act("Start thread");
    go.click();
    expect(go.disabled).toBe(true);
    expect(go.getAttribute("aria-busy")).toBe("true");
    await until(() => !modal().querySelector("#hp-error").hidden, "error shown");
    expect(modal().querySelector("#hp-error").textContent).toBe("bad_task: too long: max 5k: shorten");
    expect(go.disabled).toBe(false);
    expect(go.getAttribute("aria-busy")).toBeNull();
    expect(go.lastChild.textContent).toBe("Start thread");
    resp.postErr = { "projects/hp/threads": Object.assign(new Error("x"), { status: 424, error: "missing", data: { install_cmd: "install hp" } }) };
    go.click();
    await until(() => modal().querySelector("h2").textContent === "Herdr-projects is not installed", "install modal");
    expect(modal().querySelector("code").textContent).toBe("install hp");
  });
  test("the busy label is 'Starting' while the request is in flight", async () => {
    let release;
    api.post = (path, body) => { calls.push(["post", path, body]); return new Promise((r) => { release = r; }); };
    await H.openNewThread();
    setVal("hp-title", "T");
    setVal("hp-task", "x");
    review();
    const go = act("Start thread");
    go.click();
    expect(go.lastChild.textContent).toBe("Starting");
    release({});
    await until(() => modal() === null, "modal closed");
  });
});

describe("HerdrProjectsSection", () => {
  const section = () => { clock += 10_000; return H.HerdrProjectsSection(); };
  const settle = async (root, cond) => { dom.body.appendChild(root); await until(cond || (() => !root.textContent.includes("Reading")), "section loaded"); return root; };
  test("starts with a reading status, then shows the not-installed help", async () => {
    resp.hp = { installed: false };
    const root = section();
    expect(root.querySelector("[role=status]").textContent).toBe("Reading herdr-projects");
    expect(root.querySelector("h2").textContent).toBe("Herdr projects");
    await settle(root);
    expect(root.querySelector("[data-state=not-installed] p").textContent).toBe("herdr-projects is not installed.");
    expect(root.querySelector("code").textContent).toBe("herdr plugin install eliasstravik/herdr-projects");
    expect(root.querySelectorAll("button").map((b) => b.textContent)).toEqual(["Refresh", "Copy"]);
  });
  test("a given install command wins over the default", async () => {
    resp.hp = { installed: false, install_cmd: "custom install" };
    const root = await settle(section());
    expect(root.querySelector("code").textContent).toBe("custom install");
  });
  test("unconfigured shows the configure preview; empty shows the root and the new command", async () => {
    resp.hp = { installed: true, configured: false, hint: "hint text" };
    let root = await settle(section());
    expect(root.querySelector("[data-state=unconfigured] p").textContent).toBe("hint text");
    resp.hp = { installed: true, configured: true, root: "/projects", projects: [] };
    root = await settle(section());
    expect(root.querySelector("[data-state=empty] p").textContent).toBe("No herdr project under /projects yet.");
    expect(root.querySelector(".hp-root").textContent).toBe("/projects");
    expect(root.querySelectorAll("button").map((b) => b.textContent).slice(0, 2)).toEqual(["Refresh", "New thread"]);
  });
  test("an error shows the reason and a Retry that refetches", async () => {
    resp.hpErr = Object.assign(new Error("x"), { error: "down", why: "daemon", do: "restart", data: { detail: "d" } });
    const root = section();
    await settle(root, () => root.querySelector(".state-error"));
    expect(root.querySelector(".state-title").textContent).toBe("Could not read herdr-projects");
    expect(root.querySelector(".state-body").textContent).toBe("down: daemon: restart: d");
    resp.hpErr = null;
    resp.hp = { installed: true, configured: true, root: "/p", projects: [] };
    root.querySelectorAll("button").find((b) => b.textContent === "Retry").click();
    await until(() => !root.querySelector(".state-error"), "recovered");
    expect(root.querySelector("[data-state=empty]")).not.toBeNull();
  });
  const POPULATED = { installed: true, configured: true, root: "/projects", needs_you: 2, projects: [
    { slug: "alpha", name: "Alpha App", goal: "Ship it", status: "active", repos: ["/work/alpha/", "/work/lib"], threads: [
      { id: "1", title: "Fix login", status: "working", branch: "hp/alpha/1-fix", pane_id: "pane1", cwd: "/work/alpha/wt1", channel: "chat", channel_path: "/c/chat x", pr: { url: "http://pr/1" }, pr_state: "open", group: "G1", note: "waiting on CI" },
      { id: "2", title: "", status: "blocked", kind: "tab", pr: "12" },
      { id: "3", status: "needs_you", group_token: "needs-you" },
      { id: "4", title: "Done one", status: "merged", pr: { number: 9 } },
    ] },
    { slug: "beta", status: "paused", threads: [] },
  ] };
  test("populated: header badges, projects, repos, threads", async () => {
    resp.hp = POPULATED;
    const root = await settle(section());
    expect(root.querySelector(".hp-head .badge").textContent).toBe("2 projects need you");
    resp.hp = { ...POPULATED, needs_you: 1 };
    const one = await settle(section());
    expect(one.querySelector(".hp-head .badge").textContent).toBe("1 project needs you");
    const alpha = root.querySelector("[data-project=alpha]");
    expect(alpha.getAttribute("aria-label")).toBe("Herdr project alpha");
    expect(alpha.querySelector("h3").textContent).toBe("Alpha App alpha");
    expect(alpha.querySelector("p.dim").textContent).toBe("Ship it");
    expect(alpha.querySelector(".hp-project-head .badge").textContent).toBe("active");
    expect(alpha.querySelector(".hp-project-head .badge").getAttribute("data-state")).toBe("working");
    expect(alpha.querySelectorAll(".hp-project-head .badge").map((b) => b.textContent)).toEqual(["active", "2 need you"]);
    expect(alpha.querySelectorAll(".hp-repos .chip-lite").map((c) => c.textContent)).toEqual(["alpha", "lib"]);
    const beta = root.querySelector("[data-project=beta]");
    expect(beta.querySelector("h3").textContent).toBe("beta beta");
    expect(beta.querySelector("p.dim").textContent).toBe("No goal recorded");
    expect(beta.querySelector(".hp-repos").textContent).toBe("No repos recorded");
    expect(beta.children.at(-1).textContent).toBe("No threads yet.");
    expect(beta.querySelectorAll(".hp-project-head .badge")).toHaveLength(1);
    expect(beta.querySelector(".hp-project-head .badge").getAttribute("data-state")).toBe("idle");
  });
  test("thread rows: status tone, title/id, branch or its absence, channel link, PR, note, directory", async () => {
    resp.hp = POPULATED;
    const root = await settle(section());
    const row = (id) => root.querySelector(`[data-thread='${id}']`);
    const r1 = row("1");
    expect(r1.getAttribute("data-status")).toBe("working");
    expect(r1.querySelector(".badge").getAttribute("data-state")).toBe("working");
    expect(r1.querySelector("strong").textContent).toBe("Fix login");
    expect(r1.querySelector(".hp-thread-top .mono").textContent).toBe("#1");
    expect(r1.querySelectorAll(".hp-thread-top .chip-lite").map((c) => c.textContent)).toEqual(["G1"]);
    expect(r1.querySelector("[title=Branch]").textContent).toBe("hp/alpha/1-fix");
    const link = r1.querySelector("a.chip-link");
    expect([link.getAttribute("href"), link.textContent, link.getAttribute("title")]).toEqual(["#/channels?channel=%2Fc%2Fchat%20x", "chat", "/c/chat x"]);
    expect(r1.querySelector("[title='Pull request']").textContent).toBe("PR http://pr/1 (open)");
    expect(r1.querySelector(".hp-thread-sub .truncate[title='waiting on CI']").textContent).toBe("waiting on CI");
    expect(r1.querySelector(".hp-thread-files span").textContent).toBe("/work/alpha/wt1");
    const r2 = row("2");
    expect(r2.querySelector("strong").textContent).toBe("2");
    expect(r2.querySelector(".badge").getAttribute("data-state")).toBe("input");
    expect(r2.querySelector(".hp-thread-sub .dim").textContent).toBe("tab thread, no branch");
    expect(r2.querySelector("[title='Pull request']").textContent).toBe("PR 12");
    expect(r2.querySelector(".hp-thread-files")).toBeNull();
    expect(r2.querySelector("a.chip-link")).toBeNull();
    expect(row("3").querySelector(".hp-thread-sub .dim").textContent).toBe("no branch recorded");
    expect(row("3").querySelectorAll(".hp-thread-sub .dim").map((d) => d.textContent)).toEqual(["no branch recorded", "no PR"]);
    expect(row("3").querySelector(".badge").getAttribute("data-state")).toBe("input");
    expect(row("4").querySelector("[title='Pull request']").textContent).toBe("PR 9");
    expect(row("4").querySelector(".badge").getAttribute("data-state")).toBe("done");
  });
  test("a channel without a path links to the channels page; an unknown status reads idle", async () => {
    resp.hp = { installed: true, configured: true, projects: [{ slug: "z", threads: [{ id: "9", channel: "ch", status: "weird" }, { id: "8" }] }] };
    const root = await settle(section());
    expect(root.querySelector("a.chip-link").getAttribute("href")).toBe("#/channels");
    expect(root.querySelector("[data-thread='9'] .badge").getAttribute("data-state")).toBe("idle");
    expect(root.querySelector("[data-thread='8']").getAttribute("data-status")).toBe("unknown");
    expect(root.querySelector("[data-thread='8'] .badge").textContent).toBe("unknown");
  });
  test("Open is disabled without a live pane; with one it focuses it through the fleet", async () => {
    resp.hp = POPULATED;
    agentsStore.get = (id) => (id === "pane1" ? { key: "omp:pane1" } : null);
    const root = await settle(section());
    const open = (id) => root.querySelector(`[data-thread='${id}']`).querySelectorAll(".hp-thread-actions button")[0];
    expect(open("2").disabled).toBe(true);
    expect(open("2").getAttribute("title")).toBe("This thread has no live pane");
    expect(open("1").disabled).toBeFalsy();
    expect(open("1").getAttribute("title")).toBe("Focus the thread's pane pane1");
    open("1").click();
    expect(location.hash).toBe("#/agents?agent=omp%3Apane1&tab=terminal");
  });
  test("Editor opens the thread directory; it is disabled when none is recorded", async () => {
    resp.hp = POPULATED;
    const root = await settle(section());
    const editor = (id) => root.querySelector(`[data-thread='${id}']`).querySelectorAll(".hp-thread-actions button")[1];
    expect(editor("2").disabled).toBe(true);
    expect(editor("2").getAttribute("title")).toBe("No directory recorded");
    expect(editor("1").getAttribute("title")).toBe("Open the thread directory in tode");
    editor("1").click();
    await until(() => calls.some((c) => c[1] === "open-editor"), "editor call");
    expect(calls.find((c) => c[1] === "open-editor")).toEqual(["post", "open-editor", { path: "/work/alpha/wt1" }]);
  });
  test("Refresh and .reload() refetch; the per-project New thread button opens the dialog for that project", async () => {
    resp.hp = POPULATED;
    const root = await settle(section());
    const reads = () => calls.filter((c) => c[1] === "projects/hp").length;
    const n0 = reads();
    root.querySelectorAll("button").find((b) => b.textContent === "Refresh").click();
    await until(() => reads() > n0, "refresh");
    const n1 = reads();
    await root.reload(true);
    expect(reads()).toBe(n1 + 1);
    root.querySelector("[data-project=alpha] .hp-project-head button").click();
    await until(() => modal() && modal().querySelector("h2").textContent === "New herdr thread", "dialog");
    expect(field("hp-project").value).toBe("alpha");
    expect(field("hp-repo").value).toBe("/work/alpha/");
  });
  test("starting a thread from a project refreshes the section", async () => {
    resp.hp = POPULATED;
    resp.post = { "projects/hp/threads": { thread: { id: "5" } } };
    const root = await settle(section());
    root.querySelector("[data-project=alpha] .hp-project-head button").click();
    await until(() => modal() && field("hp-title"), "dialog");
    setVal("hp-title", "New");
    setVal("hp-task", "go");
    act("Review").click();
    const n = calls.filter((c) => c[1] === "projects/hp").length;
    act("Start thread").click();
    await until(() => calls.filter((c) => c[1] === "projects/hp").length > n + 1, "section reload after start");
  });
  test("the header New thread button appears only when installed and configured", async () => {
    resp.hp = { installed: true, configured: false };
    const a = await settle(section());
    expect(a.querySelectorAll(".hp-head button").map((b) => b.textContent)).toEqual(["Refresh"]);
    resp.hp = POPULATED;
    const b = await settle(section());
    expect(b.querySelectorAll(".hp-head button").map((x) => x.textContent)).toEqual(["Refresh", "New thread"]);
    expect(a.querySelector(".hp-head .badge")).toBeNull();
  });
});
