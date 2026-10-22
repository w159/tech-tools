// Settings sections backed by other APIs: Dashboard prefs, Connectors, Plugins and MCP servers.
// Each builder resolves to [{meta, node}] using the shared row anatomy.
import { h, baseName } from "../dom.js";
import { Button, Input, Segmented, Select, StateDot, Switch } from "../ui.js";
import { get, post, prefs, savePrefs, describeError } from "../api.js";
import { applyTheme } from "../theme.js";
import { Row, makeFeedback, InputControl } from "./settings-row.js";

// --- Dashboard (GET/PUT /api/v2/prefs) ---

/** One prefs row. `build(save, p)` returns the control; `show(p)` words the Current line. */
function prefRow(meta, build, show) {
  const fb = makeFeedback();
  const cur = h("span");
  const paint = () => {
    cur.textContent = `Current: ${show(prefs.get())} (saved in dashboard preferences)`;
  };
  const save = async (patch) => {
    fb.clear();
    try {
      await savePrefs(patch);
      shown = show(prefs.get());
      paint();
      fb.ok();
      return true;
    } catch (e) {
      fb.fail(describeError(e).message);
      return false;
    }
  };
  paint();
  let control = build(save, prefs.get());
  const node = Row({
    meta: { ...meta, section: "dashboard" },
    control,
    current: cur,
    feedback: fb,
  });
  // Re-paint when prefs change elsewhere (sidebar theme button, late prime). Own saves already match.
  let shown = show(prefs.get());
  let seen = false;
  const unsub = prefs.subscribe((p) => {
    if (node.isConnected) seen = true;
    else if (seen) return unsub(); // page was replaced
    const now = show(p);
    if (now === shown) return;
    shown = now;
    paint();
    const next = build(save, p);
    control.replaceWith(next);
    control = next;
  });
  return { meta: { ...meta, section: "dashboard" }, node };
}

const numberRow = (key, title, description, range, read, patch) =>
  prefRow(
    { key, title, description },
    (save, p) =>
      InputControl({
        number: true,
        value: read(p),
        range,
        placeholder: `${range.min} to ${range.max}`,
        label: title,
        save: (v) => save(patch(v, prefs.get())),
      }),
    (p) => String(read(p)),
  );

const switchRow = (key, title, description, read, patch) =>
  prefRow(
    { key, title, description },
    (save, p) => {
      const sw = Switch({
        checked: !!read(p),
        label: title,
        onChange: async (v) => {
          if (!(await save(patch(v, prefs.get()))))
            sw.setAttribute("aria-checked", String(!v));
        },
      });
      return sw;
    },
    (p) => (read(p) ? "on" : "off"),
  );

