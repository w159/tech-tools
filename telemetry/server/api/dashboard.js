// @ts-check
import { randomBytes } from "node:crypto";

/**
 * GET -> the Atlas telemetry dashboard: one self-contained HTML page. It never embeds a secret; the
 * operator types the dashboard token in the browser and the page calls /api/admin with it. All data
 * is rendered with textContent because keys come from clients.
 */

const STYLE = String.raw`
:root {
  --base: #11111b; --panel: #181825; --raised: #1e1e2e; --line: #313244;
  --text: #d0d0d0; --sub: #a6adc8; --muted: #8a8a8a;
  --accent: #af87ff; --ok: #87d787; --warn: #d7af5f; --bad: #ff5f5f;
  --s1: 8px; --s2: 16px; --s3: 24px; --s4: 32px; --s5: 48px;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root {
    --base: #eff1f5; --panel: #e6e9ef; --raised: #ffffff; --line: #ccd0da;
    --text: #4c4f69; --sub: #5c5f77; --muted: #6c6f85;
    --accent: #8534ee; --ok: #40a02b; --warn: #df8e1d; --bad: #d20f39;
    color-scheme: light;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--base); color: var(--text); font: 14px/1.5 var(--sans); -webkit-text-size-adjust: 100%; overflow-x: hidden; }
.num, .mono, code { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.wrap { max-width: 1120px; margin: 0 auto; padding: var(--s3) var(--s2) var(--s5); }
h1, h2, h3, p { margin: 0; }
h2 { font-size: 13px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--sub); margin: var(--s4) 0 var(--s2); }
h3 { font-size: 14px; font-weight: 600; text-transform: capitalize; }
button, select, input { font: inherit; color: inherit; }
button { background: var(--raised); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; cursor: pointer; min-height: 32px; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--base); font-weight: 600; }
button.link { background: none; border: 0; color: var(--accent); padding: 4px 0; min-height: 0; }
select, input[type=password] { background: var(--raised); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; min-height: 32px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: var(--s2); min-width: 0; }
.head { display: flex; flex-wrap: wrap; gap: var(--s2); align-items: flex-start; justify-content: space-between; }
.brand { display: flex; align-items: center; gap: var(--s1); color: var(--accent); font-weight: 700; letter-spacing: .24em; font-size: 20px; }
.sub { color: var(--sub); }
.muted { color: var(--muted); font-size: 12px; }
.tools { display: flex; flex-wrap: wrap; gap: var(--s1); align-items: center; }
.tools label { display: inline-flex; gap: 6px; align-items: center; color: var(--sub); }
.kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s2); margin-top: var(--s3); }
.kpi .v { font-size: 28px; line-height: 1.2; font-weight: 600; }
.kpi .l { color: var(--sub); font-size: 12px; }
.kpi.warn { border-color: var(--warn); }
.kpi .note { color: var(--warn); font-size: 12px; margin-top: 4px; }
.grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s2); }
.chart svg { display: block; width: 100%; height: auto; }
.chart .legend { display: flex; flex-wrap: wrap; gap: var(--s2); margin-bottom: var(--s1); color: var(--sub); font-size: 12px; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; background: var(--accent); }
.dot.line { background: var(--ok); border-radius: 5px; }
.brow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px var(--s1); margin-top: var(--s1); }
.brow .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-size: 12px; }
.brow .val { text-align: right; font-size: 12px; color: var(--sub); }
.brow .track { grid-column: 1 / -1; height: 6px; background: var(--raised); border-radius: 3px; overflow: hidden; }
.brow .fill { height: 100%; background: var(--accent); border-radius: 3px; width: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: var(--s1); }
.chip { font-family: var(--mono); font-size: 12px; background: var(--raised); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tablewrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 8px; border-bottom: 1px solid var(--line); text-align: left; }
th { color: var(--sub); font-weight: 500; font-size: 12px; }
th.r, td.r { text-align: right; }
td.key { font-family: var(--mono); font-size: 12px; word-break: break-all; }
.bad { color: var(--bad); }
.ok { color: var(--ok); }
details { border-bottom: 1px solid var(--line); padding: var(--s1) 0; }
details:last-child { border-bottom: 0; }
summary { cursor: pointer; display: flex; flex-wrap: wrap; gap: var(--s1) var(--s2); align-items: baseline; }
summary .w { font-family: var(--mono); font-weight: 600; }
.tag { font-size: 11px; color: var(--warn); border: 1px solid var(--warn); border-radius: 999px; padding: 0 8px; }
.gate { max-width: 440px; margin: 12vh auto 0; }
.gate form { display: grid; gap: var(--s2); margin-top: var(--s2); }
.gate input { width: 100%; }
.msg { text-align: center; padding: var(--s4) var(--s2); }
.msg p + p, .msg p + button { margin-top: var(--s1); }
.err { color: var(--bad); }
.foot { margin-top: var(--s4); color: var(--muted); font-size: 12px; }
.foot li { margin-top: 4px; }
.skel { height: 88px; border-radius: 12px; background: linear-gradient(90deg, var(--panel) 25%, var(--raised) 50%, var(--panel) 75%); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
.skel.tall { height: 240px; margin-top: var(--s2); }
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .skel { animation: none; } }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.axis { fill: var(--muted); font: 10px var(--mono); }
.gridline { stroke: var(--line); stroke-width: 1; }
@media (min-width: 640px) {
  .kpis { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
`;

