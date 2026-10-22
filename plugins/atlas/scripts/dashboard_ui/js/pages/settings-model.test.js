import test from "node:test";
import assert from "node:assert/strict";
import {
  sectionOf,
  flattenBehavior,
  controlFor,
  currentLine,
  liveSentence,
  exportLine,
  optionsFor,
  modelOptions,
  filterEntries,
  countBySection,
  toggleValue,
  isOn,
  resultSentence,
} from "./settings-model.js";

const toggle = {
  key: "ATLAS_TRIPWIRE",
  kind: "toggle",
  on: "on",
  off: "off",
  default: "on",
  editable: true,
};

test("sectionOf maps server group titles and defaults to advanced", () => {
  assert.equal(sectionOf({ group: "Session automation" }), "sessions");
  assert.equal(sectionOf({ group: "Turn scoring" }), "scoring");
  assert.equal(sectionOf({ group: "Storage paths" }), "storage");
  assert.equal(sectionOf({}), "advanced");
});

test("flattenBehavior tags groups and advanced entries", () => {
  const rows = flattenBehavior({
    groups: [{ title: "Guardrails", knobs: [{ key: "A" }] }],
    advanced: [{ key: "B" }],
  });
  assert.deepEqual(
    rows.map((r) => [r.key, r.section]),
    [
      ["A", "guardrails"],
      ["B", "advanced"],
    ],
  );
});

test("controlFor never gives free text to finite kinds", () => {
  assert.equal(controlFor(toggle), "switch");
  assert.equal(controlFor({ kind: "select", editable: true }), "select");
  assert.equal(controlFor({ kind: "number", editable: true }), "number");
  assert.equal(
    controlFor({ kind: "text", key: "ATLAS_HOME", default: "x" }),
    "path",
  );
  assert.equal(
    controlFor({ kind: "text", key: "K", default: "~/.omp/x.yml" }),
    "path",
  );
  assert.equal(controlFor({ kind: "text", key: "K", default: "" }), "text");
  assert.equal(controlFor({ kind: "toggle", editable: false }), "readonly");
});

test("toggle on/off honours an empty on value", () => {
  const gate = { kind: "toggle", on: "", off: "off", default: "" };
  assert.equal(isOn(gate, ""), true);
  assert.equal(isOn(gate, "off"), false);
  assert.equal(toggleValue(gate, true), "");
  assert.equal(toggleValue(toggle, false), "off");
});

test("currentLine states value, source and when it applies", () => {
  const e = {
    ...toggle,
    current: { value: "on", source: "default", applies: "next-session" },
  };
  assert.equal(currentLine(e), "Current: on (default) · new sessions");
  const s = {
    kind: "select",
    options: [{ value: "always", label: "Always" }],
    current: { value: "always", source: "saved", applies: "next-session" },
  };
  assert.equal(currentLine(s), "Current: Always (saved) · new sessions");
  const p = {
    kind: "number",
    current: { value: "7421", source: "shell", applies: "dashboard-restart" },
  };
  assert.equal(currentLine(p), "Current: 7421 (shell env) · restart dashboard");
});

test("liveSentence only appears when the process env differs", () => {
  assert.equal(
    liveSentence({ ...toggle, live: { value: "off", differs: false } }),
    "",
  );
  assert.equal(
    liveSentence({ ...toggle, live: { value: "off", differs: true } }),
    "This dashboard was started with off; saved value wins for new sessions.",
  );
});

test("exportLine and optionsFor", () => {
  assert.equal(exportLine({ key: "K", current: { value: "x" } }), "export K=x");
  const opts = optionsFor({
    options: [{ value: "a" }],
    current: { value: "zz" },
  });
  assert.deepEqual(
    opts.map((o) => o.value),
    ["zz", "a"],
  );
});

test("search filters by key, title and description; counts follow", () => {
  const rows = [
    {
      key: "ATLAS_GATE",
      title: "Completion gate",
      description: "Blocks done",
      section: "guardrails",
    },
    {
      key: "ATLAS_MODE",
      title: "Run mode",
      description: "relaxes the completion gate",
      section: "advanced",
    },
    {
      key: "ATLAS_DB",
      title: "Database",
      description: "sqlite",
      section: "storage",
    },
  ];
  assert.equal(filterEntries(rows, "gate").length, 2);
  assert.equal(filterEntries(rows, "").length, 3);
  assert.deepEqual(countBySection(filterEntries(rows, "gate")), {
    guardrails: 1,
    advanced: 1,
  });
  assert.equal(filterEntries(rows, "zzz").length, 0);
});

test("resultSentence covers the server error shapes", () => {
  assert.equal(
    resultSentence({
      ok: true,
      results: [{ ok: true, layers: [{ ok: true }] }],
    }).text,
    "Saved",
  );
  assert.equal(
    resultSentence({ error: "out_of_range", range: { min: 1, max: 50 } }).text,
    "Must be between 1 and 50",
  );
  assert.equal(
    resultSentence({ error: "bad_option", options: ["off", "trigger"] }).text,
    "Choose one of: off, trigger",
  );
  const c = resultSentence({ error: "needs_confirm", command: "echo hi" });
  assert.equal(c.confirm, "echo hi");
  assert.match(
    resultSentence({ error: "unknown_model", value: "x", matches: ["a", "b"] })
      .text,
    /Closest: a, b/,
  );
  assert.match(
    resultSentence({ error: "unknown_model", value: "x", matches: [] }).text,
    /No close matches/,
  );
  const layer = resultSentence({
    ok: false,
    results: [
      {
        ok: false,
        layers: [
          { layer: "claude_settings", wrote: "off", got: "on", ok: false },
        ],
      },
    ],
  });
  assert.equal(layer.tone, "fail");
  assert.match(layer.text, /claude settings: wrote "off", read back "on"/);
  assert.equal(
    resultSentence({
      error: "network",
      why: "the dashboard daemon is not reachable",
    }).text,
    "network: the dashboard daemon is not reachable",
  );
});

test("modelOptions labels by size or cloud and appends an unknown current value", () => {
  const opts = modelOptions([{ name: "a:1", params: "7B" }, { name: "b:cloud", cloud: true }], "jev-latest");
  assert.deepEqual(opts.map((o) => o.label), ["a:1 · 7B", "b:cloud · cloud", "jev-latest"]);
  assert.equal(modelOptions([{ name: "a:1" }], "a:1").length, 1);
});
