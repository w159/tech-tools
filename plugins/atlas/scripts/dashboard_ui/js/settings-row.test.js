import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installDom, restoreDom } from "./operate-dom-stub.js";

installDom();
const { SettingRow, verifyStatus, clampNumber, liveVsSaved, rowMatches } = await import("./settings-row.js");
restoreDom();

beforeEach(installDom);
afterEach(restoreDom);

const walk = (n, out = []) => { out.push(n); (n.children || []).forEach((c) => walk(c, out)); return out; };
const byId = (root, id) => walk(root).find((n) => n.attrs && n.attrs.id === id);
const byTag = (root, tag) => walk(root).filter((n) => n.tag === tag);
const byClass = (root, cls) => walk(root).filter((n) => n.attrs && (n.attrs.class || "").split(/\s+/).includes(cls));
const fire = (node, ev, arg = {}) => Promise.all((node.listeners[ev] || []).map((f) => f(arg)));
const statusOf = (row, key) => { const s = byId(row, `st-${key}-status`); return { text: s.textContent, kind: s.attrs.class }; };
const OK = { ok: true, layers: [{ layer: "store", ok: true }] };
const mkDeps = (over = {}) => {
  const saves = [];
  return {
    saves,
    save: async (item, value, extra) => { saves.push([item.key, value, extra]); return over.save ? over.save(item, value, extra) : OK; },
    confirm: over.confirm || (async () => true),
    testUrl: over.testUrl,
    api: over.api,
  };
};
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const reject = (data, extra = {}) => Object.assign(new Error(extra.message || "x"), { data, ...extra });

describe("clampNumber", () => {
  test("unparseable or empty input is null", () => {
    for (const raw of ["", null, undefined, "abc", NaN, Infinity, -Infinity, "1e999"]) expect(clampNumber({ min: 0, max: 5 }, raw)).toBeNull();
  });
  test("values are clamped to whichever bounds exist, and passed through otherwise", () => {
    expect(clampNumber({ min: 1, max: 20 }, 0)).toBe(1);
    expect(clampNumber({ min: 1, max: 20 }, 99)).toBe(20);
    expect(clampNumber({ min: 1, max: 20 }, "7")).toBe(7);
    expect(clampNumber({ min: 1 }, -5)).toBe(1);
    expect(clampNumber({ max: 3 }, 10)).toBe(3);
    expect(clampNumber({ min: 0, max: 0 }, 4)).toBe(0);
    expect(clampNumber(undefined, 4.5)).toBe(4.5);
    expect(clampNumber(null, "-2")).toBe(-2);
    expect(clampNumber({}, 0)).toBe(0);
  });
});

describe("verifyStatus", () => {
  test("green only when ok and every layer read back, naming the layers in friendly words", () => {
    expect(verifyStatus({ ok: true, layers: [{ layer: "store", ok: true }, { layer: "live_env", ok: true }, { layer: "claude_settings", ok: true }, { layer: "omp_config", ok: true }, { layer: "shell_rc", ok: true }, { layer: "prefs", ok: true }, { layer: "other", ok: true }] }))
      .toEqual({ ok: true, text: "✓ verified · atlas store, live env, claude settings.json, omp config, ~/.atlas/env.sh, dashboard prefs, other" });
    expect(verifyStatus({ ok: true })).toEqual({ ok: true, text: "✓ verified" });
    expect(verifyStatus({ ok: true, layers: [] })).toEqual({ ok: true, text: "✓ verified" });
  });
  test("a layer that did not read back names the layer and what it holds", () => {
    expect(verifyStatus({ ok: true, layers: [{ layer: "store", ok: true }, { layer: "omp_config", ok: false, got: "off" }, { layer: "shell_rc", ok: false, got: "" }, { layer: "prefs", ok: false }, { layer: "store", ok: false, got: null }] }))
      .toEqual({ ok: false, text: "✗ not saved: omp config has off; ~/.atlas/env.sh has (nothing); dashboard prefs has (nothing); atlas store has (nothing)" });
    expect(verifyStatus({ ok: true, layers: [{ layer: "store", ok: false, got: 0 }] }).text).toBe("✗ not saved: atlas store has 0");
  });
  test("ok false or a missing answer fails with the server's reason, or a default", () => {
    expect(verifyStatus({ ok: false, error: "disk full" })).toEqual({ ok: false, text: "✗ not saved: disk full" });
    expect(verifyStatus({ ok: false, why: "locked" }).text).toBe("✗ not saved: locked");
    expect(verifyStatus({ ok: false, error: "e", why: "w" }).text).toBe("✗ not saved: e");
    expect(verifyStatus({ ok: false })).toEqual({ ok: false, text: "✗ not saved: the server did not confirm" });
    expect(verifyStatus(null).text).toBe("✗ not saved: the server did not confirm");
    expect(verifyStatus(undefined).ok).toBe(false);
    expect(verifyStatus({ ok: false, layers: [{ layer: "store", ok: true }], error: "nope" }).text).toBe("✗ not saved: nope");
  });
  test("an unknown layer id is shown as typed, and a bad layer beats ok true", () => {
    expect(verifyStatus({ ok: true, layers: [{ layer: "weird", ok: false, got: 5 }] }).text).toBe("✗ not saved: weird has 5");
  });
});

