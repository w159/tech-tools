import { test, expect, afterEach } from "bun:test";

// Minimal DOM stand-in (same pattern as terminal.test.js; no DOM lib is installed).
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this.textContent = ""; this.hidden = false; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...c) { this.children = []; c.forEach((x) => x && this.appendChild(x)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
}
globalThis.Node = N;
globalThis.document = { createElement: (t) => new N(t), createTextNode: (t) => ({ text: t }) };

const { ModelPicker, filterModels, sortModels, fmtSize, pollJob, fmtAge } = await import("./model-picker.js");

const MODELS = [
  { name: "nimble:latest", params: "9B", size_bytes: 9.5e9, modified_at: "2026-10-08T00:00:00Z", cloud: false, running: true, popularity_rank: 3 },
  { name: "minimax-m3.1-flash:cloud", params: "", size_bytes: null, modified_at: "2026-10-20T00:00:00Z", cloud: true, running: false, popularity_rank: null },
  { name: "llama3.2:3b", params: "3B", size_bytes: 2e9, modified_at: "2026-09-01T00:00:00Z", cloud: false, running: false, popularity_rank: 1 },
];
const walk = (n, out = []) => { if (n && n.children) { out.push(n); n.children.forEach((c) => walk(c, out)); } return out; };
const text = (n) => walk(n).flatMap((x) => x.children.map((c) => c.text)).filter(Boolean).join("|");
const byClass = (n, c) => walk(n).filter((x) => (x.attrs.class || "").split(" ").includes(c));
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test("scope chips filter local vs cloud and the search narrows by name", () => {
  expect(filterModels(MODELS, { scope: "local" }).map((m) => m.name)).toEqual(["nimble:latest", "llama3.2:3b"]);
  expect(filterModels(MODELS, { scope: "cloud" }).map((m) => m.name)).toEqual(["minimax-m3.1-flash:cloud"]);
  expect(filterModels(MODELS, { scope: "all", q: "LLAMA" }).map((m) => m.name)).toEqual(["llama3.2:3b"]);
});

test("sort Latest/Size/Name/Popular; missing size and rank sort last", () => {
  const names = (s) => sortModels(MODELS, s).map((m) => m.name);
  expect(names("latest")[0]).toBe("minimax-m3.1-flash:cloud");
  expect(names("size")).toEqual(["nimble:latest", "llama3.2:3b", "minimax-m3.1-flash:cloud"]);
  expect(names("name")).toEqual(["llama3.2:3b", "minimax-m3.1-flash:cloud", "nimble:latest"]);
  expect(names("popular")).toEqual(["llama3.2:3b", "nimble:latest", "minimax-m3.1-flash:cloud"]);
  expect(fmtSize(9.5e9)).toBe("9.5 GB");
});

test("the picker fetches on first open, shows rows with size or cloud, running dot, and status line", async () => {
  const calls = [];
  const api = { get: async (p, q) => { calls.push(p); return p.endsWith("/status") ? { reachable: true, version: "0.12", ps: [{}] } : { models: MODELS }; } };
  const picked = [];
  const root = ModelPicker({ api, value: "nimble:latest", onPick: async (n) => picked.push(n) });
  expect(calls).toEqual([]);
  root.setOpen(true);
  await tick();
  expect(calls).toContain("/api/v2/ollama/models");
  const t = text(root);
  expect(byClass(root, "mp-status")[0].textContent).toContain("ollama 0.12 reachable");
  expect(t).toContain("9.5 GB");
  expect(t).toContain("cloud");
  expect(byClass(root, "mp-dot").filter((d) => d.attrs.class.includes("is-running")).length).toBe(1);
  const row = byClass(root, "mp-row").find((r) => text(r).includes("llama3.2:3b"));
  await row.listeners.click();
  expect(picked).toEqual(["llama3.2:3b"]);
});

test("Pull another posts the pull job and shows its progress until done", async () => {
  const posts = [];
  let n = 0;
  const api = {
    get: async (p) => (p.includes("/jobs/") ? (++n < 2 ? { status: "running", percent: 42 } : { status: "done" }) : p.endsWith("/status") ? { reachable: true } : { models: MODELS }),
    post: async (p, b) => { posts.push([p, b]); return { job: "j1" }; },
  };
  const root = ModelPicker({ api, value: "", onPick: async () => {} });
  root.setOpen(true);
  await tick();
  byClass(root, "mp-pull-open")[0].listeners.click();
  const pull = byClass(root, "mp-pull")[0];
  const [input, go, progress] = pull.children;
  input.value = "qwen3:8b";
  const done = go.listeners.click();
  await done;
  expect(posts).toEqual([["/api/v2/ollama/pull", { name: "qwen3:8b" }]]);
  expect(progress.textContent).toContain("pulled qwen3:8b");
});

test("pull progress renders the server percent field", async () => {
  const seen = [];
  const api = { get: async () => ({ status: "running", percent: 42 }), post: async () => ({ job: "j" }) };
  const orig = api.get; let n = 0;
  api.get = async (p) => (p.includes("/jobs/") ? (++n < 2 ? { status: "running", percent: 42 } : { status: "done" }) : p.endsWith("/status") ? { reachable: true } : { models: MODELS });
  const root = ModelPicker({ api, value: "", onPick: async () => {} });
  root.setOpen(true); await tick();
  byClass(root, "mp-pull-open")[0].listeners.click();
  const [input, go, progress] = byClass(root, "mp-pull")[0].children;
  input.value = "x:1";
  const p = go.listeners.click(); await tick();
  seen.push(progress.textContent); await p;
  expect(seen[0]).toContain("42%");
});

test("fmtAge accepts epoch seconds, epoch ms and ISO strings", () => {
  const now = Date.parse("2026-01-02T00:00:00Z");
  const hourAgo = now - 3600000;
  expect(fmtAge(hourAgo / 1000, now)).toBe("60m ago");
  expect(fmtAge(hourAgo, now)).toBe("60m ago");
  expect(fmtAge(new Date(hourAgo).toISOString(), now)).toBe("60m ago");
});

test("pollJob reports every update and stops on error", async () => {
  const seen = [];
  const api = { get: async () => ({ status: "error", error: "boom" }) };
  const job = await pollJob(api, "j", (j) => seen.push(j.status), async () => {});
  expect(job.status).toBe("error");
  expect(seen).toEqual(["error"]);
});

test("the current value that is not an installed tag is pinned first as `current`; Reset to default saves the default", async () => {
  const api = { get: async (p) => (p.endsWith("/status") ? { reachable: true } : { models: MODELS }) };
  const picked = [];
  const root = ModelPicker({ api, value: "nimble", defaultValue: "nimble", onPick: async (n) => picked.push(n) });
  root.setOpen(true);
  await tick();
  const first = byClass(root, "mp-row")[0];
  expect(first.attrs.class).toContain("mp-pinned");
  expect(text(first)).toContain("nimble");
  expect(text(first)).toContain("current");
  expect(byClass(root, "mp-reset")[0].hidden).toBe(true); // already the default
  const other = byClass(root, "mp-row").find((r) => text(r).includes("llama3.2:3b"));
  await other.listeners.click();
  expect(byClass(root, "mp-reset")[0].hidden).toBe(false);
  await byClass(root, "mp-reset")[0].listeners.click();
  expect(picked).toEqual(["llama3.2:3b", "nimble"]);
});

test("models without completion are hidden until Show all", async () => {
  const withCaps = [...MODELS, { name: "nomic-embed-text:latest", cloud: false, size_bytes: 2.7e8, capabilities: ["embedding"] }];
  expect(filterModels(withCaps, { showAll: false }).map((m) => m.name)).not.toContain("nomic-embed-text:latest");
  expect(filterModels(withCaps, { showAll: true }).map((m) => m.name)).toContain("nomic-embed-text:latest");
  const api = { get: async (p) => (p.endsWith("/status") ? { reachable: true } : { models: withCaps }) };
  const root = ModelPicker({ api, value: "nimble:latest", onPick: async () => {} });
  root.setOpen(true);
  await tick();
  const names = () => byClass(root, "mp-row").map((r) => text(r));
  expect(names().some((t) => t.includes("nomic-embed"))).toBe(false);
  const btn = byClass(root, "mp-show-all")[0];
  expect(btn.hidden).toBe(false);
  btn.listeners.click();
  expect(names().some((t) => t.includes("nomic-embed"))).toBe(true);
});

// ---- pure helpers: edge cases and boundaries ----
const names = (l) => l.map((m) => m.name);

test("filterModels: defaults show everything, a null list is empty, the needle is trimmed and case-insensitive on the name only", () => {
  expect(names(filterModels(MODELS))).toEqual(names(MODELS));
  expect(filterModels(null)).toEqual([]);
  expect(filterModels(undefined, { scope: "cloud" })).toEqual([]);
  expect(names(filterModels(MODELS, { q: "  NIMBLE  " }))).toEqual(["nimble:latest"]);
  expect(names(filterModels(MODELS, { q: "9B" }))).toEqual([]); // params are not searched
  expect(names(filterModels(MODELS, { q: "   " }))).toEqual(names(MODELS));
  expect(names(filterModels([{ name: 42 }], { q: "4" }))).toEqual([42]);
});

test("filterModels: a model without a cloud flag is local; scope and search combine", () => {
  const list = [{ name: "a" }, { name: "b", cloud: true }, { name: "c", cloud: 0 }, { name: "ab-cloud", cloud: 1 }];
  expect(names(filterModels(list, { scope: "local" }))).toEqual(["a", "c"]);
  expect(names(filterModels(list, { scope: "cloud" }))).toEqual(["b", "ab-cloud"]);
  expect(names(filterModels(list, { scope: "cloud", q: "ab" }))).toEqual(["ab-cloud"]);
  expect(names(filterModels(list, { scope: "local", q: "b" }))).toEqual([]);
});

test("filterModels: without showAll only completion-capable (or capability-less) models remain", () => {
  const list = [{ name: "plain" }, { name: "text", capabilities: ["completion", "tools"] }, { name: "embed", capabilities: ["embedding"] }, { name: "none", capabilities: [] }, { name: "weird", capabilities: "completion" }];
  expect(names(filterModels(list, { showAll: false }))).toEqual(["plain", "text", "weird"]);
  expect(names(filterModels(list, { showAll: true }))).toEqual(["plain", "text", "embed", "none", "weird"]);
  expect(names(filterModels(list, { showAll: false, q: "e" }))).toEqual(["text", "weird"]);
});

test("sortModels: default is latest-first, input is not mutated, an unknown key keeps order, null is empty", () => {
  const copy = [...MODELS];
  expect(names(sortModels(MODELS))).toEqual(["minimax-m3.1-flash:cloud", "nimble:latest", "llama3.2:3b"]);
  expect(MODELS).toEqual(copy);
  expect(names(sortModels(MODELS, "bogus"))).toEqual(names(MODELS));
  expect(sortModels(null)).toEqual([]);
  expect(sortModels(undefined, "name")).toEqual([]);
});

test("sortModels: missing values sort last for every key; zero and string sizes are real values", () => {
  const sz = (xs) => names(sortModels(xs, "size"));
  expect(sz([{ name: "none" }, { name: "zero", size_bytes: 0 }, { name: "nul", size_bytes: null }, { name: "str", size_bytes: "500" }, { name: "big", size_bytes: 900 }])).toEqual(["big", "str", "zero", "none", "nul"]);
  const lt = (xs) => names(sortModels(xs, "latest"));
  expect(lt([{ name: "old", modified_at: "2020" }, { name: "none" }, { name: "new", modified_at: "2026" }])).toEqual(["new", "old", "none"]);
  const pop = (xs) => names(sortModels(xs, "popular"));
  expect(pop([{ name: "none" }, { name: "r5", popularity_rank: 5 }, { name: "r0", popularity_rank: 0 }, { name: "nul", popularity_rank: null }, { name: "r1", popularity_rank: 1 }])).toEqual(["r0", "r1", "r5", "none", "nul"]);
  expect(names(sortModels([{ name: "b" }, { name: "a" }, { name: "C" }], "name"))).toEqual(["a", "b", "C"]);
});

test("fmtSize: decimal units, one decimal below 10, none for empty/invalid", () => {
  for (const bad of [0, -5, null, undefined, "abc", NaN, Infinity]) expect(fmtSize(bad)).toBe("");
  expect(fmtSize(1)).toBe("1 B");
  expect(fmtSize(999)).toBe("999 B");
  expect(fmtSize(1000)).toBe("1.0 KB");
  expect(fmtSize(1500)).toBe("1.5 KB");
  expect(fmtSize(9949)).toBe("9.9 KB");
  expect(fmtSize(10000)).toBe("10 KB");
  expect(fmtSize(12345)).toBe("12 KB");
  expect(fmtSize(2.7e8)).toBe("270 MB");
  expect(fmtSize(2e9)).toBe("2.0 GB");
  expect(fmtSize("2000000000")).toBe("2.0 GB");
  expect(fmtSize(1e12)).toBe("1.0 TB");
  expect(fmtSize(5e15)).toBe("5000 TB");
});

test("fmtAge: unit boundaries, future dates clamp to 0s, unparseable input is blank", () => {
  const now = Date.parse("2026-01-10T00:00:00Z");
  const ago = (s) => fmtAge((now - s * 1000) / 1000, now);
  expect(ago(0)).toBe("0s ago");
  expect(ago(89)).toBe("89s ago");
  expect(ago(90)).toBe("2m ago");
  expect(ago(5399)).toBe("90m ago");
  expect(ago(5400)).toBe("2h ago");
  expect(ago(129599)).toBe("36h ago");
  expect(ago(129600)).toBe("2d ago");
  expect(ago(86400 * 10)).toBe("10d ago");
  expect(ago(-500)).toBe("0s ago");
  for (const bad of ["", "not a date", undefined, null, NaN]) expect(fmtAge(bad, now)).toBe("");
  expect(fmtAge(now - 5000, now)).toBe("5s ago"); // ms epoch
  expect(fmtAge(1e11, 1e11 + 3000)).toBe("3s ago"); // 1e11 itself is already ms
  expect(fmtAge(99999999999, 99999999999000 + 1000)).toBe("1s ago"); // just below 1e11 is seconds
});

test("fmtAge defaults to the current time", () => {
  const real = Date.now;
  Date.now = () => 1_800_000_000_000;
  try { expect(fmtAge(1_800_000_000_000 - 7000)).toBe("7s ago"); } finally { Date.now = real; }
});

test("pollJob: polls the encoded job url, reports each update, sleeps 1s between polls, returns the finished job", async () => {
  const urls = [], seen = [], sleeps = [];
  const states = [{ status: "running", percent: 1 }, { status: "running", percent: 50 }, { status: "done", id: "x" }];
  const api = { get: async (u) => { urls.push(u); return states[urls.length - 1]; } };
  const job = await pollJob(api, "a b/c", (j) => seen.push(j.percent ?? j.status), async (ms) => sleeps.push(ms));
  expect(job).toEqual({ status: "done", id: "x" });
  expect(urls).toEqual(Array(3).fill("/api/v2/ollama/jobs/a%20b%2Fc"));
  expect(seen).toEqual([1, 50, "done"]);
  expect(sleeps).toEqual([1000, 1000]);
});

test("pollJob: gives up with timed_out after maxPolls without sleeping after the last one", async () => {
  let gets = 0; const sleeps = [];
  const api = { get: async () => { gets++; return { status: "running" }; } };
  const job = await pollJob(api, "j", () => {}, async (ms) => sleeps.push(ms), 3);
  expect(job).toEqual({ status: "error", error: "timed_out" });
  expect(gets).toBe(3);
  expect(sleeps.length).toBe(3);
  gets = 0;
  expect(await pollJob(api, "j", () => {}, async () => {}, 0)).toEqual({ status: "error", error: "timed_out" });
  expect(gets).toBe(0);
});

test("pollJob uses a real 1s timer by default", async () => {
  const real = globalThis.setTimeout; const delays = [];
  globalThis.setTimeout = (f, ms) => { delays.push(ms); return real(f, 0); };
  try {
    let n = 0;
    const job = await pollJob({ get: async () => (++n < 2 ? { status: "running" } : { status: "done" }) }, "j", () => {});
    expect(job.status).toBe("done");
    expect(delays).toEqual([1000]);
  } finally { globalThis.setTimeout = real; }
});

// ---- the picker widget ----
const mkApi = (over = {}) => {
  const calls = [];
  const api = {
    calls,
    get: async (p, q) => { calls.push(["get", p, q]); if (over.get) return over.get(p, q); return p.endsWith("/status") ? (over.status ?? { reachable: true, version: "0.12", ps: [] }) : { models: over.models ?? MODELS }; },
    post: async (p, b) => { calls.push(["post", p, b]); return over.post ? over.post(p, b) : { job: "j1" }; },
  };
  return api;
};
const openPicker = async (apiOver, props = {}) => {
  const api = mkApi(apiOver);
  const root = ModelPicker({ api, value: "", onPick: async () => {}, ...props });
  root.setOpen(true);
  await tick();
  return { root, api };
};
const rows = (root) => byClass(root, "mp-row").map((r) => text(r));

test("closed picker: trigger shows the value or a prompt, panel hidden, aria wired, nothing fetched", () => {
  const api = mkApi();
  const empty = ModelPicker({ api, value: "", onPick() {} });
  const trigger = byClass(empty, "mp-trigger")[0];
  expect(text(trigger)).toBe("Choose a model");
  expect(trigger.attrs["aria-haspopup"]).toBe("listbox");
  expect(trigger.attrs["aria-expanded"]).toBe("false");
  expect(trigger.attrs.type).toBe("button");
  expect(byClass(empty, "mp-panel")[0].hidden).toBe(true);
  expect(text(ModelPicker({ api, value: "m:1", onPick() {} }).children[0])).toBe("m:1");
  expect(api.calls).toEqual([]);
});

test("the trigger toggles the panel and aria-expanded; models load once", async () => {
  const api = mkApi();
  const root = ModelPicker({ api, value: "", onPick() {} });
  const trigger = byClass(root, "mp-trigger")[0], panel = byClass(root, "mp-panel")[0];
  trigger.listeners.click(); await tick();
  expect(panel.hidden).toBe(false);
  expect(trigger.attrs["aria-expanded"]).toBe("true");
  trigger.listeners.click();
  expect(panel.hidden).toBe(true);
  expect(trigger.attrs["aria-expanded"]).toBe("false");
  trigger.listeners.click(); await tick();
  expect(api.calls.filter((c) => c[1] === "/api/v2/ollama/models")).toEqual([["get", "/api/v2/ollama/models", { scope: "all" }]]);
  expect(api.calls.filter((c) => c[1] === "/api/v2/ollama/status").length).toBe(1);
});

test("before the models arrive the list says Loading; an empty catalogue says No models match", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const api = mkApi({ get: async (p) => { await gate; return p.endsWith("/status") ? { reachable: true } : { models: [] }; } });
  const root = ModelPicker({ api, value: "", onPick() {} });
  root.setOpen(true);
  expect(text(byClass(root, "mp-list")[0])).toBe("Loading…");
  release(); await tick();
  expect(text(byClass(root, "mp-list")[0])).toBe("No models match.");
  expect(byClass(root, "mp-empty").length).toBe(1);
});

