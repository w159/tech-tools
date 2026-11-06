import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installRichDom, restoreRichDom } from "../rich-dom.js";
import { agentsStore } from "../agents-store.js";
import { api } from "../api.js";

let dom, page, calls, stream, savedApi, savedAgents, ctx;
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
const until = async (cond, what = "condition") => { const end = Date.now() + 2000; while (!cond()) { if (Date.now() > end) throw new Error("timed out: " + what); await new Promise((r) => realTimers.setTimeout(r, 1)); } };
const channelReads = () => calls.filter((c) => c === "channels").length;

beforeEach(async () => {
  dom = installRichDom();
  ({ default: page } = await import("./channels.js"));
  calls = [];
  stream = null;
  savedApi = { get: api.get, stream: api.stream, probe: api.probe };
  savedAgents = agentsStore.getState().agents;
  // the store's own reads are answered with an empty herd; the stream is captured so tests can push events
  api.get = async () => ({ agents: [], workspaces: [], phases: [], messages: [], projects: [] });
  api.stream = (opts) => { stream = opts; return { close() {} }; };
  api.probe = async () => ({ up: true });
  globalThis.setTimeout = () => 0; // State() arms 600ms/8s timers; none may fire
  globalThis.clearTimeout = () => {};
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
  ctx = { project: "/w/app", params: {}, navigate() {}, openAgent() {}, setProject() {}, store: { get: () => [] }, api: { get: async (path) => { calls.push(path); return { channels: [] }; } } };
});
afterEach(() => {
  page.destroy();
  agentsStore.stop();
  api.get = savedApi.get; api.stream = savedApi.stream; api.probe = savedApi.probe;
  agentsStore.getState().agents = savedAgents;
  Object.assign(globalThis, { setTimeout: realTimers.setTimeout, clearTimeout: realTimers.clearTimeout, setInterval: realTimers.setInterval, clearInterval: realTimers.clearInterval });
  restoreRichDom();
});

describe("channels page", () => {
  test("describes itself as the Operate group's Channels page", () => {
    expect([page.id, page.title, page.icon, page.group]).toEqual(["channels", "Channels", "irc", "Operate"]);
  });
  test("render returns a page wrapper holding the channel lens body and reads the channel list", async () => {
    const mount = page.render(ctx);
    expect(mount.className).toContain("is-chan");
    expect(mount.className).toContain("agents-page");
    expect(mount.querySelector(".agents-body")).not.toBeNull();
    await until(() => channelReads() === 1, "channel list read");
  });
  test("an irc event from the live stream re-reads the channels", async () => {
    page.render(ctx);
    await until(() => channelReads() === 1);
    await agentsStore.start({ project: "all" });
    stream.onEvent("irc", { messages: [] });
    await until(() => channelReads() === 2, "second channel read");
  });
  test("other events do not re-read", async () => {
    page.render(ctx);
    await until(() => channelReads() === 1);
    await agentsStore.start({ project: "all" });
    stream.onEvent("todos", { phases: [] });
    await new Promise((r) => realTimers.setTimeout(r, 20));
    expect(channelReads()).toBe(1);
  });
  test("while a select has focus the irc event is ignored so the draft is kept", async () => {
    page.render(ctx);
    await until(() => channelReads() === 1);
    await agentsStore.start({ project: "all" });
    const sel = document.createElement("select");
    dom.body.appendChild(sel);
    sel.focus();
    expect(document.activeElement).toBe(sel);
    stream.onEvent("irc", { messages: [] });
    await new Promise((r) => realTimers.setTimeout(r, 20));
    expect(channelReads()).toBe(1);
    sel.blur();
    stream.onEvent("irc", { messages: [] });
    await until(() => channelReads() === 2, "refresh once select is gone");
  });
  test("a focused non-select element does not block the refresh", async () => {
    page.render(ctx);
    await until(() => channelReads() === 1);
    await agentsStore.start({ project: "all" });
    const input = document.createElement("input");
    dom.body.appendChild(input);
    input.focus();
    stream.onEvent("irc", { messages: [] });
    await until(() => channelReads() === 2);
  });
  test("destroy stops the sync: later events read nothing", async () => {
    page.render(ctx);
    await until(() => channelReads() === 1);
    await agentsStore.start({ project: "all" });
    page.destroy();
    stream.onEvent("irc", { messages: [] });
    await new Promise((r) => realTimers.setTimeout(r, 20));
    expect(channelReads()).toBe(1);
  });
  test("destroy unsubscribes from the store and is safe to repeat", () => {
    page.render(ctx);
    page.destroy();
    expect(() => page.destroy()).not.toThrow();
  });
  test("rendering again replaces the previous sync, so one event reads once", async () => {
    page.render(ctx);
    await until(() => channelReads() === 1);
    page.render(ctx);
    await until(() => channelReads() === 2);
    await agentsStore.start({ project: "all" });
    stream.onEvent("irc", { messages: [] });
    await until(() => channelReads() >= 3);
    await new Promise((r) => realTimers.setTimeout(r, 20));
    expect(channelReads()).toBe(3);
  });
  test("load tears down any earlier render and resolves null", async () => {
    page.render(ctx);
    await until(() => channelReads() === 1);
    await agentsStore.start({ project: "all" });
    expect(await page.load()).toBeNull();
    stream.onEvent("irc", { messages: [] });
    await new Promise((r) => realTimers.setTimeout(r, 20));
    expect(channelReads()).toBe(1);
  });
  test("a store change repaints the lens only while the page is mounted", async () => {
    const mount = page.render(ctx);
    await until(() => channelReads() === 1);
    await until(() => mount.querySelector(".state-empty"));
    mount.querySelector(".agents-body").textContent = "";
    await agentsStore.start({ project: "all" });
    stream.onMode("poll");
    await until(() => mount.querySelector(".state-empty"), "repaint on store change");
    page.destroy();
    mount.querySelector(".agents-body").textContent = "";
    stream.onMode("live");
    await new Promise((r) => realTimers.setTimeout(r, 20));
    expect(mount.querySelector(".agents-body").textContent).toBe("");
  });
});
