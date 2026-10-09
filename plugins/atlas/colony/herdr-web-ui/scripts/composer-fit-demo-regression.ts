import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { appFaces } from "./app-faces.ts";
import panes from "../site/demo/fixtures/panes.json";

// The model label in the input card's last row, fitted to what is measured there, on the
// unmodified app over the demo's fixture transport. The demo's panes name no context window and
// run no task, so the page's data is patched here, in the test only: the pane is a Codex one with
// two background tasks, in the state a case asks for, and its conversation names that case's
// model, the level xhigh and a context window; an upload never answers, so its sentence stays.
// All files and HTTP traffic stay in this disposable, loopback-only app; no herdr session is opened.
const repo = join(import.meta.dir, "..");
const app = mkdtempSync(join(tmpdir(), "herdr-composer-fit-demo-"));
// an id the composer cannot name is drawn as received, in the mono face: the widest label there is
const LONG_MODEL = "gpt-5.6-sol-codex-preview-2026-10";
// ids it names: "GPT-5.6" and "Opus 5.5"; null: the conversation names no model
const NAMED = ["gpt-5.6", "claude-opus-5-5"] as const;

interface Case { model: string | null; effort?: string | null; status?: "working" | "idle"; mic?: boolean; ring?: boolean; chatFontSize?: number | null }
type Draw = "full" | "no-effort" | "out";

const measure = (page: Page) => page.evaluate(() => {
  const status = document.querySelector<HTMLElement>(".composer-status")!;
  const part = (selector: string) => {
    const item = document.querySelector<HTMLElement>(selector);
    if (!item) return null;
    const box = item.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, width: box.width, clipped: item.scrollWidth > item.clientWidth };
  };
  // everything drawn in the last row: no two of them may share a pixel
  const drawn = [...document.querySelectorAll<HTMLElement>(".composer-controls-left > *:not(input), .composer-status-meta > *, .composer-status-hint, .composer-controls-right > *")]
    // the pill and what it holds: its parts are compared with each other too, in every draw (a
    // pill without a box, the label out or no model, has no size and is filtered out below)
    .flatMap((item) => item.classList.contains("composer-pill") ? [item, ...item.children] as HTMLElement[] : [item])
    .flatMap((item) => item.classList.contains("composer-model-info") && getComputedStyle(item).display === "contents" ? [...item.children] as HTMLElement[] : [item])
    .filter((item) => item.getBoundingClientRect().width > 1.5 && item.getBoundingClientRect().height > 1.5);
  const overlaps: string[] = [];
  for (const [index, one] of drawn.entries()) for (const other of drawn.slice(index + 1)) {
    // the pill is around its own parts
    if (one.classList.contains("composer-pill") && one.contains(other)) continue;
    const a = one.getBoundingClientRect(), b = other.getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) overlaps.push(`${one.className} | ${other.className}`);
  }
  const surface = document.querySelector(".composer-surface")!.getBoundingClientRect();
  return {
    draw: status.getAttribute("data-model") ?? "full", hintAlone: status.hasAttribute("data-hint-alone"),
    card: { width: surface.width, height: surface.height }, status: status.getBoundingClientRect().height,
    pill: (() => {
      const pill = document.querySelector<HTMLElement>(".composer-pill")!;
      const box = pill.getBoundingClientRect(), row = status.getBoundingClientRect();
      const inside = (selector: string): boolean => {
        const item = pill.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        return item !== undefined && item.left >= box.left - 0.5 && item.right <= box.right + 0.5 && item.top >= box.top - 0.5 && item.bottom <= box.bottom + 0.5;
      };
      const style = getComputedStyle(pill);
      return {
        width: box.width, height: box.height, inRow: box.left >= row.left - 0.5 && box.right <= row.right + 0.5,
        holds: inside(".agent-mark") && inside(".composer-model") && (pill.querySelector(".composer-context") === null || inside(".composer-context"))
          // the level too, wherever it is drawn (stepped out or not recorded it is a 1px box that is only read)
          && ((pill.querySelector<HTMLElement>(".composer-reasoning")?.getBoundingClientRect().width ?? 0) <= 1.5 || inside(".composer-reasoning")),
        // it only shows: nothing about it says it can be pressed
        inert: pill.tagName === "SPAN" && !pill.hasAttribute("role") && !pill.hasAttribute("tabindex") && style.cursor === "auto",
      };
    })(),
    name: document.querySelector<HTMLElement>(".composer-model")?.textContent ?? null, named: !document.querySelector(".composer-model")?.classList.contains("is-id"),
    label: part(".composer-model-info"), model: part(".composer-model"), effort: part(".composer-reasoning"), ring: part(".composer-context"), ringText: part(".composer-context-text"),
    // the ring's track, and the two tokens it can be: the bare ring's and the one on the pill's fill
    track: (() => {
      const track = document.querySelector(".composer-context-track");
      const token = (name: string): string => {
        const probe = document.body.appendChild(document.createElement("span"));
        probe.style.color = `var(${name})`;
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      return track ? { stroke: getComputedStyle(track).stroke, bare: token("--border"), onFill: token("--border-strong") } : null;
    })(),
    hint: part(".composer-status-hint"), queue: document.querySelector(".composer-queue-button") !== null,
    chip: document.querySelector(".bg-tasks-toggle") !== null, mic: document.querySelector(".composer-controls-left .voice-mic") !== null,
    overlaps, overflowing: document.documentElement.scrollWidth > window.innerWidth,
  };
});
type Row = Awaited<ReturnType<typeof measure>>;