test("a search that matches nothing shows the empty note", async () => {
  const { root } = await openPicker();
  const input = byClass(root, "input").find((i) => i.attrs.type === "search");
  expect(input.attrs.placeholder).toBe("Search models");
  input.value = "zzz"; input.listeners.input();
  expect(text(byClass(root, "mp-list")[0])).toBe("No models match.");
  input.value = "llama"; input.listeners.input();
  expect(rows(root).length).toBe(1);
});

test("status line: reachable with and without a version, running count, unreachable, request failure", async () => {
  expect(byClass((await openPicker({ status: { reachable: true, version: "0.12", ps: [{}, {}] } })).root, "mp-status")[0].textContent).toBe("ollama 0.12 reachable · 2 running");
  expect(byClass((await openPicker({ status: { reachable: true } })).root, "mp-status")[0].textContent).toBe("ollama reachable · 0 running");
  expect(byClass((await openPicker({ status: { reachable: false } })).root, "mp-status")[0].textContent).toBe("ollama not reachable");
  const failing = await openPicker({ get: (p) => { if (p.endsWith("/status")) throw new Error("x"); return { models: MODELS }; } });
  expect(byClass(failing.root, "mp-status")[0].textContent).toBe("ollama not reachable");
  expect(byClass(failing.root, "mp-status")[0].attrs.role).toBe("status");
});