describe("liveVsSaved", () => {
  const sup = (value, supported = true) => ({ supported, value });
  test("null when nothing differs or a side is missing", () => {
    expect(liveVsSaved({})).toBeNull();
    expect(liveVsSaved({ layers: { live_env: sup("a"), store: sup("a") } })).toBeNull();
    expect(liveVsSaved({ layers: { live_env: sup(1), store: sup("1") } })).toBeNull();
    expect(liveVsSaved({ layers: { live_env: sup("a") } })).toBeNull();
    expect(liveVsSaved({ layers: { store: sup("a") } })).toBeNull();
    expect(liveVsSaved({ layers: { live_env: sup(null), store: sup("a") } })).toBeNull();
    expect(liveVsSaved({ layers: { live_env: sup("a"), store: sup(null) } })).toBeNull();
  });
  test("unsupported layers are ignored on both sides", () => {
    expect(liveVsSaved({ layers: { live_env: sup("a", false), store: sup("b") } })).toBeNull();
    expect(liveVsSaved({ layers: { live_env: sup("a"), store: sup("b", false) } })).toBeNull();
  });
  test("the first saved layer with a value wins, in store, claude, omp, shell order", () => {
    const layers = { live_env: sup("1"), store: sup(undefined), claude_settings: sup("2"), omp_config: sup("3") };
    expect(liveVsSaved({ kind: "text", layers })).toBe("live: 1 · saved: 2");
    expect(liveVsSaved({ kind: "text", layers: { live_env: sup("1"), shell_rc: sup("9") } })).toBe("live: 1 · saved: 9");
    expect(liveVsSaved({ kind: "text", layers: { live_env: sup("1"), store: sup("5"), claude_settings: sup("2") } })).toBe("live: 1 · saved: 5");
  });
  test("toggles read as on/off (honoring custom words and defaults), other kinds show raw values with (empty)", () => {
    expect(liveVsSaved({ kind: "toggle", on: "1", off: "0", layers: { live_env: sup("1"), store: sup("0") } })).toBe("live: on · saved: off");
    expect(liveVsSaved({ kind: "toggle", layers: { live_env: sup("off"), store: sup("anything") } })).toBe("live: off · saved: on");
    expect(liveVsSaved({ kind: "toggle", default: "on", layers: { live_env: sup(""), store: sup("off") } })).toBe("live: on · saved: off");
    expect(liveVsSaved({ kind: "toggle", default: "off", layers: { live_env: sup(""), store: sup("on") } })).toBe("live: off · saved: on");
    expect(liveVsSaved({ kind: "text", layers: { live_env: sup(""), store: sup("x") } })).toBe("live: (empty) · saved: x");
    expect(liveVsSaved({ kind: "text", layers: { live_env: sup("x"), store: sup("") } })).toBe("live: x · saved: (empty)");
  });
});

describe("rowMatches", () => {
  test("empty query matches everything; otherwise a trimmed, case-insensitive substring", () => {
    expect(rowMatches("abc def", "")).toBe(true);
    expect(rowMatches("abc def", undefined)).toBe(true);
    expect(rowMatches("abc def", "   ")).toBe(true);
    expect(rowMatches("abc def", "  DEF ")).toBe(true);
    expect(rowMatches("abc def", "xyz")).toBe(false);
  });
});

