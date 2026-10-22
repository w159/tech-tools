// Improve (brief 5.7): loop stages, findings, lessons, nudges, plus Re-measure and Run self-fix.
import { h, relTime, num, truncate } from "../dom.js";
import { get, post, topics, describeError } from "../api.js";
import {
  PageHeader,
  Panel,
  Table,
  Badge,
  Button,
  Empty,
  toast,
} from "../ui.js";
import { projectParam, projectLabel } from "./monitor-model.js";
import {
  findingTone,
  remeasurable,
  remeasureSentence,
  batchSummary,
  countLine,
} from "./improve-model.js";
import { mountView, Disclosure } from "./monitor-view.js";

async function remeasureOne(id, project) {
  return post(
    `/api/v2/improve/remeasure${project ? `?project=${encodeURIComponent(project)}` : ""}`,
    { id },
  );
}

function report(err) {
  const d = describeError(err);
  toast(d.message, { kind: "error", detail: d.detail });
}

export function render(ctx) {
  const open = new Set();
  const project = projectParam(ctx.project);
  let latest = null;
  let reload = () => {};

  const remeasureBtn = Button({}, "Re-measure");
  const fixBtn = Button({ variant: "primary" }, "Run self-fix");

  remeasureBtn.addEventListener("click", async () => {
    const todo = remeasurable(latest && latest.findings);
    if (!todo.length)
      return toast("Nothing to re-measure.", {
        kind: "info",
        detail: "No open findings from the doctor.",
      });
    remeasureBtn.disabled = true;
    const results = [];
    for (const f of todo) {
      try {
        await remeasureOne(f.id, project);
        results.push({ ok: true });
      } catch (e) {
        results.push({ ok: false });
        if (results.length === 1) report(e);
      }
    }
    remeasureBtn.disabled = false;
    toast(batchSummary(results), {
      kind: results.every((r) => r.ok) ? "ok" : "warn",
    });
    reload();
  });
  fixBtn.addEventListener("click", async () => {
    fixBtn.disabled = true;
    try {
      await post("/api/v2/improve/selffix", { op: "run_now" });
      toast("Self-fix started.", {
        kind: "ok",
        detail: "It runs in the background; findings update as it finishes.",
      });
    } catch (e) {
      report(e);
    } finally {
      fixBtn.disabled = false;
    }
  });

  const header = PageHeader({
    title: "Improve",
    description: "What Atlas learned and what it wants to fix.",
    actions: [remeasureBtn, fixBtn],
  });

  function findingRow(f) {
    const detail = [
      f.evidence && h("p", { class: "mono wrap" }, f.evidence),
      f.proposed_action &&
        h(
          "p",
          {},
          h("span", { class: "meta" }, "Proposed: "),
          f.proposed_action,
        ),
      f.verdict &&
        h(
          "p",
          { class: "meta" },
          `Verdict: ${f.verdict}${f.trend ? `, ${f.trend}` : ""}`,
        ),
      f.source === "doctor" &&
        /^doctor:\d+$/.test(f.id) &&
        Button(
          {
            size: "sm",
            onClick: async () => {
              try {
                toast(remeasureSentence(await remeasureOne(f.id, project)), {
                  kind: "ok",
                });
                reload();
              } catch (e) {
                report(e);
              }
            },
          },
          "Re-measure",
        ),
    ];
    return detail;
  }

  function paint(data) {
    latest = data;
    const stages = data.loop && data.loop.stages ? data.loop.stages : [];
    return h(
      "div",
      { class: "stack" },
      Panel(
        { title: "Loop stages" },
        h(
          "ol",
          { class: "stage-list" },
          stages.map((s) =>
            h(
              "li",
              {},
              h("strong", {}, s.label),
              h(
                "span",
                { class: "meta" },
                ` ${num(s.count)} - ${s.hint || ""}`,
              ),
            ),
          ),
        ),
      ),
      Panel(
        {
          title: "Findings",
          actions: h("span", { class: "meta" }, countLine(data.counts)),
        },
        Table({
          columns: [
            {
              key: "status",
              label: "Status",
              render: (f) => Badge(f.status, findingTone(f.status)),
            },
            {
              key: "title",
              label: "Finding",
              render: (f) =>
                Disclosure(open, f.id, truncate(f.title, 100), findingRow(f)),
            },
            {
              key: "project",
              label: "Project",
              render: (f) => projectLabel(f.project),
            },
            {
              key: "last",
              label: "Age",
              class: "num",
              render: (f) => relTime(f.last || f.first),
            },
          ],
          rows: data.findings || [],
          rowKey: (f) => f.id,
          empty: Empty({
            title: "No findings yet.",
            body: "The doctor raises findings as it mines your sessions.",
          }),
        }),
      ),
      h(
        "div",
        { class: "cols-2" },
        Panel(
          { title: "Lessons" },
          (data.lessons || []).length
            ? h(
                "ul",
                { class: "plain-list" },
                data.lessons.map((l) =>
                  h(
                    "li",
                    {},
                    h("strong", {}, truncate(l.title, 80)),
                    h(
                      "span",
                      { class: "meta" },
                      ` ${l.project_name || projectLabel(l.project)}, ${relTime(l.date)} ago`,
                    ),
                  ),
                ),
              )
            : h("p", { class: "meta" }, "No lessons recorded."),
        ),
        Panel({ title: "Nudges" }, nudges(data.nudges)),
      ),
    );
  }

  function nudges(n) {
    if (!n || !n.last) return h("p", { class: "meta" }, "No nudges sent yet.");
    return h(
      "p",
      {},
      `Last nudge ${relTime(n.last)} ago. ${num(n.sessions_nudged)} sessions nudged, at most one every ${n.throttle_min} minutes.`,
    );
  }

  const load = () => get("/api/v2/improve", { project });
  const stop = mountView(ctx.root, header, {
    load,
    paint,
    stores: [topics.improve],
  });
  reload = () => topics.improve.set(topics.improve.get()); // re-uses the quiet refresh path
  return stop;
}
