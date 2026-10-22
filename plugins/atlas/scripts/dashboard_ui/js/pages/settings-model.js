// Settings model: pure helpers (no DOM, no network) so node:test can cover them.
// Brief 5.9 and section 11: section assignment, Current line, control kind, search, save sentences.

export const SECTIONS = [
  { id: "dashboard", title: "Dashboard" },
  { id: "sessions", title: "Sessions" },
  { id: "guardrails", title: "Guardrails" },
  { id: "optimizer", title: "Prompt optimizer" },
  { id: "scoring", title: "Scoring" },
  { id: "omp", title: "omp extension" },
  { id: "storage", title: "Storage" },
  { id: "advanced", title: "Advanced" },
  { id: "connectors", title: "Connectors" },
  { id: "plugins", title: "Plugins and MCP servers" },
];

// Server group titles (behavior_state groups[].title) to section ids.
const GROUP_SECTION = {
  "Session automation": "sessions",
  Guardrails: "guardrails",
  "Prompt optimizer": "optimizer",
  "Turn scoring": "scoring",
  "omp extension": "omp",
  "Storage paths": "storage",
};

/** Section id for a /api/behavior entry. Entries from advanced[] carry no group. */
export function sectionOf(entry) {
  return GROUP_SECTION[entry && entry.group] || "advanced";
}

/** Flatten a /api/behavior payload into one list, each entry tagged with its section id. */
export function flattenBehavior(payload) {
  const out = [];
  for (const g of (payload && payload.groups) || [])
    for (const k of g.knobs || [])
      out.push({ ...k, group: k.group || g.title });
  for (const k of (payload && payload.advanced) || [])
    out.push({ ...k, group: "" });
  return out.map((e) => ({ ...e, section: sectionOf(e) }));
}

const SOURCE_WORD = { default: "default", saved: "saved", shell: "shell env" };
const APPLIES_WORD = {
  now: "applies now",
  "next-session": "new sessions",
  "dashboard-restart": "restart dashboard",
};

const PATHISH = /^(\/|~|<|[A-Za-z]:\\)/;

/**
 * Which control a row gets: switch | select | number | model | url | command | path | text | readonly.
 * Finite value sets never fall through to text.
 */
export function controlFor(entry) {
  if (entry.editable === false) return "readonly";
  switch (entry.kind) {
    case "toggle":
      return "switch";
    case "select":
      return "select";
    case "number":
      return "number";
    case "model":
      return "model";
    case "url":
      return "url";
    case "command":
      return "command";
    default:
      return entry.key === "ATLAS_HOME" ||
        entry.key === "ATLAS_DB" ||
        PATHISH.test(String(entry.default ?? ""))
        ? "path"
        : "text";
  }
}

/** True when the stored value means "on" for a toggle entry (empty `on` means a cleared key). */
export function isOn(entry, value) {
  const v = value == null ? entry.default : value;
  return String(v ?? "") === String(entry.on ?? "");
}

/** The literal value to save for a switch position. */
export const toggleValue = (entry, on) => (on ? entry.on : entry.off) ?? "";

/** Human wording for a value in the Current line. */
export function valueWord(entry, value) {
  if (entry.kind === "toggle") return isOn(entry, value) ? "on" : "off";
  if (value == null || value === "") return "not set";
  if (entry.kind === "select") {
    const o = (entry.options || []).find(
      (x) => String(x.value) === String(value),
    );
    return o ? o.label || o.value : String(value);
  }
  return String(value);
}

/** "Current: on (default) · new sessions". */
export function currentLine(entry) {
  const cur = entry.current || {};
  const src = SOURCE_WORD[cur.source] || cur.source || "default";
  const when =
    APPLIES_WORD[cur.applies] || (cur.applies || "").replace(/-/g, " ");
  return `Current: ${valueWord(entry, cur.value)} (${src})${when ? ` · ${when}` : ""}`;
}

/** Sentence for a dashboard process env that differs from the saved value, else "". */
export function liveSentence(entry) {
  const live = entry.live;
  if (!live || !live.differs) return "";
  return `This dashboard was started with ${valueWord(entry, live.value)}; saved value wins for new sessions.`;
}

