// Run page: seats rail (left), channel feed + steer bar (center), needs / gates / metrics (right).
// Region renderers are pure (HTML string out) and exported for the node tests; render() wires them to the live API.
import { get, topics, live, describeError } from "../api.js";
import { baseName, truncate } from "../dom.js";
import { mergeAgents, countStates } from "../state.js";
import { renderBand } from "../band.js";
import { roleLetter, spin } from "../glyph-table.js";
import { renderRegionState } from "../region-state.js";
import { sendSteer, steerTarget, resolveTarget, holdSeat } from "../steer.js";
import { bindKeys, isTypingIn } from "../keys.js";
import { projectParam, parseTarget } from "./monitor-model.js";
import { toBand, toSeats, toFeed, toNeeds, toGates, toMetrics } from "../run-data.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pad = (n) => String(n).padStart(2, "0");
const stamp = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const hms = (iso) => {
  const d = stamp(iso);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : "";
};
const dayOf = (iso) => {
  const d = stamp(iso);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";
};
const cells = (on, total) => `<b>${"\u25A0".repeat(on)}</b><i>${"\u25A1".repeat(total - on)}</i>`;

// --- Pure region renderers ---

export function renderSeats(seats, selected, meta = {}) {
  const rows = seats.map((s) => {
    const status =
      s.state === "running"
        ? `<span class="spin">${spin(meta.frame || 0, meta.phase)}</span>`
        : `<span class="stw">${esc(s.state)}</span>`;
    return (
      `<div class="seat${s.name === selected ? " sel" : ""}" data-seat="${esc(s.name)}" role="button" tabindex="0" aria-pressed="${s.name === selected}">` +
      `<div class="s1"><span class="gl st-${esc(s.state)}">${s.glyph}</span><span class="rl">${esc(s.letter)}</span>` +
      `<span class="nm">${esc(s.name)}</span><span class="age">${esc(s.age)}</span></div>` +
      `<div class="s2"><span class="tool">${esc(truncate(s.tool, 28))}</span>` +
      `<span class="bar st-${esc(s.state)}">${cells(s.elapsedCells, 8)}</span>${status}</div></div>`
    );
  });
  const head = meta.group ? `<div class="grp">\u25C6 ${esc(meta.group)}</div>` : "";
  return head + rows.join("");
}

const needsGlyph = "\u25C7";
const kindCell = (r) => (r.from === "human" ? ">" : r.needs ? needsGlyph : roleLetter(r.fromClass.slice(2)));
const spans = (text) => esc(text).replace(/`([^`]+)`/g, "<code>$1</code>");

export function renderFeed(rows, seat) {
  let last = "";
  return rows
    .filter((r) => !seat || r.from === seat)
    .map((r) => {
      const day = dayOf(r.t);
      const mark = day && day !== last ? `<div class="daymark">${day}</div>` : "";
      last = day || last;
      const cls = r.needs ? "ev need" : r.phase ? "ev phase" : "ev";
      return (
        `${mark}<div class="${cls}" data-key="${esc(r.key)}"><time class="t">${hms(r.t)}</time>` +
        `<span class="kg">${esc(kindCell(r))}</span>` +
        `<div class="msg"><span class="who ${esc(r.fromClass)}">${esc(r.from)}</span> ${spans(r.text)}</div></div>`
      );
    })
    .join("");
}

const NEEDS_SHOWN = 5;
const hashFor = (target) => {
  const { route, focus } = parseTarget(target);
  return `#/${route}${focus ? `?focus=${encodeURIComponent(focus)}` : ""}`;
};

export function renderNeeds(items) {
  const shown = items.slice(0, NEEDS_SHOWN).map((it) => {
    const buttons =
      it.state === "waiting"
        ? `<button class="btn" data-action="answer" data-seat="${esc(it.title)}">Answer</button>`
        : it.actions.map((a) => `<a class="btn" href="${esc(hashFor(a.target))}">${esc(a.label)}</a>`).join("");
    return (
      `<div class="need ${esc(it.state)}"><div class="nb"><div class="nt">${esc(truncate(it.title, 60))}</div>` +
      `<div class="nd">${esc(truncate(it.detail, 100))}</div><div class="ns">${esc(it.stateLine)}</div></div>` +
      `<div class="na">${buttons}</div></div>`
    );
  });
  const more = items.length - NEEDS_SHOWN;
  return shown.join("") + (more > 0 ? `<a class="more" href="#/health">${more} more in Health</a>` : "");
}

export function renderGates(chips) {
  return chips
    .map((c) => {
      const cls = c.ok ? "gate ok" : "gate open";
      const glyph = c.ok ? "\u2713" : "\u25C7";
      const fix = !c.ok && c.fix ? `<span class="gfix">${esc(c.fix)}</span>` : "";
      return `<div class="grow"><span class="${cls}" title="${esc(c.message)}"><b>${glyph}</b> ${esc(c.letter)} ${esc(c.label)}</span>${fix}</div>`;
    })
    .join("");
}

