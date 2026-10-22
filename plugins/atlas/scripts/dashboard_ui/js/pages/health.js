// Health: subsystems with evidence, silent failures, successes, plus the doctor ledger
// (findings, loop stages, lessons, nudges) that the old Improve page held.
import { h, relTime, num, truncate } from "../dom.js";
import { get, post, topics, describeError } from "../api.js";
import { PageHeader, Button, toast } from "../ui.js";
import { esc, gate } from "../html.js";
import { bindRegion } from "../region.js";
import { normalizeWindow, projectParam, projectLabel } from "./monitor-model.js";
import { WindowControl } from "./monitor-view.js";
import {
  healthState,
  hasHistory,
  successLabel,
  failureLabel,
  sortSubsystems,
  findingTone,
  remeasurable,
  remeasureSentence,
  batchSummary,
  countLine,
} from "./health-model.js";

const REFRESH_DEBOUNCE_MS = 400;

function sparkSvg(buckets, width = 80, height = 20) {
  const vals = buckets.map((b) => (typeof b === "number" ? { ok: b, fail: 0 } : b));
  const max = Math.max(1, ...vals.map((v) => (v.ok || 0) + (v.fail || 0)));
  const gap = 2;
  const bw = Math.max(1, (width - gap * (vals.length - 1)) / Math.max(1, vals.length));
  const bars = vals
    .map((v, i) => {
      const total = (v.ok || 0) + (v.fail || 0);
      const bh = total ? Math.max(2, (total / max) * height) : 1;
      return `<rect x="${i * (bw + gap)}" y="${height - bh}" width="${bw}" height="${bh}"${v.fail ? ' class="bad"' : ""}/>`;
    })
    .join("");
  return `<svg class="spark" width="${width}" height="${height}" role="img" aria-label="History">${bars}</svg>`;
}

/** A native details element whose open state survives re-renders via the page-owned `open` Set. */
function disclosure(open, key, summary, body) {
  return (
    `<details class="disclosure" data-key="${esc(key)}"${open.has(key) ? " open" : ""}>` +
    `<summary>${summary}</summary><div class="disclosure-body">${body}</div></details>`
  );
}

function subsystemRow(open, sub) {
  const st = healthState(sub);
  const measured = sub.measured !== false;
  const detail = measured
    ? truncate(sub.detail || "", 160)
    : `Not measured: ${sub.reason || sub.detail || "no data source yet"}`;
  const times = measured
    ? `last ok ${sub.last_ok ? `${relTime(sub.last_ok)} ago` : "never"}${sub.last_fail ? ` - last fail ${relTime(sub.last_fail)} ago` : ""}`
    : "";
  const trend = !measured
    ? ""
    : hasHistory(sub)
      ? sparkSvg(sub.history)
      : `<span class="meta" title="${esc(sub.history_reason || "")}">No history</span>`;
  const head =
    `<span class="sub-head"><span class="sub-state mono st-${esc(st.raw)}">${esc(st.word)}</span>` +
    `<strong>${esc(sub.label || sub.id)}</strong><span class="sub-detail">${esc(detail)}</span>` +
    `<span class="mono sub-times">${esc(times)}</span>${trend}</span>`;
  const lines = (sub.evidence || []).length
    ? sub.evidence.map((e) => `<p class="mono wrap">${esc(e)}</p>`)
    : ['<p class="meta">No evidence lines.</p>'];
  if (sub.history_source) lines.push(`<p class="meta">History: ${esc(sub.history_source)}</p>`);
  else if (measured && sub.history_reason)
    lines.push(`<p class="meta">No history: ${esc(sub.history_reason)}</p>`);
  return `<li class="sub-row" id="sub-${esc(sub.id)}">${disclosure(open, sub.id, head, lines.join(""))}</li>`;
}

/** Subsystems, the main region of the page, as an HTML string (pure; unit-tested). */
export function renderSubsystemsRegion({ data = null, loaded = false, error = null, open = new Set() }) {
  const subs = (data && data.subsystems) || [];
  const gated = gate({ loaded, error, count: subs.length }, "subsystems");
  if (gated) return gated;
  return `<ul class="sub-list">${sortSubsystems(subs).map((s) => subsystemRow(open, s)).join("")}</ul>`;
}