/** The exact shell line for a read-only row. */
export function exportLine(entry) {
  const v =
    entry.current && entry.current.value != null
      ? entry.current.value
      : (entry.default ?? "");
  return `export ${entry.key}=${v}`;
}

/** Select options for an entry; keeps the current value selectable when the server list lacks it. */
export function optionsFor(entry) {
  const opts = (entry.options || []).map((o) => ({
    value: o.value,
    label: o.label || o.value,
    hint: o.hint,
  }));
  const cur = entry.current && entry.current.value;
  if (
    cur != null &&
    cur !== "" &&
    !opts.some((o) => String(o.value) === String(cur))
  )
    opts.unshift({ value: cur, label: String(cur) });
  return opts;
}

/** Select options from GET /api/v2/ollama/models; the current value is appended when the list lacks it. */
export function modelOptions(models, current) {
  const opts = (models || []).map((m) => {
    const tail = m.cloud ? "cloud" : m.params || "";
    return { value: m.name, label: tail ? `${m.name} · ${tail}` : m.name };
  });
  if (
    current != null &&
    current !== "" &&
    !opts.some((o) => o.value === String(current))
  )
    opts.push({ value: current, label: String(current) });
  return opts;
}

/** Case-insensitive match on key, title and description. An empty query matches everything. */
export function matches(entry, q) {
  const s = String(q || "")
    .trim()
    .toLowerCase();
  if (!s) return true;
  return [entry.key, entry.title, entry.description].some((f) =>
    String(f || "")
      .toLowerCase()
      .includes(s),
  );
}

export function filterEntries(entries, q) {
  return entries.filter((e) => matches(e, q));
}

/** {sectionId: count} over a list of entries. */
export function countBySection(entries) {
  const out = {};
  for (const e of entries) out[e.section] = (out[e.section] || 0) + 1;
  return out;
}

/** Range placeholder text, "1 to 50". */
export const rangeText = (range) =>
  range ? `${range.min} to ${range.max}` : "";

/**
 * Turn a save outcome into one inline sentence. `data` is a parsed success body or an
 * ApiError.data envelope. Returns {tone: "ok"|"fail", text, confirm?: string}.
 */
export function resultSentence(data) {
  const d = data || {};
  if (d.error === "needs_confirm")
    return {
      tone: "fail",
      text: `This command will run on every prompt: ${d.command}`,
      confirm: d.command,
    };
  if (d.error === "out_of_range")
    return {
      tone: "fail",
      text: `Must be between ${d.range.min} and ${d.range.max}`,
    };
  if (d.error === "bad_option")
    return {
      tone: "fail",
      text: `Choose one of: ${(d.options || []).join(", ")}`,
    };
  if (d.error === "unknown_model") {
    const m = d.matches || [];
    return {
      tone: "fail",
      text: `Ollama has no model "${d.value}". ${m.length ? `Closest: ${m.join(", ")}` : "No close matches."}`,
    };
  }
  if (d.error === "bad_path")
    return {
      tone: "fail",
      text: d.hint || "Use an absolute path that exists or can be created.",
    };
  if (d.error === "value_too_long")
    return { tone: "fail", text: d.hint || "That value is too long." };
  if (d.error === "keys_not_allowlisted")
    return {
      tone: "fail",
      text: `Atlas cannot save ${(d.keys || []).join(", ")} from here.`,
    };
  if (Array.isArray(d.results)) {
    for (const r of d.results)
      for (const l of r.layers || [])
        if (!l.ok)
          return {
            tone: "fail",
            text: `Not saved to ${l.layer.replace(/_/g, " ")}: wrote "${l.wrote}", read back "${l.got}"${l.error ? ` (${l.error})` : ""}.`,
          };
    if (d.ok !== false) return { tone: "ok", text: "Saved" };
  }
  if (d.ok === true) return { tone: "ok", text: "Saved" };
  const msg = [d.error, d.why || d.hint].filter(Boolean).join(": ");
  return { tone: "fail", text: msg || "Save failed" };
}
