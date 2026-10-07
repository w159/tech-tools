// Native herdr tooling in the Command Center (GET /api/v2/integrations, /deck, POST /open-file, /open-editor).
// One module for: cached reads, honest error explanations (424 install command, 403 outside root, 429 duplicate),
// path:line links that open the herdr-file-viewer, "Open in editor" (tode CLI only), the Files panel, and the
// Integrations panel / compact status row. No innerHTML, nothing from tode's code-server is ever embedded or linked.

import { h, icon, replace, copyText } from "./dom.js";
import { api } from "./api.js";
import { Badge, Button, Input, CommandBlock } from "./ui-core.js";
import { Modal, openModal, closeModal, toast } from "./ui-overlays.js";

// ---- cached reads --------------------------------------------------------------------------------

const cache = new Map();
function cached(key, path, force, ttl) {
  const c = cache.get(key);
  if (c && !force && Date.now() - c.at < ttl) return c.p;
  const entry = { at: Date.now(), p: null, data: c ? c.data : null };
  entry.p = api.get(path).then((d) => { entry.data = d; return d; }, (e) => { if (cache.get(key) === entry) cache.delete(key); throw e; });
  cache.set(key, entry);
  return entry.p;
}
export const getIntegrations = (force) => cached("integrations", "integrations", force, 5000);
export const getHp = (force) => cached("hp", "projects/hp", force, 5000);
export const getDeck = (force) => cached("deck", "deck", force, 5000);
export const hpSnapshot = () => (cache.get("hp") || {}).data || null;

let hpKey = "";
/** Loads herdr-projects data for chips; resolves true when it changed since the last call. Never throws. */
export async function warmHp() {
  try {
    const d = await getHp();
    const key = JSON.stringify((d.projects || []).map((p) => [p.slug, (p.threads || []).map((t) => [t.id, t.cwd, t.status, t.pane_id])]));
    const changed = key !== hpKey;
    hpKey = key;
    return changed;
  } catch (_e) {
    return false;
  }
}

const trim = (p) => String(p || "").replace(/\/+$/, "");
/** The herdr-projects thread whose cwd is `cwd` (from the last warmHp), else null. */
export function hpThreadFor(cwd) {
  const snap = hpSnapshot();
  if (!snap || !cwd) return null;
  for (const p of snap.projects || []) {
    for (const t of p.threads || []) if (t.cwd && trim(t.cwd) === trim(cwd)) return { project: p.slug, thread: t };
  }
  return null;
}

// ---- honest errors -------------------------------------------------------------------------------

const CODE_TEXT = {
  unknown_root: ["Outside the folders Atlas knows", "Atlas opens files only inside a project root or a running agent's directory."],
  path_outside_root: ["That path leaves the project folder", "Symlinks that point outside the folder are refused too."],
  duplicate_viewer: ["A viewer for this folder just opened", "Switch to the viewer pane that is already open, or try again in a few seconds."],
  not_found: ["File not found", "It may have been moved or deleted since the message was written."],
  not_a_file: ["That is a folder, not a file", "The file viewer opens one file at a time."],
  bad_root: ["Directory no longer exists", ""],
  open_failed: ["herdr could not open the viewer", ""],
  spawn_failed: ["Could not start the editor", ""],
  unsupported_path: ["This file name cannot be opened", "A colon in the path clashes with the line suffix."],
};

/** Modal for a missing tool: what, the exact command, copy button. */
export function installModal(title, cmd, note) {
  openModal(Modal({
    title,
    children: [
      note ? h("p", null, note) : null,
      cmd ? h("p", { class: "dim" }, "Run this in a terminal, then try again:") : null,
      cmd ? CommandBlock(cmd) : null,
    ],
    actions: [Button({ label: "Close", variant: "primary", onClick: () => closeModal() })],
  }));
}