describe("row chrome", () => {
  const base = { key: "K_A", title: "Alpha", description: "Does alpha.", effect: "Alpha gets bigger.", kind: "text", value: "v" };
  test("title, description and effect render; blank ones are left out; the label points at the control", () => {
    const row = SettingRow(base, mkDeps());
    expect(row.tag).toBe("li");
    expect(row.attrs.id).toBe("st-K_A-row");
    const label = byTag(row, "label")[0];
    expect(label.textContent).toBe("Alpha");
    expect(label.attrs.for).toBe("st-K_A");
    expect(byClass(row, "st-desc")[0].textContent).toBe("Does alpha.");
    expect(byClass(row, "st-effect")[0].textContent).toBe("Effect: Alpha gets bigger.");
    const bare = SettingRow({ key: "K_B", kind: "text" }, mkDeps());
    expect(byTag(bare, "label")[0].textContent).toBe("K_B");
    expect(byClass(bare, "st-desc")).toEqual([]);
    expect(byClass(bare, "st-effect")).toEqual([]);
    expect(byClass(bare, "st-badge")).toEqual([]);
    expect(byClass(bare, "st-live")).toEqual([]);
    expect(byClass(bare, "st-files")).toEqual([]);
  });
  test("only a delayed effect gets an applies badge", () => {
    const late = SettingRow({ ...base, applies: "dashboard-restart" }, mkDeps());
    const badge = byClass(late, "st-badge")[0];
    expect(badge.textContent).toBe("restart dashboard");
    expect(badge.attrs["data-applies"]).toBe("dashboard-restart");
    expect(byClass(SettingRow({ ...base, applies: "now" }, mkDeps()), "st-badge")).toEqual([]);
    expect(byClass(SettingRow({ ...base, applies: "anything-else" }, mkDeps()), "st-badge")).toEqual([]);
  });
  test("live vs saved shows only when they differ, and shell knobs list the files they write", () => {
    const layers = { live_env: { supported: true, value: "1" }, store: { supported: true, value: "0" }, omp_config: { supported: true, value: "0" }, shell_rc: { supported: false, value: "0" }, claude_settings: null };
    const row = SettingRow({ ...base, scope: "shell", layers }, mkDeps());
    expect(byClass(row, "st-live")[0].textContent).toBe("live: 1 · saved: 0");
    expect(byClass(row, "st-files")[0].textContent).toBe("Writes: atlas store, omp config");
    const hooks = SettingRow({ ...base, scope: "hooks", layers }, mkDeps());
    expect(byClass(hooks, "st-files")).toEqual([]);
    const none = SettingRow({ ...base, scope: "shell", layers: { live_env: { supported: true, value: "1" } } }, mkDeps());
    expect(byClass(none, "st-files")).toEqual([]);
  });
  test("the row exposes a lowercase search blob of key, title, description and effect", () => {
    const row = SettingRow(base, mkDeps());
    expect(row.search).toBe("k_a alpha does alpha. alpha gets bigger.");
    expect(rowMatches(row.search, "BIGGER")).toBe(true);
    expect(SettingRow({ key: "K_Z", kind: "text" }, mkDeps()).search).toBe("k_z   ");
  });
  test("an item-supplied control is used as is, and the status line starts empty and idle", () => {
    const ctl = document.createElement("span");
    const row = SettingRow({ ...base, control: ctl }, mkDeps());
    expect(walk(row)).toContain(ctl);
    expect(row.clampInput).toBeNull();
    expect(statusOf(row, "K_A")).toEqual({ text: "", kind: "st-status" });
    expect(byId(row, "st-K_A-status").attrs.role).toBe("status");
  });
});

describe("toggle", () => {
  const item = { key: "K_T", title: "Tog", kind: "toggle", on: "on", off: "off", value: "on" };
  const sw = (row) => byId(row, "st-K_T");
  test("paints the saved state, flips and saves the other word, and says what was verified", async () => {
    const deps = mkDeps();
    const row = SettingRow(item, deps);
    expect(sw(row).textContent).toBe("On");
    expect(sw(row).attrs["aria-checked"]).toBe("true");
    expect(sw(row).attrs.class).toBe("pg-switch is-on");
    expect(sw(row).attrs.role).toBe("switch");
    await fire(sw(row), "click");
    expect(deps.saves).toEqual([["K_T", "off", undefined]]);
    expect(sw(row).textContent).toBe("Off");
    expect(sw(row).attrs["aria-checked"]).toBe("false");
    expect(sw(row).attrs.class).toBe("pg-switch");
    expect(statusOf(row, "K_T")).toEqual({ text: "✓ verified · atlas store", kind: "st-status is-ok" });
    await fire(sw(row), "click");
    expect(deps.saves[1]).toEqual(["K_T", "on", undefined]);
    expect(sw(row).textContent).toBe("On");
  });
  test("a refused save leaves the switch where it was and shows the layer that disagreed", async () => {
    const deps = mkDeps({ save: async () => ({ ok: true, layers: [{ layer: "store", ok: false, got: "on" }] }) });
    const row = SettingRow(item, deps);
    await fire(sw(row), "click");
    expect(sw(row).textContent).toBe("On");
    expect(sw(row).attrs["aria-checked"]).toBe("true");
    expect(statusOf(row, "K_T")).toEqual({ text: "✗ not saved: atlas store has on", kind: "st-status is-fail" });
  });
  test("custom on/off words are what is saved, and the stored word decides the paint", async () => {
    const deps = mkDeps();
    const row = SettingRow({ ...item, on: "1", off: "0", value: "1" }, deps);
    expect(sw(row).textContent).toBe("On");
    await fire(sw(row), "click");
    expect(deps.saves[0][1]).toBe("0");
    expect(sw(row).textContent).toBe("Off");
    const off = SettingRow({ ...item, on: "1", off: "0", value: "0" }, mkDeps());
    expect(byId(off, "st-K_T").textContent).toBe("Off");
  });
  test("an unset toggle follows its default: on-by-default reads On, off-by-default reads Off, and clicking saves the opposite", async () => {
    const onDefault = mkDeps();
    const a = SettingRow({ ...item, value: "", default: "on" }, onDefault);
    expect(sw(a).textContent).toBe("On");
    await fire(sw(a), "click");
    expect(onDefault.saves[0][1]).toBe("off");
    const offDefault = mkDeps();
    const b = SettingRow({ ...item, value: undefined, default: "off" }, offDefault);
    expect(sw(b).textContent).toBe("Off");
    await fire(sw(b), "click");
    expect(offDefault.saves[0][1]).toBe("on");
    const noDefault = SettingRow({ ...item, value: undefined, default: undefined }, mkDeps());
    expect(byId(noDefault, "st-K_T").textContent).toBe("Off");
  });
  test("item.value wins over item.default, and matching is case-insensitive", () => {
    expect(byId(SettingRow({ ...item, value: "OFF", default: "on" }, mkDeps()), "st-K_T").textContent).toBe("Off");
    expect(byId(SettingRow({ ...item, value: "On", default: "off" }, mkDeps()), "st-K_T").textContent).toBe("On");
    expect(byId(SettingRow({ ...item, value: "maybe" }, mkDeps()), "st-K_T").textContent).toBe("On");
  });
});