export function renderMetrics(rows) {
  return rows
    .map(
      (r) =>
        `<div class="mrow ${esc(r.tone)}"><span class="ml">${esc(r.label)}</span><span class="mn">${esc(r.n ?? "-")}</span>` +
        `<span class="mbar ${esc(r.tone)}">${cells(r.cells, 13)}</span><span class="md">${esc(r.delta)}</span></div>`,
    )
    .join("");
}

// --- Page ---

const LABEL = { seats: "seats", feed: "messages", needs: "needs", gates: "gates", metrics: "metrics" };

// The server's own message (why / do) from sendSteer, escaped for the inline error under the input.
export const renderSteerError = (r) => esc(r.message || r.error);

// Keys render() binds: RUN_KEYS minus "/", which app.js owns for the palette.
export const RUN_KEYMAP_IDS = ["1", "2", "3", "f", "i", "m", "h", "Escape"];

const SHELL_CENTER =
  '<div class="chan-head"><span class="lbl">CHANNEL</span> <span class="chan-name" data-chan></span></div>' +
  '<div class="feed" data-region="feed" role="log" aria-live="polite" tabindex="0"></div>' +
  '<form class="steer" data-steer><span class="chip" data-target>@lead</span>' +
  '<input data-steer-input name="text" autocomplete="off" aria-label="Message to the selected seat">' +
  '<span class="hint">enter send</span><p class="steer-err" data-steer-err role="alert" hidden></p></form>';
const section = (title, region) => `<section class="rsec"><h2>${title}</h2><div data-region="${region}"></div></section>`;
const SHELL_LEFT =
  '<h2 class="rail-h">SEATS</h2><div data-region="seats"></div><div class="machine" data-machine></div>';
const SHELL_RIGHT =
  section("NEEDS YOU", "needs") + section("GATES", "gates") + section("LAST 7 DAYS", "metrics");

