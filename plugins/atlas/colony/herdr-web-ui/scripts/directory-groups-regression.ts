/** Owned, real-browser directory grouping regression. Run after `bun run build`. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import type { Page } from "playwright-core";
import { createServer } from "../server/index.ts";
import { HerdrError, herdrRpc, sessionSnapshot, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";
import { UsageService } from "../server/usage.ts";

type State = {
  readonly selector: string;
  readonly count?: number;
  readonly attribute?: readonly [string, string];
  readonly text?: string;
};

declare global {
  interface Window {
    directoryRegressionState?: Promise<boolean>;
  }
}

/** Register before the action; only DOM mutations, never intervals, drive the wait. */
async function armState(page: Page, states: readonly State[]): Promise<void> {
  await page.evaluate((conditions) => {
    window.directoryRegressionState = new Promise<boolean>((resolve) => {
      const matches = (): boolean => conditions.every(({ selector, count, attribute, text }) => {
        const nodes = document.querySelectorAll(selector);
        if (count !== undefined && nodes.length !== count) return false;
        if (attribute && nodes[0]?.getAttribute(attribute[0]) !== attribute[1]) return false;
        if (text !== undefined && nodes[0]?.textContent !== text) return false;
        return count !== undefined || nodes.length > 0;
      });
      const finish = (matched: boolean): void => {
        observer.disconnect();
        document.removeEventListener("focusin", check);
        clearTimeout(timeout);
        resolve(matched);
      };
      const check = (): void => { if (matches()) finish(true); };
      const observer = new MutationObserver(check);
      const timeout = window.setTimeout(() => finish(false), 15_000);
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      document.addEventListener("focusin", check);
      if (matches()) finish(true);
    });
  }, states);
}

async function stateReceived(page: Page, label: string): Promise<void> {
  assert.equal(await page.evaluate(() => window.directoryRegressionState), true, `Timed out: ${label}`);
}

async function changeState(page: Page, states: readonly State[], action: () => Promise<unknown>, label: string): Promise<void> {
  await armState(page, states);
  await action();
  await stateReceived(page, label);
}

const directorySelector = (cwd: string): string => `.directory-group[data-directory=${JSON.stringify(cwd)}]`;
const paneSelector = (paneId: string): string => `.pane-select[title^=${JSON.stringify(`${paneId} —`)}]`;
const itemSelector = (paneId: string): string => `.pane-item:has(${paneSelector(paneId)})`;
const root = realpathSync(mkdtempSync(join(tmpdir(), "herdr-directory-regression-")));
// These accumulators contain only IDs created by this invocation.
const ownedWorkspaces: string[] = [];
const errors: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let server: ReturnType<typeof createServer> | undefined;