describe("select", () => {
  const item = { key: "K_S", title: "Sel", kind: "select", value: "b", options: ["a", { value: "b", label: "Bee", hint: "the b one" }, { value: "c" }] };
  const sel = (row) => byId(row, "st-K_S");
  test("options render their label (falling back to the value), hint and selected state", () => {
    const row = SettingRow(item, mkDeps());
    const opts = byTag(row, "option");
    expect(opts.map((o) => o.textContent)).toEqual(["a", "Bee", "c"]);
    expect(opts.map((o) => o.value)).toEqual(["a", "b", "c"]);
    expect(opts.map((o) => !!o.selected)).toEqual([false, true, false]);
    expect(opts[1].attrs.title).toBe("the b one");
    expect(opts[0].attrs.title).toBe("");
    expect(sel(row).attrs["aria-label"]).toBe("Sel");
  });
  test("a saved value missing from the options is appended so it still shows", () => {
    const row = SettingRow({ ...item, value: "zzz" }, mkDeps());
    const opts = byTag(row, "option");
    expect(opts.map((o) => o.textContent)).toEqual(["a", "Bee", "c", "zzz"]);
    expect(opts[3].selected).toBe(true);
    const empty = SettingRow({ ...item, value: "" }, mkDeps());
    expect(byTag(empty, "option").length).toBe(3);
    const noOptions = SettingRow({ key: "K_N", kind: "choice", value: "x" }, mkDeps());
    expect(byTag(noOptions, "option").map((o) => o.textContent)).toEqual(["x"]);
  });
  test("changing the choice saves it; a refusal puts the old choice back", async () => {
    const deps = mkDeps();
    const row = SettingRow(item, deps);
    sel(row).value = "c";
    await fire(sel(row), "change");
    expect(deps.saves).toEqual([["K_S", "c", undefined]]);
    expect(statusOf(row, "K_S").kind).toBe("st-status is-ok");
    const bad = mkDeps({ save: async () => ({ ok: false, error: "no" }) });
    const row2 = SettingRow(item, bad);
    sel(row2).value = "a";
    await fire(sel(row2), "change");
    expect(sel(row2).value).toBe("b");
    expect(statusOf(row2, "K_S").text).toBe("✗ not saved: no");
  });
  test("re-picking the saved value sends nothing, and a later pick after a success compares against the new saved value", async () => {
    const deps = mkDeps();
    const row = SettingRow(item, deps);
    sel(row).value = "b";
    await fire(sel(row), "change");
    expect(deps.saves).toEqual([]);
    sel(row).value = "a";
    await fire(sel(row), "change");
    sel(row).value = "a";
    await fire(sel(row), "change");
    expect(deps.saves.length).toBe(1);
  });
});

