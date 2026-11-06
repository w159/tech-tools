import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installDom, restoreDom, body } from "./operate-dom-stub.js";
installDom();
const { sendToSeat, sendToMember, sendToMembers, killSeat, waveAction, killMessage } = await import("./send-path.js");
restoreDom();

const fakeApi = (over = {}) => { const calls = []; return { calls, get: async (p, q) => { calls.push(["GET", p, q]); return over.get ? over.get(p, q) : {}; }, post: async (p, b) => { calls.push(["POST", p, b]); if (over.post) return over.post(p, b); return { ok: true, delivered: true }; } }; };

describe("send path", () => {
beforeEach(installDom);
afterEach(restoreDom);

test("sendToMember posts exactly one colony/<name>/send with text and project", async () => {
  const api = fakeApi();
  await sendToMember({ params: {}, project: "/p" }, "impl 1", "hi", { api });
  expect(api.calls).toEqual([["POST", "colony/impl%201/send", { text: "hi", project: "/p" }]]);
});

test("a refused send rejects with the server's error so the caller can show it", async () => {
  const api = fakeApi({ post: async () => { throw Object.assign(new Error("x"), { status: 409, error: "member_paused" }); } });
  await expect(sendToSeat({ to: "w", body: "hi", project: "/p" }, { api })).rejects.toMatchObject({ error: "member_paused" });
});

test("Everyone fans out to live members only, through the same colony send route", async () => {
  const api = fakeApi({ get: async () => ({ members: [{ name: "a", state: "running" }, { name: "b", state: "idle" }, { name: "c", state: "dead" }, { name: "d", state: "finished" }] }) });
  const r = await sendToSeat({ to: "all", body: "hi", project: "/p" }, { api });
  expect(api.calls.filter((c) => c[0] === "POST").map((c) => c[1])).toEqual(["colony/a/send", "colony/b/send"]);
  expect(r.message.delivery_text).toBe("Sent to 2 of 2 members");
});

test("sendToMembers sends one message per named member", async () => {
  const api = fakeApi();
  await sendToMembers({ params: {}, project: "/p" }, ["a", "b"], "go", { api });
  expect(api.calls.map((c) => c[1])).toEqual(["colony/a/send", "colony/b/send"]);
});

test("kill: confirm names the seat; declining makes zero api calls", async () => {
  const api = fakeApi();
  let asked = null;
  const no = await killSeat({ name: "impl-7", kind: "worker", project: "/p" }, { api, confirm: async (o) => { asked = o; return false; } });
  expect(no).toBe(false);
  expect(asked.title).toContain("impl-7");
  expect(api.calls).toEqual([]);
});

test("kill: confirmed posts colony/<name>/kill with the project", async () => {
  const api = fakeApi();
  expect(await killSeat({ name: "impl-7", project: "/p" }, { api, confirm: async () => true })).toBe(true);
  expect(api.calls).toEqual([["POST", "colony/impl-7/kill", { project: "/p" }]]);
});

test("kill: 409 member_dead is reported as member_dead, not a generic failure", async () => {
  const api = fakeApi({ post: async () => { throw Object.assign(new Error("gone"), { status: 409, error: "member_dead" }); } });
  expect(await killSeat({ name: "w", project: "/p" }, { api, confirm: async () => true })).toBe(false);
  expect(killMessage({ error: "member_dead" }, "w")).toContain("member_dead");
  expect(killMessage({ error: "boom" }, "w")).toBeNull();
});

test("pause and resume post their colony routes without a confirm; cancel asks first", async () => {
  const api = fakeApi();
  const never = async () => { throw new Error("must not confirm"); };
  await waveAction("pause", { name: "w", project: "/p" }, { api, confirm: never });
  await waveAction("resume", { name: "w", project: "/p" }, { api, confirm: never });
  expect(api.calls.map((c) => c[1])).toEqual(["colony/w/pause", "colony/w/resume"]);
  let asked = null;
  expect(await waveAction("cancel", { name: "w", project: "/p" }, { api, confirm: async (o) => { asked = o; return false; } })).toBe(false);
  expect(asked.title).toContain("w");
  expect(api.calls.length).toBe(2);
  await waveAction("cancel", { name: "w", project: "/p" }, { api, confirm: async () => true });
  expect(api.calls[2]).toEqual(["POST", "colony/w/cancel", { project: "/p" }]);
});

const toasts = () => body.children.filter((c) => c.className.split(/\s+/).includes("toast")).map((c) => ({ kind: c.attrs["data-kind"], text: c.textContent }));
const refuse = (error, why) => Object.assign(new Error(error), { status: 409, error, why });

test("Everyone with an empty or missing roster delivers nothing and says so, without posting", async () => {
  for (const roster of [{ members: [] }, {}, null, { members: [{ name: "x", state: "dead" }, { name: "y", state: "parked" }, { name: "z", state: "finished" }] }]) {
    const api = fakeApi({ get: async () => roster });
    const r = await sendToSeat({ to: "", body: "hi", project: "/p" }, { api });
    expect(r).toEqual({ ok: true, delivered: false, message: { delivery_text: "No live members to receive it" } });
    expect(api.calls.some((c) => c[0] === "POST")).toBe(false);
  }
});

test("Everyone reads the roster for the project and posts the text and project to each live member", async () => {
  const api = fakeApi({ get: async () => ({ members: [{ name: "a b", state: "running" }] }) });
  await sendToSeat({ to: undefined, body: "yo", project: "/proj" }, { api });
  expect(api.calls).toEqual([["GET", "colony", { project: "/proj" }], ["POST", "colony/a%20b/send", { text: "yo", project: "/proj" }]]);
});

test("a partial fan-out reports how many got it; delivered is true only if a member confirmed delivery", async () => {
  const roster = { members: [{ name: "a", state: "running" }, { name: "b", state: "idle" }, { name: "c", state: "idle" }] };
  const partial = fakeApi({ get: async () => roster, post: async (path) => { if (path === "colony/b/send") throw refuse("not_deliverable"); return { ok: true, delivered: false }; } });
  const r1 = await sendToSeat({ to: "all", body: "x", project: "/p" }, { api: partial });
  expect(r1).toEqual({ ok: true, delivered: false, message: { delivery_text: "Sent to 2 of 3 members" } });
  const mixed = fakeApi({ get: async () => roster, post: async (path) => { if (path === "colony/a/send") throw refuse("member_dead"); return { ok: true, delivered: path === "colony/c/send" }; } });
  const r2 = await sendToSeat({ to: "all", body: "x", project: "/p" }, { api: mixed });
  expect(r2.delivered).toBe(true);
  expect(r2.message.delivery_text).toBe("Sent to 2 of 3 members");
});

test("when every fan-out send fails, the first member's refusal is thrown", async () => {
  const roster = { members: [{ name: "a", state: "running" }, { name: "b", state: "idle" }] };
  const api = fakeApi({ get: async () => roster, post: async (path) => { throw refuse("err_" + path.split("/")[1]); } });
  await expect(sendToSeat({ to: "all", body: "x", project: "/p" }, { api })).rejects.toMatchObject({ error: "err_a" });
});

test("a direct send returns the server reply untouched", async () => {
  const reply = { ok: true, delivered: false, message: { delivery_text: "queued" } };
  const api = fakeApi({ post: async () => reply });
  expect(await sendToSeat({ to: "w", body: "hi", project: "/p" }, { api })).toBe(reply);
});

test("sendToMember falls back to ctx.params.project before ctx.project", async () => {
  const api = fakeApi();
  await sendToMember({ params: { project: "/from-params" }, project: "/ctx" }, "w", "hi", { api });
  expect(api.calls[0][2].project).toBe("/from-params");
});

test("kill: the confirm names the seat and kind, is danger-styled, and kind defaults to member", async () => {
  const asked = [];
  const ask = async (o) => { asked.push(o); return false; };
  await killSeat({ name: "impl-7", kind: "worker", project: "/p" }, { api: fakeApi(), confirm: ask });
  await killSeat({ name: "impl-8", project: "/p" }, { api: fakeApi(), confirm: ask });
  expect(asked[0]).toMatchObject({ title: "Kill impl-7?", danger: true, confirmLabel: "Kill" });
  expect(asked[0].body).toContain("Stops this worker and closes its pane");
  expect(asked[1].title).toBe("Kill impl-8?");
  expect(asked[1].body).toContain("Stops this member and closes its pane");
});

test("kill: success toasts '<name> killed' as ok", async () => {
  await killSeat({ name: "impl-7", project: "/p" }, { api: fakeApi(), confirm: async () => true });
  expect(toasts()).toEqual([{ kind: "ok", text: expect.stringContaining("impl-7 killed") }]);
});

test("kill: member_dead warns that the seat is already gone and the generic failure is an error toast with the server's reason", async () => {
  const dead = fakeApi({ post: async () => { throw refuse("member_dead"); } });
  expect(await killSeat({ name: "w", project: "/p" }, { api: dead, confirm: async () => true })).toBe(false);
  expect(toasts()).toEqual([{ kind: "warn", text: expect.stringContaining("w is already gone (member_dead): nothing to kill") }]);
  body.replaceChildren();
  const boom = fakeApi({ post: async () => { throw refuse("boom", "pane busy"); } });
  expect(await killSeat({ name: "w", project: "/p" }, { api: boom, confirm: async () => true })).toBe(false);
  const [t] = toasts();
  expect(t.kind).toBe("fail");
  expect(t.text).toContain("boom");
  expect(t.text).toContain("pane busy");
  body.replaceChildren();
  const bare = fakeApi({ post: async () => { throw {}; } });
  await killSeat({ name: "w2", project: "/p" }, { api: bare, confirm: async () => true });
  expect(toasts()[0].text).toContain("Could not kill w2");
});

test("killMessage names the seat and handles a missing error", () => {
  expect(killMessage({ error: "member_dead" }, "seat-3")).toBe("seat-3 is already gone (member_dead): nothing to kill");
  expect(killMessage(null, "w")).toBeNull();
  expect(killMessage(undefined, "w")).toBeNull();
});

test("wave actions toast the past tense with the seat name; unknown verbs throw before any call", async () => {
  const api = fakeApi();
  const yes = async () => true;
  for (const [verb, word] of [["pause", "Paused"], ["resume", "Resumed"], ["cancel", "Canceled"]]) {
    body.replaceChildren();
    expect(await waveAction(verb, { name: "w", project: "/p" }, { api, confirm: yes })).toBe(true);
    expect(toasts()).toEqual([{ kind: "ok", text: expect.stringContaining(word + " w") }]);
  }
  const before = api.calls.length;
  await expect(waveAction("explode", { name: "w", project: "/p" }, { api, confirm: yes })).rejects.toThrow("unknown wave action explode");
  expect(api.calls.length).toBe(before);
});

test("cancel confirm is danger-styled and names the seat; a declined cancel toasts nothing", async () => {
  let asked;
  await waveAction("cancel", { name: "w9", project: "/p" }, { api: fakeApi(), confirm: async (o) => { asked = o; return false; } });
  expect(asked).toMatchObject({ title: "Cancel w9?", danger: true, confirmLabel: "Cancel work" });
  expect(toasts()).toEqual([]);
});

test("a failed wave action returns false and shows an error toast naming the verb", async () => {
  const api = fakeApi({ post: async () => { throw {}; } });
  expect(await waveAction("pause", { name: "w", project: "/p" }, { api, confirm: async () => true })).toBe(false);
  expect(toasts()).toEqual([{ kind: "fail", text: expect.stringContaining("Could not pause w") }]);
});
});