/** The fit answers after the commit, a resize a frame later: wait for the mark, never a fixed time. */
const drawn = async (page: Page, draw: Draw, what: string): Promise<Row> => {
  await page.waitForFunction((want) => (document.querySelector(".composer-status")?.getAttribute("data-model") ?? "full") === want, draw, { timeout: 5_000 })
    .catch(async () => assert.fail(`${what}: the model label is drawn "${(await measure(page)).draw}", not "${draw}": ${JSON.stringify(await measure(page))}`));
  const row = await measure(page);
  // a label that is drawn whole is whole; with Queue it is never drawn in part
  if (draw === "full" || row.queue) assert.ok(!row.model?.clipped && !row.effort?.clipped, `${what}: no word of the model label is cut: ${JSON.stringify(row)}`);
  if (draw === "no-effort") assert.ok((row.effort?.width ?? 0) <= 1, `${what}: the level is read, not drawn: ${JSON.stringify(row)}`);
  if (draw === "out") assert.ok((row.label?.width ?? 0) <= 1, `${what}: the name and the level are read, not drawn: ${JSON.stringify(row)}`);
  // the pill goes with the label: no empty pill is left around the ring. Drawn, it holds the mark, the name and the ring
  if (draw === "out") assert.equal(row.pill.width, 0, `${what}: no pill is drawn without its label: ${JSON.stringify(row)}`);
  else assert.ok(row.pill.width > 1 && row.pill.inRow && row.pill.holds && row.pill.inert, `${what}: the mark, the name and the ring sit in one pill that is not a control: ${JSON.stringify(row)}`);
  // the ring's track is the stronger one only on the pill's fill: bare on the card it is the bare ring's
  if (row.track) assert.equal(row.track.stroke, draw === "out" ? row.track.bare : row.track.onFill, `${what}: the ring's track is the one for where it stands: ${JSON.stringify(row.track)}`);
  assert.deepEqual(row.overlaps, [], `${what}: nothing overlaps its neighbour`);
  assert.equal(row.overflowing, false, `${what}: the page does not scroll sideways`);
  return row;
};

const ring = (page: Page) => page.locator(".composer-context");
/**
 * Opens or closes the context number and answers how the label is drawn in that same task: React
 * commits a click in a microtask, and the label is fitted with that commit, not by whatever
 * renders the composer next (a poll, a status change), which no wait here would tell apart.
 */
