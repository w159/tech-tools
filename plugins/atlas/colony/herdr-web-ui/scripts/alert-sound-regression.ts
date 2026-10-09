import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";
import { herdrRpc, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";

/**
 * The alert sound: real herdr status changes make the open tab chime, once a tap let the page
 * play audio, and never for the pane already open. Alerts that come together in
 * a tab chime once. The page's AudioContext is a recorder that starts suspended
 * like a real one, so what would have sounded is the notes it was asked for.
 */
export async function checkAlertSound(browser: Browser, origin: string): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "herdr-web-ui-alert-sound-"));
  const workspaces: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  try {
    const panes: string[] = [];
    for (const suffix of ["open", "other", "third"]) {
      const cwd = join(root, suffix);
      mkdirSync(cwd);
      const created = await workspaceCreate({ cwd, label: `herdr-web-ui-test-sound-${suffix}` });
      workspaces.push(created.workspace.workspace_id);
      panes.push(created.root_pane.pane_id);
    }
    const [openPane, otherPane, thirdPane] = panes as [string, string, string];
    const report = (pane: string, state: string) => herdrRpc("pane.report_agent", { pane_id: pane, source: "manual", agent: "claude", state });
    await report(openPane, "idle");
    await report(otherPane, "idle");
    await report(thirdPane, "idle");

    await context.addInitScript(() => {
      if (localStorage.getItem("herdr-web-ui:settings") === null) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", alertDone: "off", alertSound: true }));
      const notes: number[] = [];
      const recorded = window as unknown as { chimes: number[]; chimeEnd: number };
      recorded.chimes = notes;
      recorded.chimeEnd = 0;
      class RecordingAudioContext {
        state = "suspended";
        // a real context's clock runs on its own: the app tells a chime still sounding by it
        get currentTime() { return performance.now() / 1000; }
        destination = {};
        async resume() { this.state = "running"; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (node: unknown) => node }; }
        createOscillator() {
          const oscillator = {
            type: "", frequency: { value: 0 }, connect: (node: unknown) => node,
            start() { notes.push(oscillator.frequency.value); },
            stop(at: number) { recorded.chimeEnd = Math.max(recorded.chimeEnd, at); },
          };
          return oscillator;
        }
      }
      Object.assign(window, { AudioContext: RecordingAudioContext });
      // A visible working badge can come from a roster snapshot before the collector has
      // subscribed to these newly created panes. Observe a real status event before testing alerts.
      const statuses: Record<string, string> = {};
      const NativeEvents = window.EventSource;
      class ObservedEvents extends NativeEvents {
        constructor(url: string | URL, init?: EventSourceInit) {
          super(url, init);
          this.addEventListener("message", (event) => {
            const message = JSON.parse(event.data)?.message;
            if (message?.type === "pane-status") statuses[message.pane_id] = message.agent_status;
          });
        }
      }
      Object.assign(window, { EventSource: ObservedEvents, soundStatuses: statuses });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/?pane=${encodeURIComponent(openPane)}`);
    await page.locator(".conn-live").waitFor();
    const chimes = (tab: Page = page) => tab.evaluate(() => [...(window as unknown as { chimes: number[] }).chimes]);
    // the app must have seen the pane work before it waits: a wait first seen is no news
    const seen = (pane: string, status: string, tab: Page = page) => tab.locator(`.pane-item:has(.pane-select[title^="${pane} —"]) [data-status="${status}"]`).first().waitFor({ state: "attached" });
    // a tab's last chime ended: an alert after it is not told by it
    const quiet = (tab: Page) => tab.waitForFunction(() => performance.now() / 1000 >= (window as unknown as { chimeEnd: number }).chimeEnd);
    // The card for a waiting pane leaves by itself after a few seconds, so nothing is awaited
    // between the report and the wait for the card. Only the pane in front, which gets no card,
    // is followed to `blocked` in the sidebar.
    const block = async (pane: string, inFront = false) => {
      await report(pane, "working");
      await seen(pane, "working");
      await report(pane, "blocked");
      if (inFront) await seen(pane, "blocked");
    };

    // The collector reopens its subscriptions after the pane set changes. Prime only owned
    // fixture statuses until working arrives as an event, not merely in a polled snapshot.
    for (const deadline = Date.now() + 10_000; !(await page.evaluate((pane) =>
      (window as unknown as { soundStatuses: Record<string, string> }).soundStatuses[pane] === "working", otherPane));) {
      assert.ok(Date.now() < deadline, "the status subscription includes the new panes");
      await report(otherPane, "idle");
      await report(otherPane, "working");
      await page.waitForTimeout(50);
    }
    // no tap yet: the page may not play, and nothing is kept to sound later
    await block(otherPane);
    await page.locator(".droplet-card").waitFor({ state: "visible" });
    assert.deepEqual(await chimes(), [], "no chime before a gesture");
    console.log("PASS no alert sound before the page was tapped");

    await page.locator(".droplet-card").click();
    await page.locator(".droplet").waitFor({ state: "detached" });
    // the tap opened the other pane: it is the one in front now
    await report(otherPane, "idle");
    await report(openPane, "idle");
    await block(otherPane, true);
    await block(openPane);
    // the pane in front was seen waiting before the other was reported, and the card drops in
    // with the chime: by the time the card for the pane behind shows, a chime for the pane in
    // front would have sounded already
    await page.locator(".droplet-card").waitFor({ state: "visible" });
    assert.deepEqual(await chimes(), [660, 880], "one rising chime, for the pane not in front");
    console.log("PASS a pane that waits chimes, the one in front does not");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const sound = page.getByRole("switch", { name: "Sound", exact: true });
    await sound.click();
    assert.equal(await sound.getAttribute("aria-checked"), "false");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("herdr-web-ui:settings") ?? "{}").alertSound), false);
    await sound.click();
    await page.waitForFunction(() => (window as unknown as { chimes: number[] }).chimes.length >= 4);
    assert.deepEqual((await chimes()).slice(2), [880, 660], "turning it on plays a preview");
    await sound.scrollIntoViewIfNeeded();
    if (process.env.UI_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, "alert-sound-settings.png") });
    console.log("PASS Settings turns the alert sound off and on, with a preview");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Settings" }).waitFor({ state: "detached" });

    // two panes start waiting at the same moment: one chime tells both
    await quiet(page);
    const before = (await chimes()).length;
    await report(openPane, "idle");
    for (const pane of [openPane, thirdPane]) {
      await report(pane, "working");
      await seen(pane, "working");
    }
    await Promise.all([report(openPane, "blocked"), report(thirdPane, "blocked")]);
    for (const pane of [openPane, thirdPane]) await seen(pane, "blocked");
    // the chime for the two is asked for, and then it has ended: a second one, for the other
    // pane, would have been asked for while the first still sounded
    await page.waitForFunction((count) => (window as unknown as { chimes: number[] }).chimes.length >= count + 2, before);
    await quiet(page);
    assert.deepEqual((await chimes()).slice(before), [660, 880], "one chime for two panes that wait together");
    console.log("PASS two panes that wait together chime once");

    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    // closing the last pane can already have removed the workspace; any other failure is reported
    for (const workspace of workspaces) await workspaceClose(workspace).catch((error) => { if (error?.code !== "workspace_not_found") throw error; });
    rmSync(root, { recursive: true, force: true });
  }
}