test("a failing models request reports the API error and leaves an empty list", async () => {
  const never = new Promise(() => {}); // keep the status probe from overwriting the line
  const failModels = (err) => (p) => { if (p.endsWith("/models")) throw err; return never; };
  const withErr = await openPicker({ get: failModels({ error: "ollama_down" }) });
  expect(text(byClass(withErr.root, "mp-list")[0])).toBe("No models match.");
  expect(byClass(withErr.root, "mp-status")[0].textContent).toBe("✗ models unavailable: ollama_down");
  const bare = await openPicker({ get: failModels(new Error("boom")) });
  expect(byClass(bare.root, "mp-status")[0].textContent).toBe("✗ models unavailable: request failed");
  const nul = await openPicker({ get: failModels(null) });
  expect(byClass(nul.root, "mp-status")[0].textContent).toBe("✗ models unavailable: request failed");
  const noModels = await openPicker({ get: (p) => (p.endsWith("/models") ? null : never) });
  expect(text(byClass(noModels.root, "mp-list")[0])).toBe("No models match.");
  expect(byClass(noModels.root, "mp-status")[0].textContent).toBe("");
});

test("rows: name, params, size or 'cloud', age, running dot, selection state", async () => {
  const now = Date.now();
  const models = [
    { name: "run:1", params: "7B", size_bytes: 4e9, modified_at: now / 1000 - 7200, running: true },
    { name: "idle:1", size_bytes: 1500, cloud: false },
    { name: "far:cloud", cloud: true, size_bytes: 5e9 },
  ];
  const { root } = await openPicker({ models }, { value: "idle:1" });
  const [run, idle, far] = byClass(root, "mp-row");
  expect(byClass(run, "mp-name")[0].children[0].text).toBe("run:1");
  expect(text(byClass(run, "mp-meta")[0])).toBe("7B · 4.0 GB · 2h ago");
  expect(text(byClass(idle, "mp-meta")[0])).toBe("1.5 KB");
  expect(text(byClass(far, "mp-meta")[0])).toBe("cloud");
  expect(run.attrs.role).toBe("option");
  expect(run.attrs["aria-selected"]).toBe("false");
  expect(idle.attrs["aria-selected"]).toBe("true");
  expect(idle.attrs.class).toBe("mp-row is-current");
  expect(run.attrs.class).toBe("mp-row");
  const dot = (r) => walk(r).find((x) => (x.attrs.class || "").startsWith("mp-dot"));
  expect(dot(run).attrs.class).toBe("mp-dot is-running");
  expect(dot(run).attrs.title).toBe("running");
  expect(text(dot(run))).toBe("●");
  expect(dot(idle).attrs.class).toBe("mp-dot");
  expect(dot(idle).attrs.title).toBe("not loaded");
  expect(text(dot(idle))).toBe("○");
  expect(byClass(root, "mp-pinned").length).toBe(0);
  expect(byClass(root, "mp-list")[0].attrs.role).toBe("listbox");
});