// Synchronous: the prefs store is already primed, so these rows paint at first render.
// The project list arrives later and fills the Default project select in place.
export function buildDashboardRows() {
  const saved = prefs.get().default_project;
  const projectOptions = [{ value: "all", label: "All projects" }];
  if (saved && saved !== "all")
    projectOptions.push({ value: saved, label: baseName(saved) });
  const word = (opts, v) =>
    (opts.find((o) => o.value === v) || { label: v }).label;
  const themeOpts = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
    { value: "system", label: "System" },
  ];
  const densityOpts = [
    { value: "compact", label: "Compact" },
    { value: "comfortable", label: "Comfortable" },
  ];
  const sevOpts = [
    { value: "info", label: "Info and above" },
    { value: "warn", label: "Warnings and failures" },
    { value: "fail", label: "Failures only" },
  ];
  const noise = (k) => (p) => (p.noise || {})[k];
  const selffix = (k) => (p) => (p.selffix || {})[k];
  const nest =
    (group, k, parse = (v) => v) =>
    (v, p) => ({ [group]: { ...(p[group] || {}), [k]: parse(v) } });

  const rows = [
    prefRow(
      {
        key: "theme",
        title: "Theme",
        description:
          "Colour scheme for this dashboard. System follows your operating system.",
      },
      (save, p) =>
        Segmented({
          options: themeOpts,
          value: p.theme,
          label: "Theme",
          onChange: (v) => {
            applyTheme(v);
            save({ theme: v });
          },
        }),
      (p) => word(themeOpts, p.theme),
    ),
    prefRow(
      {
        key: "density",
        title: "Density",
        description: "Compact controls are 32px tall, comfortable are 36px.",
      },
      (save, p) =>
        Segmented({
          options: densityOpts,
          value: p.density,
          label: "Density",
          onChange: (v) => save({ density: v }),
        }),
      (p) => word(densityOpts, p.density),
    ),
    prefRow(
      {
        key: "default_project",
        title: "Default project",
        description:
          "Which project the dashboard opens on when the address names none.",
      },
      (save, p) =>
        Select({
          options: projectOptions,
          value: p.default_project || "all",
          label: "Default project",
          onChange: (v) => save({ default_project: v }),
        }),
      (p) => word(projectOptions, p.default_project || "all"),
    ),
    numberRow(
      "refresh_seconds",
      "Refresh interval",
      "Seconds between polls when the live stream is down.",
      { min: 2, max: 3600 },
      (p) => p.refresh_seconds,
      (v) => ({ refresh_seconds: Number(v) }),
    ),
    switchRow(
      "noise.collapse_duplicates",
      "Collapse duplicate activity",
      "Show repeated activity items once with a count.",
      noise("collapse_duplicates"),
      nest("noise", "collapse_duplicates"),
    ),
    prefRow(
      {
        key: "noise.min_severity",
        title: "Activity noise floor",
        description: "The lowest severity the activity feed shows.",
      },
      (save, p) =>
        Select({
          options: sevOpts,
          value: noise("min_severity")(p),
          label: "Activity noise floor",
          onChange: (v) => save(nest("noise", "min_severity")(v, prefs.get())),
        }),
      (p) => word(sevOpts, noise("min_severity")(p)),
    ),
    switchRow(
      "selffix.enabled",
      "Self-fix scheduler",
      "Let the dashboard run self-fix passes on a timer.",
      selffix("enabled"),
      nest("selffix", "enabled"),
    ),
    numberRow(
      "selffix.interval_min",
      "Self-fix interval",
      "Minutes between self-fix passes.",
      { min: 5, max: 1440 },
      selffix("interval_min"),
      nest("selffix", "interval_min", Number),
    ),
    numberRow(
      "selffix.max_concurrent",
      "Self-fix concurrency",
      "How many self-fix runs may overlap.",
      { min: 1, max: 4 },
      selffix("max_concurrent"),
      nest("selffix", "max_concurrent", Number),
    ),
  ];

  const select = rows
    .find((r) => r.meta.key === "default_project")
    .node.querySelector("select");
  get("/api/v2/projects")
    .then((res) => {
      const want = select.value;
      const found = (res.projects || []).filter((p) => p.root);
      projectOptions.splice(
        1,
        projectOptions.length,
        ...found.map((p) => ({
          value: p.root,
          label: p.name || baseName(p.root),
        })),
      );
      if (want !== "all" && !projectOptions.some((o) => o.value === want))
        projectOptions.push({ value: want, label: baseName(want) });
      select.replaceChildren(
        ...projectOptions.map((o) =>
          h("option", { value: o.value, selected: o.value === want }, o.label),
        ),
      );
    })
    .catch((e) =>
      console.warn(
        "project list unavailable for the Default project select",
        e,
      ),
    );
  return rows;
}

// --- Connectors (GET /api/connectors, POST /api/connectors/env, /api/connectors/test) ---

function connectorState(c, tested) {
  if (tested === false) return StateDot("fail", { word: "Test failed" });
  return c.fields.some((f) => f.is_set)
    ? StateDot("done", { word: "Configured" })
    : StateDot("ready", { word: "Not configured" });
}