describe("commit rules", () => {
  const item = { key: "K_S", kind: "select", value: "a", options: ["a", "b", "c"] };
  const sel = (row) => byId(row, "st-K_S");
  test("same value clears a stale failure but leaves a good status alone, and never saves", async () => {
    const results = [{ ok: false, error: "boom" }, OK];
    const deps = mkDeps({ save: async () => results.shift() });
    const row = SettingRow(item, deps);
    sel(row).value = "b";
    await fire(sel(row), "change");
    expect(statusOf(row, "K_S").text).toBe("✗ not saved: boom");
    sel(row).value = "a";
    await fire(sel(row), "change");
    expect(statusOf(row, "K_S")).toEqual({ text: "", kind: "st-status is-idle" });
    sel(row).value = "b";
    await fire(sel(row), "change");
    expect(statusOf(row, "K_S").text).toBe("✓ verified · atlas store");
    sel(row).value = "b";
    await fire(sel(row), "change");
    expect(statusOf(row, "K_S").text).toBe("✓ verified · atlas store");
    expect(deps.saves.length).toBe(2);
  });
  test("shows saving… while the request is out, and a second change meanwhile is refused without a second request", async () => {
    const gate = deferred();
    const deps = mkDeps({ save: () => gate.promise });
    const row = SettingRow(item, deps);
    sel(row).value = "b";
    const first = fire(sel(row), "change");
    expect(statusOf(row, "K_S")).toEqual({ text: "saving…", kind: "st-status is-busy" });
    sel(row).value = "c";
    await fire(sel(row), "change");
    expect(deps.saves.length).toBe(1);
    expect(sel(row).value).toBe("a");
    gate.resolve(OK);
    await first;
    expect(statusOf(row, "K_S").kind).toBe("st-status is-ok");
    sel(row).value = "c";
    await fire(sel(row), "change");
    expect(deps.saves.map((s) => s[1])).toEqual(["b", "c"]);
  });
  test("after a failure the next attempt is allowed (the in-flight guard is released)", async () => {
    const results = [() => { throw reject({}, { message: "down" }); }, () => OK];
    const deps = mkDeps({ save: async () => results.shift()() });
    const row = SettingRow(item, deps);
    sel(row).value = "b";
    await fire(sel(row), "change");
    sel(row).value = "b";
    await fire(sel(row), "change");
    expect(deps.saves.length).toBe(2);
    expect(statusOf(row, "K_S").kind).toBe("st-status is-ok");
  });
  test("a thrown error is explained: unknown model, layer disagreement, message with why, or a default", async () => {
    const cases = [
      [reject({ error: "unknown_model", matches: ["m1", "m2", "m3", "m4"] }), "✗ not saved: no such model (closest: m1, m2, m3)"],
      [reject({ error: "unknown_model", closest: ["c1"] }), "✗ not saved: no such model (closest: c1)"],
      [reject({ error: "unknown_model", matches: [] }), "✗ not saved: no such model"],
      [reject({ error: "unknown_model" }), "✗ not saved: no such model"],
      [reject({ layers: [{ layer: "store", ok: true }, { layer: "omp_config", ok: false, got: "x" }] }), "✗ not saved: omp config has x"],
      [reject({ layers: [{ layer: "store", ok: true }] }, { error: "bad", why: "because" }), "✗ not saved: bad - because"],
      [reject(undefined, { message: "plain", error: undefined }), "✗ not saved: plain"],
      [Object.assign(new Error("m"), { error: "code", why: "w" }), "✗ not saved: code - w"],
      [{ why: "only why" }, "✗ not saved: only why"],
      [{}, "✗ not saved: request failed"],
      [null, "✗ not saved: request failed"],
    ];
    for (const [err, text] of cases) {
      const row = SettingRow(item, mkDeps({ save: async () => { throw err; } }));
      sel(row).value = "b";
      await fire(sel(row), "change");
      expect(statusOf(row, "K_S")).toEqual({ text, kind: "st-status is-fail" });
    }
  });
});