test("the pinned current value is not duplicated when it is an installed model", async () => {
  const { root } = await openPicker({}, { value: "llama3.2:3b" });
  expect(byClass(root, "mp-pinned").length).toBe(0);
  expect(rows(root).filter((t) => t.includes("llama3.2:3b")).length).toBe(1);
  const pinned = (await openPicker({}, { value: "ghost:9" })).root;
  const first = byClass(pinned, "mp-row")[0];
  expect(first.attrs["aria-selected"]).toBe("true");
  expect(first.attrs.class).toBe("mp-row is-current mp-pinned");
  expect(first.attrs.role).toBe("option");
  expect(text(byClass(first, "mp-meta")[0])).toBe("current");
  expect(byClass(pinned, "mp-row").length).toBe(4);
});

test("scope chips: aria-pressed and is-on follow the choice, rows are filtered, the empty note shows when nothing is left", async () => {
  const { root } = await openPicker({}, { value: "nimble:latest" });
  const chips = () => byClass(root, "chip");
  expect(chips().map((c) => text(c))).toEqual(["Local", "Cloud", "All"]);
  expect(chips().map((c) => c.attrs["aria-pressed"])).toEqual(["false", "false", "true"]);
  expect(byClass(root, "mp-chips")[0].attrs.role).toBe("group");
  expect(byClass(root, "mp-chips")[0].attrs["aria-label"]).toBe("Model scope");
  chips()[1].listeners.click();
  expect(chips().map((c) => c.attrs["aria-pressed"])).toEqual(["false", "true", "false"]);
  expect(chips().map((c) => c.attrs.class)).toEqual(["chip", "chip is-on", "chip"]);
  expect(rows(root).filter((t) => t.includes("minimax"))).toHaveLength(1);
  expect(rows(root).some((t) => t.includes("llama"))).toBe(false);
  chips()[0].listeners.click();
  expect(rows(root).some((t) => t.includes("minimax"))).toBe(false);
  expect(rows(root).some((t) => t.includes("llama"))).toBe(true);
  chips()[2].listeners.click();
  expect(byClass(root, "mp-row").length).toBe(3);
});