function failuresBlock(open, rows) {
  if (!rows.length) return '<p class="meta">No silent failures in this window.</p>';
  const line = (r) => {
    const body =
      `<p class="mono wrap">${esc(r.sample || "")}</p>` +
      (r.hint ? `<p class="meta">${esc(r.hint)}</p>` : "") +
      (r.next ? `<p class="meta">${esc(r.next)}</p>` : "");
    const head =
      `<span class="fail-head"><span>${esc(failureLabel(r.kind))}</span>` +
      `<span class="mono">${esc(projectLabel(r.project))}</span>` +
      `<span class="mono num">${esc(num(r.count))}</span>` +
      `<span class="mono">${esc(relTime(r.last))} ago</span></span>`;
    return `<li>${disclosure(open, r.id || r.kind + r.project, head, body)}</li>`;
  };
  return `<ul class="rule-list">${rows.map(line).join("")}</ul>`;
}

function successesBlock(rows) {
  if (!rows.length) return '<p class="meta">Nothing succeeded in this window.</p>';
  return (
    '<ul class="rule-list">' +
    rows
      .map(
        (s) =>
          `<li><strong class="mono num">${esc(num(s.count))}</strong> ${esc(successLabel(s.kind))}` +
          `<span class="meta mono">, last ${esc(relTime(s.last))} ago</span></li>`,
      )
      .join("") +
    "</ul>"
  );
}

/** Silent failures and successes from /api/v2/health, as one HTML string (pure). */
export function renderSignalsRegion({ data = null, loaded = false, error = null, open = new Set() }) {
  if (!loaded) return gate({ loaded }, "failures");
  if (error && !data) return gate({ loaded, error, count: 0 }, "failures");
  const d = data || {};
  return (
    '<h2 class="hd">Silent failures</h2>' +
    failuresBlock(open, d.silent_failures || []) +
    '<h2 class="hd">Successes</h2>' +
    successesBlock(d.successes || [])
  );
}

function findingRow(open, f) {
  const lines = [
    f.evidence ? `<p class="mono wrap">${esc(f.evidence)}</p>` : "",
    f.proposed_action ? `<p><span class="meta">Proposed: </span>${esc(f.proposed_action)}</p>` : "",
    f.verdict ? `<p class="meta">Verdict: ${esc(f.verdict)}${f.trend ? `, ${esc(f.trend)}` : ""}</p>` : "",
    f.source === "doctor" && /^doctor:\d+$/.test(f.id)
      ? `<button type="button" class="btn btn-sm" data-action="remeasure-one" data-id="${esc(f.id)}">Re-measure</button>`
      : "",
  ].join("");
  const head =
    `<span class="finding-head"><span class="mono st-${esc(findingTone(f.status))}">${esc(f.status)}</span>` +
    `<span>${esc(truncate(f.title, 100))}</span>` +
    `<span class="mono">${esc(projectLabel(f.project))}</span>` +
    `<span class="mono">${esc(relTime(f.last || f.first))}</span></span>`;
  return `<li>${disclosure(open, f.id, head, lines)}</li>`;
}

/** Findings ledger (doctor), loop stages, lessons and nudges, as an HTML string (pure; unit-tested). */
export function renderFindingsRegion({ data = null, loaded = false, error = null, open = new Set() }) {
  const findings = (data && data.findings) || [];
  const gated = gate({ loaded, error, count: findings.length }, "findings");
  if (gated) return gated;
  const stages = (data.loop && data.loop.stages) || [];
  const lessons = data.lessons || [];
  const n = data.nudges;
  return (
    `<h2 class="hd">Findings <span class="mono">${esc(countLine(data.counts))}</span></h2>` +
    `<ul class="rule-list">${findings.map((f) => findingRow(open, f)).join("")}</ul>` +
    '<h2 class="hd">Loop stages</h2>' +
    `<ol class="stage-list">${stages.map((s) => `<li><strong>${esc(s.label)}</strong> <span class="meta mono">${esc(num(s.count))} - ${esc(s.hint || "")}</span></li>`).join("")}</ol>` +
    '<h2 class="hd">Lessons</h2>' +
    (lessons.length
      ? `<ul class="rule-list">${lessons.map((l) => `<li><strong>${esc(truncate(l.title, 80))}</strong> <span class="meta mono">${esc(l.project_name || projectLabel(l.project))}, ${esc(relTime(l.date))} ago</span></li>`).join("")}</ul>`
      : '<p class="meta">No lessons recorded.</p>') +
    '<h2 class="hd">Nudges</h2>' +
    (n && n.last
      ? `<p class="mono">Last nudge ${esc(relTime(n.last))} ago. ${esc(num(n.sessions_nudged))} sessions nudged, at most one every ${esc(n.throttle_min)} minutes.</p>`
      : '<p class="meta">No nudges sent yet.</p>')
  );
}

function report(err) {
  const d = describeError(err);
  toast(d.message, { kind: "error", detail: d.detail });
}