describe("number", () => {
  const item = { key: "K_N", title: "Num", kind: "number", value: "5", range: { min: 1, max: 20, step: 5 } };
  const input = (row) => byId(row, "st-K_N");
  const [dec, inc] = [(row) => byTag(row, "button")[0], (row) => byTag(row, "button")[1]];
  test("the input carries the range as attributes, a default step of 1, and labelled steppers", () => {
    const row = SettingRow(item, mkDeps());
    expect(input(row).attrs).toMatchObject({ type: "number", min: "1", max: "20", step: "5", "aria-label": "Num" });
    expect(input(row).value).toBe("5");
    expect(dec(row).attrs["aria-label"]).toBe("Decrease Num");
    expect(inc(row).attrs["aria-label"]).toBe("Increase Num");
    expect(dec(row).textContent).toBe("−");
    expect(inc(row).textContent).toBe("+");
    expect(row.clampInput).toBe(input(row));
    const plain = SettingRow({ key: "K_P", kind: "number", value: "2", range: { min: 0, max: 9 } }, mkDeps());
    expect(byId(plain, "st-K_P").attrs.step).toBe("1");
    const noRange = SettingRow({ key: "K_Q", kind: "number", value: "2" }, mkDeps());
    expect(byId(noRange, "st-K_Q").attrs.min).toBeUndefined();
  });
  test("the steppers move by the range step, clamp to the range, and save the number", async () => {
    const deps = mkDeps();
    const row = SettingRow(item, deps);
    await fire(inc(row), "click");
    expect(deps.saves.at(-1)).toEqual(["K_N", "10", undefined]);
    expect(input(row).value).toBe("10");
    await fire(inc(row), "click");
    await fire(inc(row), "click");
    expect(deps.saves.at(-1)[1]).toBe("20");
    await fire(inc(row), "click");
    expect(input(row).value).toBe("20");
    expect(deps.saves.length).toBe(3);
    await fire(dec(row), "click");
    expect(deps.saves.at(-1)[1]).toBe("15");
    input(row).value = "3";
    await fire(dec(row), "click");
    expect(deps.saves.at(-1)[1]).toBe("1");
  });
  test("a stepper without a range step moves by one, and starts from the saved value when the field is empty", async () => {
    const deps = mkDeps();
    const row = SettingRow({ key: "K_N", kind: "number", value: "7" }, deps);
    input(row).value = "";
    await fire(inc(row), "click");
    expect(deps.saves[0][1]).toBe("8");
    await fire(dec(row), "click");
    await fire(dec(row), "click");
    expect(deps.saves.map((s) => s[1])).toEqual(["8", "7", "6"]);
    const fresh = mkDeps();
    const empty = SettingRow({ key: "K_E", kind: "number", value: "" }, fresh);
    await fire(byTag(empty, "button")[1], "click");
    expect(fresh.saves[0][1]).toBe("1");
  });
  test("a typed value is trimmed and saved as typed; non-numbers are refused locally and reset", async () => {
    const deps = mkDeps();
    const row = SettingRow(item, deps);
    input(row).value = "  12 ";
    await fire(input(row), "change");
    expect(deps.saves).toEqual([["K_N", "12", undefined]]);
    for (const bad of ["", "   ", "abc", "1x", "NaN"]) {
      input(row).value = bad;
      await fire(input(row), "change");
      expect(statusOf(row, "K_N")).toEqual({ text: "✗ not saved: enter a number", kind: "st-status is-fail" });
      expect(input(row).value).toBe("12");
    }
    expect(deps.saves.length).toBe(1);
  });
  test("a number the server refuses stays in the box with the range explained; other failures reset the box", async () => {
    const out = mkDeps({ save: async () => { throw reject({ error: "out_of_range", range: { min: 1, max: 20 } }); } });
    const row = SettingRow(item, out);
    input(row).value = "99";
    await fire(input(row), "change");
    expect(statusOf(row, "K_N").text).toBe("✗ not saved: 99 is outside 1..20");
    expect(input(row).value).toBe("99");
    const other = mkDeps({ save: async () => ({ ok: false, error: "disk" }) });
    const row2 = SettingRow(item, other);
    input(row2).value = "8";
    await fire(input(row2), "change");
    expect(input(row2).value).toBe("5");
    expect(statusOf(row2, "K_N").text).toBe("✗ not saved: disk");
  });
  test("Enter blurs the field (one save path); other keys do nothing", () => {
    const row = SettingRow(item, mkDeps());
    let blurred = 0;
    let prevented = 0;
    input(row).blur = () => { blurred++; };
    input(row).listeners.keydown.forEach((f) => f({ key: "Enter", preventDefault: () => { prevented++; } }));
    input(row).listeners.keydown.forEach((f) => f({ key: "a", preventDefault: () => { prevented++; } }));
    expect([blurred, prevented]).toEqual([1, 1]);
  });
});