test("the sort selector reorders the rows", async () => {
  const { root } = await openPicker({}, { value: "nimble:latest" });
  const sel = byClass(root, "select")[0];
  expect(sel.attrs["aria-label"]).toBe("Sort models");
  expect(sel.children.map((o) => [o.value, text(o)])).toEqual([["latest", "Latest"], ["size", "Size"], ["name", "Name"], ["popular", "Popular"]]);
  const order = () => rows(root).map((t) => t.split("|")[1]);
  expect(order()[0]).toContain("minimax");
  sel.value = "name"; sel.listeners.change();
  expect(order().map((n) => n.split(" ")[0] || n)).toEqual(["llama3.2:3b", "minimax-m3.1-flash:cloud", "nimble:latest"].map((n) => n));
  sel.value = "size"; sel.listeners.change();
  expect(order()[0]).toContain("nimble");
});

test("Show all (N hidden) appears only when non-text models exist and toggles their visibility and its own label", async () => {
  const withEmbed = [...MODELS, { name: "e1", capabilities: ["embedding"] }, { name: "e2", capabilities: ["image"] }];
  const { root } = await openPicker({ models: withEmbed });
  const btn = byClass(root, "mp-show-all")[0];
  expect(btn.hidden).toBe(false);
  expect(btn.textContent).toBe("Show all (2 hidden)");
  expect(byClass(root, "mp-row").length).toBe(3);
  btn.listeners.click();
  expect(btn.textContent).toBe("Hide non-text models");
  expect(byClass(root, "mp-row").length).toBe(5);
  btn.listeners.click();
  expect(btn.textContent).toBe("Show all (2 hidden)");
  expect(byClass(root, "mp-row").length).toBe(3);
  expect(byClass((await openPicker()).root, "mp-show-all")[0].hidden).toBe(true);
});