function connectorRow(c) {
  const fb = makeFeedback();
  const stateSlot = h("span", { class: "setting-state" }, connectorState(c));
  const inputs = c.fields.map((f) => ({
    f,
    input: Input({
      type: f.sensitive ? "password" : "text",
      value: f.sensitive ? "" : f.value || "",
      placeholder: f.is_set ? (f.sensitive ? "Saved, hidden" : "") : "Not set",
      autocomplete: "off",
      "aria-label": f.title,
      mono: true,
    }),
  }));
  const save = Button({ size: "sm" }, "Save");
  const test = Button({ size: "sm", variant: "ghost" }, "Test");
  save.addEventListener("click", async () => {
    // Only fields the person typed in; a blank password field means "leave as is".
    const updates = Object.fromEntries(
      inputs
        .filter(
          ({ f, input }) =>
            input.value.trim() && input.value !== (f.value || ""),
        )
        .map(({ f, input }) => [f.user_config_key, input.value.trim()]),
    );
    if (!Object.keys(updates).length) return fb.fail("Type a value first.");
    save.disabled = true;
    try {
      await post("/api/connectors/env", { updates });
      inputs.forEach(({ input, f }) => {
        if (f.sensitive) input.value = "";
      });
      inputs.forEach(({ f }) => {
        if (updates[f.user_config_key]) f.is_set = true;
      });
      stateSlot.replaceChildren(connectorState(c));
      fb.ok();
    } catch (e) {
      fb.fail(describeError(e).message);
    } finally {
      save.disabled = false;
    }
  });
  test.addEventListener("click", async () => {
    fb.clear();
    test.disabled = true;
    test.setAttribute("aria-busy", "true");
    try {
      const r = await post(
        "/api/connectors/test",
        { name: c.name },
        { timeoutMs: 60000 },
      );
      stateSlot.replaceChildren(connectorState(c, r.ok));
      r.ok
        ? fb.ok(`Test passed: ${r.tool_count} tools, version ${r.version}`)
        : fb.fail(
            `Test failed: ${r.configured === false ? "no credentials are saved" : r.error || "the server did not respond"}`,
          );
    } catch (e) {
      // A failed handshake comes back as {ok:false,...}; the envelope still carries the reason.
      const d = (e && e.data) || {};
      stateSlot.replaceChildren(connectorState(c, false));
      fb.fail(
        `Test failed: ${d.configured === false ? "no credentials are saved" : d.error || describeError(e).message}`,
      );
    } finally {
      test.disabled = false;
      test.removeAttribute("aria-busy");
    }
  });
  const fields = h(
    "div",
    { class: "connector-fields" },
    inputs.map(({ f, input }) =>
      h(
        "label",
        { class: "field" },
        h("span", { class: "label" }, f.title),
        input,
      ),
    ),
    h("div", { class: "connector-actions" }, save, test),
  );
  const meta = {
    key: c.name,
    title: c.name,
    description: `Credentials for the ${c.name} connector.`,
    section: "connectors",
  };
  return {
    meta,
    node: Row({
      meta,
      control: stateSlot,
      current: c.enabled
        ? "Current: connector enabled"
        : "Current: connector disabled",
      extra: fields,
      feedback: fb,
    }),
  };
}

export async function buildConnectorRows() {
  const res = await get("/api/connectors");
  return (res.connectors || []).map(connectorRow);
}

// --- Plugins and MCP servers (GET /api/ecosystem, POST /api/plugins/toggle, /api/mcp/toggle) ---

function toggleRow({
  key,
  title,
  description,
  enabled,
  disabledReason,
  path,
  body,
}) {
  const fb = makeFeedback();
  const cur = h(
    "span",
    {},
    `Current: ${enabled ? "on" : "off"} (saved) · reload Claude Code to apply`,
  );
  const sw = Switch({
    checked: enabled,
    label: title,
    disabled: !!disabledReason,
  });
  sw.addEventListener("click", async () => {
    const next = sw.getAttribute("aria-checked") === "true";
    fb.clear();
    try {
      await post(path, body(next));
      cur.textContent = `Current: ${next ? "on" : "off"} (saved) · reload Claude Code to apply`;
      fb.ok();
    } catch (e) {
      sw.setAttribute("aria-checked", String(!next));
      const d = (e && e.data) || {};
      fb.fail(d.why || d.error || describeError(e).message);
    }
  });
  const meta = {
    key,
    title,
    description: disabledReason || description,
    section: "plugins",
  };
  return { meta, node: Row({ meta, control: sw, current: cur, feedback: fb }) };
}

export async function buildPluginRows() {
  const res = await get("/api/ecosystem");
  const rows = (res.plugins || [])
    .filter((p) => p.installed)
    .map((p) =>
      toggleRow({
        key: p.key,
        title: `${p.name} ${p.version || ""}`.trim(),
        description: (p.description || "").slice(0, 160),
        enabled: p.enabled,
        path: "/api/plugins/toggle",
        body: (v) => ({ key: p.key, enabled: v }),
      }),
    );
  // The same server name can appear once per plugin source; the toggle is by name, so list each name once.
  const seen = new Map();
  for (const s of (res.mcp || {}).servers || []) {
    const prev = seen.get(s.name);
    if (!prev || (s.enabled && !prev.enabled)) seen.set(s.name, s);
  }
  for (const s of seen.values())
    rows.push(
      toggleRow({
        key: s.name,
        title: `${s.bare_name || s.name} MCP server`,
        description: `From ${s.origin_detail || s.origin}, ${s.transport || "stdio"}.`,
        enabled: s.enabled,
        disabledReason:
          s.plugin_enabled === false
            ? `From ${s.origin_detail}, whose plugin is off.`
            : "",
        path: "/api/mcp/toggle",
        body: (v) => ({ name: s.name, enabled: v }),
      }),
    );
  return rows;
}