try {
  // test-herdr has live/unit escape hatches and a no-binary fallback. Never let
  // any of those silently target the user's current socket.
  assert.notEqual(process.env.HERDR_TEST_LIVE, "1", "Live-session mode is forbidden");
  assert.notEqual(process.env.HERDR_TEST_MODE, "unit", "This regression requires isolated herdr");
  process.env.HERDR_TEST_SESSION = "herdr-web-ui-test";
  const { testSocketPath } = await import("./test-herdr.ts");
  assert.equal(process.env.HERDR_SOCKET, testSocketPath(), "test-herdr must select its isolated socket");

  // Given two independent workspaces at one full cwd, a basename collision,
  // and a separate single-pane folder. No agent or shell input is started.
  const sharedCwd = join(root, "left", "project");
  const otherCwd = join(root, "right", "project");
  const loneCwd = join(root, "lone");
  for (const cwd of [sharedCwd, otherCwd, loneCwd]) mkdirSync(cwd, { recursive: true });
  const fixtures = [];
  for (const [cwd, label] of [
    [sharedCwd, "directory-regression-alpha"],
    [sharedCwd, "directory-regression-beta"],
    [otherCwd, "directory-regression-other-parent"],
    [loneCwd, "directory-regression-lone"],
  ] as const) {
    const created = await workspaceCreate({ cwd, label });
    ownedWorkspaces.push(created.workspace.workspace_id);
    fixtures.push({ cwd, label, workspaceId: created.workspace.workspace_id, paneId: created.root_pane.pane_id });
  }
  const [alpha, beta, other, lone] = fixtures;
  assert.ok(alpha && beta && other && lone);
  assert.notEqual(alpha.workspaceId, beta.workspaceId, "same cwd must still own independent workspaces");
  const split = await herdrRpc<{ pane: { pane_id: string } }>("pane.split", {
    target_pane_id: other.paneId, direction: "down", focus: false, cwd: otherCwd,
  });
  const workspaceFoldKey = `herdr-web-ui:workspace-collapsed:local:${other.workspaceId}`;
  const directoryFoldKey = `herdr-web-ui:directory-collapsed:local:directory:${otherCwd}`;
  server = createServer({
    port: 0, hostname: "127.0.0.1", token: "", tailscaleOwner: null,
    stateDir: join(root, "state"), codexHome: join(root, "codex"),
    usage: new UsageService(undefined, []),
  });
  const origin = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "/opt/google/chrome/chrome"),
    headless: true, args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await context.addInitScript(({ ids, legacyFoldKey }) => {
    // Browser locale alone does not override the app's remembered language.
    // Preserve a language changed through Settings across subsequent reloads.
    if (!localStorage.getItem("herdr-web-ui:settings")) {
      localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", alertsOn: false }));
      localStorage.setItem(legacyFoldKey, "1");
    }
    for (const id of ids) localStorage.setItem(`herdr-web-ui:view:${id}`, "chat");
  }, { ids: [...fixtures.map(({ paneId }) => paneId), split.pane.pane_id], legacyFoldKey: workspaceFoldKey });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(error.message));

  const navigate = async (action: () => Promise<unknown>, paneId: string): Promise<void> => {
    // Register the exact network signal before replacing the document. DOM
    // readiness then comes from Playwright's attached-state signal.
    const snapshot = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/machines" && response.ok());
    await action();
    await snapshot;
    await page.locator(`${paneSelector(paneId)}[aria-current="true"]`).waitFor({ state: "attached" });
  };
  const shared = directorySelector(sharedCwd);
  const distinct = directorySelector(otherCwd);
  const single = directorySelector(loneCwd);
  const header = `${shared} .directory-header[aria-expanded]`;
  const fold = async (collapsed: boolean): Promise<void> => {
    await changeState(page, [
      { selector: header, attribute: ["aria-expanded", String(!collapsed)] },
      { selector: `${shared} .directory-contents`, count: collapsed ? 0 : 1 },
    ], () => page.locator(header).click(), collapsed ? "folder folded" : "folder unfolded");
    assert.equal(await page.locator(header).getAttribute("aria-label"), `${collapsed ? "Expand" : "Collapse"} folder ${sharedCwd}`);
  };
  const evidence = process.env.UI_EVIDENCE_DIR;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const screenshot = async (name: string): Promise<void> => {
    if (evidence) await page.screenshot({ path: join(evidence, `directory-groups-${name}.png`), animations: "disabled" });
  };
  // the workspace with two panes in one tab: one row, whose strip and pane picker reach the second
  const otherWorkspace = `.workspace:has(${paneSelector(other.paneId)}), .workspace:has(${paneSelector(split.pane.pane_id)})`;
  const grouping = '.settings-dialog .segmented[aria-label="Sidebar grouping"]';
  const switchGrouping = async (mode: "workspace" | "directory", states: readonly State[]): Promise<void> => {
    const documentIdentity = await page.evaluate(() => performance.timeOrigin);
    await changeState(page, [{ selector: grouping }],
      () => page.getByRole("button", { name: "Settings", exact: true }).click(), "grouping Settings opens");
    assert.equal(await page.locator(grouping).count(), 1);
    assert.equal(await page.locator(grouping).getByRole("button", { name: "By workspace", exact: true }).count(), 1);
    assert.equal(await page.locator(grouping).getByRole("button", { name: "By folder", exact: true }).count(), 1);
    await changeState(page, states,
      () => page.locator(grouping).getByRole("button", {
        name: mode === "workspace" ? "By workspace" : "By folder", exact: true,
      }).click(), `${mode} grouping applies without reload`);
    assert.equal(await page.locator(grouping).getByRole("button", {
      name: mode === "workspace" ? "By workspace" : "By folder", exact: true,
    }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentIdentity, "grouping must not replace the document");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("herdr-web-ui:settings") ?? "{}").sidebarGrouping), mode);
    await changeState(page, [{ selector: ".settings-dialog", count: 0 }],
      () => page.keyboard.press("Escape"), "grouping Settings closes");
  };

  await navigate(() => page.goto(`${origin}/?pane=${encodeURIComponent(lone.paneId)}`), lone.paneId);
  await page.locator(paneSelector(other.paneId)).waitFor({ state: "attached" });
  assert.equal(await page.locator(".directory-group").count(), 0, "workspace is the default grouping");
  // one row per workspace, as herdr's Spaces sidebar: the split pane has no row of its own, the
  // workspace's row shows the pane herdr has in front, and nothing folds a workspace any more
  assert.equal(await page.locator(otherWorkspace).count(), 1, "a workspace with two panes is one row");
  assert.equal(await page.locator(paneSelector(split.pane.pane_id)).count(), 0);
  assert.equal(await page.locator(".workspace-toggle").count(), 0, "a legacy workspace fold has nothing to fold");
  assert.equal(await page.locator(".tab-strip").count(), 0, "no strip over a lone pane's workspace");
  for (const fixture of [alpha, beta]) {
    // A single pane is its workspace: one row with the reorder handle, no heading or toggle above
    // it. No header names the workspace, so line two does, with the folder unless the title
    // already is that folder (a shell titled by its cwd).
    const title = await page.locator(`${itemSelector(fixture.paneId)} .pane-title`).textContent();
    assert.equal(await page.locator(`${itemSelector(fixture.paneId)} .pane-subtitle`).textContent(), title === "project" ? fixture.label : `${fixture.label} · project`);
    const workspace = `.workspace:has(${paneSelector(fixture.paneId)})`;
    assert.equal(await page.locator(`${workspace} .workspace-header`).count(), 0);
    assert.equal(await page.locator(`${workspace} .workspace-toggle`).count(), 0);
    assert.equal(await page.locator(`${itemSelector(fixture.paneId)} .sidebar-drag-handle`).count(), 1);
  }
  // A fold stored while a single pane had a heading (0.3.44) must not hide a row that has no toggle.
  const singleFoldKey = `herdr-web-ui:workspace-collapsed:local:${alpha.workspaceId}`;
  await page.evaluate((key) => localStorage.setItem(key, "1"), singleFoldKey);
  await navigate(() => page.reload(), lone.paneId);
  await page.locator(paneSelector(alpha.paneId)).waitFor({ state: "visible" });
  assert.equal(await page.locator(`.workspace:has(${paneSelector(alpha.paneId)}) .workspace-toggle`).count(), 0);
  await page.evaluate((key) => localStorage.removeItem(key), singleFoldKey);
  // the second pane of a split tab is reached from the strip over the pane: its tab carries a
  // picker, which lists both panes and opens the other one; the row then shows that pane
  await changeState(page, [{ selector: paneSelector(other.paneId), attribute: ["aria-current", "true"] }, { selector: '.tab-strip [role="tab"]', count: 1 }],
    () => page.locator(paneSelector(other.paneId)).click(), "selecting the split workspace shows its strip");
  assert.equal(await page.locator('.tab-strip [role="tab"]').textContent(), "Tab 1", "a tab herdr named by its number reads as Tab 1");
  // at this width the header over the pane is the pane's surface, and the strip under it is
  // the same one, not a band of the panel's colour between header and pane
  const surfaces = await page.evaluate(() => {
    const header = document.querySelector(".app-header")!;
    const column = document.querySelector(".pane-column")!;
    return {
      headerChat: header.classList.contains("is-chat"), columnChat: column.classList.contains("is-chat"),
      header: getComputedStyle(header).backgroundColor, strip: getComputedStyle(document.querySelector(".tab-strip")!).backgroundColor,
      chat: document.querySelector(".chat-view") ? getComputedStyle(document.querySelector(".chat-view")!).backgroundColor : null,
    };
  });
  assert.equal(surfaces.columnChat, surfaces.headerChat, "the header and the pane column agree on the lens");
  assert.equal(surfaces.strip, surfaces.header, "the strip is the header's surface");
  if (surfaces.headerChat) assert.equal(surfaces.chat, surfaces.header, "which under the chat lens is the transcript's");
  await page.locator(".tab-strip-panes").click();
  const picker = page.getByRole("menu", { name: "Panes in Tab 1", exact: true });
  await picker.waitFor();
  // both panes, then the tab's own Rename tab and Close tab
  assert.deepEqual((await picker.getByRole("menuitem").allTextContents()).slice(2), ["Rename tab", "Close tab"]);
  assert.equal(await picker.getByRole("menuitem").count(), 4);
  assert.equal(await picker.locator('[role="menuitem"][aria-current="true"]').count(), 1, "the picker marks the open pane");
  await changeState(page, [{ selector: `${paneSelector(split.pane.pane_id)}[aria-current="true"]` }, { selector: paneSelector(other.paneId), count: 0 }],
    () => picker.getByRole("menuitem").nth(1).click(), "the picker opens the split pane, and the row follows it");
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    if (await page.locator(".drawer-toggle").isVisible()
      && await page.locator(".drawer-toggle").getAttribute("aria-expanded") !== "true") {
      await changeState(page, [{ selector: "#workspace-drawer.is-open" }],
        () => page.locator(".drawer-toggle").click(), `workspace drawer opens at ${width}`);
    }
    assert.equal(await page.locator(paneSelector(split.pane.pane_id)).isVisible(), true);
    assert.equal(await page.locator(".directory-group").count(), 0);
    await screenshot(`workspace-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  if (await page.locator(".drawer-toggle").isVisible() && await page.locator(".drawer-toggle").getAttribute("aria-expanded") === "true") await page.locator(".drawer-toggle").click();
  await switchGrouping("directory", [
    { selector: `${shared} .workspace`, count: 2 },
    { selector: `${distinct} ${paneSelector(split.pane.pane_id)}` },
    { selector: ".workspace-toggle", count: 0 },
  ]);
  await changeState(page, [{ selector: `${distinct} > .directory-header`, attribute: ["aria-expanded", "false"] }],
    () => page.locator(`${distinct} > .directory-header`).click(), "directory folded independently");
  for (const mode of ["workspace", "directory", "workspace", "directory"] as const) {
    await switchGrouping(mode, mode === "workspace" ? [
      { selector: ".directory-group", count: 0 },
      { selector: otherWorkspace, count: 1 },
    ] : [
      { selector: `${distinct} > .directory-header`, attribute: ["aria-expanded", "false"] },
      { selector: `${distinct} .directory-contents`, count: 0 },
      { selector: ".workspace-toggle", count: 0 },
    ]);
    assert.deepEqual(await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)),
      [workspaceFoldKey, directoryFoldKey]), ["1", "1"], "mode toggles preserve the folder fold and leave a legacy key alone");
  }
  await changeState(page, [{ selector: paneSelector(lone.paneId), attribute: ["aria-current", "true"] }],
    () => page.locator(paneSelector(lone.paneId)).click(), "lone pane selected again before the reload");
  await navigate(() => page.reload(), lone.paneId);
  await page.locator(`${distinct} > .directory-header[aria-expanded="false"]`).waitFor({ state: "attached" });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("herdr-web-ui:settings") ?? "{}").sidebarGrouping), "directory");
  assert.deepEqual(await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)),
    [workspaceFoldKey, directoryFoldKey]), ["1", "1"], "reload preserves grouping and independent folds");
  await changeState(page, [{ selector: `${distinct} .workspace`, count: 1 }],
    () => page.locator(`${distinct} > .directory-header`).click(), "folder unfolds without touching the legacy key");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), workspaceFoldKey), "1");

  // A deliberate fold of the selected pane must survive switching away and
  // back: mode identity is independent from selection identity.
  await changeState(page, [{ selector: paneSelector(other.paneId), attribute: ["aria-current", "true"] }],
    () => page.locator(paneSelector(other.paneId)).click(), "other pane selected");
  await changeState(page, [{ selector: `${distinct} > .directory-header`, attribute: ["aria-expanded", "false"] }],
    () => page.locator(`${distinct} > .directory-header`).click(), "selected directory deliberately folded");
  await switchGrouping("workspace", [
    { selector: ".directory-group", count: 0 },
    { selector: paneSelector(other.paneId), attribute: ["aria-current", "true"] },
  ]);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), directoryFoldKey), "1",
    "revealing a selection in workspace mode preserves its directory fold");
  await switchGrouping("directory", [
    { selector: `${distinct} > .directory-header`, attribute: ["aria-expanded", "false"] },
    { selector: `${distinct} .directory-contents`, count: 0 },
  ]);
  await switchGrouping("workspace", [
    { selector: ".directory-group", count: 0 },
    { selector: otherWorkspace, count: 1 },
  ]);
  assert.deepEqual(await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)),
    [workspaceFoldKey, directoryFoldKey]), ["1", "1"], "selected-pane mode toggles do not clear stored folds");
  await changeState(page, [{ selector: paneSelector(lone.paneId), attribute: ["aria-current", "true"] }],
    () => page.locator(paneSelector(lone.paneId)).click(), "selection outside folded workspace");
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), workspaceFoldKey), "1");
  await navigate(() => page.reload(), lone.paneId);
  await page.locator(paneSelector(other.paneId)).waitFor({ state: "attached" });
  assert.equal(await page.locator(".directory-group").count(), 0, "workspace preference also survives reload");
  await switchGrouping("directory", [
    { selector: `${distinct} > .directory-header`, attribute: ["aria-expanded", "false"] },
  ]);
  await changeState(page, [{ selector: `${distinct} ${paneSelector(other.paneId)}` }],
    () => page.locator(`${distinct} > .directory-header`).click(), "restore directory scenario");
  await changeState(page, [{ selector: paneSelector(split.pane.pane_id), count: 0 }],
    () => herdrRpc("pane.close", { pane_id: split.pane.pane_id }), "remove only the owned split fixture");
  console.log("PASS default workspace, live Settings grouping, reload persistence and independent legacy/directory folds");

  // When opening a pane outside the shared folder, Then grouping merges only
  // the folder: both independent workspace rows and their labels remain.
  await page.locator(paneSelector(beta.paneId)).waitFor({ state: "attached" });
  assert.equal(await page.locator(shared).count(), 1, "one full cwd has exactly one folder");
  assert.equal(await page.locator(`${shared} .directory-contents .workspace`).count(), 2);
  for (const fixture of [alpha, beta]) {
    assert.equal(await page.locator(`${shared} ${paneSelector(fixture.paneId)}`).count(), 1);
    assert.equal(await page.locator(`${itemSelector(fixture.paneId)} .pane-subtitle`).textContent(), fixture.label);
  }
  assert.equal(await page.locator(`${shared} > .directory-header .workspace-number`).textContent(), "2");
  assert.equal(await page.locator(distinct).count(), 1, "same basename in another parent stays separate");
  assert.equal(await page.locator(`${distinct} ${paneSelector(other.paneId)}`).count(), 1);
  assert.equal(await page.locator(`${distinct} ${paneSelector(alpha.paneId)}`).count(), 0);
  assert.equal(await page.locator(`${distinct} > .directory-header .directory-name`).textContent(),
    await page.locator(`${shared} > .directory-header .directory-name`).textContent());
  assert.equal(await page.locator(`${single} > .directory-header[aria-expanded="true"]`).count(), 1, "a lone pane keeps a folder header");
  assert.equal(await page.locator(`${single} .workspace`).count(), 1);
  assert.equal(await page.locator(header).getAttribute("aria-label"), `Collapse folder ${sharedCwd}`);
  for (const fixture of [alpha, beta, lone]) {
    await changeState(page, [{ selector: paneSelector(fixture.paneId), attribute: ["aria-current", "true"] }],
      () => page.locator(paneSelector(fixture.paneId)).click(), `session click selects ${fixture.label}`);
    const selected = await page.evaluate(() => JSON.parse(sessionStorage.getItem("herdr-web-ui:selection") ?? "null"));
    assert.equal(selected?.pane_id, fixture.paneId);
    assert.equal(await page.locator(".context-sub").textContent().then((text) => text?.includes(fixture.label)), true);
  }

  // Alt+Arrow acts on the real workspace handle, even when its folder merges
  // two workspaces. Verify both optimistic DOM order and herdr's persisted order.
  const moveResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/workspace/move")
    && response.request().postDataJSON().workspace_id === beta.workspaceId);
  await changeState(page, [{ selector: `${shared} .workspace:first-child ${paneSelector(beta.paneId)}` }],
    () => page.locator(itemSelector(beta.paneId)).getByRole("button", {
      name: `Reorder workspace ${beta.label}`, exact: true,
    }).press("Alt+ArrowUp"), "keyboard reorder moves beta ahead of alpha");
  assert.equal((await moveResponse).status(), 200);
  const reordered = await sessionSnapshot();
  assert.ok(reordered.workspaces.findIndex((workspace) => workspace.workspace_id === beta.workspaceId)
    < reordered.workspaces.findIndex((workspace) => workspace.workspace_id === alpha.workspaceId));
  assert.equal(await page.locator(`${shared} .workspace`).count(), 2);
  await screenshot("1280");
  console.log("PASS same-full-cwd grouping preserves independent workspaces, full paths and lone headers");

  // When folding an unselected folder and reloading, Then its stored fold survives.
  await fold(true);
  await screenshot("folded");
  await navigate(() => page.reload(), lone.paneId);
  await page.locator(`${shared} > .directory-header[aria-expanded="false"]`).waitFor({ state: "attached" });
  assert.equal(await page.locator(`${shared} .directory-contents`).count(), 0, "fold survives reload");
  assert.equal(await page.locator(`${distinct} .directory-header`).getAttribute("aria-expanded"), "true", "basename collision does not inherit the fold");
  assert.equal(await page.locator(`${single} .directory-header`).getAttribute("aria-expanded"), "true");

  // When navigating to ?pane in the folded folder, Then it reveals that pane.
  await navigate(() => page.goto(`${origin}/?pane=${encodeURIComponent(beta.paneId)}`), beta.paneId);
  assert.equal(await page.locator(header).getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator(`${shared} .directory-contents .workspace`).count(), 2);

  // When a real status update replaces the snapshot while its selected folder
  // is deliberately folded, Then the fold is not mistaken for a new selection.
  await fold(true);
  await changeState(page, [
    { selector: `${itemSelector(lone.paneId)} .badge[data-status="working"]` },
  ], () => herdrRpc("pane.report_agent", {
    pane_id: lone.paneId, source: "manual", agent: "claude", state: "working",
  }), "real streamed status updates the visible lone pane");
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/machines" && response.ok());
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const snapshotResponse = await refreshed;
  await snapshotResponse.finished();
  // The visible lone-pane status above is the exact DOM signal that the new
  // status snapshot rendered. The HTTP response is additional network evidence,
  // not a reason to wait an arbitrary number of animation frames.
  assert.equal(await page.locator(header).getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator(`${shared} .directory-contents`).count(), 0);
  const selection = await page.evaluate(() => JSON.parse(sessionStorage.getItem("herdr-web-ui:selection") ?? "null"));
  assert.equal(selection?.pane_id, beta.paneId, "status snapshots preserve selection as well as its deliberate fold");
  await fold(false);
  console.log("PASS folding survives reload, ?pane unfolds, and status snapshots preserve deliberate folds");

  // Given the grouped independent panes, When renaming one through its real
  // row action, Then only that pane changes and the shared directory remains.
  const renamed = "directory-regression-renamed-alpha";
  await page.locator(itemSelector(alpha.paneId)).hover();
  await changeState(page, [{ selector: ".pane-rename-input" }],
    async () => {
      await page.locator(`${itemSelector(alpha.paneId)} .row-menu-toggle`).click();
      await page.getByRole("menuitem", { name: "Rename pane", exact: true }).click();
    }, "rename editor opens");
  await page.locator(".pane-rename-input").fill(renamed);
  const renameResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/pane/rename")
    && response.request().postDataJSON().pane_id === alpha.paneId);
  await armState(page, [{ selector: `${itemSelector(alpha.paneId)} .pane-title`, text: renamed }]);
  await page.locator(".pane-rename-input").press("Enter");
  assert.equal((await renameResponse).status(), 200);
  await stateReceived(page, "renamed pane rendered in its original directory");
  assert.equal(await page.locator(`${shared} .workspace`).count(), 2);
  assert.equal(await page.locator(`${itemSelector(beta.paneId)} .pane-subtitle`).textContent(), beta.label);
  const renamedSnapshot = await sessionSnapshot();
  assert.equal(renamedSnapshot.panes.find((pane) => pane.pane_id === alpha.paneId)?.label, renamed);
  assert.equal(renamedSnapshot.panes.find((pane) => pane.pane_id === beta.paneId)?.workspace_id, beta.workspaceId);
  console.log("PASS rename stays attached to its independent workspace inside the shared folder");

  // When the selected shell changes cwd into a deliberately folded destination,
  // Then its new full-path folder is revealed without changing the selection.
  await changeState(page, [
    { selector: `${distinct} > .directory-header`, attribute: ["aria-expanded", "false"] },
    { selector: `${distinct} .directory-contents`, count: 0 },
  ], () => page.locator(`${distinct} > .directory-header`).click(), "destination deliberately folded");
  await changeState(page, [
    { selector: `${distinct} > .directory-header`, attribute: ["aria-expanded", "true"] },
    { selector: `${distinct} ${paneSelector(beta.paneId)}`, attribute: ["aria-current", "true"] },
    { selector: `${shared} ${paneSelector(beta.paneId)}`, count: 0 },
  ], async () => {
    await herdrRpc("pane.send_text", { pane_id: beta.paneId, text: `cd -- '${otherCwd}'` });
    await herdrRpc("pane.send_keys", { pane_id: beta.paneId, keys: ["Enter"] });
  }, "selected pane cwd change reveals the destination folder");
  assert.equal(await page.locator(`${distinct} .workspace`).count(), 2);
  assert.equal(await page.locator(`${shared} .workspace`).count(), 1);
  assert.equal((await sessionSnapshot()).panes.find((pane) => pane.pane_id === beta.paneId)?.cwd, otherCwd);
  await changeState(page, [
    { selector: `${shared} ${paneSelector(beta.paneId)}`, attribute: ["aria-current", "true"] },
    { selector: `${distinct} ${paneSelector(beta.paneId)}`, count: 0 },
  ], async () => {
    await herdrRpc("pane.send_text", { pane_id: beta.paneId, text: `cd -- '${sharedCwd}'` });
    await herdrRpc("pane.send_keys", { pane_id: beta.paneId, keys: ["Enter"] });
  }, "selected shell returns to the shared folder");
  console.log("PASS clicked selection, keyboard workspace reorder and selected cwd-change reveal");

  // When one workspace's panes sit in two folders, each folder shows a row for it, opening the
  // pane in that folder. Then renaming the workspace from one row opens one editor that keeps
  // the focus: two would take it from each other and close on the blur.
  let away = "";
  await armState(page, [
    { selector: `${single} .workspace`, count: 2 },
  ]);
  away = (await herdrRpc<{ pane: { pane_id: string } }>("pane.split", {
    target_pane_id: other.paneId, direction: "down", focus: false, cwd: loneCwd,
  })).pane.pane_id;
  await stateReceived(page, "a workspace split over two folders has a row in both");
  assert.equal(await page.locator(`${single} ${paneSelector(away)}`).count(), 1);
  assert.equal(await page.locator(`${distinct} ${paneSelector(other.paneId)}`).count(), 1);
  await changeState(page, [{ selector: ".workspace-rename-input:focus", count: 1 }, { selector: ".workspace-rename-input", count: 1 }],
    async () => {
      await page.locator(`${single} ${itemSelector(away)} .row-menu-toggle`).click();
      await page.getByRole("menuitem", { name: "Rename workspace", exact: true }).click();
    }, "one workspace rename editor opens and keeps the focus");
  await changeState(page, [{ selector: ".workspace-rename-input", count: 0 }],
    () => page.locator(".workspace-rename-input").press("Escape"), "workspace rename editor closes on Escape");
  await changeState(page, [{ selector: paneSelector(away), count: 0 }],
    () => herdrRpc("pane.close", { pane_id: away }), "remove only the owned second-folder pane");
  console.log("PASS a workspace shown under two folders has a row in each and one rename editor");

  // Capture each requested viewport with the drawer actually open on mobile.
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    if (await page.locator(".drawer-toggle").isVisible()
      && await page.locator(".drawer-toggle").getAttribute("aria-expanded") !== "true") {
      await changeState(page, [{ selector: "#workspace-drawer.is-open" }],
        () => page.locator(".drawer-toggle").click(), `drawer opens at ${width}`);
    }
    assert.equal(await page.locator(header).isVisible(), true, `folder header visible at ${width}`);
    await screenshot(String(width));
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator(header).hover();
  assert.equal(await page.locator(header).evaluate((element) => element.matches(":hover")), true);
  await screenshot("hover");
  // Establish keyboard modality before focusing the exact header. The active
  // drawer's tab order varies when its responsive layout changes.
  await page.keyboard.press("Tab");
  await changeState(page, [{ selector: `${header}:focus-visible` }],
    () => page.locator(header).focus(), "keyboard focus on directory header");
  await screenshot("focus");

  // Switch through the real Settings surface for Korean evidence; fictional
  // labels and owned temp paths are the only session data staged in this page.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".settings-dialog").waitFor({ state: "attached" });
  await page.locator(grouping).scrollIntoViewIfNeeded();
  const groupingControl = await page.locator(grouping).elementHandle();
  assert.ok(groupingControl);
  await screenshot("settings-en");
  await changeState(page, [{ selector: "html", attribute: ["lang", "ko-KR"] }],
    () => page.locator(".settings-dialog").getByRole("button", { name: "한국어", exact: true }).click(),
    "Settings changes the UI language to Korean");
  await groupingControl.scrollIntoViewIfNeeded();
  await screenshot("settings-ko");
  await page.setViewportSize({ width: 375, height: 900 });
  await groupingControl.scrollIntoViewIfNeeded();
  const mobileGrouping = await groupingControl.boundingBox();
  assert.ok(mobileGrouping && mobileGrouping.x >= 0 && mobileGrouping.x + mobileGrouping.width <= 375, "mobile grouping choices fit the viewport");
  await screenshot("settings-ko-375");
  await page.setViewportSize({ width: 1280, height: 900 });
  await changeState(page, [{ selector: ".settings-dialog", count: 0 }],
    () => page.keyboard.press("Escape"), "Korean Settings closes");
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    if (await page.locator(".drawer-toggle").isVisible()
      && await page.locator(".drawer-toggle").getAttribute("aria-expanded") !== "true") {
      await changeState(page, [{ selector: "#workspace-drawer.is-open" }],
        () => page.locator(".drawer-toggle").click(), `Korean drawer opens at ${width}`);
    }
    assert.equal(await page.locator(header).isVisible(), true);
    await screenshot(`ko-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.locator(".settings-dialog").waitFor({ state: "attached" });
  await changeState(page, [{ selector: "html", attribute: ["lang", "en-US"] }],
    () => page.locator(".settings-dialog").getByRole("button", { name: "English", exact: true }).click(),
    "Settings restores English action locators");
  await changeState(page, [{ selector: ".settings-dialog", count: 0 }],
    () => page.keyboard.press("Escape"), "English Settings closes");

  // When closing one grouped pane through its row menu, Then
  // its sibling survives, still under the same full-path header.
  const closeOwnedPane = async (paneId: string, states: readonly State[]): Promise<void> => {
    // from the row's ⋯ menu: a lone pane takes the workspace with it, so a confirm asks first
    const item = page.locator(itemSelector(paneId));
    await item.hover();
    await item.locator(".row-menu-toggle").click();
    const response = page.waitForResponse((candidate) => candidate.request().method() === "POST"
      && new URL(candidate.url()).pathname.endsWith("/pane/close")
      && candidate.request().postDataJSON().pane_id === paneId);
    await armState(page, states);
    await page.getByRole("menuitem", { name: "Close", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Close", exact: true }).click();
    assert.equal((await response).status(), 200);
    await stateReceived(page, "owned pane removed from directory tree");
  };
  await closeOwnedPane(alpha.paneId, [
    { selector: paneSelector(alpha.paneId), count: 0 },
    { selector: `${shared} .workspace`, count: 1 },
    { selector: `${shared} > .directory-header .workspace-number`, text: "1" },
  ]);
  assert.equal(await page.locator(`${shared} ${paneSelector(beta.paneId)}`).count(), 1);
  assert.equal(await page.locator(`${shared} > .directory-header[aria-expanded="true"]`).count(), 1);
  await closeOwnedPane(beta.paneId, [{ selector: shared, count: 0 }]);
  assert.equal(await page.locator(`${distinct} ${paneSelector(other.paneId)}`).count(), 1);
  assert.equal(await page.locator(`${single} ${paneSelector(lone.paneId)}`).count(), 1);
  assert.deepEqual(errors, [], "no browser page errors");
  console.log("PASS close removes only the owned pane, retains a lone header, then removes the empty folder");
} finally {
  // Attempt every cleanup even if an earlier teardown fails; never close an
  // unowned resident workspace from test-herdr or any other invocation.
  const cleanupErrors: unknown[] = [];
  try { await browser?.close(); } catch (error) { cleanupErrors.push(error); }
  try { server?.stop(); } catch (error) { cleanupErrors.push(error); }
  for (const id of ownedWorkspaces) {
    try { await workspaceClose(id); } catch (error) {
      // Closing the last pane can already have removed its workspace.
      if (!(error instanceof HerdrError && error.code === "workspace_not_found")) cleanupErrors.push(error);
    }
  }
  try { rmSync(root, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) {
    console.error(new AggregateError(cleanupErrors, "Directory regression cleanup failed"));
    process.exitCode = 1;
  }
}