const SCRIPT = String.raw`
(function () {
  "use strict";
  var KEY = "atlas-tel-token";
  var FAMILIES = ["skill", "command", "agent", "hook", "mod"];
  var NS = "http://www.w3.org/2000/svg";
  var app = document.getElementById("app");
  var state = { token: "", weeks: 10, test: false, data: null, raw: "", open: {}, gateMsg: "" };

  function load() { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function save(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* no storage */ } }

  function el(tag, cls, text, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function svg(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, String(attrs[k])); });
    if (text !== undefined) n.textContent = String(text);
    return n;
  }
  function fmt(n) { return typeof n === "number" ? n.toLocaleString() : String(n == null ? "" : n); }
  function btn(label, onClick, cls) {
    var b = el("button", cls || "", label, { type: "button" });
    b.addEventListener("click", onClick);
    return b;
  }
  function clear() { while (app.firstChild) app.removeChild(app.firstChild); }

  function showGate(msg) {
    clear();
    var card = el("div", "card gate");
    add(card, el("div", "brand", "\u25C6 ATLAS"));
    add(card, el("p", "sub", "Enter the dashboard secret to view anonymous usage telemetry."));
    var form = el("form");
    var lab = el("label", "sr", "Dashboard secret", { for: "secret" });
    var input = el("input", "", null, { id: "secret", type: "password", autocomplete: "off", placeholder: "Dashboard secret", "aria-label": "Dashboard secret" });
    var go = el("button", "primary", "View dashboard", { type: "submit" });
    add(form, lab, input);
    if (msg) add(form, el("p", "err", msg, { role: "alert" }));
    add(form, go);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = input.value.trim();
      if (!v) return;
      state.token = v;
      save(v);
      fetchData();
    });
    add(card, form);
    add(card, el("p", "muted", "The secret is the ATLAS_DASHBOARD_TOKEN value in Vercel, project atlas-telemetry, Settings, Environment Variables."));
    add(app, card);
    input.focus();
  }

  function forget() { state.token = ""; save(""); state.data = null; showGate(""); }

  function showLoading() {
    clear();
    var w = el("div", "", null, { "aria-busy": "true", "aria-label": "Loading" });
    add(w, el("div", "skel"));
    add(w, el("div", "skel tall"));
    add(w, el("div", "skel tall"));
    add(app, w);
  }

  function showMessage(title, body, withRetry, isErr) {
    clear();
    var c = el("div", "card msg", null, { role: isErr ? "alert" : "status" });
    add(c, el("h3", isErr ? "err" : "", title));
    if (body) add(c, el("p", "sub", body));
    var row = el("div", "tools", null);
    row.style.justifyContent = "center";
    row.style.marginTop = "16px";
    if (withRetry) add(row, btn("Retry", fetchData, "primary"));
    add(row, btn("Forget secret", forget));
    add(c, row);
    add(app, c);
  }

  function fetchData() {
    showLoading();
    var url = "/api/admin?weeks=" + state.weeks + (state.test ? "&include_test=1" : "");
    fetch(url, { headers: { Authorization: "Bearer " + state.token }, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) { showGate("That secret was not accepted."); return null; }
        if (r.status === 503) { showMessage("Not configured", "The dashboard secret is not set on the server.", true, true); return null; }
        if (!r.ok) throw new Error("Server answered " + r.status + ".");
        return r.text();
      })
      .then(function (txt) {
        if (txt === null || txt === undefined) return;
        state.raw = txt;
        state.data = JSON.parse(txt);
        render();
      })
      .catch(function (e) {
        showMessage("Could not load the summary", (e && e.message) || "Network error.", true, true);
      });
  }

  function localTime(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
  }

  function download() {
    var d = state.data;
    var blob = new Blob([state.raw], { type: "application/json" });
    var u = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = u;
    a.download = "atlas-telemetry-" + (d && d.window ? d.window.to : "summary") + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
  }

  function copyJson(button) {
    var done = function (ok) {
      var old = button.textContent;
      button.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(function () { button.textContent = old; }, 1500);
    };
    var fallback = function () {
      var ta = el("textarea", "sr", null, { "aria-hidden": "true" });
      ta.value = state.raw;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(state.raw).then(function () { done(true); }, fallback);
    } else fallback();
  }

  function kpi(label, value, note, warn) {
    var c = el("div", "card kpi" + (warn ? " warn" : ""));
    add(c, el("div", "v num", value), el("div", "l", label));
    if (note) add(c, el("div", "note", note));
    return c;
  }

  function barList(items, max, expanded) {
    var box = el("div");
    var shown = expanded ? items : items.slice(0, 12);
    var top = 0;
    shown.forEach(function (it) { if (it.installs > top) top = it.installs; });
    top = Math.max(top, max || 0, 1);
    shown.forEach(function (it) {
      var row = el("div", "brow");
      add(row, el("span", "name", it.name !== undefined ? it.name : it.key, { title: it.name !== undefined ? it.name : it.key }));
      add(row, el("span", "val num", fmt(it.installs) + " / " + fmt(it.total)));
      var track = el("div", "track");
      var fill = el("div", "fill");
      fill.style.width = Math.max(2, Math.round((it.installs / top) * 100)) + "%";
      add(track, fill);
      add(row, track);
      add(box, row);
    });
    return box;
  }

  function tally(title, obj) {
    var c = el("div", "card");
    add(c, el("h3", "", title.replace("_", " ")));
    var items = Object.keys(obj || {}).map(function (k) { return { name: k, installs: obj[k], total: obj[k] }; })
      .sort(function (a, b) { return b.installs - a.installs; }).slice(0, 8);
    if (!items.length) { add(c, el("p", "muted", "None")); return c; }
    var top = items[0].installs || 1;
    var box = el("div");
    items.forEach(function (it) {
      var row = el("div", "brow");
      add(row, el("span", "name", it.name, { title: it.name }));
      add(row, el("span", "val num", fmt(it.installs)));
      var track = el("div", "track");
      var fill = el("div", "fill");
      fill.style.width = Math.max(2, Math.round((it.installs / top) * 100)) + "%";
      add(track, fill);
      add(row, track);
      add(box, row);
    });
    add(c, box);
    return c;
  }

  function trend(weeks) {
    var c = el("div", "card chart");
    var legend = el("div", "legend");
    var l1 = el("span"); add(l1, el("span", "dot"), document.createTextNode("Install-weeks (bars)"));
    var l2 = el("span"); add(l2, el("span", "dot line"), document.createTextNode("Sessions (line)"));
    add(legend, l1, l2);
    add(c, legend);
    var W = 720, H = 240, L = 36, R = 36, T = 20, B = 36;
    var n = weeks.length;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Weekly install-weeks and sessions" });
    var defs = svg("defs");
    var pat = svg("pattern", { id: "hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    add(pat, svg("rect", { width: 6, height: 6, fill: "var(--raised)" }), svg("rect", { width: 3, height: 6, fill: "var(--accent)" }));
    add(defs, pat);
    add(s, defs);
    var maxS = 1, maxQ = 1;
    weeks.forEach(function (w) { if (w.submissions > maxS) maxS = w.submissions; if (w.sessions > maxQ) maxQ = w.sessions; });
    var pw = W - L - R, ph = H - T - B;
    [0, 0.5, 1].forEach(function (f) {
      var y = T + ph - ph * f;
      add(s, svg("line", { x1: L, x2: W - R, y1: y, y2: y, class: "gridline" }));
    });
    add(s, svg("text", { x: L - 6, y: T + 4, class: "axis", "text-anchor": "end" }, fmt(maxS)));
    add(s, svg("text", { x: L - 6, y: T + ph + 4, class: "axis", "text-anchor": "end" }, "0"));
    add(s, svg("text", { x: W - R + 6, y: T + 4, class: "axis" }, fmt(maxQ)));
    var slot = pw / Math.max(n, 1);
    var bw = Math.max(4, Math.min(48, slot * 0.6));
    var every = Math.ceil(n / 12);
    var pts = [];
    weeks.forEach(function (w, i) {
      var cx = L + slot * i + slot / 2;
      var h = Math.max(w.submissions ? 2 : 0, (w.submissions / maxS) * ph);
      var bar = svg("rect", {
        x: cx - bw / 2, y: T + ph - h, width: bw, height: h, rx: 4, ry: 4,
        fill: w.partial ? "url(#hatch)" : "var(--accent)", stroke: "var(--accent)", "stroke-width": w.partial ? 1 : 0,
      });
      add(bar, svg("title", {}, w.week + ": " + w.submissions + " install-weeks, " + w.sessions + " sessions" + (w.partial ? " (week so far)" : "")));
      add(s, bar);
      if (w.partial) add(s, svg("text", { x: cx, y: Math.max(T - 6, T + ph - h - 4), class: "axis", "text-anchor": "middle" }, "so far"));
      if (i % every === 0 || i === n - 1) {
        add(s, svg("text", { x: cx, y: H - 14, class: "axis", "text-anchor": "middle" }, String(w.week).replace(/^\d{4}-/, "")));
      }
      pts.push([cx, T + ph - (w.sessions / maxQ) * ph, w]);
    });
    if (pts.length) {
      add(s, svg("polyline", { points: pts.map(function (p) { return p[0] + "," + p[1]; }).join(" "), fill: "none", stroke: "var(--ok)", "stroke-width": 2, "stroke-linejoin": "round" }));
      pts.forEach(function (p) {
        var d = svg("circle", { cx: p[0], cy: p[1], r: 3.5, fill: "var(--ok)" });
        add(d, svg("title", {}, p[2].week + ": " + p[2].sessions + " sessions"));
        add(s, d);
      });
    }
    add(c, s);
    return c;
  }

  function render() {
    var d = state.data;
    clear();
    var head = el("div", "head");
    var left = el("div");
    var brand = el("div", "brand", "\u25C6 ATLAS");
    add(left, brand, el("div", "sub", "Anonymous usage telemetry"));
    add(left, el("div", "muted num", d.window.from + " to " + d.window.to + " \u00B7 generated " + localTime(d.generated_at)));
    var tools = el("div", "tools");
    var sel = el("select", "", null, { "aria-label": "Week window" });
    [4, 10, 26].forEach(function (n) {
      var o = el("option", "", n + " weeks", { value: String(n) });
      if (n === state.weeks) o.selected = true;
      add(sel, o);
    });
    sel.addEventListener("change", function () { state.weeks = parseInt(sel.value, 10); fetchData(); });
    var lab = el("label");
    var cb = el("input", "", null, { type: "checkbox" });
    cb.checked = state.test;
    cb.addEventListener("change", function () { state.test = cb.checked; fetchData(); });
    add(lab, cb, document.createTextNode("Include test submissions"));
    var copy = el("button", "", "Copy JSON for Claude", { type: "button" });
    copy.addEventListener("click", function () { copyJson(copy); });
    add(tools, sel, lab, btn("Refresh", fetchData), btn("Download JSON", download), copy, btn("Forget secret", forget));
    add(head, left, tools);
    add(app, head);

    var t = d.totals;
    if (!t.submissions) {
      var e = el("div", "card msg", null, { role: "status" });
      add(e, el("h3", "", "No submissions in this window yet."));
      add(e, el("p", "sub", "Installs send a week-to-date snapshot about once an hour while Atlas runs."));
      add(app, e);
      return;
    }

    var k = el("div", "kpis");
    add(k, kpi("Install-weeks", fmt(t.submissions)));
    add(k, kpi("Sessions", fmt(t.sessions)));
    add(k, kpi("Keys seen / allowlist", fmt(t.distinct_keys_seen) + " / " + fmt(t.allowlist_keys)));
    add(k, kpi("Test submissions", fmt(t.test_submissions)));
    add(k, kpi("Dropped keys", fmt(t.dropped_keys),
      t.dropped_keys > 0 ? "Clients send keys this server does not know: redeploy the server." : "", t.dropped_keys > 0));
    add(app, k);

    add(app, el("h2", "", "Trend"));
    add(app, trend(d.weeks || []));

    add(app, el("h2", "", "Top features"));
    var fg = el("div", "grid two");
    FAMILIES.forEach(function (f) {
      var items = (d.features && d.features[f]) || [];
      var c = el("div", "card");
      add(c, el("h3", "", f + " (" + items.length + ")"));
      if (!items.length) { add(c, el("p", "muted", "Nothing reported.")); add(fg, c); return; }
      var holder = el("div");
      var draw = function () {
        while (holder.firstChild) holder.removeChild(holder.firstChild);
        add(holder, barList(items, 0, !!state.open[f]));
        if (items.length > 12) {
          add(holder, btn(state.open[f] ? "Show top 12" : "Show all " + items.length, function () { state.open[f] = !state.open[f]; draw(); }, "link"));
        }
      };
      draw();
      add(c, holder);
      add(fg, c);
    });
    add(app, fg);

    add(app, el("h2", "", "Never used"));
    var uc = el("div", "card");
    add(uc, el("p", "sub", "Shipped but nobody in this window reported it. Fix discovery, merge or retire."));
    var any = false;
    FAMILIES.concat(Object.keys(d.unused || {}).filter(function (f) { return FAMILIES.indexOf(f) < 0; })).forEach(function (f) {
      var names = (d.unused && d.unused[f]) || [];
      if (!names.length) return;
      any = true;
      add(uc, el("h3", "", f + " (" + names.length + ")"));
      var chips = el("div", "chips");
      names.forEach(function (nm) { add(chips, el("span", "chip", nm, { title: nm })); });
      add(uc, chips);
    });
    if (!any) add(uc, el("p", "ok", "Everything shipped was used."));
    add(app, uc);

    add(app, el("h2", "", "Failures"));
    var fc = el("div", "card");
    var fl = d.failures || [];
    if (!fl.length) add(fc, el("p", "ok", "No faults, slow hooks, blocks or failed runs reported."));
    else {
      var tw = el("div", "tablewrap");
      var tb = el("table");
      var th = el("thead"), hr = el("tr");
      add(hr, el("th", "", "Key"), el("th", "r", "Installs"), el("th", "r", "Total"));
      add(th, hr); add(tb, th);
      var body = el("tbody");
      fl.forEach(function (f) {
        var tr = el("tr");
        add(tr, el("td", "key", f.key), el("td", "r num", fmt(f.installs)), el("td", "r num" + (f.total > 0 ? " bad" : ""), fmt(f.total)));
        add(body, tr);
      });
      add(tb, body); add(tw, tb); add(fc, tw);
    }
    add(app, fc);

    add(app, el("h2", "", "Versions"));
    var vg = el("div", "grid four");
    var v = d.versions || {};
    ["atlas_version", "os", "python", "harness"].forEach(function (name) { add(vg, tally(name, v[name])); });
    add(app, vg);

    add(app, el("h2", "", "Per week"));
    var pc = el("div", "card");
    (d.weeks || []).slice().reverse().forEach(function (w) {
      var det = el("details");
      var sm = el("summary");
      add(sm, el("span", "w", w.week));
      if (w.partial) add(sm, el("span", "tag", "so far"));
      add(sm, el("span", "sub num", fmt(w.submissions) + " install-weeks"));
      add(sm, el("span", "sub num", fmt(w.sessions) + " sessions"));
      add(sm, el("span", "muted num", "avg active days " + (w.active_days_avg == null ? "n/a" : w.active_days_avg)));
      add(det, sm);
      var top = w.top || [];
      if (top.length) add(det, barList(top.map(function (x) { return { name: x.key, installs: x.installs, total: x.total }; }), 0, true));
      else add(det, el("p", "muted", "No keys reported."));
      add(pc, det);
    });
    add(app, pc);

    var foot = el("ul", "foot");
    (d.reading_guide || []).forEach(function (line) { add(foot, el("li", "", line)); });
    add(app, foot);
  }

  state.token = load();
  if (state.token) fetchData(); else showGate("");
})();
`;

/**
 * @param {Request} request
 * @param {Record<string, unknown>} [_ctx]
 */
export async function handle(request, _ctx = {}) {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json", "cache-control": "no-store", allow: "GET" },
    });
  }
  const nonce = randomBytes(16).toString("base64");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Atlas telemetry</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<main class="wrap" id="app" aria-live="polite"></main>
<noscript><p class="wrap">This dashboard needs JavaScript. It reads /api/admin.</p></noscript>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>
`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}'`,
        "connect-src 'self'",
        "img-src data:",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join("; "),
    },
  });
}

/** @type {{fetch(request: Request): Promise<Response>}} */
export default { fetch: (request) => handle(request) };