describe("text, url and command", () => {
  const text = { key: "K_X", title: "Txt", kind: "text", value: "old" };
  const field = (row) => byId(row, "st-K_X");
  const saveBtn = (row) => byId(row, "st-K_X-save");
  test("renders an input with the saved value and a Save button; Save sends the edit", async () => {
    const deps = mkDeps();
    const row = SettingRow(text, deps);
    expect(field(row).attrs).toMatchObject({ type: "text", "aria-label": "Txt" });
    expect(field(row).value).toBe("old");
    expect(saveBtn(row).textContent).toBe("Save");
    expect(byId(row, "st-K_X-test")).toBeUndefined();
    field(row).value = "new";
    await fire(saveBtn(row), "click");
    expect(deps.saves).toEqual([["K_X", "new", undefined]]);
    expect(statusOf(row, "K_X").text).toBe("✓ verified · atlas store");
  });
  test("a refused text save puts the saved text back; unchanged text sends nothing", async () => {
    const deps = mkDeps({ save: async () => ({ ok: false, error: "no" }) });
    const row = SettingRow(text, deps);
    field(row).value = "new";
    await fire(field(row), "change");
    expect(field(row).value).toBe("old");
    field(row).value = "old";
    await fire(saveBtn(row), "click");
    expect(deps.saves.length).toBe(1);
  });
  test("Save, change and Enter-blur racing each other send exactly one request", async () => {
    const gate = deferred();
    const deps = mkDeps({ save: () => gate.promise });
    const row = SettingRow(text, deps);
    field(row).value = "new";
    field(row).blur = () => { field(row).listeners.change.forEach((f) => f()); };
    const a = fire(saveBtn(row), "click");
    const b = fire(field(row), "change");
    field(row).listeners.keydown.forEach((f) => f({ key: "Enter", preventDefault() {} }));
    await Promise.resolve();
    expect(deps.saves.length).toBe(1);
    expect(field(row).value).toBe("new"); // the duplicate trigger must not reset what the user typed while the first save is out
    gate.resolve(OK);
    await Promise.all([a, b]);
    expect(deps.saves.length).toBe(1);
    field(row).value = "newer";
    await fire(saveBtn(row), "click");
    expect(deps.saves.length).toBe(2);
  });
  test("a command is confirmed first, naming the key and the command, then saved with confirm:true", async () => {
    const asked = [];
    const deps = mkDeps({ confirm: async (o) => { asked.push(o); return true; } });
    const row = SettingRow({ ...text, kind: "command", value: "" }, deps);
    field(row).value = "rm -rf /tmp/x";
    await fire(saveBtn(row), "click");
    expect(asked).toEqual([{ title: "Save K_X?", body: "This is run as a shell command on every matching prompt:\nrm -rf /tmp/x", danger: true, confirmLabel: "Save command" }]);
    expect(deps.saves).toEqual([["K_X", "rm -rf /tmp/x", { confirm: true }]]);
  });
  test("a second trigger while the command confirm is open does not ask again", async () => {
    const gate = deferred();
    let asked = 0;
    const deps = mkDeps({ confirm: () => { asked++; return gate.promise; } });
    const row = SettingRow({ ...text, kind: "command", value: "" }, deps);
    field(row).value = "ls";
    const a = fire(saveBtn(row), "click");
    const b = fire(field(row), "change");
    await b;
    expect(asked).toBe(1);
    gate.resolve(true);
    await a;
    expect(deps.saves).toEqual([["K_X", "ls", { confirm: true }]]);
  });
  test("declining the command confirm saves nothing and says cancelled; an unchanged command does not ask", async () => {
    const deps = mkDeps({ confirm: async () => false });
    const row = SettingRow({ ...text, kind: "command", value: "ls" }, deps);
    field(row).value = "ls -la";
    await fire(saveBtn(row), "click");
    expect(deps.saves).toEqual([]);
    expect(statusOf(row, "K_X")).toEqual({ text: "✗ not saved: cancelled", kind: "st-status is-fail" });
    field(row).value = "ls";
    let asked = 0;
    const deps2 = mkDeps({ confirm: async () => { asked++; return true; } });
    const row2 = SettingRow({ ...text, kind: "command", value: "ls" }, deps2);
    await fire(byId(row2, "st-K_X-save"), "click");
    expect(asked).toBe(0);
    expect(deps2.saves).toEqual([]);
  });
  test("a non-command kind never asks up front", async () => {
    let asked = 0;
    const deps = mkDeps({ confirm: async () => { asked++; return true; } });
    const row = SettingRow({ ...text, kind: "url" }, deps);
    field(row).value = "http://x";
    await fire(saveBtn(row), "click");
    expect(asked).toBe(0);
    expect(deps.saves[0][2]).toBeUndefined();
  });
  test("a server demand for confirmation (409 or needs_confirm) asks, then retries once with confirm:true", async () => {
    for (const err of [reject({ command: "echo hi" }, { status: 409 }), reject({ error: "needs_confirm" }, { status: 400 })]) {
      const asked = [];
      let first = true;
      const deps = mkDeps({
        confirm: async (o) => { asked.push(o); return true; },
        save: async (_i, _v, extra) => { if (first) { first = false; throw err; } expect(extra).toEqual({ confirm: true }); return OK; },
      });
      const row = SettingRow(text, deps);
      field(row).value = "echo hi";
      await fire(saveBtn(row), "click");
      expect(asked.length).toBe(1);
      expect(asked[0]).toMatchObject({ title: "Save K_X?", danger: true, confirmLabel: "Save command" });
      expect(asked[0].body).toBe(`K_X runs as a shell command: ${err.data.command || "echo hi"}`);
      expect(deps.saves.length).toBe(2);
      expect(statusOf(row, "K_X").text).toBe("✓ verified · atlas store");
      expect(field(row).value).toBe("echo hi");
    }
  });
  test("declining a server-demanded confirmation cancels; a refusal that persists after confirming is shown as an error", async () => {
    const deps = mkDeps({ confirm: async () => false, save: async () => { throw reject({}, { status: 409 }); } });
    const row = SettingRow(text, deps);
    field(row).value = "x";
    await fire(saveBtn(row), "click");
    expect(statusOf(row, "K_X")).toEqual({ text: "✗ not saved: cancelled", kind: "st-status is-fail" });
    expect(field(row).value).toBe("old");
    let asked = 0;
    const again = mkDeps({ confirm: async () => { asked++; return true; }, save: async () => { throw reject({}, { status: 409, message: "still locked" }); } });
    const row2 = SettingRow(text, again);
    byId(row2, "st-K_X").value = "y";
    await fire(byId(row2, "st-K_X-save"), "click");
    expect(asked).toBe(1);
    expect(again.saves.length).toBe(2);
    expect(statusOf(row2, "K_X").text).toBe("✗ not saved: still locked");
  });
  test("other statuses are plain failures and do not ask for confirmation", async () => {
    let asked = 0;
    const deps = mkDeps({ confirm: async () => { asked++; return true; }, save: async () => { throw reject({}, { status: 500, message: "oops" }); } });
    const row = SettingRow(text, deps);
    field(row).value = "x";
    await fire(saveBtn(row), "click");
    expect(asked).toBe(0);
    expect(statusOf(row, "K_X").text).toBe("✗ not saved: oops");
  });
  test("Enter blurs; other keys leave the field alone", () => {
    const row = SettingRow(text, mkDeps());
    let blurred = 0;
    let prevented = 0;
    field(row).blur = () => { blurred++; };
    field(row).listeners.keydown.forEach((f) => f({ key: "Enter", preventDefault: () => { prevented++; } }));
    field(row).listeners.keydown.forEach((f) => f({ key: "Tab", preventDefault: () => { prevented++; } }));
    expect([blurred, prevented]).toEqual([1, 1]);
  });
  test("a url row has a Test button that reports testing… then the result text, or the failure", async () => {
    const gate = deferred();
    const seen = [];
    const deps = mkDeps({ testUrl: (v) => { seen.push(v); return gate.promise; } });
    const row = SettingRow({ ...text, kind: "url", value: "http://a" }, deps);
    const test = byId(row, "st-K_X-test");
    const result = byClass(row, "st-hint")[0];
    expect(test.textContent).toBe("Test");
    field(row).value = "http://typed";
    const p = fire(test, "click");
    expect(result.textContent).toBe("testing…");
    gate.resolve({ ok: true, text: "✓ reachable (3 models)" });
    await p;
    expect(seen).toEqual(["http://typed"]);
    expect(result.textContent).toBe("✓ reachable (3 models)");
    const failing = mkDeps({ testUrl: async () => { throw { error: "refused" }; } });
    const row2 = SettingRow({ ...text, kind: "url" }, failing);
    await fire(byId(row2, "st-K_X-test"), "click");
    expect(byClass(row2, "st-hint")[0].textContent).toBe("✗ refused");
    const silent = mkDeps({ testUrl: async () => { throw null; } });
    const row3 = SettingRow({ ...text, kind: "url" }, silent);
    await fire(byId(row3, "st-K_X-test"), "click");
    expect(byClass(row3, "st-hint")[0].textContent).toBe("✗ unreachable");
  });
});

