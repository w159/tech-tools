import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { installDom, restoreDom } from "./operate-dom-stub.js";
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
});
