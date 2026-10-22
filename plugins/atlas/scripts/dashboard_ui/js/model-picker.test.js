import { test, expect } from "bun:test";

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