describe("model", () => {
  test("a model row shows the picker with the saved model, or a prompt to choose", () => {
    const api = { get: async () => ({ models: [] }), post: async () => ({}) };
    const row = SettingRow({ key: "K_M", title: "Mod", kind: "model", value: "nimble:latest", default: "x" }, mkDeps({ api }));
    expect(byClass(row, "mp-trigger")[0].textContent).toBe("nimble:latest");
    const none = SettingRow({ key: "K_M", kind: "model", value: "" }, mkDeps({ api }));
    expect(byClass(none, "mp-trigger")[0].textContent).toBe("Choose a model");
    expect(none.clampInput).toBeNull();
  });
});

describe("value fallbacks", () => {
  test("the row starts from item.value, else item.default, else empty", () => {
    expect(byId(SettingRow({ key: "K_V", kind: "text", value: "v", default: "d" }, mkDeps()), "st-K_V").value).toBe("v");
    expect(byId(SettingRow({ key: "K_V", kind: "text", default: "d" }, mkDeps()), "st-K_V").value).toBe("d");
    expect(byId(SettingRow({ key: "K_V", kind: "text" }, mkDeps()), "st-K_V").value).toBe("");
    expect(byId(SettingRow({ key: "K_V", kind: "text", value: 0 }, mkDeps()), "st-K_V").value).toBe("0");
    expect(byId(SettingRow({ key: "K_V", kind: "text", value: null, default: "d" }, mkDeps()), "st-K_V").value).toBe("d");
  });
});