const toggleRing = async (page: Page, open: boolean, draw?: Draw): Promise<void> => {
  const marked = await ring(page).evaluate(async (node: HTMLElement) => {
    node.click();
    await new Promise<void>((done) => queueMicrotask(done));
    return { open: node.getAttribute("aria-expanded"), draw: node.closest(".composer-status")!.getAttribute("data-model") ?? "full" };
  });
  assert.equal(marked.open, String(open));
  if (draw) assert.equal(marked.draw, draw, `the model label is fitted as the context number ${open ? "opens" : "closes"}`);
};
const draft = async (page: Page, queue: boolean): Promise<void> => {
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("hold this");
  if (queue) await page.locator(".composer-queue-button").waitFor();
};
const upload = async (page: Page): Promise<void> => {
  await page.locator('.composer-controls-left input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await page.locator(".composer-status-hint").waitFor();
  assert.equal(await page.locator(".composer-status-hint").textContent(), "· Uploading file…");
};

try {
  const build = Bun.spawnSync([join(repo, "node_modules/.bin/vite"), "build", "--base", "./", "--outDir", app, "--emptyOutDir", "--logLevel", "warn"], { cwd: repo });
  assert.equal(build.exitCode, 0, new TextDecoder().decode(build.stderr));
  const transport = await Bun.build({
    entrypoints: [join(repo, "site/demo/transport.ts")], outdir: app,
    naming: "demo-transport.js", target: "browser",
    define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version) },
  });
  assert.ok(transport.success, transport.logs.map(String).join("\n"));
  const index = join(app, "index.html");
  const html = readFileSync(index, "utf8");
  assert.match(html, /<script type="module"/);
  // What the demo answers, rewritten as it is read (`window.fitCase` is set per browser context).
  const patch = `<script>(() => {
    const TARGET = ${JSON.stringify(panes.api)};
    const fix = (value) => {
      if (!value || typeof value !== "object") return value;
      if (Array.isArray(value)) { value.forEach(fix); return value; }
      if (value.pane_id === TARGET && "agent_status" in value) {
        if ("agent" in value) Object.assign(value, { agent: "codex", background_tasks: 2 });
        value.agent_status = window.fitCase.status;
      }
      if (Array.isArray(value.turns) && value.metadata) value.metadata = { model: window.fitCase.model, reasoning_effort: window.fitCase.effort, ...(window.fitCase.ring ? { context: { used: 151000, window: 272000 } } : {}) };
      for (const key of Object.keys(value)) fix(value[key]);
      return value;
    };
    const parse = JSON.parse;
    JSON.parse = function (text, reviver) { return fix(parse.call(JSON, text, reviver)); };
    const json = Response.prototype.json;
    Response.prototype.json = async function () { return fix(await json.call(this)); };
    const demoFetch = window.fetch;
    window.fetch = (input, init) => String(typeof input === "string" ? input : input.url ?? input).includes("/pane/image") ? new Promise(() => {}) : demoFetch(input, init);
  })();</script>`;
  writeFileSync(index, html.replace(/<script type="module"/, () => `<script src="./demo-transport.js"></script>\n    ${patch}\n    <script type="module"`));

  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/herdr-web-ui/demo/app/")) return new Response("not found", { status: 404 });
    let file: string;
    try { file = decodeURIComponent(path.slice("/herdr-web-ui/demo/app/".length)); }
    catch { return new Response("bad path", { status: 400 }); }
    if (!file || file.endsWith("/")) file += "index.html";
    if (file.split("/").includes("..") || file.includes("\\")) return new Response("bad path", { status: 400 });
    const body = Bun.file(join(app, file));
    return (await body.exists()) ? new Response(body) : new Response("not found", { status: 404 });
  } });
  const url = `http://127.0.0.1:${server.port}/herdr-web-ui/demo/app/?pane=${encodeURIComponent(panes.api)}`;

  /** One card: a phone (390px, touch) or a mouse-driven window of `width`. */
  const withCard = async (browser: Browser, width: number, state: Case, run: (page: Page) => Promise<void>): Promise<void> => {
    const touch = width <= 480;
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: touch, isMobile: touch, locale: "en-US" });
    try {
      await context.addInitScript((fitCase) => {
        localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", voiceInput: fitCase.mic, chatFontSize: fitCase.chatFontSize ?? null }));
        Object.assign(window, { fitCase });
      }, { status: "working", effort: "xhigh", mic: false, ring: true, ...state });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error" && message.text().includes("ResizeObserver")) errors.push(message.text()); });
      await page.goto(url);
      await page.locator(".conn-live").waitFor({ state: "attached" });
      if (await page.locator(".terminal-stack.is-chat").count() === 0) await page.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).click();
      await page.locator(".terminal-stack.is-chat").waitFor();
      await page.locator(".composer-model").waitFor({ state: "attached" });
      await appFaces(page);
      await run(page);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  };

  try {
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
    try {
      // a readable name for an id the composer can name, and any other id exactly as received
      for (const [model, name, named] of [["claude-opus-5-5", "Opus 5.5", true], ["gpt-5.6", "GPT-5.6", true], ["gpt-5.6-sol", "GPT-5.6-Sol", true], ["gpt-5.6-sol-max", "gpt-5.6-sol-max", false], [LONG_MODEL, LONG_MODEL, false]] as const) await withCard(browser, 1440, { model }, async (page) => {
        const row = await drawn(page, "full", `${model} in a wide window`);
        assert.deepEqual([row.name, row.named], [name, named]);
        assert.equal(await page.locator(".composer-model").getAttribute("title"), model, "the id as received is the name's title");
        assert.equal(await page.locator(".composer-model").evaluate((node) => getComputedStyle(node).fontFamily.includes("monospace")), !named, "an id with no name is drawn in the mono face");
        // the level is the agent's own word, drawn with a capital and never rewritten
        assert.deepEqual(await page.locator(".composer-reasoning-short").evaluate((node: HTMLElement) => [node.textContent, node.innerText]), ["xhigh", "Xhigh"]);
        // behind a name the id as received is still read by assistive tech; an id drawn as received is not said twice
        assert.deepEqual(await page.locator(".composer-model-id.visually-hidden").allTextContents(), named ? [model] : []);
        assert.equal(row.pill.height, await page.locator(".composer-attach").evaluate((node) => node.getBoundingClientRect().height), "the pill is as tall as a control");
      });
      console.log("PASS the model is named only where its id is one the composer can name, and the pill holds it at a control's height");

      // a level of two words: the first letter alone is drawn as a capital, the words are the agent's
      await withCard(browser, 1440, { model: "claude-opus-5-5", effort: "extra high" }, async (page) => {
        await drawn(page, "full", "a level of two words");
        assert.deepEqual(await page.locator(".composer-reasoning-short").evaluate((node: HTMLElement) => [node.textContent, node.innerText]), ["extra high", "Extra high"]);
      });
      // no level recorded: the pill reads the name and the ring, with no dot and no dash drawn; the sentence is still read
      for (const width of [390, 1440]) await withCard(browser, width, { model: "claude-opus-5-5", effort: null }, async (page) => {
        const row = await drawn(page, "full", `no level, ${width}px`);
        assert.equal(row.name, "Opus 5.5");
        assert.equal(await page.locator(".composer-reasoning-dot, .composer-reasoning-short").count(), 0, "no dot and no dash");
        assert.ok((row.effort?.width ?? 0) <= 1.5, `nothing is drawn for a level that is not recorded: ${JSON.stringify(row)}`);
        assert.equal(await page.locator(".composer-reasoning-full").textContent(), "Reasoning —");
      });
      // a level and no model: no pill is drawn around a placeholder; the placeholder and the level
      // stand in the row, dim, with the mark and a bare ring
      await withCard(browser, 1440, { model: null, effort: "high" }, async (page) => {
        await page.waitForFunction(() => document.querySelector(".composer-status")?.getAttribute("data-model") === null);
        const row = await measure(page);
        assert.equal(row.pill.width, 0, `no pill without a model: ${JSON.stringify(row)}`);
        assert.ok(row.name === "Model —" && (row.effort?.width ?? 0) > 1.5 && row.track !== null && row.track.stroke === row.track.bare, JSON.stringify(row));
        assert.deepEqual(await page.locator(".composer-model").evaluate((node) => [getComputedStyle(node).color, getComputedStyle(node).fontWeight]),
          await page.locator(".composer-status").evaluate((node) => [getComputedStyle(node).color, getComputedStyle(node).fontWeight]), "the placeholder is not drawn as a name");
        assert.deepEqual(row.overlaps, []);
      });
      console.log("PASS a level of two words keeps its words, a missing level draws nothing, and a pane with no model draws no pill");

      // The context ring's number opens inside the row and the card keeps its size: the label is
      // fitted again. With Queue it steps out whole, its pill with it, and comes back when the number closes
      for (const model of NAMED) await withCard(browser, 800, { model }, async (page) => {
        await draft(page, true);
        const closed = await drawn(page, "full", `${model}, a draft`);
        assert.ok(closed.chip && closed.ring, "the task chip and the context ring are in the row");
        await toggleRing(page, true, "out");
        const open = await drawn(page, "out", `${model}, a draft, the context number open`);
        assert.equal(open.ringText?.clipped, false, `the number has the room the label left: ${JSON.stringify(open)}`);
        assert.equal(open.card.height, closed.card.height);
        await toggleRing(page, false, "full");
        await drawn(page, "full", `${model}, a draft, the context number closed again`);
      });
      console.log("PASS with Queue showing, opening the context number steps the model label and its pill out whole, and closing it brings them back");

      // a phone: beside the task chip and Queue the pill has no room, so the label is out while the
      // draft is there and back, whole, once it is gone; the card keeps its height through it
      for (const model of NAMED) await withCard(browser, 390, { model }, async (page) => {
        const rest = await drawn(page, "full", `${model} on a phone, no draft`);
        assert.ok(rest.chip && rest.ring && !rest.queue);
        await draft(page, true);
        const held = await drawn(page, "out", `${model} on a phone, a draft`);
        assert.ok(held.queue && (held.ring?.width ?? 0) > 1, `the ring is still drawn: ${JSON.stringify(held)}`);
        assert.equal(held.card.height, rest.card.height);
        await page.getByRole("textbox", { name: "Message", exact: true }).fill("");
        await drawn(page, "full", `${model} on a phone, the draft cleared`);
      });
      // the pill steps out where it does not fit, not on a phone as such: a short id with no
      // level is drawn whole there beside the task chip, the ring and Queue
      await withCard(browser, 390, { model: "o3", effort: null }, async (page) => {
        await draft(page, true);
        const row = await drawn(page, "full", "a short id with no level on a phone, a draft");
        assert.ok(row.chip && row.ring && row.queue, `the task chip, the ring and Queue are in the row: ${JSON.stringify(row)}`);
        assert.deepEqual([row.name, row.named], ["o3", false]);
        assert.ok((row.effort?.width ?? 0) <= 1.5, `no level is drawn: ${JSON.stringify(row)}`);
      });
      // the shortest label a named model with a level can have still has no room there
      await withCard(browser, 390, { model: "gpt-6", effort: "low" }, async (page) => {
        await draft(page, true);
        const row = await drawn(page, "out", "the shortest name with a level on a phone, a draft");
        assert.ok(row.chip && row.ring && row.queue, JSON.stringify(row));
      });
      console.log("PASS on a phone the pill is whole beside Stop and steps out, ring kept, while Queue shows; a short id with no level stays drawn beside Queue");

      // without Queue the level alone steps out, and no sliver of it is left beside the number
      await withCard(browser, 390, { model: "gpt-5.6", status: "idle" }, async (page) => {
        await drawn(page, "full", "a resting pane");
        await toggleRing(page, true, "no-effort");
        const open = await drawn(page, "no-effort", "a resting pane, the context number open");
        assert.equal(open.model?.clipped, false, `the name is whole: ${JSON.stringify(open)}`);
        await toggleRing(page, false, "full");
        await drawn(page, "full", "a resting pane, the context number closed again");
      });
      console.log("PASS without Queue, opening the context number steps the level out whole and keeps the name");

      // The uploading sentence takes a line of its own and is shown whole; the rest stays one
      // row, so a label that does not fit there steps out as it does without the sentence, and
      // the mark, the name and the level never take a line each. 80px: the attachment strip
      for (const model of ["gpt-5.6", "gpt-5.6-sol-max", LONG_MODEL]) for (const number of [false, true]) await withCard(browser, 390, { model, mic: true }, async (page) => {
        await draft(page, true);
        if (number) await toggleRing(page, true);
        const before = await drawn(page, "out", `${model}, the mic and a draft`);
        assert.ok(before.mic && before.chip, "the mic and the task chip are in the row");
        await upload(page);
        const row = await drawn(page, "out", `${model}, the mic, a draft and an upload`);
        assert.ok(row.hintAlone && row.hint !== null && !row.hint.clipped, `the sentence is whole on its own line: ${JSON.stringify(row)}`);
        assert.ok(row.hint.top >= row.ring!.bottom - 0.5, `the sentence is under the ring: ${JSON.stringify(row)}`);
        assert.equal(row.status, before.status, `the status content keeps its height: ${JSON.stringify(row)}`);
        assert.ok(row.card.height - before.card.height <= 80.5, `the card grows by the attachment strip alone: ${row.card.height - before.card.height}px`);
      });
      console.log("PASS on a phone with the mic, a task chip, a draft and a pending upload, the model label stays stepped out and the sentence is whole on its own line");

      // a resting pane: a short label stays whole over the sentence; a long name gives up its
      // level and is ellipsized in its one row
      await withCard(browser, 390, { model: "gpt-5.6", status: "idle", mic: true }, async (page) => {
        await draft(page, false);
        const before = await drawn(page, "full", "a resting pane, a short label");
        await upload(page);
        const row = await drawn(page, "full", "a resting pane, a short label and an upload");
        assert.ok(row.hintAlone && !row.hint!.clipped && row.status === before.status, JSON.stringify(row));
        assert.ok(Math.abs(row.model!.top - row.effort!.top) < 0.5, `the name and the level share a line: ${JSON.stringify(row)}`);
      });
      await withCard(browser, 390, { model: LONG_MODEL, status: "idle", mic: true }, async (page) => {
        await draft(page, false);
        const before = await drawn(page, "no-effort", "a resting pane, a long name");
        await upload(page);
        const row = await drawn(page, "no-effort", "a resting pane, a long name and an upload");
        assert.ok(row.hintAlone && !row.hint!.clipped && row.status === before.status, JSON.stringify(row));
        assert.ok(row.model!.clipped && row.model!.bottom <= row.hint!.top + 0.5 && row.ring!.bottom <= row.hint!.top + 0.5, `the name is ellipsized beside the ring, over the sentence: ${JSON.stringify(row)}`);
      });
      // nothing but the sentence is drawn (no ring, the label out): no empty line is kept over it
      await withCard(browser, 390, { model: "gpt-5.6-sol-max", mic: true, ring: false }, async (page) => {
        await draft(page, true);
        const before = await drawn(page, "out", "no ring, the label out");
        await upload(page);
        const row = await drawn(page, "out", "no ring, the label out and an upload");
        assert.ok(row.hintAlone && !row.hint!.clipped && row.status === before.status, JSON.stringify(row));
        const centre = await page.evaluate(() => {
          const hint = document.querySelector(".composer-status-hint")!.getBoundingClientRect();
          const queue = document.querySelector(".composer-queue-button")!.getBoundingClientRect();
          return Math.abs((hint.top + hint.bottom) / 2 - (queue.top + queue.bottom) / 2);
        });
        assert.ok(centre <= 2, `the sentence alone sits on the controls' centre line: ${centre}px off`);
      });
      console.log("PASS a resting pane keeps one row of metadata over the uploading sentence, and the sentence alone is centred");

      // a task chip, the context ring, the mic and Queue together, from a phone to a wide window,
      // with the number closed and open: nothing overlaps and the label is whole or stepped out,
      // for a short name and for a long id that has none
      const widths = [390, 800, 1024, 1440] as const;
      const fits: Record<string, Record<"plain" | "mic", readonly (readonly [Draw, Draw])[]>> = {
        "claude-opus-5-5": {
          plain: [["out", "out"], ["full", "out"], ["full", "full"], ["full", "full"]],
          mic: [["out", "out"], ["out", "out"], ["full", "full"], ["full", "full"]],
        },
        [LONG_MODEL]: {
          plain: [["out", "out"], ["out", "out"], ["out", "out"], ["full", "full"]],
          mic: [["out", "out"], ["out", "out"], ["out", "out"], ["full", "out"]],
        },
      };
      for (const [model, byMic] of Object.entries(fits)) for (const mic of [false, true]) for (const [index, width] of widths.entries()) await withCard(browser, width, { model, mic }, async (page) => {
        const [closed, open] = byMic[mic ? "mic" : "plain"][index]!;
        await draft(page, true);
        const row = await drawn(page, closed, `${model}, ${width}px${mic ? ", the mic" : ""}`);
        assert.ok(row.chip && row.ring && row.queue && row.mic === mic);
        await toggleRing(page, true, open);
        await drawn(page, open, `${model}, ${width}px${mic ? ", the mic" : ""}, the context number open`);
      });
      console.log("PASS at 390, 800, 1024 and 1440px a short name and a long model id are whole or stepped out beside the chip, the ring, the mic and Queue");

      // The message box is typed at the transcript's size (Settings → Chat font size): with a mouse
      // exactly, on a phone never under 16px, the smallest size iOS does not zoom the page for
      for (const width of [390, 1440]) for (const chatFontSize of [null, 20]) await withCard(browser, width, { model: "claude-opus-5-5", chatFontSize }, async (page) => {
        const [box, body] = await page.evaluate(() => {
          const probe = document.createElement("span");
          probe.style.fontSize = "var(--chat-fs-body)";
          document.querySelector(".chat-view")!.append(probe);
          const sizes = [document.querySelector(".composer-text")!, probe].map((node) => parseFloat(getComputedStyle(node).fontSize));
          probe.remove();
          return sizes;
        });
        const want = width <= 480 ? Math.max(16, body!) : body!;
        assert.ok(Math.abs(box! - want) < 0.05, `${width}px, chat size ${chatFontSize ?? "default"}: the box is ${box}px, the transcript ${body}px`);
        if (chatFontSize === null) assert.equal(box, width <= 480 ? 16 : 15, "with no size chosen the box keeps its size");
      });
      console.log("PASS the message box follows Chat font size: with a mouse at the transcript's size, on a phone never under 16px");

      // Changing the setting in an already-open chat rewraps the existing draft: an automatic
      // box grows and shrinks with it, while a height chosen with the grip stays chosen.
      for (const width of [390, 1440]) await withCard(browser, width, { model: "claude-opus-5-5" }, async (page) => {
        const box = page.getByRole("textbox", { name: "Message", exact: true });
        const grip = page.getByRole("separator", { name: "Resize message box", exact: true });
        const text = "An unsent draft changes size with the transcript.\nIts second line stays visible.\nThe third line stays visible too.";
        const height = () => box.evaluate((node) => node.clientHeight);
        const chooseSize = async (size: number) => {
          await page.keyboard.press("ControlOrMeta+Shift+Comma");
          await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
          const current = Number.parseInt(await page.locator('.settings-stepper[aria-label="Chat font size"] output').innerText(), 10);
          const button = page.getByRole("button", { name: size > current ? "Increase chat font size" : "Decrease chat font size", exact: true });
          for (let step = 0; step < Math.abs(size - current); step++) await button.click();
          await page.getByRole("button", { name: "Close settings", exact: true }).click();
        };
        await box.fill(text);
        const initial = await height();
        await chooseSize(20);
        await page.waitForFunction((before) => {
          const box = document.querySelector<HTMLTextAreaElement>(".composer-text")!;
          return box.clientHeight > before && box.scrollHeight <= box.clientHeight + 1;
        }, initial);
        const large = await height();
        assert.equal(await box.inputValue(), text, "resizing keeps the draft whole");
        await chooseSize(11);
        await page.waitForFunction((before) => document.querySelector(".composer-text")!.clientHeight < before, large);
        assert.equal(await box.inputValue(), text, "shrinking keeps the draft whole");
        assert.equal(await grip.getAttribute("aria-valuetext"), "automatic height");

        await grip.press("ArrowUp");
        const chosen = await height();
        assert.equal(await box.evaluate((node) => node.classList.contains("is-sized")), true);
        await chooseSize(20);
        await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector(".composer-text")!).fontSize) > 21);
        assert.equal(await height(), chosen, "a font-size change preserves the chosen height");
        assert.equal(await box.inputValue(), text, "a manual box keeps the draft whole too");
        await grip.press("Home");
        await page.waitForFunction(() => {
          const box = document.querySelector<HTMLTextAreaElement>(".composer-text")!;
          return !box.classList.contains("is-sized") && box.scrollHeight <= box.clientHeight + 1;
        });
        assert.equal(await box.inputValue(), text);
      });
      console.log("PASS changing Chat font size grows and shrinks an existing draft's automatic box and preserves a chosen height");
    } finally {
      await browser.close();
    }
  } finally {
    server.stop(true);
  }
} finally {
  rmSync(app, { recursive: true, force: true });
}