/** Show any open-file / open-editor / thread-start failure as plain words; 424 gets the install command. */
export function explain(err, what) {
  const d = (err && err.data) || {};
  const status = err && err.status;
  if (status === 424) {
    const tool = what === "editor" ? "tode" : what === "thread" ? "herdr-projects" : "the herdr file viewer";
    const cmd = d.install_cmd || "";
    installModal(tool.charAt(0).toUpperCase() + tool.slice(1) + " is not installed", cmd, d.error === "herdr_not_found" ? "herdr itself was not found on this machine." : "Atlas will not install it for you.");
    return;
  }
  const code = err && err.error;
  const t = CODE_TEXT[code];
  if (status === 429) return void toast(t ? t[0] : "Slow down", { kind: "warn", why: t ? t[1] : d.why });
  if (t) return void toast(t[0], { kind: "fail", why: [t[1], d.why].filter(Boolean).join(" ") });
  const detail = d.detail ? String(d.detail) : "";
  toast((err && (err.why || err.error || err.message)) || "Request failed", { kind: "fail", why: detail, do: err && err.do });
}

// ---- paths ---------------------------------------------------------------------------------------

function normalize(path, root) {
  const abs = path.startsWith("/") ? path : trim(root) + "/" + path;
  const out = [];
  for (const seg of abs.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}

export async function openFile({ path, line, range, root, placement }) {
  if (!root || !root.startsWith("/")) return void toast("No folder to open this file in", { kind: "warn", why: "Atlas needs the agent or project directory as the root." });
  const abs = normalize(path, root);
  const body = { path: abs, root, placement: placement || "split" };
  if (range) body.range = range;
  else if (line) body.line = line;
  try {
    await api.post("open-file", body);
    toast("Opened " + abs.replace(trim(root) + "/", "") + (range ? ":" + range.join("-") : line ? ":" + line : "") + " in the file viewer", { kind: "ok" });
    return true;
  } catch (e) {
    explain(e, "file");
    return false;
  }
}

export async function openEditor({ path, line }) {
  try {
    await api.post("open-editor", line ? { path, line } : { path });
    toast("Opening " + path.split("/").filter(Boolean).pop() + " in tode", { kind: "ok" });
    return true;
  } catch (e) {
    explain(e, "editor");
    return false;
  }
}

const ABS_OK = /^\/(?:Users|home|tmp|private|var|opt|Volumes|srv|mnt)\//;
const EXTS = "py|js|mjs|cjs|ts|tsx|jsx|json|md|mdx|css|scss|html|sh|bash|zsh|toml|ya?ml|rs|go|c|h|cpp|hpp|java|kt|rb|php|swift|txt|sql|lock|cfg|ini|env|mjs|vue|svelte";
// Absolute paths under well-known roots, or relative paths ending in a code/doc extension; optional :line or :a-b.
const PATH_RE = new RegExp("(?<![\\w/:.~@-])((?:/[\\w.@+-]*[\\w@+-])+|(?:\\./)?(?:[\\w.@+-]+/)*[\\w@+-][\\w.@+-]*\\.(?:" + EXTS + "))(?::(\\d+)(?:-(\\d+))?)?(?![\\w/])", "g");

/** Link for one path:line. root = directory the viewer is pinned to (agent cwd or project root). */
export function PathLink({ path, line, range, root, text }) {
  const label = text || path + (range ? ":" + range.join("-") : line ? ":" + line : "");
  return h("button", { class: "path-link mono", type: "button", "data-path": path, "data-line": line || null, title: "Open in the file viewer (root " + root + ")", onClick: (e) => { e.preventDefault(); e.stopPropagation(); openFile({ path, line, range, root }); } }, label);
}

/** Text -> nodes: path:line mentions become links when `root` is known; each segment is passed to `rest(str)` for other linking. */
export function linkifyPaths(text, root, rest) {
  const src = String(text === undefined || text === null ? "" : text);
  const pass = rest || ((s) => s);
  if (!root) return pass(src);
  const out = [];
  let last = 0;
  src.replace(PATH_RE, (m, path, a, b, at) => {
    if (path.startsWith("/") && !(ABS_OK.test(path) || path.startsWith(trim(root) + "/"))) return m;
    if (path.length < 3) return m;
    const range = b && Number(b) >= Number(a) ? [Number(a), Number(b)] : null;
    out.push(pass(src.slice(last, at)), PathLink({ path, line: !range && a ? Number(a) : null, range, root, text: m }));
    last = at + m.length;
    return m;
  });
  out.push(pass(src.slice(last)));
  return out.flat();
}

/** Distinct { path, line } mentions in some texts, newest first, capped. */
export function mentionedPaths(texts, root, cap = 20) {
  const seen = new Map();
  for (const t of texts) {
    String(t || "").replace(PATH_RE, (m, path, a) => {
      if (path.startsWith("/") && !(ABS_OK.test(path) || path.startsWith(trim(root) + "/"))) return m;
      const key = path + ":" + (a || "");
      if (!seen.has(key) && seen.size < cap) seen.set(key, { path, line: a ? Number(a) : null });
      return m;
    });
  }
  return [...seen.values()];
}

/** Files panel: root + Open in editor, open-by-path form, files mentioned in `texts`. */
export function FilesPanel({ root, texts, label, chip }) {
  if (!root) return h("p", { class: "dim" }, "No directory is known for this " + (label || "item") + ".");
  const field = Input({ label: "Open a file in the viewer", placeholder: "src/app.py:42", hint: "Relative to the directory above, optional :line. Opens in a split pane." });
  const input = field.querySelector("input");
  const go = () => {
    const m = /^(.*?)(?::(\d+))?$/.exec(input.value.trim());
    if (m && m[1]) openFile({ path: m[1], line: m[2] ? Number(m[2]) : null, root });
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  const found = mentionedPaths(texts || [], root);
  return h("div", { class: "files-panel" },
    h("dl", { class: "kv" }, h("dt", null, "Directory"), h("dd", null, h("span", { class: "mono cwd", title: root }, root, h("button", { class: "btn btn-ghost btn-icon btn-sm", type: "button", "aria-label": "Copy directory", onClick: () => copyText(root) }, icon("copy"))))),
    chip || null,
    h("div", { class: "row files-actions" }, Button({ label: "Open in editor", icon: "external-link", size: "sm", title: "Launch tode on this folder (CLI only)", onClick: () => openEditor({ path: root }) })),
    h("div", { class: "files-open" }, field, Button({ label: "Open", size: "sm", onClick: go })),
    h("h3", null, "Files mentioned"),
    found.length
      ? h("ul", { class: "files-list" }, found.map((f) => h("li", null, PathLink({ path: f.path, line: f.line, root }))))
      : h("p", { class: "dim" }, "No file paths in this " + (label || "item") + "'s recent task or messages."));
}

// ---- integrations panel --------------------------------------------------------------------------

const TOOL_LABEL = { "herdr-projects": "herdr-projects", "herdr-file-viewer": "herdr-file-viewer", "captains-deck": "Captain's Deck", "cmux-browser-mcp": "cmux-browser MCP", tode: "tode" };
const TOOL_ROLE = {
  "herdr-projects": "Coordinator + worker threads on their own branches",
  "herdr-file-viewer": "Read-only file viewer pane (path:line links)",
  "captains-deck": "Read-only Firstmate kanban inside herdr",
  "cmux-browser-mcp": "Browser automation for agents through the cmux app",
  tode: "Editor launched from the CLI (Open in editor)",
};

function stateBadge(t) {
  if (!t.installed) return Badge({ status: "idle", text: "Not installed" });
  if (!t.enabled) return Badge({ status: "warn", text: "Installed, disabled" });
  return Badge({ status: "ok", text: "Installed" });
}

function facts(t, mcp, deck) {
  const rows = [["Enabled", t.enabled ? "yes" : "no"], ["Version", t.version || "unknown"]];
  if (t.name === "herdr-projects") rows.push(["Configured", t.configured ? "yes, root exists" : "no, run configure --dry-run first"], ["Binary on PATH", t.binary ? "yes" : "no"]);
  if (t.name === "cmux-browser-mcp") {
    const reg = (mcp || []).filter((m) => /cmux-browser/.test(m.name));
    rows.push(["MCP registration", reg.length ? "registered in " + reg.map((m) => m.source).join(", ") : "not registered in any MCP config"]);
    if (t.cmux) rows.push(["cmux app", t.cmux.running ? "running" + (t.cmux.access_mode ? ", " + t.cmux.access_mode : "") : t.cmux.installed ? "installed, not running" : "not found"], ...(t.cmux.browser_capabilities !== undefined ? [["Browser methods", String(Array.isArray(t.cmux.browser_capabilities) ? t.cmux.browser_capabilities.length : t.cmux.browser_capabilities)]] : []));
  }
  if (t.name === "captains-deck" && deck) rows.push(["Board", deck.available ? "available, " + (deck.homes || []).length + " Firstmate home(s)" : "unavailable: needs Firstmate"]);
  return rows;
}

function toolRow(t, ctx) {
  const n = t.name;
  return h("li", { class: "int-tool", "data-tool": n, "data-installed": t.installed ? "true" : "false" },
    h("div", { class: "int-head" }, h("h3", null, TOOL_LABEL[n] || n), stateBadge(t), h("a", { class: "int-docs", href: t.docs_url, target: "_blank", rel: "noopener noreferrer" }, "Docs", icon("external-link"))),
    h("p", { class: "dim int-role" }, TOOL_ROLE[n] || ""),
    h("dl", { class: "kv int-facts" }, facts(t, ctx.mcp, ctx.deck).map(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
    t.notes ? h("p", { class: "dim int-notes" }, t.notes) : null,
    !t.installed && t.install_cmd ? h("div", { class: "int-install" }, h("p", { class: "dim" }, "Install (Atlas never runs this for you):"), CommandBlock(t.install_cmd)) : null);
}

function deckBlock(deck) {
  if (!deck) return null;
  if (deck.available) {
    return h("div", { class: "int-deck", "data-available": "true" }, h("h3", null, "Captain's Deck"), h("p", { class: "dim" }, "Firstmate homes found: " + (deck.homes || []).join(", ")), (deck.discovered || []).length ? h("ul", { class: "files-list mono" }, deck.discovered.map((l) => h("li", null, l))) : null, h("p", { class: "dim" }, "The board itself lives in the herdr pane (open-captain-deck); Atlas shows no copy of it."));
  }
  return h("div", { class: "int-deck", "data-available": "false" }, h("h3", null, "Captain's Deck board"), h("p", null, "Unavailable: " + (deck.reason || "needs Firstmate") + "."), h("p", { class: "dim" }, "Captain's Deck is a read-only view of a Firstmate flow. Atlas shows no board without Firstmate homes, and does not make one up."));
}

/** Full panel; .reload(force) refetches. */
export function IntegrationsPanel() {
  const root = h("div", { class: "int-panel", id: "integrations" });
  let busy = false;
  async function load(force) {
    if (busy) return;
    busy = true;
    try {
      const [d, deck] = await Promise.all([getIntegrations(force), getDeck(force).catch(() => null)]);
      replace(root,
        h("div", { class: "int-bar" }, h("p", { class: "dim" }, "herdr " + (d.herdr ? "found" : "not found") + ". Atlas only reads this state; installing is always your call."), Button({ label: "Recheck", size: "sm", onClick: () => load(true) })),
        h("ul", { class: "int-list" }, (d.tools || []).map((t) => toolRow(t, { mcp: d.mcp, deck }))),
        deckBlock(deck));
    } catch (e) {
      replace(root, h("div", { class: "state state-error", role: "alert" }, h("h2", { class: "state-title" }, "Could not read the integrations"), h("p", { class: "state-body" }, [e.error, e.why, e.do].filter(Boolean).join(". ")), Button({ label: "Retry", variant: "primary", onClick: () => load(true) })));
    }
    busy = false;
  }
  root.reload = load;
  replace(root, h("p", { class: "dim", role: "status" }, "Reading integrations"));
  load(false);
  return root;
}

const ver = (v) => (/^v/i.test(String(v)) ? String(v) : "v" + v);

/** Compact one-line status row for Overview. */
export function IntegrationsRow() {
  const row = h("section", { class: "int-row", "aria-label": "Integrations" }, h("span", { class: "int-row-label dim" }, "Integrations"), h("span", { class: "dim" }, "Reading"));
  getIntegrations().then((d) => {
    replace(row, h("span", { class: "int-row-label dim" }, "Integrations"),
      ...(d.tools || []).map((t) => h("a", { class: "chip-lite chip-link int-chip", href: "#/settings#integrations", "data-tool": t.name, "data-installed": t.installed ? "true" : "false", title: TOOL_LABEL[t.name] + ": " + (t.installed ? (t.enabled ? "installed" : "installed, disabled") : "not installed") + (t.version ? " " + ver(t.version) : "") },
        h("span", { class: "int-dot", "aria-hidden": "true" }), TOOL_LABEL[t.name] || t.name, h("span", { class: "dim" }, t.installed ? (t.enabled ? (t.version ? ver(t.version) : "on") : "off") : "missing"))));
  }, (e) => replace(row, h("span", { class: "int-row-label dim" }, "Integrations"), h("span", { class: "dim" }, "Unavailable: " + (e.error || "request failed"))));
  return row;
}