test("picking a row updates the trigger, closes the panel, marks the row current and reports the pick", async () => {
  const picked = [];
  const { root } = await openPicker({}, { value: "nimble:latest", onPick: async (n) => picked.push(n) });
  const row = byClass(root, "mp-row").find((r) => text(r).includes("llama3.2:3b"));
  await row.listeners.click();
  expect(picked).toEqual(["llama3.2:3b"]);
  expect(byClass(root, "mp-trigger")[0].textContent).toBe("llama3.2:3b");
  expect(byClass(root, "mp-panel")[0].hidden).toBe(true);
  expect(byClass(root, "mp-trigger")[0].attrs["aria-expanded"]).toBe("false");
  const now = byClass(root, "mp-row").filter((r) => r.attrs["aria-selected"] === "true");
  expect(now.length).toBe(1);
  expect(text(now[0])).toContain("llama3.2:3b");
});

test("Reset to default: hidden with no default or when already on it, otherwise restores the default and reports it", async () => {
  const none = await openPicker({}, { value: "llama3.2:3b" });
  expect(byClass(none.root, "mp-reset")[0].hidden).toBe(true);
  const on = await openPicker({}, { value: "llama3.2:3b", defaultValue: "llama3.2:3b" });
  expect(byClass(on.root, "mp-reset")[0].hidden).toBe(true);
  const picked = [];
  const off = await openPicker({}, { value: "nimble:latest", defaultValue: "llama3.2:3b", onPick: async (n) => picked.push(n) });
  const reset = byClass(off.root, "mp-reset")[0];
  expect(reset.hidden).toBe(false);
  expect(text(reset)).toBe("Reset to default");
  await reset.listeners.click();
  expect(picked).toEqual(["llama3.2:3b"]);
  expect(byClass(off.root, "mp-trigger")[0].textContent).toBe("llama3.2:3b");
  expect(byClass(off.root, "mp-panel")[0].hidden).toBe(true);
  expect(reset.hidden).toBe(true);
});