export function render(ctx) {
  const win = normalizeWindow(ctx.params.window);
  const project = projectParam(ctx.project);
  const open = new Set(ctx.params.focus ? [ctx.params.focus] : []);
  const S = {
    health: null,
    healthErr: null,
    healthLoaded: false,
    improve: null,
    improveErr: null,
    improveLoaded: false,
    seq: 0,
    dead: false,
  };
  const subsHost = h("div", { class: "region" });
  const signalsHost = h("div", { class: "region" });
  const findingsHost = h("div", { class: "region" });

  const remeasureBtn = Button({}, "Re-measure");
  const fixBtn = Button({ variant: "primary" }, "Run self-fix");

  function paint() {
    if (S.dead) return;
    const base = { open };
    subsHost.innerHTML = renderSubsystemsRegion({ ...base, data: S.health, loaded: S.healthLoaded, error: S.healthErr });
    signalsHost.innerHTML = renderSignalsRegion({ ...base, data: S.health, loaded: S.healthLoaded, error: S.healthErr });
    findingsHost.innerHTML = renderFindingsRegion({ ...base, data: S.improve, loaded: S.improveLoaded, error: S.improveErr });
  }

  // A failed quiet refresh keeps the old content; a failed first load shows the Retry state.
  async function loadOne(fetcher, key) {
    try {
      S[key] = await fetcher();
      S[`${key}Err`] = null;
    } catch (e) {
      if (!S[key]) S[`${key}Err`] = describeError(e).message;
    }
    S[`${key}Loaded`] = true;
  }
  async function refresh() {
    const mine = ++S.seq;
    await Promise.all([
      loadOne(() => get("/api/v2/health", { window: win, project }), "health"),
      loadOne(() => get("/api/v2/improve", { project }), "improve"),
    ]);
    if (mine === S.seq) paint();
  }

  const remeasureOne = (id) =>
    post(`/api/v2/improve/remeasure${project ? `?project=${encodeURIComponent(project)}` : ""}`, { id });

  remeasureBtn.addEventListener("click", async () => {
    const todo = remeasurable(S.improve && S.improve.findings);
    if (!todo.length)
      return toast("Nothing to re-measure.", { kind: "info", detail: "No open findings from the doctor." });
    remeasureBtn.disabled = true;
    const results = [];
    for (const f of todo) {
      try {
        await remeasureOne(f.id);
        results.push({ ok: true });
      } catch (e) {
        results.push({ ok: false });
        if (results.length === 1) report(e);
      }
    }
    remeasureBtn.disabled = false;
    toast(batchSummary(results), { kind: results.every((r) => r.ok) ? "ok" : "warn" });
    refresh();
  });
  fixBtn.addEventListener("click", async () => {
    fixBtn.disabled = true;
    try {
      await post("/api/v2/improve/selffix", { op: "run_now" });
      toast("Self-fix started.", { kind: "ok", detail: "It runs in the background; findings update as it finishes." });
    } catch (e) {
      report(e);
    } finally {
      fixBtn.disabled = false;
    }
  });

  const retry = () => {
    S.healthLoaded = S.improveLoaded = false;
    S.healthErr = S.improveErr = null;
    paint();
    refresh();
  };
  const handlers = {
    retry,
    "remeasure-one": async (el) => {
      try {
        toast(remeasureSentence(await remeasureOne(el.dataset.id)), { kind: "ok" });
        refresh();
      } catch (e) {
        report(e);
      }
    },
  };
  const unbind = [subsHost, signalsHost, findingsHost].map((el) => bindRegion(el, handlers));
  // toggle does not bubble; capture it so the open Set tracks every disclosure.
  const onToggle = (ev) => {
    const d = ev.target;
    if (!d.matches || !d.matches("details.disclosure")) return;
    if (d.open) open.add(d.dataset.key);
    else open.delete(d.dataset.key);
  };
  ctx.root.addEventListener("toggle", onToggle, true);

  ctx.root.replaceChildren(
    PageHeader({
      title: "Health",
      description: "Is Atlas itself working, and what it wants to fix.",
      actions: [WindowControl(ctx), remeasureBtn, fixBtn],
    }),
    h("div", { class: "stack" }, subsHost, signalsHost, findingsHost),
  );
  paint();
  refresh();

  let timer = null;
  const onStore = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
  };
  const unsubs = [topics.health, topics.improve].map((s) => s.subscribe(onStore));
  return () => {
    S.dead = true;
    clearTimeout(timer);
    unsubs.forEach((u) => u());
    unbind.forEach((u) => u());
    ctx.root.removeEventListener("toggle", onToggle, true);
  };
}
