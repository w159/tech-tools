/** Math in the chat, end to end in Chrome: KaTeX comes with the first expression, not with the page. */
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { build as viteBuild } from "vite";
import { transcriptPage } from "../server/conversation.ts";
import type { ConversationResponse } from "../shared/protocol.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "herdr-math-browser-")));
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let conversation: ConversationResponse;
// pi's record shapes, as pi-image-browser-qa.ts writes them: one question and its answer
const write = (answer: string) => {
  const path = join(root, "session.jsonl");
  writeFileSync(path, [
    { type: "session", version: 3, id: "s", timestamp: "2026-09-30T00:00:00Z", cwd: root },
    { type: "model_change", id: "m1", parentId: null, timestamp: "2026-09-30T00:00:00Z", provider: "test", modelId: "qwen-test" },
    { type: "message", id: "u1", parentId: "m1", timestamp: "2026-09-30T00:00:01Z", message: { role: "user", content: "show me some math" } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-09-30T00:00:02Z", message: {
      role: "assistant", model: "qwen-test", provider: "test", stopReason: "stop", usage: { input: 10, output: 4 },
      content: [{ type: "text", text: answer }],
    } },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n");
  const { source, turns, metadata } = transcriptPage("pi-transcript", path);
  conversation = { source, history_id: "fixture", cursor: null, turns, metadata, version: 1 };
};
try {
  // Exercise the production bundler too: Vite must load the stylesheet with its JS chunk.
  const repo = join(import.meta.dir, "..");
  const output = join(root, "dist");
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"), "dir");
  symlinkSync(join(repo, "scripts/chat-history-fixture.tsx"), join(root, "fixture.tsx"));
  writeFileSync(join(root, "index.html"), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>');
  await viteBuild({ configFile: join(repo, "vite.config.ts"), root, publicDir: false, logLevel: "warn", build: { outDir: output, emptyOutDir: true } });
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    const path = new URL(request.url).pathname;
    return new Response(Bun.file(join(output, path === "/" ? "index.html" : path.slice(1))));
  } });

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors: string[] = [];
  const scripts: string[] = [];
  const mathAssets: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.resourceType() === "script") scripts.push(path);
    if (/\/katex-[^/]+\.(?:js|css)$/.test(path)) mathAssets.push(path);
  });
  await page.route("**/api/pane/conversation?*", (route) => route.fulfill({ json: conversation }));

  write("Prose only, nothing to typeset.");
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.getByText("Prose only, nothing to typeset.").waitFor();
  const atStart = scripts.length;
  assert.deepEqual(mathAssets, [], "prose fetches neither KaTeX JavaScript nor its stylesheet");
  assert.equal(await page.locator(".katex").count(), 0);

  write("Euler: \\(e^{i\\pi}+1=0\\)\n\n\\[\\int_0^1 x\\,dx = \\tfrac{1}{2}\\]");
  await page.evaluate(() => window.qa.refresh());
  await page.locator(".markdown-math .katex").waitFor();
  await page.locator(".markdown-math-display .katex-display").waitFor();
  assert.ok(scripts.length > atStart, "the first expression fetches the KaTeX chunk");
  assert.equal(mathAssets.filter((path) => path.endsWith(".js")).length, 1);
  assert.equal(mathAssets.filter((path) => path.endsWith(".css")).length, 1);
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".katex")!).fontFamily.includes("KaTeX_Main"));
  assert.match(await page.locator(".markdown-math .katex-mathml annotation").textContent() ?? "", /e\^\{i\\pi\}\+1=0/);

  // later expressions have it at once: nothing more is fetched, and no source form shows
  const loaded = scripts.length;
  write("Again: \\(a^2+b^2=c^2\\)");
  await page.evaluate(() => window.qa.refresh());
  await page.getByText("Again:").waitFor();
  await page.locator(".markdown-math .katex").waitFor();
  assert.equal(scripts.length, loaded, "KaTeX is fetched once");
  assert.equal(mathAssets.length, 2, "later expressions reuse both assets");
  assert.equal(await page.getByText("\\(a^2+b^2=c^2\\)").count(), 0, "a later expression is typeset at once");
  assert.deepEqual(errors, []);

  // offline when the first expression comes: it and every later one keep their source form, quietly
  const offline = await browser.newPage();
  offline.on("pageerror", (error) => errors.push(error.message));
  await offline.route("**/api/pane/conversation?*", (route) => route.fulfill({ json: conversation }));
  write("Prose only, nothing to typeset.");
  await offline.goto(`http://127.0.0.1:${server.port}/`);
  await offline.getByText("Prose only, nothing to typeset.").waitFor();
  let aborted = 0;
  const failedChunk = offline.waitForEvent("requestfailed", { predicate: (request) => request.resourceType() === "script", timeout: 5_000 });
  await offline.route("**/*.js", (route) => { aborted++; return route.abort(); });
  write("First: \\(x^2\\)\n\nSecond: \\(y^2\\)");
  await offline.evaluate(() => window.qa.refresh());
  await offline.getByText("\\(y^2\\)").waitFor();
  await failedChunk;
  assert.equal(await offline.locator(".katex").count(), 0);
  assert.equal(await offline.getByText("\\(x^2\\)").count(), 1, "an expression KaTeX could not reach shows its source");
  write("Later: \\(z^2\\)");
  await offline.evaluate(() => window.qa.refresh());
  await offline.getByText("\\(z^2\\)").waitFor();
  assert.equal(aborted, 1, "later expressions reuse the failed load without retrying");
  assert.equal(await offline.locator(".katex").count(), 0);
  assert.deepEqual(errors, []);
  console.log("math: browser OK (KaTeX fetched with the first expression, once; inline and display typeset; offline keeps the source)");
} finally {
  await browser?.close();
  server?.stop();
  rmSync(root, { recursive: true, force: true });
}