// ---- pulling another model ----
const realSetTimeout = globalThis.setTimeout;
afterEach(() => { globalThis.setTimeout = realSetTimeout; });
const startPull = async (apiOver, typed = "qwen3:8b") => {
  globalThis.setTimeout = (f, ms, ...a) => realSetTimeout(f, ms >= 1000 ? 0 : ms, ...a); // collapse the 1s poll sleep
  const ctx = await openPicker(apiOver);
  byClass(ctx.root, "mp-pull-open")[0].listeners.click();
  const [input, go, progress] = byClass(ctx.root, "mp-pull")[0].children;
  input.value = typed;
  return { ...ctx, input, go, progress };
};

test("Pull another shows a model field, a Pull button and a status region", async () => {
  const { root } = await openPicker();
  expect(text(byClass(root, "mp-pull-open")[0])).toBe("Pull another…");
  expect(byClass(root, "mp-pull")[0].children.length).toBe(0);
  byClass(root, "mp-pull-open")[0].listeners.click();
  const [input, go, progress] = byClass(root, "mp-pull")[0].children;
  expect(input.attrs.placeholder).toBe("model:tag");
  expect(input.attrs["aria-label"]).toBe("Model to pull");
  expect(text(go)).toBe("Pull");
  expect(progress.attrs.role).toBe("status");
  expect(progress.attrs.class).toBe("mp-progress");
});