export function render({ root, project, setParams }) {
  const rootPath = projectParam(project) || null;
  const band = document.getElementById("band");
  const left = document.getElementById("col-left");
  const right = document.getElementById("col-right");
  const mq = matchMedia("(max-width: 699px)");
  const st = {
    overview: null, agents: null, colony: { ok: false }, notes: [], gates: [], projects: [],
    selected: null, filter: true, frame: 0, stick: true, rs: {},
  };
  const timers = new Map();
  const later = (key, ms, fn) => {
    if (!timers.has(key)) timers.set(key, setTimeout(() => (timers.delete(key), fn()), ms));
  };
  let spinTimer = null;
  let dead = false;

  root.classList.add("run-main");
  root.innerHTML = SHELL_CENTER;
  left.innerHTML = SHELL_LEFT;
  right.innerHTML = SHELL_RIGHT;
  const $ = (sel) => document.querySelector(`[${sel}]`);
  const input = $("data-steer-input");
  const regionEl = (name) => document.querySelector(`[data-region="${name}"]`);

  const channelName = () => (st.colony.ok && ((st.colony.lead && st.colony.lead.channel) || (st.colony.channel && st.colony.channel.name))) || null;
  const leadName = () => (st.colony.ok && st.colony.lead && st.colony.lead.name) || "";
  const seats = () => toSeats(st.agents, st.colony, Date.now());
  const phase = () => toBand(st.overview, st.colony, null).phase;

  // --- paint ---
  function body(name) {
    switch (name) {
      case "seats": {
        const list = seats();
        const group = st.colony.ok ? `${baseName(st.colony.project || "")} / ${leadName()}` : "";
        return list.length ? renderSeats(list, st.selected, { frame: st.frame, phase: phase(), group }) : "";
      }
      case "feed": {
        const rows = toFeed(st.notes);
        return rows.length ? renderFeed(rows, st.filter ? st.selected : null) : "";
      }
      case "needs": {
        const items = toNeeds(st.overview, st.agents, Date.now());
        return items.length ? renderNeeds(items) : "";
      }
      case "gates":
        return st.gates.length ? renderGates(toGates({ ok: true, lines: st.gates })) : "";
      default: {
        const rows = st.overview ? toMetrics(st.overview) : [];
        return rows.length ? renderMetrics(rows) : "";
      }
    }
  }

  function paint(name) {
    const el = regionEl(name);
    if (!el) return;
    const r = st.rs[name] || { status: "loading" };
    const feed = name === "feed";
    if (feed) el.dataset.filter = st.filter ? "on" : "off";
    if (feed) st.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    const html = r.status === "ready" ? body(name) : "";
    el.innerHTML =
      r.status === "error" ? renderRegionState("error", LABEL[name], r.message)
      : r.status === "loading" ? renderRegionState("loading", LABEL[name])
      : html || renderRegionState("empty", LABEL[name]);
    if (feed && st.stick) el.scrollTop = el.scrollHeight;
    if (name === "seats") syncSpin();
  }

  function paintBand() {
    if (!band) return;
    const b = toBand(st.overview, st.colony, ""); // ponytail: header null, phase stays research; upgrade path is the lead's last ATLAS line from GET /api/sessions/<id>/transcript
    if (!st.colony.ok) {
      const c = countStates(mergeAgents(st.agents, null));
      b.counts = { working: c.working || 0, needs: c.input || 0, failed: c.fail || 0, parked: c.ready || 0 };
    }
    const sel = rootPath || "all";
    const opts = [{ value: "all", label: "all projects" }, ...st.projects.map((p) => ({ value: p.root, label: baseName(p.root) }))];
    if (!opts.some((o) => o.value === sel)) opts.push({ value: sel, label: baseName(sel) });
    band.innerHTML = renderBand({
      ...b,
      project: rootPath ? b.project || baseName(rootPath) : "all projects",
      live: live.get(),
      clock: new Date().toTimeString().slice(0, 8),
      narrow: mq.matches,
      route: "run",
      projectOptions: opts.map((o) => ({ ...o, selected: o.value === sel })),
    });
    const machine = $("data-machine");
    if (machine) machine.textContent = `${location.host} \u00B7 ${seats().length} seats \u00B7 ${live.get()}`;
  }

  function paintSteer() {
    const sel = seats().find((s) => s.name === st.selected);
    $("data-target").textContent = steerTarget(sel, leadName());
    $("data-chan").textContent = channelName() ? `#${channelName()}` : "";
    input.disabled = !channelName();
    input.placeholder = channelName() ? "steer the selected seat, or type @all ..." : "select a project to steer";
  }

  function syncSpin() {
    const any = seats().some((s) => s.state === "running");
    if (any && !spinTimer) {
      spinTimer = setInterval(() => {
        st.frame++;
        for (const el of document.querySelectorAll(".spin")) el.textContent = spin(st.frame, phase());
      }, 250);
    } else if (!any && spinTimer) {
      clearInterval(spinTimer);
      spinTimer = null;
    }
  }

  // --- load ---
  const loaders = {
    overview: async () => {
      st.overview = await get("/api/v2/overview", { window: "7d", project: rootPath || undefined });
    },
    agents: async () => {
      st.agents = topics.agents.get() || (await get("/api/v2/agents"));
    },
    colony: async () => {
      if (!rootPath) return void (st.colony = { ok: false });
      try {
        st.colony = await get("/api/v2/colony", { project: rootPath });
      } catch (e) {
        st.colony = { ok: false }; // seats fall back to the agents list
      }
    },
    feed: async () => {
      const name = channelName();
      if (!name) return void (st.notes = []);
      const r = await get(`/api/v2/channels/${encodeURIComponent(name)}`);
      st.notes = [...st.notes, ...(r.messages || [])].slice(-600); // toFeed dedupes by seq/id/ts+from+text
    },
    gates: async () => {
      st.gates = rootPath ? (await get("/api/v2/gates", { project: rootPath })).lines || [] : [];
    },
  };
  // Which regions each loader feeds.
  const FEEDS = {
    overview: ["metrics", "needs"], agents: ["seats", "needs"], colony: ["seats"], feed: ["feed"], gates: ["gates"],
  };

  async function run(names) {
    await Promise.all(
      names.map(async (n) => {
        try {
          await loaders[n]();
          for (const r of FEEDS[n]) st.rs[r] = { status: "ready" };
        } catch (e) {
          for (const r of FEEDS[n]) st.rs[r] = { status: "error", message: describeError(e).message };
        }
      }),
    );
    if (dead) return; // a late load must not paint into the next render's DOM
    for (const r of new Set(names.flatMap((n) => FEEDS[n]))) paint(r);
    paintBand();
    paintSteer();
  }

  // Seats need both agents and colony; needs need overview and agents.
  const retry = {
    seats: () => run(["agents", "colony"]), feed: () => run(["feed"]), needs: () => run(["overview", "agents"]),
    gates: () => run(["gates"]), metrics: () => run(["overview"]),
  };

  // --- events ---
  const onClick = (e) => {
    const retryBtn = e.target.closest("[data-action=retry]");
    if (retryBtn) {
      const name = retryBtn.closest("[data-region]").dataset.region;
      st.rs[name] = { status: "loading" };
      paint(name);
      return void retry[name]();
    }
    const answer = e.target.closest("[data-action=answer]");
    const seatEl = e.target.closest("[data-seat]");
    const name = (answer || seatEl) && (answer || seatEl).dataset.seat;
    if (!name) return;
    st.selected = answer || st.selected !== name ? name : null; // a second click on the seat clears the filter
    paint("seats");
    paint("feed");
    paintSteer();
    if (answer) input.focus();
  };
  const onKey = (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-seat]")) {
      e.preventDefault();
      e.target.click();
    }
  };
  const onBand = (e) => {
    if (e.target.matches("select[data-proj]")) setParams({ project: e.target.value === "all" ? null : e.target.value });
  };
  const onSubmit = async (e) => {
    e.preventDefault();
    const errEl = $("data-steer-err");
    const { to, text } = resolveTarget(input.value.trim(), $("data-target").textContent);
    const r = await sendSteer({ channel: channelName(), to, text });
    errEl.hidden = r.ok;
    if (!r.ok) return void (errEl.innerHTML = renderSteerError(r)); // typed text stays
    input.value = "";
    await run(["feed"]); // the stream tick would also bring it; this makes the round trip immediate
  };
  const mqChange = () => paintBand();

  // Region focus: the landmark gets tabindex -1 plus a ring class, so Tab continues inside it.
  const focusRegion = (el) => {
    if (!el) return;
    document.querySelectorAll(".region-focus").forEach((n) => n.classList.remove("region-focus"));
    el.tabIndex = -1;
    el.classList.add("region-focus");
    el.focus();
  };
  const steerErr = () => $("data-steer-err");
  const note = (msg) => {
    const el = steerErr();
    el.textContent = msg;
    el.hidden = false;
  };
  const hold = async () => {
    if (!st.selected) return note("Select a seat first, then press h to hold it.");
    const r = await holdSeat(channelName(), st.selected);
    if (r.ok) steerErr().hidden = true;
    else note(r.message || r.error);
  };
  const handlers = {
    1: () => focusRegion(left),
    2: () => focusRegion(root),
    3: () => focusRegion(regionEl("needs").closest("section")),
    f: () => ((st.filter = !st.filter), paint("feed")),
    i: () => input.focus(),
    m: () => input.focus(),
    h: hold,
    Escape: () => (input.blur(), (steerErr().hidden = true)),
  };
  const unbindKeys = bindKeys(Object.fromEntries(RUN_KEYMAP_IDS.map((k) => [k, handlers[k]])), {
    isTyping: () => isTypingIn(document.activeElement) || !!document.activeElement?.closest?.(".xterm"),
  });
  window.addEventListener("atlas:hold-selected", hold);

  root.addEventListener("click", onClick);
  left.addEventListener("click", onClick);
  right.addEventListener("click", onClick);
  left.addEventListener("keydown", onKey);
  root.querySelector("[data-steer]").addEventListener("submit", onSubmit);
  band && band.addEventListener("change", onBand);
  mq.addEventListener("change", mqChange);

  const unsubs = [
    topics.agents.subscribe((a) => {
      st.agents = a;
      for (const r of FEEDS.agents) paint(r);
      later("colony", 2500, () => run(["colony", "feed"]));
    }),
    topics.herd.subscribe(() => later("colony", 2500, () => run(["colony"]))),
    topics.irc.subscribe(() => later("feed", 800, () => run(["feed"]))),
    topics.health.subscribe(() => later("overview", 8000, () => run(["overview"]))),
    topics.todos.subscribe(() => later("gates", 4000, () => run(["gates"]))),
    live.subscribe(paintBand),
  ];

  for (const name of Object.keys(LABEL)) {
    st.rs[name] = { status: "loading" };
    paint(name);
  }
  paintBand();
  // Own the band only after the first paint succeeded: a render exception must not freeze it on other routes.
  if (band) band.dataset.owner = "run";
  get("/api/v2/projects")
    .then((r) => ((st.projects = (r.projects || []).filter((p) => p.root)), dead || paintBand()))
    .catch(() => {}); // the select still lists the current project
  // Colony first (it names the channel), then the channel-dependent loads in one pass.
  (async () => {
    await run(["overview", "agents", "colony"]);
    await run(["feed", "gates"]);
  })();

  return () => {
    dead = true;
    unbindKeys();
    window.removeEventListener("atlas:hold-selected", hold);
    unsubs.forEach((u) => u());
    for (const t of timers.values()) clearTimeout(t);
    clearInterval(spinTimer);
    root.removeEventListener("click", onClick);
    left.removeEventListener("click", onClick);
    right.removeEventListener("click", onClick);
    left.removeEventListener("keydown", onKey);
    band && band.removeEventListener("change", onBand);
    mq.removeEventListener("change", mqChange);
    if (band) delete band.dataset.owner;
    root.classList.remove("run-main");
    left.replaceChildren();
    right.replaceChildren();
  };
}