test("pulling with an empty or blank name does nothing", async () => {
  const { go, api, progress } = await startPull({}, "   ");
  await go.listeners.click();
  expect(api.calls.some((c) => c[0] === "post")).toBe(false);
  expect(progress.textContent).toBe("");
});

test("a pull trims the name, polls the job (id fallback), shows percent or the last line, then refreshes the models", async () => {
  const seen = [];
  let polls = 0;
  const { go, api, progress } = await startPull({
    post: () => ({ id: "from-id" }),
    get: (p) => {
      if (p.includes("/jobs/")) { polls++; seen.push(progress.textContent); return polls === 1 ? { status: "running", percent: 0 } : polls === 2 ? { status: "running", lines: ["a", "layer b"] } : polls === 3 ? { status: "running" } : { status: "done" }; }
      return p.endsWith("/status") ? { reachable: true } : { models: MODELS };
    },
  }, "  qwen3:8b ");
  const modelsBefore = api.calls.filter((c) => c[1] === "/api/v2/ollama/models").length;
  const p = go.listeners.click();
  expect(progress.textContent).toBe("starting…");
  await p;
  expect(api.calls.find((c) => c[0] === "post")).toEqual(["post", "/api/v2/ollama/pull", { name: "qwen3:8b" }]);
  expect(api.calls.some((c) => c[1] === "/api/v2/ollama/jobs/from-id")).toBe(true);
  expect(progress.textContent).toBe("✓ pulled qwen3:8b");
  expect(api.calls.filter((c) => c[1] === "/api/v2/ollama/models").length).toBe(modelsBefore + 1);
  expect(seen[0]).toBe("starting…");
});

test("pull progress text per update: 'status percent%' (including 0), last log line, bare status", async () => {
  const shown = [];
  let n = 0, progress;
  const script = [{ status: "pulling", percent: 0 }, { status: "pulling", lines: ["x", "last line"] }, { status: "verifying" }, { status: "error", error: "disk full" }];
  const ctx = await startPull({ get: (p) => (p.includes("/jobs/") ? (shown.push(progress.textContent), script[n++]) : p.endsWith("/status") ? { reachable: true } : { models: MODELS }) });
  progress = ctx.progress;
  await ctx.go.listeners.click();
  expect(shown).toEqual(["starting…", "pulling 0%", "last line", "verifying"]);
  expect(progress.textContent).toBe("✗ pull failed: disk full");
});

test("pull failures: job error without a message, rejected start with and without an API error", async () => {
  const noMsg = await startPull({ get: (p) => (p.includes("/jobs/") ? { status: "error" } : p.endsWith("/status") ? { reachable: true } : { models: MODELS }) });
  await noMsg.go.listeners.click();
  expect(noMsg.progress.textContent).toBe("✗ pull failed: error");
  const apiErr = await startPull({ post: () => { throw { error: "no_space" }; } });
  await apiErr.go.listeners.click();
  expect(apiErr.progress.textContent).toBe("✗ pull failed: no_space");
  const plain = await startPull({ post: () => { throw new Error("x"); } });
  await plain.go.listeners.click();
  expect(plain.progress.textContent).toBe("✗ pull failed: request failed");
  const rejectedNull = await startPull({ post: () => { throw null; } });
  await rejectedNull.go.listeners.click();
  expect(rejectedNull.progress.textContent).toBe("✗ pull failed: request failed");
});

test("a failed pull does not refetch the model list", async () => {
  const ctx = await startPull({ get: (p) => (p.includes("/jobs/") ? { status: "error", error: "x" } : p.endsWith("/status") ? { reachable: true } : { models: MODELS }) });
  const before = ctx.api.calls.filter((c) => c[1] === "/api/v2/ollama/models").length;
  await ctx.go.listeners.click();
  expect(ctx.api.calls.filter((c) => c[1] === "/api/v2/ollama/models").length).toBe(before);
});
